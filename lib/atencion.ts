/**
 * Atención sin turno previo: alguien que llega al mostrador sin haber reservado.
 *
 * No es un turno telefónico —eso reserva un cupo futuro y espera que el titular
 * confirme—: es una atención que ya está ocurriendo. Por eso va sin línea, con
 * la hora de ahora, y no le saca el lugar a nadie.
 *
 * El sistema viejo hacía lo mismo con `id_linea = 0`, una línea inexistente, y
 * pedía marca, modelo, año, combustible y correo, todos obligatorios, para
 * alguien que está parado del otro lado del mostrador. Acá lo mínimo es patente,
 * tipo de vehículo y nombre.
 */
import { prisma } from "@/lib/prisma";
import { EstadoTurno, OrigenTurno, ProveedorPago } from "@prisma/client";
import { normalizarDominio } from "@/lib/dominio";
import { auditar } from "@/lib/auditoria";
import { primera, validarNombre, validarEmail, validarTelefono, validarDominio, recortar } from "@/lib/validaciones";
import { preciosVigentes } from "@/lib/precios";
import type { Operador } from "@/lib/turnoAdmin";

export type Motivo = "DATOS_INVALIDOS" | "TIPO_NO_OFRECIDO" | "MONTO_INVALIDO";

export type Resultado =
  | { ok: true; publicId: string }
  | { ok: false; motivo: Motivo; campo?: string; detalle?: string };

export interface DatosAtencion {
  dominio: string;
  tipoVehiculoId: number;
  titularNombre: string;
  titularEmail?: string;
  titularTelefono?: string;
  observaciones?: string;
  /** Si se cobra en el momento. Sin esto queda impaga y se cobra desde la ficha. */
  cobro?: { monto: number; metodo: string };
}

export async function registrarAtencion(
  plantaId: number,
  d: DatosAtencion,
  quien: Operador
): Promise<Resultado> {
  const dominio = normalizarDominio(d.dominio);

  // Sin `estricto`: el operador tiene el vehículo delante, y hay patentes
  // extranjeras y viejas que igual hay que poder atender. El correo y el
  // teléfono son opcionales acá, pero si vienen tienen que ser válidos: un
  // correo mal tipeado es un comprobante que no llega.
  const falla = primera(
    validarNombre(d.titularNombre, "titularNombre"),
    validarDominio(d.dominio),
    d.titularEmail?.trim() ? validarEmail(d.titularEmail) : null,
    d.titularTelefono?.trim() ? validarTelefono(d.titularTelefono) : null
  );
  if (falla) return { ok: false, motivo: "DATOS_INVALIDOS", campo: falla.campo, detalle: falla.mensaje };

  const nombre = recortar(d.titularNombre, "nombre").toUpperCase();

  const oferta = await prisma.plantaTipoVehiculo.findUnique({
    where: { plantaId_tipoVehiculoId: { plantaId, tipoVehiculoId: d.tipoVehiculoId } },
  });
  if (!oferta || !oferta.activo) return { ok: false, motivo: "TIPO_NO_OFRECIDO" };

  if (d.cobro && (!Number.isInteger(d.cobro.monto) || d.cobro.monto <= 0)) {
    return { ok: false, motivo: "MONTO_INVALIDO" };
  }

  const ahora = new Date();

  const turno = await prisma.turno.create({
    data: {
      plantaId,
      lineaId: null, // no ocupa cupo
      tipoVehiculoId: d.tipoVehiculoId,
      inicio: ahora,
      duracionMin: 0, // no reserva tiempo: la atención ya está pasando
      estado: d.cobro ? EstadoTurno.CONFIRMADO : EstadoTurno.PENDIENTE_PAGO,
      origen: OrigenTurno.ADMIN,
      dominio,
      titularNombre: nombre,
      titularEmail: recortar(d.titularEmail, "email").toLowerCase(),
      titularTelefono: recortar(d.titularTelefono, "telefono") || null,
      observaciones: recortar(d.observaciones, "observaciones") || "Atención sin turno previo",
      // Queda quién la cargó. En el sistema viejo el operador cargaba turnos
      // haciéndose pasar por el cliente en el sitio público, y no había forma
      // de medir cuántos entraban por mostrador.
      creadoPorId: quien.usuarioId,
      // Sin consentimiento del titular: no lo dio en ningún lado, y ponerle una
      // fecha acá sería fabricar una prueba de algo que no pasó.
      ...(d.cobro
        ? {
            pagos: {
              create: {
                plantaId,
                proveedor: ProveedorPago.EFECTIVO,
                paymentId: `mostrador-${ahora.getTime()}-${dominio}`,
                estado: "approved",
                monto: d.cobro.monto,
                metodo: d.cobro.metodo,
                fechaPago: ahora,
                raw: { origen: "mostrador", usuarioId: quien.usuarioId },
              },
            },
          }
        : {}),
    },
    select: { id: true, publicId: true },
  });

  await auditar({
    plantaId, usuarioId: quien.usuarioId, accion: "turno.creado",
    entidad: "turno", entidadId: turno.id, ip: quien.ip,
    despues: {
      tipo: "atencion_sin_turno",
      dominio,
      monto: d.cobro?.monto ?? null,
      metodo: d.cobro?.metodo ?? null,
    },
  });

  return { ok: true, publicId: turno.publicId };
}

/** Los tipos que la planta ofrece, con su precio, para el selector. */
export async function tiposDePlanta(plantaId: number) {
  const [oferta, precios] = await Promise.all([
    prisma.plantaTipoVehiculo.findMany({
      where: { plantaId, activo: true },
      include: { tipo: { select: { nombre: true } } },
      orderBy: { orden: "asc" },
    }),
    preciosVigentes(plantaId),
  ]);
  return oferta.map((o) => ({
    id: o.tipoVehiculoId,
    nombre: o.nombreDisplay ?? o.tipo.nombre,
    precio: precios.get(o.tipoVehiculoId) ?? 0,
  }));
}
