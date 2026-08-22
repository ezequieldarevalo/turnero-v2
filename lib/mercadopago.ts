/**
 * Cliente de MercadoPago.
 *
 * Diferencias deliberadas con el sistema viejo:
 *  - El token va en el header Authorization, no en la query string. El viejo lo
 *    ponía en la URL, donde queda escrito en cualquier log de acceso o proxy.
 *  - Hay `back_urls` y `auto_return`: el cliente vuelve al turnero después de
 *    pagar. En el viejo se quedaba en MercadoPago sin saber qué había pasado.
 *  - Las credenciales salen cifradas de la base, por planta.
 *  - NO se manda el `payer`. Es opcional, la conciliación se hace por
 *    external_reference, y así es un dato personal menos que viaja a un
 *    tercero. Efecto lateral útil: permite que a alguien le pague el turno
 *    otra persona desde su propia cuenta.
 */
import { prisma } from "@/lib/prisma";
import { descifrar } from "@/lib/cripto";

const API = "https://api.mercadopago.com";

export class SinCredenciales extends Error {
  constructor(slug: string) {
    super(`La planta "${slug}" no tiene credenciales de MercadoPago cargadas.`);
  }
}

export async function credencialesDe(plantaId: number, slug: string) {
  const c = await prisma.mpCredencial.findUnique({ where: { plantaId } });
  if (!c) throw new SinCredenciales(slug);
  return {
    accessToken: descifrar(c.accessTokenCifrado),
    publicKey: c.publicKey,
    webhookSecret: c.webhookSecretCifrado ? descifrar(c.webhookSecretCifrado) : null,
  };
}

export interface DatosPreferencia {
  plantaId: number;
  slug: string;
  titulo: string;
  precio: number;
  /** publicId del turno: es lo que vuelve en el webhook. */
  referencia: string;
  venceAt: Date;
  mediosExcluidos: string[];
  /** Tipos completos a excluir: "ticket" tapa Rapipago, Pago Fácil y compañía. */
  tiposExcluidos?: string[];
}

export interface Preferencia {
  id: string;
  initPoint: string;
}

export async function crearPreferencia(d: DatosPreferencia): Promise<Preferencia> {
  const { accessToken } = await credencialesDe(d.plantaId, d.slug);
  const base = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

  // MercadoPago rechaza back_urls que no sean públicas, y con auto_return
  // activo eso hace fallar TODA la preferencia. En desarrollo sin túnel se
  // omiten las dos cosas: el pago funciona igual, solo que el cliente no
  // vuelve solo al turnero.
  const publica = base.startsWith("https://") && !base.includes("localhost");
  const retorno = publica
    ? {
        back_urls: {
          success: `${base}/${d.slug}/turno/${d.referencia}`,
          pending: `${base}/${d.slug}/turno/${d.referencia}`,
          failure: `${base}/${d.slug}/turno/${d.referencia}`,
        },
        auto_return: "approved",
      }
    : {};

  if (!publica) {
    console.warn(
      `[mercadopago] PUBLIC_BASE_URL no es pública (${base}): la preferencia va sin ` +
        `back_urls, y el webhook tampoco va a poder llegar. Hace falta un túnel.`
    );
  }

  const cuerpo = {
    items: [
      {
        title: d.titulo,
        quantity: 1,
        unit_price: d.precio,
        currency_id: "ARS",
      },
    ],
    // El publicId, no el id secuencial: es lo que viaja a un tercero.
    external_reference: d.referencia,
    notification_url: `${base}/api/mp/webhook/${d.slug}`,
    ...retorno,
    expires: true,
    expiration_date_to: d.venceAt.toISOString(),
    payment_methods: {
      excluded_payment_methods: d.mediosExcluidos.map((id) => ({ id })),
      excluded_payment_types: (d.tiposExcluidos ?? []).map((id) => ({ id })),
    },
  };

  const r = await fetch(`${API}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(12_000),
  });

  if (!r.ok) {
    const detalle = await r.text().catch(() => "");
    throw new Error(`MercadoPago respondió ${r.status}: ${detalle.slice(0, 300)}`);
  }

  const pref = await r.json();
  return { id: pref.id, initPoint: pref.init_point };
}

/**
 * Consulta el estado real del pago contra la API. Nunca se confía en el cuerpo
 * del webhook para decidir si algo está pago — esto el sistema viejo ya lo
 * hacía bien y se conserva.
 */
export async function consultarPago(plantaId: number, slug: string, paymentId: string) {
  const { accessToken } = await credencialesDe(plantaId, slug);
  const r = await fetch(`${API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`MercadoPago respondió ${r.status} al consultar el pago ${paymentId}`);
  return r.json();
}

/**
 * Todos los pagos asociados a un turno, buscados por su `external_reference`.
 *
 * Lo usa la conciliación: antes de vencer una reserva impaga hay que preguntar
 * si el pago existe. Si la notificación se perdió —MercadoPago caído, un deploy
 * a destiempo, un 500 nuestro que agotó los reintentos—, vencer el turno sin
 * preguntar le saca el cupo a alguien que sí pagó. Eso ya pasó en el sistema
 * viejo: una persona abonó $3.630 y se quedó sin turno.
 */
export async function buscarPagosPorReferencia(
  plantaId: number,
  slug: string,
  referencia: string
): Promise<any[]> {
  const { accessToken } = await credencialesDe(plantaId, slug);
  const url = `${API}/v1/payments/search?external_reference=${encodeURIComponent(referencia)}&sort=date_created&criteria=desc`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) {
    throw new Error(`MercadoPago respondió ${r.status} al buscar pagos de ${referencia}`);
  }
  const datos = await r.json();
  return Array.isArray(datos?.results) ? datos.results : [];
}
