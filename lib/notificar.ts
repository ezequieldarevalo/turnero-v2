/**
 * Armado y envío de las notificaciones de un turno.
 *
 * Separado del camino de reserva a propósito: quien lo llama lo hace con
 * `after()`, es decir una vez devuelta la respuesta. Un SMTP lento no puede
 * demorar el redirect al pago ni, sobre todo, la respuesta a MercadoPago.
 */
import { prisma } from "@/lib/prisma";
import { enviarSinFallar } from "@/lib/correo";
import { codigoCorto } from "@/lib/codigo";
import { precioVigente } from "@/lib/precios";
import {
  turnoReservado, turnoConfirmado, turnoCancelado, turnoReprogramado, turnoVencido,
  turnoPorConfirmar,
  type DatosTurnoCorreo,
} from "@/lib/plantillas";

async function datos(publicId: string): Promise<(DatosTurnoCorreo & { plantaId: number; slug: string; email: string }) | null> {
  const t = await prisma.turno.findUnique({
    where: { publicId },
    include: {
      planta: true,
      tipo: { select: { id: true, nombre: true } },
    },
  });
  if (!t) return null;

  const oferta = await prisma.plantaTipoVehiculo.findUnique({
    where: { plantaId_tipoVehiculoId: { plantaId: t.plantaId, tipoVehiculoId: t.tipoVehiculoId } },
  });

  const base = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
  const cuando = new Intl.DateTimeFormat("es-AR", {
    timeZone: t.planta.timezone,
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(t.inicio);

  return {
    plantaId: t.plantaId,
    slug: t.planta.slug,
    email: t.titularEmail,
    plantaNombre: t.planta.nombre,
    plantaDireccion: t.planta.direccion,
    colorPrimario: t.planta.colorPrimario,
    colorAdvertencia: t.planta.colorAdvertencia,
    tipoVehiculo: oferta?.nombreDisplay ?? t.tipo.nombre,
    dominio: t.dominio,
    titularNombre: t.titularNombre,
    cuando: cuando.replace(/^\w/, (c) => c.toUpperCase()) + " hs",
    codigo: codigoCorto(t.publicId),
    urlTurno: `${base}/${t.planta.slug}/turno/${t.publicId}`,
    urlPago: t.pagoUrl,
    // El precio al momento de reservar, no el de hoy: si el aumento entró
    // entre la reserva y el correo, el importe que se le pide es el viejo.
    precio: (await precioVigente(t.plantaId, t.tipoVehiculoId, t.creadoAt)) ?? undefined,
    horasParaPagar: Math.round(t.planta.minutosExpiracionPago / 60),
    avisoTarifa: t.planta.avisoTarifa,
    whatsapp: t.planta.permiteReprogramar ? null : t.planta.whatsappContacto,
  };
}

/** Al reservar: incluye el link de pago real, para poder pagar más tarde. */
export async function notificarReserva(publicId: string) {
  const d = await datos(publicId);
  if (!d) return;
  const { asunto, html } = turnoReservado(d);
  await enviarSinFallar(d.plantaId, d.slug, { para: d.email, asunto, html });
}

/** Al acreditarse el pago. */
export async function notificarConfirmacion(publicId: string) {
  const d = await datos(publicId);
  if (!d) return;
  const { asunto, html } = turnoConfirmado(d);
  await enviarSinFallar(d.plantaId, d.slug, { para: d.email, asunto, html });
}

export async function notificarCancelacion(publicId: string) {
  const d = await datos(publicId);
  if (!d) return;
  const { asunto, html } = turnoCancelado(d);
  await enviarSinFallar(d.plantaId, d.slug, { para: d.email, asunto, html });
}

export async function notificarReprogramacion(publicId: string) {
  const d = await datos(publicId);
  if (!d) return;
  const { asunto, html } = turnoReprogramado(d);
  await enviarSinFallar(d.plantaId, d.slug, { para: d.email, asunto, html });
}

/** Turno cargado por teléfono: se le pide al titular que lo acepte. */
export async function notificarPorConfirmar(publicId: string) {
  const d = await datos(publicId);
  if (!d) return;
  const base = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
  const planta = await prisma.planta.findUniqueOrThrow({
    where: { id: d.plantaId },
    select: { minutosExpiracionConfirmacion: true },
  });
  const { asunto, html } = turnoPorConfirmar({
    ...d,
    urlConfirmar: `${base}/${d.slug}/turno/${publicId}/confirmar`,
    horasParaConfirmar: Math.round(planta.minutosExpiracionConfirmacion / 60),
  });
  await enviarSinFallar(d.plantaId, d.slug, { para: d.email, asunto, html });
}

/**
 * Venció el plazo y el cupo se liberó. El sistema viejo lo hacía en silencio.
 *
 * `sinConfirmar` distingue los dos motivos: un turno telefónico que el titular
 * nunca aceptó no venció "por falta de pago" — nunca llegó a haber un pago
 * pendiente, y decírselo así lo dejaría buscando un cobro que no existe.
 */
export async function notificarVencimiento(publicId: string, sinConfirmar = false) {
  const d = await datos(publicId);
  if (!d) return;
  const { asunto, html } = turnoVencido({ ...d, sinConfirmar });
  await enviarSinFallar(d.plantaId, d.slug, { para: d.email, asunto, html });
}
