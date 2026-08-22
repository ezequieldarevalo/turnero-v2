/**
 * Autenticación y permisos del panel.
 *
 * Lo que se verifica no es que el login "ande", sino que las tres cosas que el
 * sistema viejo no hacía sí ocurran: que la contraseña no se pueda leer de la
 * base, que dar de baja a alguien lo eche de inmediato, y que el rol limite
 * de verdad en vez de decorar la pantalla.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, Rol } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  hashearPassword, passwordValida, crearSesion, sesionDeToken, cerrarSesion, limpiarSesiones,
} from "../lib/auth";
import { puede, puedeEnPlanta, PERMISOS } from "../lib/permisos";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const CORREO = "verificacion@prueba.local";

async function main() {
  await prisma.usuario.deleteMany({ where: { email: CORREO } });

  // ── Contraseñas ─────────────────────────────────────────────
  console.log("\n── Contraseñas ──");
  const clave = "una clave larga y con espacios";
  const hash = await hashearPassword(clave);

  check(!hash.includes(clave), "el hash no contiene la contraseña");
  check(hash.startsWith("scrypt$"), `queda el algoritmo y sus parámetros (${hash.split("$").slice(0, 4).join("$")})`);
  check(await passwordValida(clave, hash), "la contraseña correcta valida");
  check(!(await passwordValida(clave + "x", hash)), "una con un carácter de más, no");
  check(!(await passwordValida("", hash)), "y la vacía tampoco");

  const otro = await hashearPassword(clave);
  check(hash !== otro, "dos veces la misma contraseña dan hashes distintos — la sal es por usuario");
  check(await passwordValida(clave, otro), "y los dos validan igual");

  // La ñ como un solo carácter (U+00F1) contra la misma palabra escrita con
  // n + tilde combinante (U+0303). En pantalla se ven idénticas y en bytes no
  // lo son: el teclado de macOS produce la segunda. Sin normalizar, quien
  // define la clave en una máquina no puede entrar desde la otra.
  //
  // Van tipadas como `string` y no como literales porque TypeScript compara
  // los tipos literales, ve que nunca pueden ser iguales y marca la
  // comparación como error — que es justamente lo que se quiere comprobar
  // en tiempo de ejecución.
  const PRECOMPUESTA: string = "Contrase\u00F1a";
  const DESCOMPUESTA: string = "Contrasen\u0303a";
  check(PRECOMPUESTA !== DESCOMPUESTA, "las dos formas de la ñ son bytes distintos");
  check(
    await passwordValida(DESCOMPUESTA, await hashearPassword(PRECOMPUESTA)),
    "y aun así la misma contraseña entra escrita de cualquiera de las dos"
  );

  const inicio = Date.now();
  await passwordValida(clave, hash);
  const ms = Date.now() - inicio;
  check(ms > 20, `verificar cuesta ${ms} ms: probar contraseñas a lo bruto no sale gratis`);

  // ── Sesiones ────────────────────────────────────────────────
  console.log("\n── Sesiones ──");
  const gc = await prisma.planta.findUniqueOrThrow({ where: { slug: "godoycruz" } });
  const usuario = await prisma.usuario.create({
    data: {
      email: CORREO, nombre: "Prueba", passwordHash: hash,
      plantas: { create: [{ plantaId: gc.id, rol: Rol.OPERADOR }] },
    },
  });

  const { token } = await crearSesion(usuario.id, { ip: "200.1.2.3", userAgent: "prueba" });
  const guardada = await prisma.sesion.findFirstOrThrow({ where: { usuarioId: usuario.id } });

  check(guardada.tokenHash !== token, "en la base va el hash del token, no el token");
  check(
    guardada.tokenHash === createHash("sha256").update(token).digest("hex"),
    "y quien lea la tabla no puede reconstruirlo"
  );

  const s = await sesionDeToken(token);
  check(s?.usuarioId === usuario.id, "el token abre la sesión");
  check(s?.plantas.length === 1 && s.plantas[0].slug === "godoycruz", "y trae solo la planta asignada");
  check((await sesionDeToken("inventado")) === null, "un token inventado no abre nada");

  await prisma.usuario.update({ where: { id: usuario.id }, data: { activo: false } });
  check((await sesionDeToken(token)) === null, "dar de baja al usuario corta la sesión ya abierta");
  await prisma.usuario.update({ where: { id: usuario.id }, data: { activo: true } });

  await prisma.sesion.updateMany({
    where: { usuarioId: usuario.id },
    data: { expiraAt: new Date(Date.now() - 1000) },
  });
  check((await sesionDeToken(token)) === null, "una sesión vencida no sirve");
  check((await limpiarSesiones()) >= 1, "y la limpieza la borra de la base");

  const { token: t2 } = await crearSesion(usuario.id);
  await cerrarSesion(t2);
  check((await sesionDeToken(t2)) === null, "salir invalida el token del lado del servidor");

  // ── Superadmin ──────────────────────────────────────────────
  console.log("\n── Superadmin ──");
  await prisma.usuario.update({ where: { id: usuario.id }, data: { esSuperadmin: true } });
  const { token: t3 } = await crearSesion(usuario.id);
  const sSuper = await sesionDeToken(t3);
  const activas = await prisma.planta.count({ where: { activa: true } });
  check(sSuper?.plantas.length === activas, `ve las ${activas} plantas activas sin filas en usuario_planta`);
  check(sSuper?.plantas.every((p) => p.rol === "SUPERADMIN") ?? false, "con rol SUPERADMIN en todas");

  // ── Permisos ────────────────────────────────────────────────
  console.log("\n── Permisos ──");
  check(!puede(Rol.OPERADOR, "config.editar"), "el operador no toca la configuración");
  check(!puede(Rol.OPERADOR, "reportes.ver"), "ni ve la facturación");
  check(!puede(Rol.OPERADOR, "credenciales.editar"), "ni las credenciales de cobro");
  check(puede(Rol.OPERADOR, "turno.cobrar"), "pero sí cobra en el mostrador");
  check(puede(Rol.DUENO, "config.editar"), "el dueño configura su planta");
  check(!puede(Rol.DUENO, "plantas.gestionar"), "y no puede dar de alta plantas: eso es facturarle a alguien");
  check(puede("SUPERADMIN", "plantas.gestionar"), "el superadmin sí");
  check(
    PERMISOS.every((p) => puede("SUPERADMIN", p)),
    `el superadmin tiene los ${PERMISOS.length} permisos`
  );

  console.log("\n── El parámetro de la planta manda sobre el rol ──");
  const lh = await prisma.planta.findUniqueOrThrow({ where: { slug: "lasheras" } });
  check(
    puedeEnPlanta(Rol.OPERADOR, "turno.realizar", lh),
    "en Las Heras el operador marca el turno como realizado"
  );
  check(
    !puedeEnPlanta("SUPERADMIN", "turno.realizar", gc),
    "en Godoy Cruz no lo puede ni el superadmin: lo registran en otro sistema"
  );

  await prisma.usuario.deleteMany({ where: { email: CORREO } });
  console.log(fallos === 0 ? "\n✅ Autenticación y permisos verificados\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch(async (e) => {
    console.error(e);
    await prisma.usuario.deleteMany({ where: { email: CORREO } }).catch(() => {});
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
