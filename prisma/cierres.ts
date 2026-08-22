/**
 * Consolida los cierres que vinieron del sistema viejo.
 *
 *   npm run db:cierres            simulacro
 *   npm run db:cierres -- --commit   aplica
 *
 * El sistema viejo cerraba un día poniéndoles estado `I` a los cupos
 * pregenerados, uno por uno. La migración los trajo como bloqueos sueltos: 390
 * filas que dicen lo mismo que 3. Esto las junta en una fila por día, que es
 * donde además cabe escribir el motivo.
 *
 * Solo toca los días tapados por completo. Un día con algunos cupos bloqueados
 * es otra cosa y se deja como está.
 */
import { prisma } from "../lib/prisma";
import { consolidarBloqueos } from "../lib/cierres";

const COMMIT = process.argv.includes("--commit");

async function main() {
  const plantas = await prisma.planta.findMany({ orderBy: { id: "asc" } });
  const quien = { usuarioId: null as unknown as number, ip: null };

  let total = 0;
  for (const p of plantas) {
    const r = await consolidarBloqueos(p, quien, COMMIT);
    if (!r.length) {
      console.log(`${p.slug.padEnd(11)} nada que consolidar`);
      continue;
    }
    total += r.reduce((a, c) => a + c.cupos, 0);
    console.log(`${p.slug.padEnd(11)} ${r.length} día(s):`);
    for (const c of r) console.log(`   ${c.fecha}  ${String(c.cupos).padStart(3)} bloqueos → 1 fila`);
  }

  console.log(
    COMMIT
      ? `\n✓ Consolidado: ${total} filas de bloqueo reemplazadas.`
      : `\nSimulacro. ${total} filas se reemplazarían. Volvé a correrlo con --commit.`
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
