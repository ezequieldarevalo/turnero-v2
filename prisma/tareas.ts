/**
 * Las mismas tareas periódicas, a mano.
 *
 *   npm run tareas            las dos
 *   npm run tareas vencer     libera cupos de reservas impagas
 *   npm run tareas cerrar     guarda el corte de ayer
 *   npm run tareas cerrar 2026-08-14
 */
import { prisma } from "../lib/prisma";
import { vencerReservas, cerrarDia } from "../lib/mantenimiento";

const [tarea, fecha] = process.argv.slice(2);

async function main() {
  if (!tarea || tarea === "vencer") {
    const r = await vencerReservas();
    console.log(
      `vencer: ${r.revisados} revisados, ${r.vencidos} liberados, ${r.rescatados} rescatados, ${r.sesiones} sesiones limpiadas`
    );
    for (const e of r.errores) console.error(`  ! ${e}`);
  }

  if (!tarea || tarea === "cerrar") {
    for (const c of await cerrarDia(fecha)) {
      console.log(`cerrar: ${c.fecha} → ${c.filas} líneas`);
    }
  }

  if (tarea && !["vencer", "cerrar"].includes(tarea)) {
    console.error(`Tarea desconocida: "${tarea}". Son "vencer" o "cerrar".`);
    process.exit(1);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
