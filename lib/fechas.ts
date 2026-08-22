/**
 * Fechas en la zona horaria de la planta.
 *
 * Todo instante se guarda en `timestamptz` (UTC). "El día 15" no es un instante
 * sino un rango, y ese rango depende de la zona de la planta: en Mendoza va de
 * las 03:00 UTC del 15 a las 03:00 UTC del 16.
 *
 * Está escrito con `Intl` y no con offsets fijos a propósito. Hoy las tres
 * plantas están en Mendoza y da lo mismo, pero una planta en otra provincia
 * —o un cambio de huso, que en Argentina ya pasó— haría que un `-3` a mano
 * empiece a mentir sin avisar.
 */

export const MS_DIA = 86_400_000;

/** YYYY-MM-DD en la zona dada, sin depender de la del servidor. */
export function fechaLocal(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function hoyLocal(timezone: string, ahora = new Date()): string {
  return fechaLocal(ahora, timezone);
}

/** 0 = domingo … 6 = sábado, según la zona de la planta. */
export function diaSemana(fecha: string, timezone: string): number {
  const nombre = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" })
    .format(new Date(`${fecha}T12:00:00Z`));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(nombre);
}

/**
 * Cache del desfasaje horario, con granularidad de hora.
 *
 * `toLocaleString` es carísimo y el motor lo llamaba dos veces por cada cupo
 * generado: 13.461 cupos de Las Heras son 27.000 conversiones y cuatro segundos
 * de espera para abrir una pantalla.
 *
 * La clave es la hora, no el día: los cambios de huso horario ocurren en punto,
 * así que un mismo día puede tener dos desfasajes distintos. Cachear por día
 * sería más rápido todavía y estaría mal el día del cambio — Argentina no usa
 * horario de verano desde 2009, pero el motor está escrito para sobrevivir a
 * que una planta quede en otra provincia o a que la norma cambie.
 */
const cacheOffset = new Map<string, number>();

function offsetMinutos(fecha: Date, timezone: string): number {
  const clave = `${timezone}|${fecha.toISOString().slice(0, 13)}`;
  const guardado = cacheOffset.get(clave);
  if (guardado !== undefined) return guardado;

  const enZona = new Date(fecha.toLocaleString("en-US", { timeZone: timezone }));
  const enUtc = new Date(fecha.toLocaleString("en-US", { timeZone: "UTC" }));
  const offset = (enUtc.getTime() - enZona.getTime()) / 60_000;

  // Cota de memoria: son unas 2.700 entradas para tres plantas y cuatro meses
  // de ventana. Si el proceso vive lo suficiente como para pasarse, se vacía y
  // se vuelve a llenar; el costo de reconstruirla es el de una consulta.
  if (cacheOffset.size > 50_000) cacheOffset.clear();
  cacheOffset.set(clave, offset);
  return offset;
}

/** El instante exacto de `fecha` a `minutos` desde medianoche, en esa zona. */
export function instante(fecha: string, minutos: number, timezone: string): Date {
  const [y, m, d] = fecha.split("-").map(Number);
  const tentativa = Date.UTC(y, m - 1, d, Math.floor(minutos / 60), minutos % 60);
  return new Date(tentativa + offsetMinutos(new Date(tentativa), timezone) * 60_000);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Rango de un día como instantes, para filtrar `inicio` en las consultas.
 * `hasta` es exclusivo: es la medianoche del día siguiente.
 */
export function rangoDelDia(fecha: string, timezone: string): { desde: Date; hasta: Date } {
  return {
    desde: instante(fecha, 0, timezone),
    hasta: instante(sumarDias(fecha, 1), 0, timezone),
  };
}

/** Solo la fecha, como `@db.Date` la guarda: medianoche UTC. */
export function comoFechaSola(fecha: string): Date {
  return new Date(`${fecha}T00:00:00.000Z`);
}

/**
 * Lee una columna `@db.Date` como el día que representa.
 *
 * Va en UTC a propósito, y NO con `fechaLocal`. Un `@db.Date` no es un
 * instante: Postgres lo devuelve como medianoche UTC, y convertir esa
 * medianoche a la zona de Mendoza da las 21:00 del día ANTERIOR. Leer un
 * feriado así lo corría un día — el 21 de junio cerraba el 20.
 */
export function fechaDeColumna(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const hhmm = (d: Date, timezone: string) =>
  new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);

export function fechaLarga(fecha: string, timezone: string): string {
  const texto = new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone, weekday: "long", day: "numeric", month: "long",
  }).format(instante(fecha, 12 * 60, timezone));
  return texto.replace(/^\w/, (c) => c.toUpperCase());
}
