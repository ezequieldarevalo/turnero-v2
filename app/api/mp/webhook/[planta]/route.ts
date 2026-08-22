import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { consultarPago, credencialesDe } from "@/lib/mercadopago";
import { aplicarPago } from "@/lib/pagos";

/**
 * Webhook de MercadoPago.
 *
 * Los cuatro defectos del sistema viejo que esto corrige:
 *
 *  1. No distinguía el tipo de notificación. MercadoPago manda `payment` y
 *     `merchant_order` a la misma URL; el viejo trataba a todas como pagos,
 *     armaba una URL rota y logueaba un error. Es la causa más probable de sus
 *     ~200.000 registros en logerrors.
 *  2. No validaba la firma. Cualquiera podía postear.
 *  3. No era idempotente: cada reintento insertaba otro cobro. Dejó 23.882
 *     filas duplicadas entre las tres plantas.
 *  4. Devolvía 200 ante cualquier error, con lo cual MercadoPago dejaba de
 *     reintentar y el pago se perdía en silencio.
 *
 * Regla de respuesta: 200 significa "procesado" o "ya lo tenía". Ante un fallo
 * real se devuelve 5xx para que MercadoPago reintente.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planta: string }> }
) {
  const { planta: slug } = await params;

  let cuerpo: any;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }

  // 1. Solo pagos. Lo demás se reconoce y se descarta sin consultar nada.
  const tipo = cuerpo?.type ?? cuerpo?.topic;
  if (tipo !== "payment") {
    return NextResponse.json({ ignorado: tipo ?? "sin tipo" }, { status: 200 });
  }

  const paymentId = String(cuerpo?.data?.id ?? "");
  if (!paymentId) {
    return NextResponse.json({ error: "sin data.id" }, { status: 400 });
  }

  const planta = await prisma.planta.findUnique({ where: { slug } });
  if (!planta) return NextResponse.json({ error: "planta inexistente" }, { status: 404 });

  // 2. Firma.
  const { webhookSecret } = await credencialesDe(planta.id, slug);
  if (webhookSecret) {
    const ok = firmaValida(
      req.headers.get("x-signature"),
      req.headers.get("x-request-id"),
      paymentId,
      webhookSecret
    );
    if (!ok) return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  // 3. Idempotencia. Es lo que hace estructuralmente imposible el duplicado.
  try {
    await prisma.mpEvento.create({ data: { paymentId, plantaId: planta.id } });
  } catch {
    return NextResponse.json({ estado: "ya procesado" }, { status: 200 });
  }

  try {
    // 4. La verdad la tiene MercadoPago, nunca el cuerpo de la notificación.
    const pago = await consultarPago(planta.id, slug, paymentId);
    await aplicarPago(planta.id, slug, pago);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    // Se borra la marca de idempotencia para que el reintento sí procese.
    await prisma.mpEvento.delete({ where: { paymentId } }).catch(() => {});
    console.error(`webhook ${slug} pago ${paymentId}:`, e);
    return NextResponse.json({ error: "fallo al procesar" }, { status: 500 });
  }
}

/**
 * Firma de MercadoPago: cabecera `x-signature: ts=...,v1=...`, sobre el
 * manifiesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 */
function firmaValida(
  signature: string | null,
  requestId: string | null,
  paymentId: string,
  secreto: string
): boolean {
  if (!signature) return false;

  const partes = Object.fromEntries(
    signature.split(",").map((p) => p.split("=").map((x) => x.trim()) as [string, string])
  );
  const { ts, v1 } = partes;
  if (!ts || !v1) return false;

  const manifiesto = `id:${paymentId};request-id:${requestId ?? ""};ts:${ts};`;
  const esperado = createHmac("sha256", secreto).update(manifiesto).digest("hex");

  const a = Buffer.from(esperado, "hex");
  const b = Buffer.from(v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
