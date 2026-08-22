/**
 * Núcleo de la reserva, fuera de la server action para poder probarlo.
 * La action queda como envoltorio: lee la IP del request y delega acá.
 */
import { prisma } from "@/lib/prisma";
import { EstadoTurno, OrigenTurno } from "@prisma/client";
import { SinCredenciales } from "@/lib/mercadopago";
import { generarLinkDePago } from "@/lib/pagos";
import { normalizarDominio } from "@/lib/dominio";
import {
  primera, validarNombre, validarEmail, validarTelefono, validarAnio,
  validarDominio, validarCombustible, recortar,
} from "@/lib/validaciones";
import { EN_ESPERA } from "@/lib/disponibilidad";

export interface DatosReserva {
  slug: string;
  tipoVehiculoId: number;
  lineaId: number;
  inicioIso: string;
  duracionMin: number;
  nombre: string;
  dominio: string;
  anio: string;
  email: string;
  telefono: string;
  combustible: string;
  acepta: boolean;
}

export type ResultadoReserva =
  | { ok: true; publicId: string; urlPago: string | null }
  | {
      ok: false;
      motivo: "CUPO_TOMADO" | "SIN_CONSENTIMIENTO" | "DATOS_INVALIDOS" | "TURNO_PENDIENTE" | "PAGO_NO_DISPONIBLE";
      /** Qué campo falló y por qué. El sistema viejo devolvía "Datos inválidos" a secas. */
      campo?: string;
      detalle?: string;
    };

/**
 * Marca como vencida la reserva que retiene un cupo, si su plazo ya pasó.
 *
 * Devuelve si liberó algo. La condición sobre `venceAt` va en el propio UPDATE
 * —no se lee y después se escribe— para que dos personas reservando el mismo
 * horario al mismo tiempo no liberen las dos el mismo cupo y se pisen.
 */
async function vencerOcupante(lineaId: number, inicio: Date): Promise<boolean> {
  const { count } = await prisma.turno.updateMany({
    where: {
      lineaId,
      inicio,
      estado: { in: EN_ESPERA },
      venceAt: { lt: new Date() },
    },
    data: { estado: EstadoTurno.EXPIRADO, venceAt: null, pagoUrl: null },
  });
  return count > 0;
}

export async function reservar(
  d: DatosReserva,
  ip: string | null,
  reintento = false
): Promise<ResultadoReserva> {
  if (!d.acepta) return { ok: false, motivo: "SIN_CONSENTIMIENTO" };

  const planta = await prisma.planta.findUniqueOrThrow({ where: { slug: d.slug } });

  // El navegador ya validó todo esto, y eso no cuenta: una server action es un
  // endpoint y el navegador es de quien lo está usando. Se revalida acá.
  const tipo = await prisma.tipoVehiculo.findUnique({
    where: { id: d.tipoVehiculoId },
    include: { categoria: { select: { codigo: true } } },
  });
  if (!tipo) return { ok: false, motivo: "DATOS_INVALIDOS", campo: "tipoVehiculo", detalle: "Tipo de vehículo inexistente" };

  const requeridos = (planta.camposRequeridos as string[]) ?? [];
  const falla = primera(
    validarNombre(d.nombre),
    // Estricto: acá el formato atrapa el error de tipeo antes de que la persona
    // reserve para un vehículo que no existe y se presente con otro.
    validarDominio(d.dominio, { categoria: tipo.categoria.codigo, estricto: true }),
    validarEmail(d.email),
    requeridos.includes("anio") ? validarAnio(d.anio) : null,
    requeridos.includes("telefono") ? validarTelefono(d.telefono) : null,
    requeridos.includes("combustible")
      ? validarCombustible(d.combustible, planta.tiposCombustible as string[])
      : null
  );
  if (falla) {
    return { ok: false, motivo: "DATOS_INVALIDOS", campo: falla.campo, detalle: falla.mensaje };
  }

  // La patente, en la forma en que se guarda. Contar con una forma y guardar
  // con otra hacía que el tope por patente no coincidiera nunca para quien
  // escribiera guiones.
  const dominio = normalizarDominio(d.dominio);

  // Tope de turnos activos por patente, si la planta lo configuró.
  if (planta.turnosActivosPorPatente !== null) {
    const activos = await prisma.turno.count({
      where: {
        plantaId: planta.id,
        dominio,
        estado: { in: [EstadoTurno.PENDIENTE_PAGO, EstadoTurno.PENDIENTE_CONFIRMACION, EstadoTurno.CONFIRMADO] },
        inicio: { gte: new Date() },
      },
    });
    if (activos >= planta.turnosActivosPorPatente) return { ok: false, motivo: "TURNO_PENDIENTE" };
  }

  const politica = await prisma.politicaPrivacidad.findFirst({ orderBy: { vigenteDesde: "desc" } });

  const vence = new Date(Date.now() + planta.minutosExpiracionPago * 60_000);

  try {
    const turno = await prisma.turno.create({
      data: {
        plantaId: planta.id,
        lineaId: d.lineaId,
        tipoVehiculoId: d.tipoVehiculoId,
        inicio: new Date(d.inicioIso),
        duracionMin: d.duracionMin,
        estado: planta.requierePago ? EstadoTurno.PENDIENTE_PAGO : EstadoTurno.CONFIRMADO,
        origen: OrigenTurno.WEB,
        venceAt: planta.requierePago ? vence : null,
        dominio,
        titularNombre: recortar(d.nombre, "nombre").toUpperCase(),
        titularEmail: recortar(d.email, "email").toLowerCase(),
        titularTelefono: recortar(d.telefono, "telefono") || null,
        anio: Number(d.anio) || null,
        combustible: recortar(d.combustible, "combustible") || null,
        politicaId: politica?.id ?? null,
        consentimientoAt: new Date(),
        consentimientoIp: ip,
      },
      select: { id: true, publicId: true },
    });

    if (!planta.requierePago) return { ok: true, publicId: turno.publicId, urlPago: null };

    // Si no se puede generar el pago, el turno se deshace. Si no, el cliente
    // ve un error, toca "elegir otro horario", y encuentra ocupado justamente
    // el que quería — bloqueado por su propio turno fantasma.
    try {
      const urlPago = await generarLinkDePago(turno.id);
      return { ok: true, publicId: turno.publicId, urlPago };
    } catch (e) {
      await prisma.turno.delete({ where: { id: turno.id } }).catch(() => {});
      if (e instanceof SinCredenciales) {
        console.error(e.message);
        return { ok: false, motivo: "PAGO_NO_DISPONIBLE" };
      }
      console.error("No se pudo crear la preferencia:", e);
      return { ok: false, motivo: "PAGO_NO_DISPONIBLE" };
    }
  } catch (e: any) {
    // 23505 = unique_violation. Es el índice parcial turnos_cupo_ocupado:
    // alguien tomó el cupo entre que se mostró y que se confirmó.
    const codigo = e?.code === "P2002" ? "23505" : e?.meta?.code ?? e?.code;
    if (String(codigo).includes("23505") || e?.code === "P2002") {
      // Puede no ser una reserva viva sino una muerta: alguien que empezó a
      // reservar, no pagó, y su plazo ya pasó. El índice único no distingue
      // —una condición con `now()` no se puede indexar—, así que la diferencia
      // se hace acá: si el ocupante ya venció, se lo marca y se reintenta una
      // vez. Sin esto, la disponibilidad ofrecería un horario que la reserva
      // después rechaza.
      if (!reintento && (await vencerOcupante(d.lineaId, new Date(d.inicioIso)))) {
        return reservar(d, ip, true);
      }
      return { ok: false, motivo: "CUPO_TOMADO" };
    }
    throw e;
  }
}
