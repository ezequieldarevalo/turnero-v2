/**
 * Contraseñas y sesiones del panel.
 *
 * Sin dependencias nuevas: `scrypt` viene en Node y es una función de derivación
 * pensada justamente para esto —lenta y con costo de memoria, de modo que
 * probar contraseñas a lo bruto sea caro—. Agregar bcrypt o argon2 traería un
 * binario nativo que hay que recompilar en cada cambio de versión de Node, y
 * eso es exactamente el tipo de mantenimiento que estamos sacando del medio.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";

const scrypt = promisify(scryptCb) as (
  clave: string, sal: Buffer, largo: number, opciones: Record<string, number>
) => Promise<Buffer>;

// N=2^14 con r=8 son 16 MB y ~50 ms por intento: el parámetro "interactivo"
// habitual. Subirlo no es gratis — cada intento reserva esa memoria, así que
// un N grande convierte al login en su propia palanca de saturación.
const PARAMS = { N: 16384, r: 8, p: 1 };
// Node corta en 32 MB por defecto y 128·N·r queda justo al borde. Se declara
// explícito para no depender de ese default ni de la versión de Node.
const MAXMEM = 64 * 1024 * 1024;
const LARGO = 64;

/** Formato guardado: scrypt$N$r$p$sal$hash, todo en base64. */
export async function hashearPassword(password: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), sal, LARGO, { ...PARAMS, maxmem: MAXMEM });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, sal.toString("base64"), hash.toString("base64")].join("$");
}

export async function passwordValida(password: string, guardado: string): Promise<boolean> {
  const [algo, n, r, p, salB64, hashB64] = guardado.split("$");
  if (algo !== "scrypt") return false;
  const esperado = Buffer.from(hashB64, "base64");
  const calculado = await scrypt(password.normalize("NFKC"), Buffer.from(salB64, "base64"), esperado.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

// ─────────────────────────────────────────────────────────────
// Sesiones
// ─────────────────────────────────────────────────────────────

export const COOKIE_SESION = "sesion";
const DIAS_SESION = 7;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Devuelve el token en claro, que solo existe en la cookie. En la base va su hash. */
export async function crearSesion(
  usuarioId: number,
  datos: { ip?: string | null; userAgent?: string | null } = {}
): Promise<{ token: string; expiraAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiraAt = new Date(Date.now() + DIAS_SESION * 86_400_000);
  await prisma.sesion.create({
    data: {
      tokenHash: hashToken(token), usuarioId, expiraAt,
      ip: datos.ip ?? null, userAgent: datos.userAgent?.slice(0, 300) ?? null,
    },
  });
  return { token, expiraAt };
}

export type RolEfectivo = import("@prisma/client").Rol | "SUPERADMIN";

export interface Sesion {
  usuarioId: number;
  nombre: string;
  email: string;
  esSuperadmin: boolean;
  /** Ya resueltas: para el superadmin son todas las plantas activas. */
  plantas: { slug: string; nombre: string; colorPrimario: string; rol: RolEfectivo }[];
}

export async function sesionDeToken(token: string | undefined): Promise<Sesion | null> {
  if (!token) return null;

  const s = await prisma.sesion.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      usuario: {
        include: {
          plantas: {
            include: {
              planta: { select: { slug: true, nombre: true, colorPrimario: true, activa: true } },
            },
          },
        },
      },
    },
  });

  if (!s || s.expiraAt < new Date()) return null;
  // Desactivar a alguien tiene que echarlo, no esperar a que venza la sesión.
  if (!s.usuario.activo) return null;

  const campos = { slug: true, nombre: true, colorPrimario: true } as const;

  // El superadmin no tiene filas en usuario_planta: se resuelven acá, así una
  // planta nueva le aparece sola sin que nadie tenga que acordarse.
  const plantas: Sesion["plantas"] = s.usuario.esSuperadmin
    ? (await prisma.planta.findMany({
        where: { activa: true }, select: campos, orderBy: { nombre: "asc" },
      })).map((p) => ({ ...p, rol: "SUPERADMIN" as const }))
    : s.usuario.plantas
        .filter((up) => up.planta.activa)
        .map((up) => ({
          slug: up.planta.slug,
          nombre: up.planta.nombre,
          colorPrimario: up.planta.colorPrimario,
          rol: up.rol,
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return {
    usuarioId: s.usuario.id,
    nombre: s.usuario.nombre,
    email: s.usuario.email,
    esSuperadmin: s.usuario.esSuperadmin,
    plantas,
  };
}

export async function cerrarSesion(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.sesion.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Borra las sesiones vencidas. La llama el trabajo periódico. */
export async function limpiarSesiones(ahora = new Date()): Promise<number> {
  const { count } = await prisma.sesion.deleteMany({ where: { expiraAt: { lt: ahora } } });
  return count;
}
