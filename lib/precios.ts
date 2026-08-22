/**
 * Precios con fecha de vigencia.
 *
 * Un cambio de precio no es una edición: es un hecho con fecha. Las tarifas de
 * revisión técnica se actualizan por resolución, se anuncian antes de aplicarse,
 * y después hay que poder decir cuánto costaba en marzo. Un solo número obliga a
 * entrar a cambiarlo el día exacto —a mano, en horario de atención— y borra la
 * historia al pisarlo.
 *
 * Acá el precio vigente es la fila con el `vigenteDesde` más grande que ya pasó.
 * Programar un aumento para el 1° de octubre y cambiarlo ahora mismo son la
 * misma operación con distinta fecha; no hay dos caminos que puedan divergir, ni
 * un proceso periódico del que dependa que el precio nuevo entre a tiempo.
 */
import { prisma } from "@/lib/prisma";
import { auditar } from "@/lib/auditoria";
import type { Operador } from "@/lib/turnoAdmin";

export type Motivo = "PRECIO_INVALIDO" | "FECHA_INVALIDA" | "YA_EXISTE" | "NO_EXISTE" | "YA_VIGENTE";
export type Resultado = { ok: true } | { ok: false; motivo: Motivo; detalle?: string };

/**
 * Los precios vigentes de una planta a un instante dado, por tipo de vehículo.
 *
 * Una sola consulta para todos los tipos: `DISTINCT ON` toma, de las vigencias
 * ya empezadas, la más reciente de cada tipo. Hacerlo en la aplicación
 * significaría traerse el historial entero para quedarse con la última fila.
 */
export async function preciosVigentes(
  plantaId: number,
  cuando: Date = new Date()
): Promise<Map<number, number>> {
  const filas = await prisma.$queryRaw<{ tipoVehiculoId: number; precio: number }[]>`
    SELECT DISTINCT ON ("tipoVehiculoId") "tipoVehiculoId", precio
    FROM precios_vigencia
    WHERE "plantaId" = ${plantaId} AND "vigenteDesde" <= ${cuando}
    ORDER BY "tipoVehiculoId", "vigenteDesde" DESC
  `;
  return new Map(filas.map((f) => [f.tipoVehiculoId, f.precio]));
}

export async function precioVigente(
  plantaId: number,
  tipoVehiculoId: number,
  cuando: Date = new Date()
): Promise<number | null> {
  const f = await prisma.precioVigencia.findFirst({
    where: { plantaId, tipoVehiculoId, vigenteDesde: { lte: cuando } },
    orderBy: { vigenteDesde: "desc" },
    select: { precio: true },
  });
  return f?.precio ?? null;
}

export interface Vigencia {
  id: number;
  precio: number;
  vigenteDesde: Date;
  puestoPor: string | null;
  estado: "vigente" | "programado" | "anterior";
}

/** El historial completo de un tipo, del más nuevo al más viejo. */
export async function historial(
  plantaId: number,
  tipoVehiculoId: number,
  ahora = new Date()
): Promise<Vigencia[]> {
  const filas = await prisma.precioVigencia.findMany({
    where: { plantaId, tipoVehiculoId },
    orderBy: { vigenteDesde: "desc" },
    include: { creadoPor: { select: { nombre: true } } },
  });

  // El vigente es el primero, contando desde el más nuevo, cuya fecha ya pasó.
  const iVigente = filas.findIndex((f) => f.vigenteDesde <= ahora);

  return filas.map((f, i) => ({
    id: f.id,
    precio: f.precio,
    vigenteDesde: f.vigenteDesde,
    puestoPor: f.creadoPor?.nombre ?? null,
    estado: i === iVigente ? "vigente" : f.vigenteDesde > ahora ? "programado" : "anterior",
  }));
}

/**
 * Deja un precio anotado para una fecha. Sin fecha, rige desde ya.
 *
 * No se puede programar hacia atrás: un turno que ya se cobró se cobró al precio
 * de ese momento, y cambiar la historia haría que la facturación deje de cerrar
 * contra lo que efectivamente entró.
 */
export async function programarPrecio(
  plantaId: number,
  tipoVehiculoId: number,
  precio: number,
  vigenteDesde: Date | null,
  quien: Operador,
  ahora = new Date()
): Promise<Resultado> {
  if (!Number.isInteger(precio) || precio < 0) {
    return { ok: false, motivo: "PRECIO_INVALIDO", detalle: "El precio va en pesos enteros" };
  }

  const desde = vigenteDesde ?? ahora;
  if (Number.isNaN(desde.getTime())) return { ok: false, motivo: "FECHA_INVALIDA" };
  // Se admite el "ahora" con un minuto de tolerancia por el ida y vuelta del
  // formulario; más atrás que eso es reescribir el pasado.
  if (desde.getTime() < ahora.getTime() - 60_000) {
    return { ok: false, motivo: "FECHA_INVALIDA", detalle: "No se puede cambiar un precio hacia atrás" };
  }

  const anterior = await precioVigente(plantaId, tipoVehiculoId, desde);
  if (anterior === precio) {
    return { ok: false, motivo: "YA_VIGENTE", detalle: String(precio) };
  }

  try {
    const fila = await prisma.precioVigencia.create({
      data: { plantaId, tipoVehiculoId, precio, vigenteDesde: desde, creadoPorId: quien.usuarioId },
    });
    await auditar({
      plantaId, usuarioId: quien.usuarioId, accion: "config.editada",
      entidad: "precio", entidadId: fila.id, ip: quien.ip,
      antes: { precio: anterior },
      despues: { precio, vigenteDesde: desde.toISOString(), tipoVehiculoId },
    });
    return { ok: true };
  } catch (e: any) {
    if (e?.code === "P2002") {
      return { ok: false, motivo: "YA_EXISTE", detalle: "Ya hay un precio anotado para ese instante" };
    }
    throw e;
  }
}

/**
 * Cancela un cambio **todavía no vigente**. Los que ya rigieron no se borran:
 * son la historia contra la que se concilia lo cobrado.
 */
export async function cancelarProgramado(
  plantaId: number,
  id: number,
  quien: Operador,
  ahora = new Date()
): Promise<Resultado> {
  const f = await prisma.precioVigencia.findFirst({ where: { id, plantaId } });
  if (!f) return { ok: false, motivo: "NO_EXISTE" };
  if (f.vigenteDesde <= ahora) {
    return { ok: false, motivo: "YA_VIGENTE", detalle: "Ese precio ya rigió: no se borra la historia" };
  }

  await prisma.precioVigencia.delete({ where: { id } });
  await auditar({
    plantaId, usuarioId: quien.usuarioId, accion: "config.editada",
    entidad: "precio", entidadId: id, ip: quien.ip,
    antes: { precio: f.precio, vigenteDesde: f.vigenteDesde.toISOString() }, despues: null,
  });
  return { ok: true };
}
