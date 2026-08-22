/**
 * Turno cargado por teléfono.
 *
 * A diferencia de la atención sin turno previo, este SÍ reserva un cupo futuro.
 * Y a diferencia de la reserva por la web, lo carga un operador, no el titular
 * — que es justamente el problema que resuelve el estado intermedio.
 *
 * **Por qué no queda confirmado de una.** Para reservar hay que aceptar la
 * política de privacidad, y esa aceptación tiene que ser del titular: un
 * operador tildando una casilla en nombre de otro no es consentimiento, es un
 * operador tildando una casilla. Así que el cupo se retiene, se le manda un
 * correo a la persona, y el turno vale cuando ella hace click. Si no lo hace, el
 * proceso periódico lo vence y el horario vuelve a la oferta.
 *
 * En el sistema viejo esto se resolvía peor: el operador cargaba el turno desde
 * el sitio público haciéndose pasar por el cliente. Además de fabricar un
 * consentimiento inexistente, hacía imposible medir cuántos turnos entraban por
 * teléfono.
 */
import { prisma } from "@/lib/prisma";
import { EstadoTurno, OrigenTurno } from "@prisma/client";
import { normalizarDominio } from "@/lib/dominio";
import { auditar } from "@/lib/auditoria";
import { precioVigente } from "@/lib/precios";
import { primera, validarNombre, validarEmail, validarTelefono, validarDominio, recortar } from "@/lib/validaciones";
import type { Operador } from "@/lib/turnoAdmin";

export type Motivo =
  | "DATOS_INVALIDOS"
  | "TIPO_NO_OFRECIDO"
  | "CUPO_TOMADO"
  | "NO_EXISTE"
  | "ESTADO_INVALIDO"
  | "VENCIDO"
  | "SIN_CONSENTIMIENTO";

export type Resultado =
  | { ok: true; publicId: string }
  | { ok: false; motivo: Motivo; campo?: string; detalle?: string };

export interface DatosTelefonico {
  lineaId: number;
  inicioIso: string;
  duracionMin: number;
  tipoVehiculoId: number;
  dominio: string;
  titularNombre: string;
  /** Obligatorio: es por donde se le pide la confirmación. */
  titularEmail: string;
  titularTelefono?: string;
  observaciones?: string;
}

export async function crearTurnoTelefonico(
  plantaId: number,
  d: DatosTelefonico,
  quien: Operador
): Promise<Resultado> {
  const planta = await prisma.planta.findUniqueOrThrow({ where: { id: plantaId } });
  const dominio = normalizarDominio(d.dominio);

  // Igual que en el mostrador: patente permisiva porque el operador tiene el
  // dato del cliente al teléfono. El correo NO es opcional acá — es por donde
  // se le pide la confirmación, y sin él el turno nunca llega a valer.
  const falla = primera(
    validarNombre(d.titularNombre, "titularNombre"),
    validarDominio(d.dominio),
    validarEmail(d.titularEmail),
    d.titularTelefono?.trim() ? validarTelefono(d.titularTelefono) : null
  );
  if (falla) return { ok: false, motivo: "DATOS_INVALIDOS", campo: falla.campo, detalle: falla.mensaje };

  const nombre = recortar(d.titularNombre, "nombre").toUpperCase();
  const email = recortar(d.titularEmail, "email").toLowerCase();

  const oferta = await prisma.plantaTipoVehiculo.findUnique({
    where: { plantaId_tipoVehiculoId: { plantaId, tipoVehiculoId: d.tipoVehiculoId } },
  });
  if (!oferta?.activo) return { ok: false, motivo: "TIPO_NO_OFRECIDO" };

  const vence = new Date(Date.now() + planta.minutosExpiracionConfirmacion * 60_000);

  try {
    const turno = await prisma.turno.create({
      data: {
        plantaId,
        lineaId: d.lineaId,
        tipoVehiculoId: d.tipoVehiculoId,
        inicio: new Date(d.inicioIso),
        duracionMin: d.duracionMin,
        estado: EstadoTurno.PENDIENTE_CONFIRMACION,
        origen: OrigenTurno.ADMIN,
        venceAt: vence,
        dominio,
        titularNombre: nombre,
        titularEmail: email,
        titularTelefono: recortar(d.titularTelefono, "telefono") || null,
        observaciones: recortar(d.observaciones, "observaciones") || "Cargado por teléfono",
        creadoPorId: quien.usuarioId,
        // Sin consentimiento todavía: lo da el titular al confirmar.
      },
      select: { id: true, publicId: true },
    });

    await auditar({
      plantaId, usuarioId: quien.usuarioId, accion: "turno.creado",
      entidad: "turno", entidadId: turno.id, ip: quien.ip,
      despues: { tipo: "telefonico", dominio, inicio: d.inicioIso, venceAt: vence },
    });

    return { ok: true, publicId: turno.publicId };
  } catch (e: any) {
    if (e?.code === "P2002") return { ok: false, motivo: "CUPO_TOMADO" };
    throw e;
  }
}

export interface ParaConfirmar {
  publicId: string;
  plantaNombre: string;
  plantaDireccion: string;
  colorPrimario: string;
  inicio: Date;
  timezone: string;
  tipoVehiculo: string;
  dominio: string;
  titularNombre: string;
  precio: number | null;
  requierePago: boolean;
  venceAt: Date | null;
  politica: { id: number; version: string; texto: string } | null;
}

/** Los datos que ve el titular antes de aceptar. Null si ya no aplica. */
export async function paraConfirmar(publicId: string, slug: string): Promise<ParaConfirmar | null> {
  const t = await prisma.turno.findFirst({
    where: { publicId, planta: { slug }, estado: EstadoTurno.PENDIENTE_CONFIRMACION },
    include: { planta: true, tipo: { select: { nombre: true } } },
  });
  if (!t) return null;

  const oferta = await prisma.plantaTipoVehiculo.findUnique({
    where: { plantaId_tipoVehiculoId: { plantaId: t.plantaId, tipoVehiculoId: t.tipoVehiculoId } },
  });
  const politica = await prisma.politicaPrivacidad.findFirst({ orderBy: { vigenteDesde: "desc" } });

  return {
    publicId: t.publicId,
    plantaNombre: t.planta.nombre,
    plantaDireccion: t.planta.direccion,
    colorPrimario: t.planta.colorPrimario,
    inicio: t.inicio,
    timezone: t.planta.timezone,
    tipoVehiculo: oferta?.nombreDisplay ?? t.tipo.nombre,
    dominio: t.dominio,
    titularNombre: t.titularNombre,
    precio: await precioVigente(t.plantaId, t.tipoVehiculoId, t.creadoAt),
    requierePago: t.planta.requierePago,
    venceAt: t.venceAt,
    politica: politica ? { id: politica.id, version: politica.version, texto: politica.texto } : null,
  };
}

/**
 * El titular acepta. Acá es donde queda el consentimiento, con su fecha, su IP
 * y la versión exacta del texto que aceptó.
 *
 * Si la planta cobra, el turno pasa a esperar el pago con su propio plazo; si
 * no, queda confirmado.
 */
export async function confirmarTitular(
  publicId: string,
  slug: string,
  datos: { acepta: boolean; ip: string | null }
): Promise<Resultado> {
  if (!datos.acepta) return { ok: false, motivo: "SIN_CONSENTIMIENTO" };

  const t = await prisma.turno.findFirst({
    where: { publicId, planta: { slug } },
    include: { planta: true },
  });
  if (!t) return { ok: false, motivo: "NO_EXISTE" };
  if (t.estado !== EstadoTurno.PENDIENTE_CONFIRMACION) {
    return { ok: false, motivo: "ESTADO_INVALIDO", detalle: t.estado };
  }
  if (t.venceAt && t.venceAt < new Date()) return { ok: false, motivo: "VENCIDO" };

  const politica = await prisma.politicaPrivacidad.findFirst({ orderBy: { vigenteDesde: "desc" } });

  // Condicional sobre el estado: si el proceso periódico lo venció entre la
  // lectura y ahora, esto no revive un turno cuyo cupo ya tomó otra persona.
  const { count } = await prisma.turno.updateMany({
    where: { id: t.id, estado: EstadoTurno.PENDIENTE_CONFIRMACION },
    data: {
      estado: t.planta.requierePago ? EstadoTurno.PENDIENTE_PAGO : EstadoTurno.CONFIRMADO,
      venceAt: t.planta.requierePago
        ? new Date(Date.now() + t.planta.minutosExpiracionPago * 60_000)
        : null,
      politicaId: politica?.id ?? null,
      consentimientoAt: new Date(),
      consentimientoIp: datos.ip,
    },
  });

  if (count === 0) return { ok: false, motivo: "VENCIDO" };
  return { ok: true, publicId: t.publicId };
}
