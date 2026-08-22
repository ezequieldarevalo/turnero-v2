/**
 * Publica una versión de la política de privacidad.
 *
 *   npm run politica listar
 *   npm run politica publicar <archivo.md> <version> [YYYY-MM-DD] [--reemplazar]
 *
 * Una versión **nunca se edita**: se publica una nueva. Los turnos guardan el
 * `politicaId` que aceptaron, y si el texto de esa fila cambiara, la prueba del
 * consentimiento pasaría a apuntar a algo que la persona nunca leyó. Por eso el
 * comando se niega a pisar una versión existente.
 *
 * `--reemplazar` es la única excepción, y solo funciona si **ningún turno la
 * aceptó**: una versión que nadie aceptó no es prueba de nada, así que pisarla
 * no destruye ningún consentimiento. Sirve para corregir una versión recién
 * publicada antes de que entre gente.
 */
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";

const REEMPLAZAR = process.argv.includes("--reemplazar");
const [accion, archivo, version, desde] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function listar() {
  const todas = await prisma.politicaPrivacidad.findMany({ orderBy: { vigenteDesde: "desc" } });
  if (!todas.length) return console.log("No hay ninguna política publicada.");

  for (const [i, p] of todas.entries()) {
    const usos = await prisma.turno.count({ where: { politicaId: p.id } });
    console.log(
      `${i === 0 ? "→" : " "} ${p.version.padEnd(24)} ${p.vigenteDesde.toISOString().slice(0, 10)}` +
      `  ${String(usos).padStart(6)} turno(s) la aceptaron  ${p.texto.length} caracteres`
    );
  }
  console.log("\n→ = la vigente");
}

async function publicar() {
  if (!archivo || !version) {
    console.error("Uso: publicar <archivo.md> <version> [YYYY-MM-DD]");
    process.exit(1);
  }

  const existente = await prisma.politicaPrivacidad.findUnique({ where: { version } });
  if (existente) {
    const usos = await prisma.turno.count({ where: { politicaId: existente.id } });
    if (usos > 0) {
      console.error(
        `La versión "${version}" ya fue aceptada por ${usos} turno(s).\n` +
        `No se toca ni con --reemplazar: es la prueba de lo que esa gente aceptó.\n` +
        `Publicá una nueva con otro nombre.`
      );
      process.exit(1);
    }
    if (!REEMPLAZAR) {
      console.error(
        `Ya existe la versión "${version}", que todavía no aceptó nadie.\n` +
        `Volvé a correrlo con --reemplazar para pisarla, o usá otro nombre.`
      );
      process.exit(1);
    }
    await prisma.politicaPrivacidad.delete({ where: { id: existente.id } });
    console.log(`  (se reemplaza "${version}", que no había aceptado nadie)`);
  }

  const texto = readFileSync(archivo, "utf8").trim();
  if (texto.length < 200) {
    console.error("El archivo parece vacío o demasiado corto para ser una política.");
    process.exit(1);
  }

  const vigenteDesde = desde ? new Date(`${desde}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(vigenteDesde.getTime())) {
    console.error("La fecha va como YYYY-MM-DD.");
    process.exit(1);
  }

  const p = await prisma.politicaPrivacidad.create({ data: { version, texto, vigenteDesde } });
  console.log(`✓ Publicada "${p.version}" (${texto.length} caracteres), vigente desde ${vigenteDesde.toISOString().slice(0, 10)}.`);
  console.log(`  Se ve en /<planta>/privacidad`);
}

const acciones: Record<string, () => Promise<void>> = { listar, publicar };

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
