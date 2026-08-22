"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requerirPlanta } from "@/lib/sesionActual";
import { marcarRevisado, type Resultado } from "@/lib/revision";

export async function resolver(slug: string, pagoId: number, nota: string): Promise<Resultado> {
  const acceso = await requerirPlanta(slug, "pagos.revisar");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const r = await marcarRevisado(pagoId, acceso.planta, nota, {
    usuarioId: acceso.sesion.usuarioId,
    ip,
  });
  if (r.ok) revalidatePath(`/admin/${slug}/pagos`);
  return r;
}
