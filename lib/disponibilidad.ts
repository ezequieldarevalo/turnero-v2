/**
 * Motor de disponibilidad.
 *
 * Reemplaza al QuoteCreator del sistema viejo: en vez de pre-generar una fila
 * por cada cupo libre, la disponibilidad se deriva al vuelo de las reglas.
 *
 * Consecuencia práctica: cambiar un horario tiene efecto inmediato. En el
 * sistema viejo los cupos ya generados conservaban la configuración anterior
 * hasta regenerar, y ese desfasaje era una fuente silenciosa de bugs.
 */
import { PrismaClient, EstadoTurno, TipoExcepcion, type Horario } from "@prisma/client";
import { MS_DIA, fechaLocal, fechaDeColumna, diaSemana, instante, sumarDias, rangoDelDia } from "@/lib/fechas";

/** Estados que ocupan el cupo. Coincide con el índice parcial turnos_cupo_ocupado. */
export const ESTADOS_OCUPANTES = [
  EstadoTurno.PENDIENTE_CONFIRMACION,
  EstadoTurno.PENDIENTE_PAGO,
  EstadoTurno.CONFIRMADO,
  EstadoTurno.COMPLETADO,
];

export interface Cupo {
  lineaId: number;
  inicio: Date;
  duracionMin: number;
}

export interface DiaDisponible {
  fecha: string; // YYYY-MM-DD
  cupos: Cupo[];
}

/**
 * Todos los cupos que las reglas generan para una línea en una fecha, sin
 * descontar lo vendido ni lo bloqueado. Es la *capacidad*.
 *
 * Vive separado de `calcularDisponibilidad` porque el cierre diario necesita
 * saber cuántos cupos hubo, no cuántos quedaron: una vez pasado el día, con la
 * configuración ya cambiada, esa cifra no se puede reconstruir.
 */
export function cuposDeLinea(
  horarios: Horario[],
  lineaId: number,
  fecha: string,
  timezone: string
): Cupo[] {
  const dow = diaSemana(fecha, timezone);
  const mes = Number(fecha.slice(5, 7));

  // Lo más específico gana: mes puesto > mes null, línea puesta > línea null.
  const candidatos = horarios.filter(
    (h) =>
      h.diaSemana === dow &&
      (h.lineaId === lineaId || h.lineaId === null) &&
      (h.mes === mes || h.mes === null)
  );
  if (!candidatos.length) return []; // sin fila = cerrado

  const especificidad = (h: Horario) => (h.mes !== null ? 2 : 0) + (h.lineaId !== null ? 1 : 0);
  const max = Math.max(...candidatos.map(especificidad));

  const cupos: Cupo[] = [];
  for (const banda of candidatos.filter((h) => especificidad(h) === max)) {
    const paso = 60 / banda.slotsPorHora;
    for (let min = banda.desde; min < banda.hasta; min += paso) {
      cupos.push({ lineaId, inicio: instante(fecha, min, timezone), duracionMin: paso });
    }
  }
  return cupos;
}

export async function calcularDisponibilidad(
  prisma: PrismaClient,
  opts: {
    plantaSlug: string;
    tipoVehiculoId: number;
    /** Para reprogramar: el turno que se está moviendo no debe bloquearse a sí mismo. */
    excluirTurnoId?: number;
    /** Un solo día, en vez de toda la ventana. Para pantallas que ya eligieron fecha. */
    soloFecha?: string;
    hoy?: Date;
  }
): Promise<DiaDisponible[]> {
  const planta = await prisma.planta.findUniqueOrThrow({
    where: { slug: opts.plantaSlug },
    include: {
      lineas: { where: { activa: true } },
      horarios: true,
    },
  });

  const tipo = await prisma.tipoVehiculo.findUniqueOrThrow({
    where: { id: opts.tipoVehiculoId },
  });

  // Con filtraLineaPorVehiculo apagado (Las Heras y Maipú) se ofrecen todas las
  // líneas para cualquier vehículo. Es el viejo IGNORE_LINES.
  const lineas = planta.filtraLineaPorVehiculo
    ? planta.lineas.filter((l) => l.categoriaId === tipo.categoriaId)
    : planta.lineas;
  if (!lineas.length) return [];

  const hoy = opts.hoy ?? new Date();
  // El corte es un instante, no un día: con "1 día de anticipación" se perdían
  // todos los cupos libres de esta tarde para alguien que paga online en dos
  // minutos. El primer día ofrecido puede ser hoy mismo.
  const noAntesDe = new Date(hoy.getTime() + planta.minutosMinimosAnticipacion * 60_000);
  const primero = fechaLocal(noAntesDe, planta.timezone);
  const ultimo = fechaLocal(new Date(hoy.getTime() + planta.diasVentanaReserva * MS_DIA), planta.timezone);

  // Con `soloFecha` se calcula un día y no la ventana entera. Una pantalla que
  // ya eligió fecha no necesita los otros ciento un días, y calcularlos igual
  // es la diferencia entre una consulta y ciento dos.
  const desdeFecha = opts.soloFecha && opts.soloFecha >= primero ? opts.soloFecha : primero;
  const hastaFecha = opts.soloFecha && opts.soloFecha <= ultimo ? opts.soloFecha : ultimo;
  if (desdeFecha > hastaFecha) return [];

  // La ventana como instantes, en la zona de la planta. Con `T00:00:00Z` el
  // rango arrancaba tres horas antes de lo que dice la fecha; para el horario
  // de atención daba igual, pero es la clase de detalle que deja de dar igual
  // el día que una planta abra temprano o quede en otro huso.
  const ventana = {
    desde: rangoDelDia(desdeFecha, planta.timezone).desde,
    hasta: rangoDelDia(hastaFecha, planta.timezone).hasta,
  };

  const [feriados, ocupados, excepciones] = await Promise.all([
    prisma.feriado.findMany({
      where: { plantaId: planta.id, fecha: { gte: new Date(desdeFecha), lte: new Date(hastaFecha) } },
      select: { fecha: true },
    }),
    prisma.turno.findMany({
      where: {
        plantaId: planta.id,
        estado: { in: ESTADOS_OCUPANTES },
        inicio: { gte: ventana.desde, lt: ventana.hasta },
        // Sin línea = atención sin turno previo: no reservó nada, así que no
        // tapa ningún cupo.
        lineaId: { not: null },
        ...(opts.excluirTurnoId ? { id: { not: opts.excluirTurnoId } } : {}),
      },
      select: { lineaId: true, inicio: true },
    }),
    prisma.excepcionCupo.findMany({
      where: {
        plantaId: planta.id,
        inicio: { gte: ventana.desde, lt: ventana.hasta },
      },
    }),
  ]);

  // `feriados.fecha` es @db.Date: se lee en UTC. Con fechaLocal se corría un día.
  const esFeriado = new Set(feriados.map((f) => fechaDeColumna(f.fecha)));
  const tomado = new Set(ocupados.map((t) => `${t.lineaId}|${t.inicio.getTime()}`));
  const bloqueado = new Set(
    excepciones.filter((e) => e.tipo === TipoExcepcion.BLOQUEAR).map((e) => `${e.lineaId}|${e.inicio.getTime()}`)
  );
  const agregados = excepciones.filter((e) => e.tipo === TipoExcepcion.AGREGAR);

  const dias: DiaDisponible[] = [];

  for (let f = desdeFecha; f <= hastaFecha; f = sumarDias(f, 1)) {
    if (esFeriado.has(f)) continue;

    const cupos: Cupo[] = [];

    for (const linea of lineas) {
      for (const cupo of cuposDeLinea(planta.horarios, linea.id, f, planta.timezone)) {
        const k = `${linea.id}|${cupo.inicio.getTime()}`;
        if (tomado.has(k) || bloqueado.has(k)) continue;
        if (cupo.inicio < noAntesDe) continue; // demasiado cerca para llegar a pagarlo
        cupos.push(cupo);
      }
    }

    for (const extra of agregados) {
      if (fechaLocal(extra.inicio, planta.timezone) !== f) continue;
      const k = `${extra.lineaId}|${extra.inicio.getTime()}`;
      if (tomado.has(k)) continue;
      cupos.push({ lineaId: extra.lineaId, inicio: extra.inicio, duracionMin: 15 });
    }

    if (cupos.length) {
      cupos.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
      dias.push({ fecha: f, cupos });
    }
  }

  return dias;
}

