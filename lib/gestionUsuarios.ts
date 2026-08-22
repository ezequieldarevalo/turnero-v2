/**
 * Alta y baja de usuarios del panel.
 *
 * Reemplaza al `npm run usuarios`, que sigue existiendo para el arranque en un
 * servidor recién desplegado. Con la pantalla, el dueño de una planta da de
 * alta a su gente sin depender de nadie — que es la mitad del punto de que el
 * sistema sea uno solo.
 *
 * **Nadie puede darse a sí mismo más de lo que tiene.** Un dueño da de alta
 * operadores y dueños en SU planta y en ninguna otra; el superadmin no se crea
 * desde la pantalla.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Rol } from "@prisma/client";
import { hashearPassword } from "@/lib/auth";
import { auditar } from "@/lib/auditoria";
import { validarEmail, validarNombre } from "@/lib/validaciones";
import type { Operador } from "@/lib/turnoAdmin";

export type Motivo =
  | "CORREO_INVALIDO"
  | "NOMBRE_INVALIDO"
  | "YA_TIENE_ACCESO"
  | "NO_EXISTE"
  | "ES_SUPERADMIN"
  | "ULTIMO_DUENO"
  | "VOS_MISMO";

export type Resultado =
  | { ok: true; clave?: string }
  | { ok: false; motivo: Motivo; detalle?: string };

export interface UsuarioDePlanta {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  ultimoAcceso: Date | null;
  /** En cuántas plantas más trabaja. Sirve para saber si darlo de baja lo deja sin nada. */
  otrasPlantas: number;
}

export async function usuariosDe(plantaId: number): Promise<UsuarioDePlanta[]> {
  const filas = await prisma.usuarioPlanta.findMany({
    where: { plantaId },
    include: {
      usuario: {
        include: {
          plantas: { select: { plantaId: true } },
          sesiones: { orderBy: { creadaAt: "desc" }, take: 1, select: { creadaAt: true } },
        },
      },
    },
  });

  return filas
    .map((f) => ({
      id: f.usuario.id,
      nombre: f.usuario.nombre,
      email: f.usuario.email,
      rol: f.rol,
      activo: f.usuario.activo,
      ultimoAcceso: f.usuario.sesiones[0]?.creadaAt ?? null,
      otrasPlantas: f.usuario.plantas.length - 1,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * Da acceso a una planta. Si el correo ya existe en el sistema, lo agrega a
 * esta planta en vez de crear otra cuenta: la misma persona puede trabajar en
 * dos plantas con un solo usuario y una sola contraseña.
 */
export async function darAcceso(
  plantaId: number,
  datos: { email: string; nombre: string; rol: Rol },
  quien: Operador
): Promise<Resultado> {
  const email = datos.email.trim().toLowerCase();
  const nombre = datos.nombre.trim();

  const malCorreo = validarEmail(email);
  if (malCorreo) return { ok: false, motivo: "CORREO_INVALIDO", detalle: malCorreo.mensaje };
  const malNombre = validarNombre(nombre);
  if (malNombre) return { ok: false, motivo: "NOMBRE_INVALIDO", detalle: malNombre.mensaje };

  const existente = await prisma.usuario.findUnique({
    where: { email }, include: { plantas: true },
  });

  if (existente) {
    if (existente.esSuperadmin) {
      return { ok: false, motivo: "ES_SUPERADMIN", detalle: "Ya ve todas las plantas" };
    }
    if (existente.plantas.some((p) => p.plantaId === plantaId)) {
      return { ok: false, motivo: "YA_TIENE_ACCESO" };
    }
    await prisma.usuarioPlanta.create({ data: { usuarioId: existente.id, plantaId, rol: datos.rol } });
    await auditar({
      plantaId, usuarioId: quien.usuarioId, accion: "usuario.acceso",
      entidad: "usuario", entidadId: existente.id, ip: quien.ip,
      despues: { email, rol: datos.rol, cuentaNueva: false },
    });
    // Sin contraseña nueva: ya tiene la suya.
    return { ok: true };
  }

  // La contraseña se genera acá y se muestra UNA vez. No se manda por correo
  // porque el correo del servicio sale con el remitente de una planta, y una
  // credencial viajando por ahí no tiene por qué quedar en la bandeja de nadie.
  const clave = randomBytes(9).toString("base64url");
  const usuario = await prisma.usuario.create({
    data: {
      email, nombre,
      passwordHash: await hashearPassword(clave),
      plantas: { create: { plantaId, rol: datos.rol } },
    },
  });

  await auditar({
    plantaId, usuarioId: quien.usuarioId, accion: "usuario.acceso",
    entidad: "usuario", entidadId: usuario.id, ip: quien.ip,
    despues: { email, rol: datos.rol, cuentaNueva: true },
  });

  return { ok: true, clave };
}

/** Cambia el rol dentro de esta planta. */
export async function cambiarRol(
  plantaId: number,
  usuarioId: number,
  rol: Rol,
  quien: Operador
): Promise<Resultado> {
  if (usuarioId === quien.usuarioId) {
    return { ok: false, motivo: "VOS_MISMO", detalle: "No podés cambiarte el rol a vos mismo" };
  }

  const actual = await prisma.usuarioPlanta.findUnique({
    where: { usuarioId_plantaId: { usuarioId, plantaId } },
  });
  if (!actual) return { ok: false, motivo: "NO_EXISTE" };

  // Bajar al último dueño dejaría la planta sin nadie que pueda configurarla ni
  // dar de alta gente: quedaría trabada hasta que intervenga el superadmin.
  if (actual.rol === Rol.DUENO && rol !== Rol.DUENO) {
    const duenos = await prisma.usuarioPlanta.count({ where: { plantaId, rol: Rol.DUENO } });
    if (duenos <= 1) return { ok: false, motivo: "ULTIMO_DUENO" };
  }

  await prisma.usuarioPlanta.update({
    where: { usuarioId_plantaId: { usuarioId, plantaId } }, data: { rol },
  });
  await auditar({
    plantaId, usuarioId: quien.usuarioId, accion: "usuario.rol",
    entidad: "usuario", entidadId: usuarioId, ip: quien.ip,
    antes: { rol: actual.rol }, despues: { rol },
  });
  return { ok: true };
}

/**
 * Le saca el acceso a esta planta. Si no le quedaba ninguna otra, además se
 * desactiva la cuenta y se cierran sus sesiones: un usuario sin plantas que
 * puede seguir entrando es una cuenta viva sin dueño.
 */
export async function quitarAcceso(
  plantaId: number,
  usuarioId: number,
  quien: Operador
): Promise<Resultado> {
  if (usuarioId === quien.usuarioId) {
    return { ok: false, motivo: "VOS_MISMO", detalle: "No podés sacarte el acceso a vos mismo" };
  }

  const fila = await prisma.usuarioPlanta.findUnique({
    where: { usuarioId_plantaId: { usuarioId, plantaId } },
    include: { usuario: { include: { plantas: true } } },
  });
  if (!fila) return { ok: false, motivo: "NO_EXISTE" };

  if (fila.rol === Rol.DUENO) {
    const duenos = await prisma.usuarioPlanta.count({ where: { plantaId, rol: Rol.DUENO } });
    if (duenos <= 1) return { ok: false, motivo: "ULTIMO_DUENO" };
  }

  const leQuedan = fila.usuario.plantas.length - 1;

  await prisma.$transaction(async (tx) => {
    await tx.usuarioPlanta.delete({ where: { usuarioId_plantaId: { usuarioId, plantaId } } });
    if (leQuedan === 0) {
      await tx.usuario.update({ where: { id: usuarioId }, data: { activo: false } });
      await tx.sesion.deleteMany({ where: { usuarioId } });
    }
  });

  await auditar({
    plantaId, usuarioId: quien.usuarioId, accion: "usuario.baja",
    entidad: "usuario", entidadId: usuarioId, ip: quien.ip,
    antes: { email: fila.usuario.email, rol: fila.rol },
    despues: { cuentaDesactivada: leQuedan === 0 },
  });
  return { ok: true };
}

/** Genera una contraseña nueva y cierra las sesiones abiertas. */
export async function reiniciarClave(
  plantaId: number,
  usuarioId: number,
  quien: Operador
): Promise<Resultado> {
  const fila = await prisma.usuarioPlanta.findUnique({
    where: { usuarioId_plantaId: { usuarioId, plantaId } },
  });
  if (!fila) return { ok: false, motivo: "NO_EXISTE" };

  const clave = randomBytes(9).toString("base64url");
  await prisma.usuario.update({
    where: { id: usuarioId }, data: { passwordHash: await hashearPassword(clave), activo: true },
  });
  // Cambiar la contraseña tiene que echar las sesiones abiertas: si se cambió
  // porque alguien la tenía, dejarle la sesión viva no arregla nada.
  await prisma.sesion.deleteMany({ where: { usuarioId } });

  await auditar({
    plantaId, usuarioId: quien.usuarioId, accion: "usuario.clave",
    entidad: "usuario", entidadId: usuarioId, ip: quien.ip,
  });
  return { ok: true, clave };
}
