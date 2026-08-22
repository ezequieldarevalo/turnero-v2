/**
 * Acceso a la sesión desde el servidor, y las guardas que usan las páginas.
 *
 * Separado de `lib/auth.ts` porque este módulo toca `next/headers` y solo corre
 * dentro de un request; `auth.ts` es lógica pura y se puede probar sin Next.
 */
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { COOKIE_SESION, sesionDeToken, type Sesion, type RolEfectivo } from "@/lib/auth";
import { puedeEnPlanta, type Permiso } from "@/lib/permisos";
import { prisma } from "@/lib/prisma";

export async function sesionActual(): Promise<Sesion | null> {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  return sesionDeToken(token);
}

/** Para páginas del panel: sin sesión, al login. */
export async function requerirSesion(volverA?: string): Promise<Sesion> {
  const s = await sesionActual();
  if (!s) redirect(`/admin/ingresar${volverA ? `?volver=${encodeURIComponent(volverA)}` : ""}`);
  return s;
}

export interface Acceso {
  sesion: Sesion;
  rol: RolEfectivo;
  planta: Awaited<ReturnType<typeof prisma.planta.findUniqueOrThrow>>;
  puede: (permiso: Permiso) => boolean;
}

/**
 * Acceso a una planta concreta.
 *
 * Si el usuario no tiene permiso sobre esa planta responde 404, no 403: un 403
 * confirma que la planta existe. Con las URLs bajo `/admin/<slug>`, eso sería
 * regalar la lista de clientes a cualquiera que pruebe nombres.
 */
export async function requerirPlanta(slug: string, permiso?: Permiso): Promise<Acceso> {
  const sesion = await requerirSesion(`/admin/${slug}`);
  const asignada = sesion.plantas.find((p) => p.slug === slug);
  if (!asignada) notFound();

  const planta = await prisma.planta.findUniqueOrThrow({ where: { slug } });
  const puede = (p: Permiso) => puedeEnPlanta(asignada.rol, p, planta);

  if (permiso && !puede(permiso)) notFound();

  return { sesion, rol: asignada.rol, planta, puede };
}
