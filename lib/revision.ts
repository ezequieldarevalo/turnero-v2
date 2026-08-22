/**
 * Pagos que necesitan que alguien los mire.
 *
 * Son dos casos, los dos plata que entró y que el sistema no puede aplicar solo:
 *
 *  - **Sin turno**: llegó un pago cuya referencia no corresponde a ningún turno.
 *    Pasa con los cupones en efectivo del sistema viejo cobrados después del
 *    cutover, y con referencias corruptas.
 *  - **Sobre un turno que ya no vale**: alguien pagó un cupón de un turno
 *    cancelado o vencido. El turno NO se resucita —su horario puede tenerlo
 *    otra persona—, así que hay que devolver la plata o reubicar a alguien.
 *
 * El sistema viejo revivía el turno en silencio y después crasheaba.
 */
import { prisma } from "@/lib/prisma";
import { EstadoTurno, type Planta } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { recortar } from "@/lib/validaciones";
import { codigoCorto } from "@/lib/codigo";
import { rangoDelDia, fechaLocal } from "@/lib/fechas";
import { preciosVigentes } from "@/lib/precios";
import type { Operador } from "@/lib/turnoAdmin";

export interface PagoARevisar {
  id: number;
  paymentId: string;
  proveedor: string;
  estado: string;
  monto: number;
  metodo: string | null;
  fechaPago: Date | null;
  motivo: string;
  turno: { publicId: string; codigo: string; dominio: string; estado: string } | null;
}

export async function pagosARevisar(plantaId: number): Promise<PagoARevisar[]> {
  const pagos = await prisma.pago.findMany({
    where: { plantaId, requiereRevision: true },
    orderBy: { fechaPago: "desc" },
    include: {
      turno: { select: { publicId: true, dominio: true, estado: true } },
    },
  });

  return pagos.map((p) => ({
    id: p.id,
    paymentId: p.paymentId,
    proveedor: p.proveedor,
    estado: p.estado,
    monto: p.monto,
    metodo: p.metodo,
    fechaPago: p.fechaPago,
    motivo: p.motivoRevision ?? "Sin motivo registrado",
    turno: p.turno
      ? {
          publicId: p.turno.publicId,
          codigo: codigoCorto(p.turno.publicId),
          dominio: p.turno.dominio,
          estado: p.turno.estado,
        }
      : null,
  }));
}

export interface Resueltos {
  total: number;
  monto: number;
}

/** Cuántos esperan y por cuánta plata. Sirve para el aviso en el menú. */
export async function pendientesDeRevision(plantaId: number): Promise<Resueltos> {
  const r = await prisma.pago.aggregate({
    where: { plantaId, requiereRevision: true },
    _count: true,
    _sum: { monto: true },
  });
  return { total: r._count, monto: r._sum.monto ?? 0 };
}

export type Resultado = { ok: true } | { ok: false; motivo: "NO_EXISTE" | "SIN_NOTA" };

/**
 * Da el caso por resuelto. No cambia el pago ni el turno: solo registra qué se
 * decidió y quién. Devolver la plata, reubicar a la persona o dejarlo como está
 * son decisiones que se toman afuera —en MercadoPago, en el mostrador— y este
 * sistema no las puede ejecutar; lo que sí puede es no dejar que se pierdan.
 */
export async function marcarRevisado(
  pagoId: number,
  planta: Planta,
  nota: string,
  quien: Operador
): Promise<Resultado> {
  const texto = recortar(nota, "nota");
  // Sin nota, bajar la bandera sería solo esconder el caso.
  if (texto.length < 3) return { ok: false, motivo: "SIN_NOTA" };

  const { count } = await prisma.pago.updateMany({
    where: { id: pagoId, plantaId: planta.id, requiereRevision: true },
    data: {
      requiereRevision: false,
      revisadoAt: new Date(),
      revisadoPorId: quien.usuarioId,
      notaRevision: texto,
    },
  });
  if (count === 0) return { ok: false, motivo: "NO_EXISTE" };

  await auditar({
    plantaId: planta.id, usuarioId: quien.usuarioId, accion: "pago.revisado",
    entidad: "pago", entidadId: pagoId, ip: quien.ip,
    despues: { nota: texto },
  });

  return { ok: true };
}

/**
 * Atenciones sin turno previo que quedaron impagas.
 *
 * No las vence nadie, y es correcto: la persona vino y la atendieron, así que
 * no hay cupo que liberar y dejar que el tiempo borre la deuda sería peor.
 * El problema es otro: pasado su día desaparecen de la agenda y solo aparecen
 * si a alguien se le ocurre buscar esa patente. Son plata que se debe y que
 * nadie está siguiendo.
 *
 * **Entran también las de hoy.** La primera versión las excluía, con el
 * argumento de que la persona podía seguir en el mostrador. Es un argumento
 * flojo: esta pantalla es plata que se debe, y una atención impaga lo es tanto
 * hoy como la semana pasada. Peor todavía, esconderlas hace que quien busca una
 * que acaba de cargar no la encuentre y deje de confiar en la lista. Se marcan
 * como "hoy" y listo.
 */
export interface AtencionSinCobrar {
  publicId: string;
  codigo: string;
  inicio: Date;
  dias: number;
  dominio: string;
  titularNombre: string;
  tipoVehiculo: string;
  precio: number | null;
  cargadaPor: string | null;
}

export async function atencionesSinCobrar(planta: Planta): Promise<AtencionSinCobrar[]> {
  const turnos = await prisma.turno.findMany({
    where: {
      plantaId: planta.id,
      lineaId: null, // sin turno previo
      estado: EstadoTurno.PENDIENTE_PAGO,
    },
    orderBy: { inicio: "asc" }, // la más vieja primero: es la que más urge
    include: {
      tipo: { select: { nombre: true } },
      creadoPor: { select: { nombre: true } },
    },
  });
  if (!turnos.length) return [];

  const [oferta, precios] = await Promise.all([
    prisma.plantaTipoVehiculo.findMany({
      where: { plantaId: planta.id }, select: { tipoVehiculoId: true, nombreDisplay: true },
    }),
    preciosVigentes(planta.id),
  ]);
  const nombreDe = new Map(oferta.map((o) => [o.tipoVehiculoId, o.nombreDisplay]));

  // La antigüedad se cuenta en días de calendario de la planta, no en múltiplos
  // de 24 horas: una atención de ayer a las 18 tiene un día, aunque hayan pasado
  // dieciséis horas.
  const hoy = fechaLocal(new Date(), planta.timezone);
  const inicioDeHoy = rangoDelDia(hoy, planta.timezone).desde.getTime();

  return turnos.map((t) => ({
    publicId: t.publicId,
    codigo: codigoCorto(t.publicId),
    inicio: t.inicio,
    dias: Math.max(0, Math.ceil((inicioDeHoy - t.inicio.getTime()) / 86_400_000)),
    dominio: t.dominio,
    titularNombre: t.titularNombre,
    tipoVehiculo: nombreDe.get(t.tipoVehiculoId) ?? t.tipo.nombre,
    precio: precios.get(t.tipoVehiculoId) ?? null,
    cargadaPor: t.creadoPor?.nombre ?? null,
  }));
}
