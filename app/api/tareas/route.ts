import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { vencerReservas, cerrarDia } from "@/lib/mantenimiento";

/**
 * Disparador del trabajo periódico. Lo llama un cron externo —el de la
 * plataforma de hosting, o un `curl` en el crontab— con el token en la cabecera
 * `Authorization: Bearer`.
 *
 * Está como endpoint y no como proceso residente a propósito: la aplicación
 * escala a más de una instancia, y un `setInterval` adentro correría una vez
 * por instancia. El cron externo garantiza una sola corrida.
 *
 *   GET /api/tareas?tarea=vencer   cada 5 minutos
 *   GET /api/tareas?tarea=cerrar   una vez por día, de madrugada
 *
 * Sin `tarea` corre las dos.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function autorizado(req: NextRequest): boolean {
  const esperado = process.env.TAREAS_TOKEN;
  // Sin token configurado el endpoint queda cerrado, no abierto. Un endpoint
  // que libera cupos no puede depender de que alguien se acuerde de protegerlo.
  if (!esperado) return false;

  const dado = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(dado);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const tarea = req.nextUrl.searchParams.get("tarea");
  const salida: Record<string, unknown> = {};

  try {
    if (!tarea || tarea === "vencer") salida.vencer = await vencerReservas();
    if (!tarea || tarea === "cerrar") salida.cerrar = await cerrarDia();
  } catch (e) {
    console.error("[tareas]", e);
    return NextResponse.json({ error: (e as Error).message, parcial: salida }, { status: 500 });
  }

  return NextResponse.json(salida, { status: 200 });
}
