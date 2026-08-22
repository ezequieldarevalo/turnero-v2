/**
 * Cancelación y reprogramación por parte del cliente.
 *
 * **Autorización**: alcanza con conocer el `publicId`, que es un UUID opaco que
 * viaja únicamente en el correo del titular. El sistema viejo usaba el id
 * secuencial del turno —enumerable— y por eso necesitaba además pedir el correo
 * como segundo factor. Con un identificador que no se puede adivinar, ese paso
 * extra deja de aportar seguridad y solo agrega fricción.
 */
import { prisma } from "@/lib/prisma";
import { EstadoTurno } from "@prisma/client";

export type Motivo =
  | "NO_EXISTE"
  | "ESTADO_INVALIDO"
  | "NO_PERMITIDO"
  | "FUERA_DE_PLAZO"
  | "TOPE_REPROGRAMACIONES"
  | "CUPO_TOMADO";

export type Resultado = { ok: true } | { ok: false; motivo: Motivo; detalle?: string };

/** Estados sobre los que el cliente todavía puede operar. */
const OPERABLES: EstadoTurno[] = [
  EstadoTurno.PENDIENTE_PAGO,
  EstadoTurno.CONFIRMADO,
  EstadoTurno.PENDIENTE_CONFIRMACION,
];

async function cargar(publicId: string, slug: string) {
  return prisma.turno.findFirst({
    where: { publicId, planta: { slug } },
    include: { planta: true },
  });
}

const horasHasta = (fecha: Date, ahora: Date) => (fecha.getTime() - ahora.getTime()) / 3_600_000;

/** Qué puede hacer el cliente con este turno. Sirve para decidir qué botones mostrar. */
export async function acciones(publicId: string, slug: string, ahora = new Date()) {
  const t = await cargar(publicId, slug);
  if (!t) return { cancelar: false, reprogramar: false };

  const operable = OPERABLES.includes(t.estado);
  const horas = horasHasta(t.inicio, ahora);

  return {
    cancelar:
      operable && t.planta.permiteCancelar && horas >= t.planta.horasMinimasCancelacion,
    reprogramar:
      operable &&
      t.planta.permiteReprogramar &&
      horas >= t.planta.horasMinimasReprogramacion &&
      (t.planta.maxReprogramaciones === null || t.reprogramaciones < t.planta.maxReprogramaciones),
    horasMinimasCancelacion: t.planta.horasMinimasCancelacion,
    horasMinimasReprogramacion: t.planta.horasMinimasReprogramacion,
  };
}

export async function cancelar(publicId: string, slug: string, ahora = new Date()): Promise<Resultado> {
  const t = await cargar(publicId, slug);
  if (!t) return { ok: false, motivo: "NO_EXISTE" };
  if (!OPERABLES.includes(t.estado)) return { ok: false, motivo: "ESTADO_INVALIDO", detalle: t.estado };
  if (!t.planta.permiteCancelar) return { ok: false, motivo: "NO_PERMITIDO" };

  const horas = horasHasta(t.inicio, ahora);
  if (horas < t.planta.horasMinimasCancelacion) {
    return { ok: false, motivo: "FUERA_DE_PLAZO", detalle: String(t.planta.horasMinimasCancelacion) };
  }

  // No se borra: cancelar deja rastro. El cupo se libera solo porque el índice
  // único es parcial sobre los estados que ocupan.
  await prisma.turno.update({
    where: { id: t.id },
    data: { estado: EstadoTurno.CANCELADO, venceAt: null, pagoUrl: null },
  });

  return { ok: true };
}

export async function reprogramar(
  publicId: string,
  slug: string,
  destino: { lineaId: number; inicioIso: string; duracionMin: number },
  ahora = new Date()
): Promise<Resultado> {
  const t = await cargar(publicId, slug);
  if (!t) return { ok: false, motivo: "NO_EXISTE" };
  if (!OPERABLES.includes(t.estado)) return { ok: false, motivo: "ESTADO_INVALIDO", detalle: t.estado };
  if (!t.planta.permiteReprogramar) return { ok: false, motivo: "NO_PERMITIDO" };

  const horas = horasHasta(t.inicio, ahora);
  if (horas < t.planta.horasMinimasReprogramacion) {
    return { ok: false, motivo: "FUERA_DE_PLAZO", detalle: String(t.planta.horasMinimasReprogramacion) };
  }
  if (t.planta.maxReprogramaciones !== null && t.reprogramaciones >= t.planta.maxReprogramaciones) {
    return { ok: false, motivo: "TOPE_REPROGRAMACIONES", detalle: String(t.planta.maxReprogramaciones) };
  }

  try {
    // Se mueve el mismo turno: conserva el pago, el consentimiento y el
    // historial. El sistema viejo hacía cuatro updates encadenados sobre dos
    // turnos distintos, sin transacción, y ante un fallo dejaba el pago
    // apuntando a un turno y los datos del cliente a otro.
    await prisma.turno.update({
      where: { id: t.id },
      data: {
        lineaId: destino.lineaId,
        inicio: new Date(destino.inicioIso),
        duracionMin: destino.duracionMin,
        reprogramaciones: { increment: 1 },
      },
    });
    return { ok: true };
  } catch (e: any) {
    // 23505: el índice parcial. Alguien tomó ese cupo mientras elegía.
    if (e?.code === "P2002" || String(e?.meta?.code ?? "").includes("23505")) {
      return { ok: false, motivo: "CUPO_TOMADO" };
    }
    throw e;
  }
}
