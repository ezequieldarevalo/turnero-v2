/**
 * Qué pasa cuando un pago de MercadoPago se hace real.
 *
 * Vive acá y no dentro del webhook porque hay dos caminos por los que un pago
 * llega: la notificación, y la conciliación del proceso periódico cuando esa
 * notificación se perdió. Los dos tienen que hacer exactamente lo mismo — si
 * fueran dos implementaciones, tarde o temprano difieren.
 */
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { EstadoTurno } from "@prisma/client";
import { notificarConfirmacion } from "@/lib/notificar";
import { crearPreferencia } from "@/lib/mercadopago";
import { precioVigente } from "@/lib/precios";
import type { Planta } from "@prisma/client";

/**
 * Qué tipos de pago NO se le ofrecen a este turno.
 *
 * El efectivo necesita muchísima más anticipación que una tarjeta: el cupón se
 * emite, la persona lo va a pagar cuando puede, y la acreditación llega
 * después. Si el turno es dentro de tres horas, ofrecer Rapipago es venderle a
 * alguien un camino que no llega — y en el sistema viejo eso terminaba en un
 * cupón pagado sobre un turno ya vencido, o sea plata a devolver.
 *
 * El turno igual se puede sacar: lo que desaparece es el medio, no el cupo.
 */
export function tiposExcluidosPara(planta: Planta, inicio: Date, ahora = new Date()): string[] {
  if (!planta.pagoEfectivoHabilitado) return ["ticket", "atm"];
  const minutosFaltan = (inicio.getTime() - ahora.getTime()) / 60_000;
  return minutosFaltan < planta.minutosMinimosEfectivo ? ["ticket", "atm"] : [];
}

/**
 * Genera la preferencia de MercadoPago de un turno y le guarda el link.
 *
 * La usan los dos caminos que terminan en un pago: la reserva por la web y la
 * confirmación de un turno cargado por teléfono. Si fueran dos copias, el día
 * que cambie algo de MercadoPago habría que acordarse de las dos.
 *
 * El link vive en el turno y no en `pagos`, porque una preferencia es una
 * intención de pago, no un pago: mezclarlas haría que sumar `pagos.monto`
 * contara como facturación algo que nadie abonó.
 */
export async function generarLinkDePago(turnoId: number): Promise<string> {
  const turno = await prisma.turno.findUniqueOrThrow({
    where: { id: turnoId },
    include: { planta: true, tipo: true },
  });

  const oferta = await prisma.plantaTipoVehiculo.findUniqueOrThrow({
    where: {
      plantaId_tipoVehiculoId: {
        plantaId: turno.plantaId, tipoVehiculoId: turno.tipoVehiculoId,
      },
    },
  });

  // El precio que regía cuando se reservó. Un aumento que entra en vigencia
  // entre la reserva y el pago no puede cambiarle el importe a alguien que ya
  // vio otro número en pantalla.
  const precio = await precioVigente(turno.plantaId, turno.tipoVehiculoId, turno.creadoAt);
  if (precio === null) {
    throw new Error(`Sin precio vigente para el tipo ${turno.tipoVehiculoId} en la planta ${turno.plantaId}`);
  }

  const vence = turno.venceAt ?? new Date(Date.now() + turno.planta.minutosExpiracionPago * 60_000);

  const pref = await crearPreferencia({
    tiposExcluidos: tiposExcluidosPara(turno.planta, turno.inicio),
    plantaId: turno.plantaId,
    slug: turno.planta.slug,
    titulo: `Revisión técnica ${oferta.nombreDisplay ?? turno.tipo.nombre} · ${turno.planta.nombre}`,
    precio,
    referencia: turno.publicId,
    venceAt: vence,
    mediosExcluidos: turno.planta.mediosPagoExcluidos as string[],
  });

  await prisma.turno.update({
    where: { id: turno.id },
    data: { preferenciaId: pref.id, pagoUrl: pref.initPoint, venceAt: vence },
  });

  return pref.initPoint;
}

/** Estados en los que un pago aprobado ya no puede revivir el turno. */
const NO_REVIVEN = [EstadoTurno.CANCELADO, EstadoTurno.EXPIRADO];

export async function aplicarPago(
  plantaId: number,
  slug: string,
  pago: any,
  /** El webhook corre dentro de un request y puede diferir el correo; el cron no. */
  diferir: (fn: () => Promise<void> | void) => void = after
) {
  const referencia: string = pago.external_reference ?? "";

  // Los turnos migrados traen la referencia vieja: `id + fecha + dominio`,
  // concatenada sin separador. Se busca por igualdad exacta porque parsearla
  // es ambiguo — el id no tiene largo fijo.
  const turno = await prisma.turno.findFirst({
    where: {
      plantaId,
      OR: [{ publicId: referencia }, { legacyExternalRef: `${slug}:${referencia}` }],
    },
  });

  const monto = Math.round(Number(pago.transaction_amount) || 0);
  const metodo = [pago.payment_type_id, pago.payment_method_id].filter(Boolean).join(" - ");
  const fechaPago = pago.date_approved ? new Date(pago.date_approved) : null;

  if (!turno) {
    // Se registra igual: la plata entró y tiene que quedar asentada, aunque no
    // se sepa a quién corresponde.
    //
    // Esto estuvo roto: iba con `turnoId: 0`, la clave foránea lo rechazaba y
    // un `catch` vacío se comía el error. O sea que el único caso en que este
    // bloque importaba —plata sin dueño— era justo el que se perdía. Ahora el
    // turno es opcional y el error, si lo hubiera, sube: el webhook devuelve
    // 5xx y MercadoPago reintenta.
    await prisma.pago.upsert({
      where: { proveedor_paymentId: { proveedor: "MERCADOPAGO", paymentId: String(pago.id) } },
      update: { estado: pago.status, monto, metodo, fechaPago, raw: pago },
      create: {
        plantaId, turnoId: null, proveedor: "MERCADOPAGO",
        paymentId: String(pago.id), estado: pago.status, monto, metodo, fechaPago,
        raw: pago, requiereRevision: true,
        motivoRevision: `Sin turno para la referencia "${referencia}"`,
      },
    });
    return { aplicado: false as const, motivo: "SIN_TURNO" as const };
  }

  const aprobado = pago.status === "approved";

  // Un cupón en efectivo pagado sobre un turno ya cancelado: la plata entró
  // pero el turno NO se resucita. Queda para revisión y eventual devolución.
  const noAplicable = aprobado && NO_REVIVEN.includes(turno.estado as any);

  await prisma.pago.upsert({
    where: { proveedor_paymentId: { proveedor: "MERCADOPAGO", paymentId: String(pago.id) } },
    update: { estado: pago.status, monto, metodo, fechaPago, raw: pago },
    create: {
      plantaId, turnoId: turno.id, proveedor: "MERCADOPAGO",
      paymentId: String(pago.id), preferenceId: pago.order?.id ? String(pago.order.id) : null,
      estado: pago.status, monto, metodo, fechaPago, raw: pago,
      requiereRevision: noAplicable,
      motivoRevision: noAplicable ? `Pago aprobado sobre un turno en ${turno.estado}` : null,
    },
  });

  if (aprobado && !noAplicable) {
    // Condicional sobre el estado: si el turno dejó de estar pendiente entre la
    // lectura y ahora —otra notificación en paralelo, el cron—, no se pisa.
    const { count } = await prisma.turno.updateMany({
      where: { id: turno.id, estado: { notIn: [...NO_REVIVEN, EstadoTurno.CONFIRMADO] } },
      data: { estado: EstadoTurno.CONFIRMADO, venceAt: null },
    });
    // Con after(): MercadoPago corta a los ~22 segundos, y enviar el correo
    // dentro del handler es lo que probablemente provocaba los reintentos que
    // dejaron hasta 28 copias de un mismo cobro.
    if (count > 0) diferir(() => notificarConfirmacion(turno.publicId));
    return { aplicado: count > 0, motivo: "CONFIRMADO" as const };
  }

  // Efectivo pendiente (Rapipago, Pago Fácil): el cupón corre hasta su
  // vencimiento y el cupo queda retenido hasta entonces.
  if (pago.status === "pending" && pago.date_of_expiration) {
    await prisma.turno.update({
      where: { id: turno.id },
      data: { venceAt: new Date(pago.date_of_expiration) },
    });
    return { aplicado: false as const, motivo: "EFECTIVO_PENDIENTE" as const };
  }

  return { aplicado: false as const, motivo: noAplicable ? ("NO_APLICABLE" as const) : ("SIN_CAMBIO" as const) };
}
