/**
 * Reportes de ocupación y facturación.
 *
 * Dos fuentes distintas, y la diferencia importa:
 *
 *  - **La facturación sale de `pagos`**, que es plata que efectivamente entró.
 *    No del precio de lista ni de la cantidad de turnos: un turno puede estar
 *    confirmado y cobrado a otro importe, o cancelado con el pago hecho.
 *  - **La ocupación sale de `ocupacion_diaria`**, el corte que guarda el proceso
 *    periódico. No se puede recalcular hacia atrás: la disponibilidad se deriva
 *    de la configuración vigente, así que un cambio de horario en octubre borra
 *    para siempre cuánta capacidad hubo en agosto. Por eso los días sin corte
 *    aparecen como sin dato en vez de como cero.
 *
 * Todas las agregaciones van en SQL. Traerse 60.000 filas para sumarlas en la
 * aplicación funciona con estos volúmenes y deja de funcionar sin avisar.
 */
import { prisma } from "@/lib/prisma";
import type { Planta } from "@prisma/client";
import { comoFechaSola, rangoDelDia, fechaLocal, sumarDias } from "@/lib/fechas";

export interface Periodo {
  desde: string; // YYYY-MM-DD
  hasta: string; // inclusivo
  etiqueta: string;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function periodosSugeridos(timezone: string, ahora = new Date()): Periodo[] {
  const hoy = fechaLocal(ahora, timezone);
  const [a, m] = hoy.split("-").map(Number);
  const primero = (anio: number, mes: number) => `${anio}-${String(mes).padStart(2, "0")}-01`;
  const ultimo = (anio: number, mes: number) =>
    `${anio}-${String(mes).padStart(2, "0")}-${new Date(Date.UTC(anio, mes, 0)).getUTCDate()}`;

  const mesAnterior = m === 1 ? { a: a - 1, m: 12 } : { a, m: m - 1 };

  return [
    { desde: primero(a, m), hasta: hoy, etiqueta: `${MESES[m - 1]} de ${a}` },
    {
      desde: primero(mesAnterior.a, mesAnterior.m),
      hasta: ultimo(mesAnterior.a, mesAnterior.m),
      etiqueta: `${MESES[mesAnterior.m - 1]} de ${mesAnterior.a}`,
    },
    { desde: `${a}-01-01`, hasta: hoy, etiqueta: `año ${a}` },
    { desde: sumarDias(hoy, -365), hasta: hoy, etiqueta: "últimos 12 meses" },
  ];
}

// ─────────────────────────────────────────────────────────────
// Facturación
// ─────────────────────────────────────────────────────────────

export interface Renglon {
  clave: string;
  cantidad: number;
  monto: number;
}

export interface Facturacion {
  total: number;
  cantidad: number;
  promedio: number;
  porMedio: Renglon[];
  porTipo: Renglon[];
  porMes: Renglon[];
}

/** Nombre legible de los medios que devuelve MercadoPago. */
const MEDIO = (crudo: string | null): string => {
  if (!crudo) return "Sin especificar";
  const [tipo] = crudo.split(" - ");
  const nombres: Record<string, string> = {
    account_money: "Dinero en cuenta",
    credit_card: "Tarjeta de crédito",
    debit_card: "Tarjeta de débito",
    prepaid_card: "Tarjeta prepaga",
    digital_currency: "Crédito de MercadoPago",
    digital_wallet: "Billetera digital",
    ticket: "Efectivo (cupón)",
    bank_transfer: "Transferencia",
    atm: "Cajero",
    voucher_card: "Vale",
    // Los cobros de mostrador guardan el medio tal como lo eligió el operador
    // ("Efectivo", "Débito"): ya vienen legibles y pasan sin tocar.
  };
  return nombres[tipo] ?? crudo;
};

export async function facturacion(planta: Planta, p: Periodo): Promise<Facturacion> {
  const { desde } = rangoDelDia(p.desde, planta.timezone);
  const { hasta } = rangoDelDia(p.hasta, planta.timezone);

  const [totales, medios, tipos, meses] = await Promise.all([
    prisma.$queryRaw<{ n: bigint; monto: bigint | null }[]>`
      SELECT count(*) n, sum(monto)::bigint monto FROM pagos
      WHERE "plantaId" = ${planta.id} AND estado = 'approved'
        AND "fechaPago" >= ${desde} AND "fechaPago" < ${hasta}`,
    prisma.$queryRaw<{ metodo: string | null; n: bigint; monto: bigint }[]>`
      SELECT metodo, count(*) n, sum(monto)::bigint monto FROM pagos
      WHERE "plantaId" = ${planta.id} AND estado = 'approved'
        AND "fechaPago" >= ${desde} AND "fechaPago" < ${hasta}
      GROUP BY metodo ORDER BY 3 DESC`,
    prisma.$queryRaw<{ tipo: string; n: bigint; monto: bigint }[]>`
      SELECT coalesce(ptv."nombreDisplay", tv.nombre) tipo, count(*) n, sum(p.monto)::bigint monto
      FROM pagos p
      JOIN turnos t ON t.id = p."turnoId"
      JOIN tipos_vehiculo tv ON tv.id = t."tipoVehiculoId"
      LEFT JOIN planta_tipo_vehiculo ptv
        ON ptv."plantaId" = p."plantaId" AND ptv."tipoVehiculoId" = t."tipoVehiculoId"
      WHERE p."plantaId" = ${planta.id} AND p.estado = 'approved'
        AND p."fechaPago" >= ${desde} AND p."fechaPago" < ${hasta}
      GROUP BY 1 ORDER BY 3 DESC`,
    prisma.$queryRaw<{ mes: string; n: bigint; monto: bigint }[]>`
      SELECT to_char("fechaPago" AT TIME ZONE ${planta.timezone}, 'YYYY-MM') mes,
             count(*) n, sum(monto)::bigint monto
      FROM pagos
      WHERE "plantaId" = ${planta.id} AND estado = 'approved'
        AND "fechaPago" >= ${desde} AND "fechaPago" < ${hasta}
      GROUP BY 1 ORDER BY 1`,
  ]);

  const cantidad = Number(totales[0]?.n ?? 0);
  const total = Number(totales[0]?.monto ?? 0);

  // Los medios se juntan por tipo: MercadoPago devuelve "credit_card - visa" y
  // "credit_card - master", que como líneas separadas solo hacen ruido.
  const juntados = new Map<string, Renglon>();
  for (const m of medios) {
    const clave = MEDIO(m.metodo);
    const x = juntados.get(clave) ?? { clave, cantidad: 0, monto: 0 };
    x.cantidad += Number(m.n);
    x.monto += Number(m.monto);
    juntados.set(clave, x);
  }

  return {
    total,
    cantidad,
    promedio: cantidad ? Math.round(total / cantidad) : 0,
    porMedio: [...juntados.values()].sort((a, b) => b.monto - a.monto),
    porTipo: tipos.map((t) => ({ clave: t.tipo, cantidad: Number(t.n), monto: Number(t.monto) })),
    porMes: meses.map((m) => ({ clave: m.mes, cantidad: Number(m.n), monto: Number(m.monto) })),
  };
}

// ─────────────────────────────────────────────────────────────
// Ocupación
// ─────────────────────────────────────────────────────────────

export interface Ocupacion {
  ofrecidos: number;
  vendidos: number;
  porcentaje: number;
  /** Días del período que tienen corte guardado. Sin corte no hay dato. */
  diasConDato: number;
  diasDelPeriodo: number;
  porMes: { clave: string; ofrecidos: number; vendidos: number }[];
  porLinea: { clave: string; ofrecidos: number; vendidos: number }[];
}

export async function ocupacion(planta: Planta, p: Periodo): Promise<Ocupacion> {
  const desde = comoFechaSola(p.desde);
  const hasta = comoFechaSola(p.hasta);

  const [totales, meses, lineas] = await Promise.all([
    prisma.$queryRaw<{ ofrecidos: bigint | null; vendidos: bigint | null; dias: bigint }[]>`
      SELECT sum(ofrecidos)::bigint ofrecidos, sum(vendidos)::bigint vendidos,
             count(DISTINCT fecha) dias
      FROM ocupacion_diaria
      WHERE "plantaId" = ${planta.id} AND fecha >= ${desde} AND fecha <= ${hasta}`,
    prisma.$queryRaw<{ mes: string; ofrecidos: bigint; vendidos: bigint }[]>`
      SELECT to_char(fecha, 'YYYY-MM') mes, sum(ofrecidos)::bigint ofrecidos, sum(vendidos)::bigint vendidos
      FROM ocupacion_diaria
      WHERE "plantaId" = ${planta.id} AND fecha >= ${desde} AND fecha <= ${hasta}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ linea: string; ofrecidos: bigint; vendidos: bigint }[]>`
      SELECT cv.nombre || ' ' || l.numero linea,
             sum(o.ofrecidos)::bigint ofrecidos, sum(o.vendidos)::bigint vendidos
      FROM ocupacion_diaria o
      JOIN lineas l ON l.id = o."lineaId"
      JOIN categorias_vehiculo cv ON cv.id = l."categoriaId"
      WHERE o."plantaId" = ${planta.id} AND o.fecha >= ${desde} AND o.fecha <= ${hasta}
      GROUP BY 1 ORDER BY 1`,
  ]);

  const ofrecidos = Number(totales[0]?.ofrecidos ?? 0);
  const vendidos = Number(totales[0]?.vendidos ?? 0);
  const dias = Math.round((comoFechaSola(p.hasta).getTime() - comoFechaSola(p.desde).getTime()) / 86_400_000) + 1;

  return {
    ofrecidos,
    vendidos,
    porcentaje: ofrecidos ? Math.round((vendidos / ofrecidos) * 100) : 0,
    diasConDato: Number(totales[0]?.dias ?? 0),
    diasDelPeriodo: dias,
    porMes: meses.map((m) => ({ clave: m.mes, ofrecidos: Number(m.ofrecidos), vendidos: Number(m.vendidos) })),
    porLinea: lineas.map((l) => ({ clave: l.linea, ofrecidos: Number(l.ofrecidos), vendidos: Number(l.vendidos) })),
  };
}

// ─────────────────────────────────────────────────────────────
// Actividad
// ─────────────────────────────────────────────────────────────

export interface Actividad {
  porEstado: Renglon[];
  porOrigen: Renglon[];
  total: number;
}

/**
 * Turnos del período según su fecha de atención.
 *
 * `porOrigen` es dato nuevo: en el sistema viejo el operador cargaba los turnos
 * desde el sitio público haciéndose pasar por el cliente, así que era imposible
 * saber cuántos entraban por mostrador.
 */
export async function actividad(planta: Planta, p: Periodo): Promise<Actividad> {
  const { desde } = rangoDelDia(p.desde, planta.timezone);
  const { hasta } = rangoDelDia(p.hasta, planta.timezone);

  const [estados, origenes] = await Promise.all([
    prisma.turno.groupBy({
      by: ["estado"],
      where: { plantaId: planta.id, inicio: { gte: desde, lt: hasta } },
      _count: true,
    }),
    prisma.turno.groupBy({
      by: ["origen"],
      where: { plantaId: planta.id, inicio: { gte: desde, lt: hasta } },
      _count: true,
    }),
  ]);

  const ETIQUETA: Record<string, string> = {
    COMPLETADO: "Realizados", CONFIRMADO: "Confirmados", PENDIENTE_PAGO: "Sin pagar",
    PENDIENTE_CONFIRMACION: "Sin confirmar", CANCELADO: "Cancelados",
    EXPIRADO: "Vencidos", AUSENTE: "No se presentaron",
    WEB: "Por el sitio", ADMIN: "Por mostrador o teléfono",
  };

  const fila = (clave: string, n: number) => ({ clave: ETIQUETA[clave] ?? clave, cantidad: n, monto: 0 });

  return {
    total: estados.reduce((a, e) => a + e._count, 0),
    porEstado: estados.map((e) => fila(e.estado, e._count)).sort((a, b) => b.cantidad - a.cantidad),
    porOrigen: origenes.map((o) => fila(o.origen, o._count)).sort((a, b) => b.cantidad - a.cantidad),
  };
}
