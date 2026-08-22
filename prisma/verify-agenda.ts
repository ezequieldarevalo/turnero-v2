/**
 * La agenda del día, sobre los datos reales migrados.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, EstadoTurno } from "@prisma/client";
import { agendaDelDia, ESTADOS_AGENDA } from "../lib/agenda";
import { codigoCorto, esCodigo, normalizarCodigo } from "../lib/codigo";
import { rangoDelDia, fechaLocal, hoyLocal, sumarDias } from "../lib/fechas";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

async function main() {
  // ── Código corto ────────────────────────────────────────────
  console.log("\n── Código corto del turno ──");
  const todos = await prisma.turno.findMany({ select: { publicId: true } });
  const prefijos = new Set(todos.map((t) => t.publicId.slice(0, 8)));
  const codigos = new Set(todos.map((t) => codigoCorto(t.publicId)));

  check(
    prefijos.size < 20,
    `el prefijo del UUIDv7 no sirve como código: ${todos.length} turnos comparten ${prefijos.size} prefijos`
  );
  check(
    codigos.size === todos.length,
    `la cola sí: ${codigos.size} códigos distintos para ${todos.length} turnos, sin choques`
  );
  check(esCodigo(codigoCorto(todos[0].publicId)), "un código generado se reconoce como código");
  check(normalizarCodigo(" 3f-a2 b1c4 ") === "3FA2B1C4", "se normaliza lo que tipea el operador");
  check(!esCodigo("AB123XY"), "una patente no se confunde con un código");

  // ── Agenda ──────────────────────────────────────────────────
  for (const slug of ["lasheras", "godoycruz"]) {
    const planta = await prisma.planta.findUniqueOrThrow({ where: { slug } });
    console.log(`\n── ${planta.nombre} ──`);

    // Un día con movimiento de verdad.
    const recientes = await prisma.turno.findMany({
      where: { plantaId: planta.id, estado: { in: ESTADOS_AGENDA } },
      select: { inicio: true }, orderBy: { inicio: "desc" }, take: 500,
    });
    const cuenta = new Map<string, number>();
    for (const t of recientes) {
      const f = fechaLocal(t.inicio, planta.timezone);
      cuenta.set(f, (cuenta.get(f) ?? 0) + 1);
    }
    const [fecha, esperados] = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0];

    const agenda = await agendaDelDia(planta, fecha);
    check(agenda.filas.length === esperados, `${fecha}: ${agenda.filas.length} turnos`);

    // Todo lo que trae la agenda cae dentro del día, medido en la zona de la
    // planta. Con el rango en UTC las tres primeras horas eran del día anterior.
    const { desde, hasta } = rangoDelDia(fecha, planta.timezone);
    check(
      agenda.filas.every((f) => f.inicio >= desde && f.inicio < hasta),
      `todos caen dentro del día en ${planta.timezone}`
    );
    check(
      agenda.filas.every((f) => fechaLocal(f.inicio, planta.timezone) === fecha),
      "y su fecha local coincide con la pedida"
    );

    const ordenada = agenda.filas.every(
      (f, i) => i === 0 || agenda.filas[i - 1].inicio <= f.inicio
    );
    check(ordenada, "vienen ordenados por hora");

    // El total cobrado tiene que ser la suma de los pagos acreditados, no el
    // precio de lista: es lo que se compara contra la caja al cerrar el día.
    const pagos = await prisma.pago.findMany({
      where: {
        plantaId: planta.id, estado: "approved",
        turno: { inicio: { gte: desde, lt: hasta }, estado: { in: ESTADOS_AGENDA } },
      },
      select: { monto: true },
    });
    const suma = pagos.reduce((a, p) => a + p.monto, 0);
    check(
      agenda.total.cobrado === suma,
      `el cobrado sale de los pagos acreditados ($${agenda.total.cobrado.toLocaleString("es-AR")})`
    );

    check(
      agenda.total.impagos === agenda.filas.filter((f) => f.estado === EstadoTurno.PENDIENTE_PAGO).length,
      `${agenda.total.impagos} sin pagar`
    );

    // Los cancelados y vencidos no van: liberaron el cupo, no ocupan la agenda.
    const descartados = await prisma.turno.count({
      where: {
        plantaId: planta.id,
        estado: { in: [EstadoTurno.CANCELADO, EstadoTurno.EXPIRADO] },
        inicio: { gte: desde, lt: hasta },
      },
    });
    check(
      !agenda.filas.some((f) => [EstadoTurno.CANCELADO, EstadoTurno.EXPIRADO].includes(f.estado as any)),
      `los cancelados y vencidos quedan fuera (${descartados} ese día)`
    );

    // ── Navegación ────────────────────────────────────────────
    check(agenda.conTurnos.includes(fecha), "el día mirado figura entre los que tienen turnos");
    check(
      agenda.conTurnos.every((f, i) => i === 0 || agenda.conTurnos[i - 1] < f),
      "las fechas para navegar vienen ordenadas y sin repetir"
    );
    const anterior = [...agenda.conTurnos].reverse().find((f) => f < fecha);
    if (anterior) {
      const previa = await agendaDelDia(planta, anterior);
      check(previa.filas.length > 0, `la flecha ‹ lleva al ${anterior}, que tiene ${previa.filas.length} turnos`);
    }

    // ── Columnas configuradas ─────────────────────────────────
    const columnas = planta.columnasAgenda as string[];
    check(columnas.length > 0, `muestra ${columnas.length} columnas: ${columnas.join(", ")}`);
    if (slug === "godoycruz") {
      check(columnas.includes("estado") && !columnas.includes("telefono"), "Godoy Cruz: con estado, sin teléfono");
    } else {
      check(columnas.includes("telefono") && !columnas.includes("estado"), "Las Heras: con teléfono, sin estado");
    }

    // Un día vacío no rompe nada.
    const vacio = await agendaDelDia(planta, sumarDias(hoyLocal(planta.timezone), 400));
    check(vacio.filas.length === 0 && vacio.total.cobrado === 0, "un día sin turnos devuelve una agenda vacía");
  }

  console.log(fallos === 0 ? "\n✅ Agenda verificada\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
