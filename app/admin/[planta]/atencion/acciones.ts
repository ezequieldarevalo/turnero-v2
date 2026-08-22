"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requerirPlanta } from "@/lib/sesionActual";
import { registrarAtencion, type DatosAtencion, type Resultado } from "@/lib/atencion";

export async function registrar(slug: string, datos: DatosAtencion): Promise<Resultado> {
  // Se resuelve el permiso acá y no solo en la pantalla: una server action es
  // un endpoint, y esconder el formulario no impide llamarla.
  const acceso = await requerirPlanta(slug, "turno.crear");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // Cobrar en el momento requiere el permiso de cobro, no solo el de crear.
  if (datos.cobro && !acceso.puede("turno.cobrar")) {
    datos = { ...datos, cobro: undefined };
  }

  const r = await registrarAtencion(acceso.planta.id, datos, {
    usuarioId: acceso.sesion.usuarioId,
    ip,
  });

  if (r.ok) {
    revalidatePath(`/admin/${slug}`);
    redirect(`/admin/${slug}/turno/${r.publicId}`);
  }
  return r;
}
