/**
 * Operaciones del mostrador sobre un turno.
 *
 * **No comparten reglas con la autogestión del cliente**, y es a propósito.
 * `permiteReprogramar: false` en Las Heras y Maipú existe para que el cliente no
 * mueva su turno solo, sino que llame por WhatsApp — y del otro lado de ese
 * WhatsApp está esta pantalla. Si el mostrador quedara atado al mismo
 * parámetro, la planta se bloquearía a sí misma. Lo mismo con los plazos
 * mínimos: son para el cliente, no para quien atiende.
 */
import { prisma } from "@/lib/prisma";
import { EstadoTurno, ProveedorPago } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { LARGOS, recortar } from "@/lib/validaciones";

export type Motivo =
  | "NO_EXISTE"
  | "ESTADO_INVALIDO"
  | "CUPO_TOMADO"
  | "YA_COBRADO"
  | "MONTO_INVALIDO";

export type Resultado = { ok: true } | { ok: false; motivo: Motivo; detalle?: string };

/** Quién ejecuta la acción. Va a la auditoría. */
export interface Operador {
  usuarioId: number;
  ip?: string | null;
}

async function cargar(publicId: string, plantaId: number) {
  return prisma.turno.findFirst({ where: { publicId, plantaId }, include: { pagos: true } });
}

/** Estados sobre los que todavía se puede operar desde el mostrador. */
const ABIERTOS: EstadoTurno[] = [
  EstadoTurno.PENDIENTE_CONFIRMACION,
  EstadoTurno.PENDIENTE_PAGO,
  EstadoTurno.CONFIRMADO,
];

/**
 * Cobro en mostrador: efectivo, débito, transferencia. Deja el turno confirmado.
 *
 * El `paymentId` se arma con el id del turno y no es opcional: la restricción
 * única sobre (proveedor, paymentId) es lo que hace estructuralmente imposible
 * cobrar dos veces el mismo turno. En el sistema viejo el cobro de mostrador
 * insertaba con `nro_op = 0` y nada impedía repetirlo.
 */
export async function cobrarEnMostrador(
  publicId: string,
  plantaId: number,
  datos: { monto: number; metodo: string; observaciones?: string },
  quien: Operador
): Promise<Resultado> {
  const t = await cargar(publicId, plantaId);
  if (!t) return { ok: false, motivo: "NO_EXISTE" };
  if (!ABIERTOS.includes(t.estado)) return { ok: false, motivo: "ESTADO_INVALIDO", detalle: t.estado };
  // Tope alto pero existente: sin él, un cero de más en el teclado entra como
  // cobro y descuadra la caja del día sin que nada lo frene.
  if (!Number.isInteger(datos.monto) || datos.monto <= 0 || datos.monto > 100_000_000) {
    return { ok: false, motivo: "MONTO_INVALIDO" };
  }

  const acreditado = t.pagos.filter((p) => p.estado === "approved").reduce((a, p) => a + p.monto, 0);
  if (acreditado > 0) return { ok: false, motivo: "YA_COBRADO", detalle: String(acreditado) };

  try {
    await prisma.$transaction([
      prisma.pago.create({
        data: {
          plantaId, turnoId: t.id,
          proveedor: ProveedorPago.EFECTIVO,
          paymentId: `mostrador-${t.id}`,
          estado: "approved",
          monto: datos.monto,
          metodo: recortar(datos.metodo, "texto"),
          fechaPago: new Date(),
          raw: {
            origen: "mostrador", usuarioId: quien.usuarioId,
            observaciones: recortar(datos.observaciones, "observaciones") || null,
          },
        },
      }),
      prisma.turno.update({
        where: { id: t.id },
        data: { estado: EstadoTurno.CONFIRMADO, venceAt: null, pagoUrl: null },
      }),
    ]);
  } catch (e: any) {
    if (e?.code === "P2002") return { ok: false, motivo: "YA_COBRADO" };
    throw e;
  }

  await auditar({
    plantaId, usuarioId: quien.usuarioId, accion: "turno.cobrado",
    entidad: "turno", entidadId: t.id, ip: quien.ip,
    antes: { estado: t.estado },
    despues: { estado: EstadoTurno.CONFIRMADO, monto: datos.monto, metodo: datos.metodo },
  });

  return { ok: true };
}

/** Marca la atención como hecha. Solo si la planta lleva ese registro acá. */
export async function marcarRealizado(
  publicId: string,
  plantaId: number,
  quien: Operador
): Promise<Resultado> {
  return cambiarEstado(publicId, plantaId, EstadoTurno.COMPLETADO, "turno.realizado", quien);
}

/** El vehículo no se presentó. Distinto de cancelado: el cupo se consumió igual. */
export async function marcarAusente(
  publicId: string,
  plantaId: number,
  quien: Operador
): Promise<Resultado> {
  return cambiarEstado(publicId, plantaId, EstadoTurno.AUSENTE, "turno.ausente", quien);
}

async function cambiarEstado(
  publicId: string,
  plantaId: number,
  nuevo: EstadoTurno,
  accion: "turno.realizado" | "turno.ausente",
  quien: Operador
): Promise<Resultado> {
  const t = await cargar(publicId, plantaId);
  if (!t) return { ok: false, motivo: "NO_EXISTE" };
  if (t.estado !== EstadoTurno.CONFIRMADO) {
    return { ok: false, motivo: "ESTADO_INVALIDO", detalle: t.estado };
  }

  await prisma.turno.update({ where: { id: t.id }, data: { estado: nuevo, venceAt: null } });
  await auditar({
    plantaId, usuarioId: quien.usuarioId, accion,
    entidad: "turno", entidadId: t.id, ip: quien.ip,
    antes: { estado: t.estado }, despues: { estado: nuevo },
  });
  return { ok: true };
}

/**
 * Mueve el turno a otro cupo. Sin los límites del cliente: ni plazo mínimo, ni
 * tope de reprogramaciones, ni `permiteReprogramar`.
 */
export async function reprogramarDesdeMostrador(
  publicId: string,
  plantaId: number,
  destino: { lineaId: number; inicioIso: string; duracionMin: number },
  quien: Operador
): Promise<Resultado> {
  const t = await cargar(publicId, plantaId);
  if (!t) return { ok: false, motivo: "NO_EXISTE" };
  if (!ABIERTOS.includes(t.estado)) return { ok: false, motivo: "ESTADO_INVALIDO", detalle: t.estado };

  try {
    await prisma.turno.update({
      where: { id: t.id },
      data: {
        lineaId: destino.lineaId,
        inicio: new Date(destino.inicioIso),
        duracionMin: destino.duracionMin,
        reprogramaciones: { increment: 1 },
      },
    });
  } catch (e: any) {
    if (e?.code === "P2002") return { ok: false, motivo: "CUPO_TOMADO" };
    throw e;
  }

  await auditar({
    plantaId, usuarioId: quien.usuarioId, accion: "turno.reprogramado",
    entidad: "turno", entidadId: t.id, ip: quien.ip,
    antes: { inicio: t.inicio, lineaId: t.lineaId },
    despues: { inicio: destino.inicioIso, lineaId: destino.lineaId },
  });
  return { ok: true };
}

export async function cancelarDesdeMostrador(
  publicId: string,
  plantaId: number,
  motivo: string | null,
  quien: Operador
): Promise<Resultado> {
  const t = await cargar(publicId, plantaId);
  if (!t) return { ok: false, motivo: "NO_EXISTE" };
  if (!ABIERTOS.includes(t.estado)) return { ok: false, motivo: "ESTADO_INVALIDO", detalle: t.estado };

  await prisma.turno.update({
    where: { id: t.id },
    data: {
      estado: EstadoTurno.CANCELADO,
      venceAt: null,
      pagoUrl: null,
      observaciones: recortar(motivo, "motivo") || t.observaciones,
    },
  });

  const cobrado = t.pagos.filter((p) => p.estado === "approved").reduce((a, p) => a + p.monto, 0);
  await auditar({
    plantaId, usuarioId: quien.usuarioId, accion: "turno.cancelado",
    entidad: "turno", entidadId: t.id, ip: quien.ip,
    antes: { estado: t.estado, cobrado },
    despues: { estado: EstadoTurno.CANCELADO, motivo },
  });
  return { ok: true };
}
