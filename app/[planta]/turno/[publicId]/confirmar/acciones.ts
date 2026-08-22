"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { confirmarTitular } from "@/lib/turnoTelefonico";
import { generarLinkDePago } from "@/lib/pagos";
import { notificarReserva, notificarConfirmacion } from "@/lib/notificar";

export type Salida =
  | { ok: true; urlPago: string | null }
  | { ok: false; motivo: string };

export async function confirmar(slug: string, publicId: string, acepta: boolean): Promise<Salida> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const r = await confirmarTitular(publicId, slug, { acepta, ip });
  if (!r.ok) return { ok: false, motivo: r.motivo };

  const turno = await prisma.turno.findUniqueOrThrow({
    where: { publicId },
    include: { planta: { select: { requierePago: true } } },
  });

  if (!turno.planta.requierePago) {
    after(() => notificarConfirmacion(publicId));
    revalidatePath(`/${slug}/turno/${publicId}`);
    return { ok: true, urlPago: null };
  }

  try {
    const urlPago = await generarLinkDePago(turno.id);
    // El mismo correo que recibe quien reserva por la web: lleva el link real,
    // así puede pagar más tarde si cierra la ventana del checkout.
    after(() => notificarReserva(publicId));
    revalidatePath(`/${slug}/turno/${publicId}`);
    return { ok: true, urlPago };
  } catch (e) {
    // El consentimiento ya quedó registrado y el cupo sigue siendo suyo: no se
    // deshace nada. Se lo manda a la página del turno, desde donde puede
    // reintentar el pago.
    console.error("No se pudo generar el pago tras confirmar:", e);
    return { ok: true, urlPago: null };
  }
}

export async function irAlTurno(slug: string, publicId: string) {
  redirect(`/${slug}/turno/${publicId}`);
}
