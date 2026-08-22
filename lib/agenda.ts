/**
 * La agenda de un día: lo que ve la persona del mostrador.
 *
 * Reemplaza a `obtenerTurnosDiaActual` y `obtenerTurnosDiaFuturo`, que además
 * de estar duplicados calculaban "hoy" restándole tres horas a mano a la fecha
 * del servidor. Acá el día se resuelve en la zona de la planta.
 */
import { prisma } from "@/lib/prisma";
import { EstadoTurno, type Planta } from "@prisma/client";
import { rangoDelDia, sumarDias, fechaLocal } from "@/lib/fechas";
import { codigoCorto } from "@/lib/codigo";
import { preciosVigentes } from "@/lib/precios";

/** Los que se muestran en la agenda: lo que va a pasar o pasó ese día. */
export const ESTADOS_AGENDA = [
  EstadoTurno.PENDIENTE_CONFIRMACION,
  EstadoTurno.PENDIENTE_PAGO,
  EstadoTurno.CONFIRMADO,
  EstadoTurno.COMPLETADO,
  EstadoTurno.AUSENTE,
];

export const ETIQUETA_ESTADO: Record<EstadoTurno, string> = {
  PENDIENTE_CONFIRMACION: "Sin confirmar",
  PENDIENTE_PAGO: "Impago",
  CONFIRMADO: "Pago",
  COMPLETADO: "Realizado",
  CANCELADO: "Cancelado",
  EXPIRADO: "Vencido",
  AUSENTE: "No vino",
};

export interface FilaAgenda {
  publicId: string;
  codigo: string;
  inicio: Date;
  estado: EstadoTurno;
  dominio: string;
  titularNombre: string;
  titularTelefono: string | null;
  tipoVehiculo: string;
  linea: string;
  /** Suma de los pagos acreditados. Null cuando no hay ninguno. */
  cobrado: number | null;
  precio: number | null;
}

export interface Agenda {
  fecha: string;
  filas: FilaAgenda[];
  total: { turnos: number; cobrado: number; impagos: number };
  /** Fechas cercanas con turnos, para moverse sin adivinar. */
  conTurnos: string[];
}

export async function agendaDelDia(planta: Planta, fecha: string): Promise<Agenda> {
  const { desde, hasta } = rangoDelDia(fecha, planta.timezone);

  const turnos = await prisma.turno.findMany({
    where: { plantaId: planta.id, estado: { in: ESTADOS_AGENDA }, inicio: { gte: desde, lt: hasta } },
    orderBy: [{ inicio: "asc" }, { lineaId: "asc" }],
    include: {
      tipo: { select: { id: true, nombre: true } },
      linea: { include: { categoria: { select: { nombre: true } } } },
      pagos: { select: { monto: true, estado: true } },
    },
  });

  // El nombre que la planta le da a cada tipo, y su precio. Se trae en una sola
  // consulta en vez de una por fila.
  const [oferta, precios] = await Promise.all([
    prisma.plantaTipoVehiculo.findMany({
      where: { plantaId: planta.id },
      select: { tipoVehiculoId: true, nombreDisplay: true },
    }),
    // Los precios de HOY. La agenda de un día pasado muestra lo cobrado, que
    // sale de `pagos`; este precio es solo la referencia de lista.
    preciosVigentes(planta.id),
  ]);
  const porTipo = new Map(oferta.map((o) => [o.tipoVehiculoId, o]));

  const filas: FilaAgenda[] = turnos.map((t) => {
    const acreditado = t.pagos
      .filter((p) => p.estado === "approved")
      .reduce((a, p) => a + p.monto, 0);
    const o = porTipo.get(t.tipoVehiculoId);
    return {
      publicId: t.publicId,
      codigo: codigoCorto(t.publicId),
      inicio: t.inicio,
      estado: t.estado,
      dominio: t.dominio,
      titularNombre: t.titularNombre,
      titularTelefono: t.titularTelefono,
      tipoVehiculo: o?.nombreDisplay ?? t.tipo.nombre,
      linea: t.linea ? `${t.linea.categoria.nombre} ${t.linea.numero}` : "Sin turno previo",
      cobrado: acreditado > 0 ? acreditado : null,
      precio: precios.get(t.tipoVehiculoId) ?? null,
    };
  });

  return {
    fecha,
    filas,
    total: {
      turnos: filas.length,
      cobrado: filas.reduce((a, f) => a + (f.cobrado ?? 0), 0),
      impagos: filas.filter((f) => f.estado === EstadoTurno.PENDIENTE_PAGO).length,
    },
    conTurnos: await diasConTurnos(planta, fecha),
  };
}

/**
 * Fechas con turnos en una ventana alrededor del día mirado. Sirve para que las
 * flechas no lleven a días vacíos: en temporada baja puede haber una semana sin
 * nada, y avanzar de a un día es tedioso.
 */
async function diasConTurnos(planta: Planta, fecha: string, radio = 21): Promise<string[]> {
  const { desde } = rangoDelDia(sumarDias(fecha, -radio), planta.timezone);
  const { hasta } = rangoDelDia(sumarDias(fecha, radio), planta.timezone);

  const turnos = await prisma.turno.findMany({
    where: { plantaId: planta.id, estado: { in: ESTADOS_AGENDA }, inicio: { gte: desde, lt: hasta } },
    select: { inicio: true },
  });

  return [...new Set(turnos.map((t) => fechaLocal(t.inicio, planta.timezone)))].sort();
}
