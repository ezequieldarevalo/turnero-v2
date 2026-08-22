/**
 * Días en que la planta no atiende.
 *
 * Hay dos formas de que un día quede cerrado, y la pantalla tiene que mostrar
 * las dos o miente:
 *
 *  - **Feriado**: una fila que dice "el 17 de agosto no se atiende". Es el
 *    mecanismo, y el que usa esta pantalla al cerrar un día.
 *  - **Bloqueos de cupo**: una fila por cada horario tapado. Es como lo hacía el
 *    sistema viejo —un `UPDATE` masivo sobre los cupos pregenerados, poniéndoles
 *    estado `I`— y así vinieron los 390 días cerrados que trajo la migración.
 *
 * El motor de disponibilidad respeta las dos. La diferencia es de forma: cerrar
 * un día son 141 filas de un lado y 1 del otro, y sobre 141 filas no se puede
 * escribir el motivo ni saber si el día está cerrado del todo o a medias.
 */
import { prisma } from "@/lib/prisma";
import { TipoExcepcion, type Planta } from "@prisma/client";
import { comoFechaSola, fechaDeColumna, fechaLocal, rangoDelDia, sumarDias } from "@/lib/fechas";
import { cuposDeLinea } from "@/lib/disponibilidad";
import { auditar } from "@/lib/auditoria";
import { recortar } from "@/lib/validaciones";
import type { Operador } from "@/lib/turnoAdmin";

export type Motivo = "FECHA_INVALIDA" | "SIN_MOTIVO" | "TIENE_TURNOS" | "NO_EXISTE";
export type Resultado = { ok: true } | { ok: false; motivo: Motivo; detalle?: string };

export interface DiaCerrado {
  fecha: string;
  descripcion: string;
  /** `feriado` = una fila. `bloqueos` = los cupos tapados uno por uno. */
  origen: "feriado" | "bloqueos";
  cupos: number; // cuántos horarios quedaron sin ofrecer
}

/**
 * Todos los días cerrados en un rango, vengan de donde vengan.
 *
 * Un día se considera cerrado por bloqueos cuando NO le queda ningún cupo
 * generado sin tapar. Si quedan algunos, es un cierre parcial y no entra acá:
 * ese día sigue atendiendo.
 */
export async function diasCerrados(
  planta: Planta & { lineas?: { id: number }[]; horarios?: any[] },
  desde: string,
  hasta: string
): Promise<DiaCerrado[]> {
  const [feriados, bloqueos, lineas, horarios] = await Promise.all([
    prisma.feriado.findMany({
      where: {
        plantaId: planta.id,
        fecha: { gte: comoFechaSola(desde), lte: comoFechaSola(hasta) },
      },
    }),
    prisma.excepcionCupo.findMany({
      where: {
        plantaId: planta.id,
        tipo: TipoExcepcion.BLOQUEAR,
        inicio: { gte: rangoDelDia(desde, planta.timezone).desde, lt: rangoDelDia(hasta, planta.timezone).hasta },
      },
      select: { inicio: true, lineaId: true, motivo: true },
    }),
    planta.lineas ?? prisma.linea.findMany({ where: { plantaId: planta.id, activa: true }, select: { id: true } }),
    planta.horarios ?? prisma.horario.findMany({ where: { plantaId: planta.id } }),
  ]);

  const salida = new Map<string, DiaCerrado>();

  for (const f of feriados) {
    const fecha = fechaDeColumna(f.fecha);
    salida.set(fecha, { fecha, descripcion: f.descripcion, origen: "feriado", cupos: 0 });
  }

  // Los bloqueos, agrupados por día, comparados contra la capacidad de ese día.
  const porDia = new Map<string, { n: number; motivo: string | null }>();
  for (const b of bloqueos) {
    const fecha = fechaLocal(b.inicio, planta.timezone);
    const x = porDia.get(fecha) ?? { n: 0, motivo: b.motivo };
    x.n++;
    porDia.set(fecha, x);
  }

  for (const [fecha, { n, motivo }] of porDia) {
    if (salida.has(fecha)) continue; // ya está como feriado
    const capacidad = lineas.reduce(
      (a, l) => a + cuposDeLinea(horarios, l.id, fecha, planta.timezone).length,
      0
    );
    if (capacidad > 0 && n >= capacidad) {
      salida.set(fecha, {
        fecha,
        descripcion: motivo ?? "Cerrado",
        origen: "bloqueos",
        cupos: n,
      });
    }
  }

  return [...salida.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Cierra un día entero. Una fila, con su motivo escrito. */
export async function cerrar(
  planta: Planta,
  fecha: string,
  descripcion: string,
  quien: Operador
): Promise<Resultado> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, motivo: "FECHA_INVALIDA" };
  if (!descripcion.trim()) return { ok: false, motivo: "SIN_MOTIVO" };
  const texto = recortar(descripcion, "descripcion");

  // Con gente ya citada, cerrar el día los dejaría en un día que el sistema
  // considera cerrado: aparecerían en la agenda sin que el sitio los reconozca.
  // Hay que moverlos primero, y eso es una decisión de la planta.
  const { desde, hasta } = rangoDelDia(fecha, planta.timezone);
  const conTurnos = await prisma.turno.count({
    where: {
      plantaId: planta.id,
      inicio: { gte: desde, lt: hasta },
      estado: { in: ["PENDIENTE_CONFIRMACION", "PENDIENTE_PAGO", "CONFIRMADO"] },
      lineaId: { not: null },
    },
  });
  if (conTurnos > 0) return { ok: false, motivo: "TIENE_TURNOS", detalle: String(conTurnos) };

  await prisma.feriado.upsert({
    where: { plantaId_fecha: { plantaId: planta.id, fecha: comoFechaSola(fecha) } },
    update: { descripcion: texto },
    create: { plantaId: planta.id, fecha: comoFechaSola(fecha), descripcion: texto },
  });

  await auditar({
    plantaId: planta.id, usuarioId: quien.usuarioId, accion: "config.editada",
    entidad: "cierre", ip: quien.ip, despues: { fecha, descripcion: texto },
  });
  return { ok: true };
}

/** Reabre un día, venga el cierre de donde venga. */
export async function reabrir(planta: Planta, fecha: string, quien: Operador): Promise<Resultado> {
  const { desde, hasta } = rangoDelDia(fecha, planta.timezone);

  const [feriado, bloqueos] = await Promise.all([
    prisma.feriado.findUnique({
      where: { plantaId_fecha: { plantaId: planta.id, fecha: comoFechaSola(fecha) } },
    }),
    prisma.excepcionCupo.count({
      where: { plantaId: planta.id, tipo: TipoExcepcion.BLOQUEAR, inicio: { gte: desde, lt: hasta } },
    }),
  ]);
  if (!feriado && bloqueos === 0) return { ok: false, motivo: "NO_EXISTE" };

  if (feriado) await prisma.feriado.delete({ where: { id: feriado.id } });
  if (bloqueos > 0) {
    // Los bloqueos sueltos que vienen del sistema viejo también se levantan: si
    // no, reabrir el día no reabriría nada y la pantalla mentiría al revés.
    await prisma.excepcionCupo.deleteMany({
      where: { plantaId: planta.id, tipo: TipoExcepcion.BLOQUEAR, inicio: { gte: desde, lt: hasta } },
    });
  }

  await auditar({
    plantaId: planta.id, usuarioId: quien.usuarioId, accion: "config.editada",
    entidad: "cierre", ip: quien.ip,
    antes: { fecha, feriado: feriado?.descripcion ?? null, bloqueos }, despues: null,
  });
  return { ok: true };
}

/**
 * Convierte los cierres hechos a fuerza de bloquear cupos en una sola fila de
 * día cerrado. Es limpieza de lo que trajo la migración: 390 filas que dicen lo
 * mismo que 3.
 *
 * Solo toca los días tapados por completo. Un día con algunos cupos bloqueados
 * es otra cosa —una línea fuera de servicio, media jornada— y se deja como está.
 */
export async function consolidarBloqueos(
  planta: Planta,
  quien: Operador,
  aplicar = false
): Promise<{ fecha: string; cupos: number; descripcion: string }[]> {
  const [lineas, horarios, bloqueos] = await Promise.all([
    prisma.linea.findMany({ where: { plantaId: planta.id, activa: true }, select: { id: true } }),
    prisma.horario.findMany({ where: { plantaId: planta.id } }),
    prisma.excepcionCupo.findMany({
      where: { plantaId: planta.id, tipo: TipoExcepcion.BLOQUEAR },
      select: { inicio: true, motivo: true },
    }),
  ]);

  const porDia = new Map<string, { n: number; motivo: string | null }>();
  for (const b of bloqueos) {
    const fecha = fechaLocal(b.inicio, planta.timezone);
    const x = porDia.get(fecha) ?? { n: 0, motivo: b.motivo };
    x.n++;
    porDia.set(fecha, x);
  }

  const convertidos: { fecha: string; cupos: number; descripcion: string }[] = [];

  for (const [fecha, { n }] of porDia) {
    const capacidad = lineas.reduce(
      (a, l) => a + cuposDeLinea(horarios, l.id, fecha, planta.timezone).length,
      0
    );
    if (capacidad === 0 || n < capacidad) continue;

    const descripcion = "Cerrado (migrado del sistema anterior)";
    convertidos.push({ fecha, cupos: n, descripcion });

    if (aplicar) {
      const { desde, hasta } = rangoDelDia(fecha, planta.timezone);
      await prisma.$transaction([
        prisma.feriado.upsert({
          where: { plantaId_fecha: { plantaId: planta.id, fecha: comoFechaSola(fecha) } },
          update: {},
          create: { plantaId: planta.id, fecha: comoFechaSola(fecha), descripcion },
        }),
        prisma.excepcionCupo.deleteMany({
          where: { plantaId: planta.id, tipo: TipoExcepcion.BLOQUEAR, inicio: { gte: desde, lt: hasta } },
        }),
      ]);
    }
  }

  if (aplicar && convertidos.length) {
    await auditar({
      plantaId: planta.id, usuarioId: quien.usuarioId, accion: "config.editada",
      entidad: "cierre", ip: quien.ip,
      despues: { consolidados: convertidos.map((c) => `${c.fecha} (${c.cupos} cupos)`) },
    });
  }

  return convertidos;
}

/** Fechas cerradas de acá en adelante, para el aviso del panel. */
export async function proximosCierres(planta: Planta, dias = 120): Promise<DiaCerrado[]> {
  const hoy = fechaLocal(new Date(), planta.timezone);
  return diasCerrados(planta, hoy, sumarDias(hoy, dias));
}
