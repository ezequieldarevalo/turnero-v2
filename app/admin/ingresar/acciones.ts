"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { COOKIE_SESION, crearSesion, passwordValida, cerrarSesion } from "@/lib/auth";

/** Hash descartable con el mismo costo que uno real. */
const SEÑUELO =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

export async function ingresar(_previo: unknown, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const volver = String(form.get("volver") ?? "") || "/admin";

  if (!email || !password) return { error: "Completá los dos campos." };

  const usuario = await prisma.usuario.findUnique({ where: { email } });

  // Se verifica siempre, incluso sin usuario. Si se cortara antes, la respuesta
  // volvería mucho más rápido para un correo inexistente que para uno real, y
  // eso alcanza para averiguar qué correos tienen cuenta.
  const ok = await passwordValida(password, usuario?.passwordHash ?? SEÑUELO);

  if (!usuario || !ok || !usuario.activo) {
    return { error: "Correo o contraseña incorrectos." };
  }

  const h = await headers();
  const { token, expiraAt } = await crearSesion(usuario.id, {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  (await cookies()).set(COOKIE_SESION, token, {
    httpOnly: true, // inaccesible desde JavaScript, a diferencia del localStorage viejo
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiraAt,
  });

  // Solo rutas internas: un `volver` con destino externo convertiría el login
  // en un trampolín para mandar gente a otro sitio con apariencia de propio.
  redirect(volver.startsWith("/") && !volver.startsWith("//") ? volver : "/admin");
}

export async function salir() {
  const galletas = await cookies();
  await cerrarSesion(galletas.get(COOKIE_SESION)?.value);
  galletas.delete(COOKIE_SESION);
  redirect("/admin/ingresar");
}
