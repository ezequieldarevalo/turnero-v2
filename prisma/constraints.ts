/**
 * Aplica los .sql de prisma/sql en orden.
 *
 * Existe porque `prisma db push` recrea los índices que declara el esquema y
 * borra los que no: el índice parcial de cupos y el EXCLUDE de horarios no se
 * pueden expresar en Prisma, así que después de cada push hay que reponerlos.
 * Ya se perdió una vez en silencio, y el síntoma —cancelar dejaba de liberar el
 * cupo— no se parece en nada a la causa.
 *
 *   npm run db:push && npm run db:constraints
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma";

const DIR = join(__dirname, "sql");

/**
 * Corta un archivo en sentencias.
 *
 * Los comentarios se sacan ANTES de cortar. Si se filtraran después, cada
 * bloque arrastraría los comentarios que lo preceden y una sentencia comentada
 * arriba parecería ser un comentario entero — se descartaría en silencio, que
 * es justo lo peor que puede hacer un aplicador de migraciones. Pasó: la
 * primera versión aplicaba 3 de las 8 sentencias e informaba éxito.
 */
function sentencias(sql: string): string[] {
  const limpio = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  return limpio
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const archivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  if (!archivos.length) {
    console.log("No hay archivos .sql que aplicar.");
    return;
  }

  for (const archivo of archivos) {
    console.log(`\n── ${archivo} ──`);
    for (const s of sentencias(readFileSync(join(DIR, archivo), "utf8"))) {
      const resumen = s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim().slice(0, 70);
      try {
        await prisma.$executeRawUnsafe(s);
        console.log(`  ✓ ${resumen}…`);
      } catch (e: any) {
        // 42P07 objeto ya existe, 42710 constraint duplicada: son esperables al
        // reaplicar y no significan que algo esté mal.
        const codigo = e?.meta?.code ?? e?.code;
        if (["42P07", "42710"].includes(String(codigo))) {
          console.log(`  = ${resumen}… (ya estaba)`);
          continue;
        }
        console.error(`  ✗ ${resumen}…\n    ${e.message?.split("\n").slice(-3).join(" ")}`);
        process.exitCode = 1;
      }
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
