"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requerirSesion } from "@/lib/sesionActual";
import { crearPlanta, desactivarPlanta, reactivarPlanta, type DatosPlanta, type Resultado } from "@/lib/plantas";

/**
 * Dar de alta una planta es facturarle a alguien: es del superadmin y de nadie
 * más. No alcanza con esconder la pantalla — se comprueba en cada acción.
 */
async function contexto() {
  const sesion = await requerirSesion("/admin/plantas");
  if (!sesion.esSuperadmin) redirect("/admin");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return { quien: { usuarioId: sesion.usuarioId, ip } };
}

export async function crear(datos: DatosPlanta): Promise<Resultado> {
  const { quien } = await contexto();
  const r = await crearPlanta(datos, quien);
  if (r.ok) {
    revalidatePath("/admin", "layout");
    redirect(`/admin/${r.slug}`);
  }
  return r;
}

export async function desactivar(slug: string): Promise<Resultado> {
  const { quien } = await contexto();
  const r = await desactivarPlanta(slug, quien);
  if (r.ok) revalidatePath("/admin", "layout");
  return r;
}

export async function reactivar(slug: string): Promise<Resultado> {
  const { quien } = await contexto();
  const r = await reactivarPlanta(slug, quien);
  if (r.ok) revalidatePath("/admin", "layout");
  return r;
}
