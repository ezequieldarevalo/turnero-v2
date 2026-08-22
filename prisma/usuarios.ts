/**
 * Altas, bajas y cambios de contraseña de los usuarios del panel.
 *
 *   npm run usuarios listar
 *   npm run usuarios crear <correo> "<Nombre>" <SUPERADMIN|DUENO|OPERADOR> [planta…]
 *   npm run usuarios clave <correo>
 *   npm run usuarios baja  <correo>
 *   npm run usuarios alta  <correo>
 *
 * SUPERADMIN no lleva plantas: ve todas, incluidas las que se den de alta
 * después. DUENO y OPERADOR necesitan al menos una.
 *
 * La contraseña se pide por teclado y no se muestra: pasarla como argumento la
 * dejaría escrita en el historial del shell y en la lista de procesos.
 */
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { Rol } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { hashearPassword } from "../lib/auth";

const [accion, ...resto] = process.argv.slice(2);

async function pedirClave(): Promise<string> {
  const interactivo = process.stdin.isTTY;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactivo });
  if (interactivo) {
    // Ocultar el eco solo tiene sentido con una terminal de por medio. Forzarlo
    // cuando la entrada viene de una tubería hace que readline la imprima igual,
    // que es lo contrario de lo que se busca.
    // @ts-expect-error _writeToOutput no está tipado; es la forma de silenciar el eco
    rl._writeToOutput = () => {};
  }
  process.stdout.write("Contraseña (vacío = generar una al azar): ");
  const clave = (await rl.question("")).trim();
  process.stdout.write("\n");
  rl.close();
  return clave;
}

async function listar() {
  const usuarios = await prisma.usuario.findMany({
    include: { plantas: { include: { planta: { select: { slug: true } } } } },
    orderBy: { id: "asc" },
  });
  if (!usuarios.length) return console.log("No hay usuarios todavía.");
  for (const u of usuarios) {
    const donde = u.esSuperadmin
      ? "SUPERADMIN (todas)"
      : u.plantas.map((p) => `${p.planta.slug}:${p.rol}`).join(" ") || "sin plantas";
    console.log(`${u.activo ? " " : "✗"} ${u.email.padEnd(32)} ${u.nombre.padEnd(24)} ${donde}`);
  }
}

async function crear() {
  const [email, nombre, rolTexto, ...slugs] = resto;
  if (!email || !nombre || !rolTexto) {
    console.error('Uso: crear <correo> "<Nombre>" <ROL> [planta…]');
    process.exit(1);
  }
  const rol = rolTexto.toUpperCase();
  const esSuperadmin = rol === "SUPERADMIN";
  if (!esSuperadmin && !Object.values(Rol).includes(rol as Rol)) {
    console.error(`Rol inválido. Son: SUPERADMIN, ${Object.values(Rol).join(", ")}`);
    process.exit(1);
  }
  if (esSuperadmin && slugs.length) {
    console.error("El SUPERADMIN ve todas las plantas: no se le asignan.");
    process.exit(1);
  }
  if (!esSuperadmin && !slugs.length) {
    console.error("Un DUENO o un OPERADOR necesita al menos una planta.");
    process.exit(1);
  }

  const plantas = esSuperadmin
    ? []
    : await prisma.planta.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  const faltan = slugs.filter((s) => !plantas.some((p) => p.slug === s));
  if (faltan.length) {
    console.error(`No existen estas plantas: ${faltan.join(", ")}`);
    process.exit(1);
  }

  let clave = await pedirClave();
  let generada = false;
  if (!clave) {
    clave = randomBytes(9).toString("base64url");
    generada = true;
  } else if (clave.length < 10) {
    console.error("La contraseña tiene que tener al menos 10 caracteres.");
    process.exit(1);
  }

  const usuario = await prisma.usuario.create({
    data: {
      email: email.trim().toLowerCase(),
      nombre: nombre.trim(),
      passwordHash: await hashearPassword(clave),
      esSuperadmin,
      plantas: { create: plantas.map((p) => ({ plantaId: p.id, rol: rol as Rol })) },
    },
  });

  console.log(`✓ ${usuario.email} — ${rol}${plantas.length ? ` en ${plantas.map((p) => p.slug).join(", ")}` : " (todas las plantas)"}`);
  if (generada) console.log(`  Contraseña generada: ${clave}\n  Pasásela por un canal seguro; no queda guardada en ningún lado.`);
}

async function clave() {
  const [email] = resto;
  const usuario = await prisma.usuario.findUnique({ where: { email: email?.trim().toLowerCase() ?? "" } });
  if (!usuario) { console.error("No existe ese usuario."); process.exit(1); }

  let nueva = await pedirClave();
  let generada = false;
  if (!nueva) { nueva = randomBytes(9).toString("base64url"); generada = true; }
  else if (nueva.length < 10) { console.error("Mínimo 10 caracteres."); process.exit(1); }

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { passwordHash: await hashearPassword(nueva) },
  });
  // Cambiar la contraseña tiene que echar las sesiones abiertas: si se cambió
  // porque alguien la tenía, dejarle la sesión viva no arregla nada.
  const { count } = await prisma.sesion.deleteMany({ where: { usuarioId: usuario.id } });
  console.log(`✓ Contraseña cambiada. ${count} sesión(es) cerrada(s).`);
  if (generada) console.log(`  Contraseña generada: ${nueva}`);
}

async function activar(activo: boolean) {
  const [email] = resto;
  const usuario = await prisma.usuario.update({
    where: { email: email?.trim().toLowerCase() ?? "" },
    data: { activo },
  }).catch(() => null);
  if (!usuario) { console.error("No existe ese usuario."); process.exit(1); }
  if (!activo) await prisma.sesion.deleteMany({ where: { usuarioId: usuario.id } });
  console.log(`✓ ${usuario.email} ${activo ? "reactivado" : "dado de baja"}`);
}

const acciones: Record<string, () => Promise<void>> = {
  listar,
  crear,
  clave,
  baja: () => activar(false),
  alta: () => activar(true),
};

async function main() {
  const fn = acciones[accion ?? ""];
  if (!fn) {
    console.error(`Acciones: ${Object.keys(acciones).join(", ")}`);
    process.exit(1);
  }
  await fn();
}

main()
  .catch((e) => { console.error(e.message ?? e); process.exit(1); })
  .finally(() => prisma.$disconnect());
