"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { Rol } from "@prisma/client";
import { requerirPlanta } from "@/lib/sesionActual";
import {
  darAcceso, cambiarRol, quitarAcceso, reiniciarClave, type Resultado,
} from "@/lib/gestionUsuarios";

async function contexto(slug: string) {
  const acceso = await requerirPlanta(slug, "usuarios.gestionar");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return { acceso, quien: { usuarioId: acceso.sesion.usuarioId, ip } };
}

export async function invitar(
  slug: string, datos: { email: string; nombre: string; rol: Rol }
): Promise<Resultado> {
  const { acceso, quien } = await contexto(slug);
  const r = await darAcceso(acceso.planta.id, datos, quien);
  if (r.ok) revalidatePath(`/admin/${slug}/usuarios`);
  return r;
}

export async function ponerRol(slug: string, usuarioId: number, rol: Rol): Promise<Resultado> {
  const { acceso, quien } = await contexto(slug);
  const r = await cambiarRol(acceso.planta.id, usuarioId, rol, quien);
  if (r.ok) revalidatePath(`/admin/${slug}/usuarios`);
  return r;
}

export async function sacar(slug: string, usuarioId: number): Promise<Resultado> {
  const { acceso, quien } = await contexto(slug);
  const r = await quitarAcceso(acceso.planta.id, usuarioId, quien);
  if (r.ok) revalidatePath(`/admin/${slug}/usuarios`);
  return r;
}

export async function nuevaClave(slug: string, usuarioId: number): Promise<Resultado> {
  const { acceso, quien } = await contexto(slug);
  const r = await reiniciarClave(acceso.planta.id, usuarioId, quien);
  if (r.ok) revalidatePath(`/admin/${slug}/usuarios`);
  return r;
}
