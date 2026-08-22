/**
 * Verificación del modelo contra la realidad del sistema viejo.
 * No es un test suite: es la prueba de que el diseño aguanta los datos que existen.
 */
import { PrismaClient, EstadoTurno } from "@prisma/client";
import { ESTADOS_OCUPANTES } from "../lib/disponibilidad";

const prisma = new PrismaClient();
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

async function main() {
  // Residuos de una corrida que murió antes de limpiar. Pasó: una corrida
  // abortó a mitad y dejó un turno de prueba que después apareció contaminando
  // el recuento de la migración.
  await prisma.turno.deleteMany({ where: { titularNombre: "PRUEBA" } });

  // ── 1. Capacidad: ¿el modelo genera los mismos cupos que el sistema viejo? ──
  console.log("\n── Capacidad por día ──");
  const esperado: Record<string, { habil: number; sabado: number }> = {
    lasheras: { habil: 47, sabado: 29 },
    maipu: { habil: 47, sabado: 29 },
    godoycruz: { habil: 36, sabado: 20 },
  };

  for (const slug of Object.keys(esperado)) {
    const planta = await prisma.planta.findUniqueOrThrow({
      where: { slug },
      include: { horarios: { orderBy: { diaSemana: "asc" } }, lineas: true },
    });

    for (const h of planta.horarios) {
      const paso = 60 / h.slotsPorHora;
      const cupos = Math.ceil((h.hasta - h.desde) / paso);
      const esperados = h.diaSemana === 6 ? esperado[slug].sabado : esperado[slug].habil;
      check(
        cupos === esperados,
        `${slug} ${DIAS[h.diaSemana]} ${hhmm(h.desde)}–${hhmm(h.hasta)} cada ${paso}min → ${cupos} cupos/línea (esperado ${esperados})`
      );
    }

    const totalDiario = planta.lineas.length * esperado[slug].habil;
    console.log(`    ${planta.lineas.length} líneas → ${totalDiario} cupos por día hábil\n`);
  }

  // ── 2. El domingo no existe como fila = cerrado ──
  console.log("── Domingo cerrado ──");
  const domingos = await prisma.horario.count({ where: { diaSemana: 0 } });
  check(domingos === 0, `sin filas para domingo (${domingos})`);

  // ── 3. Restricción de no solapamiento de bandas ──
  console.log("\n── Bandas horarias no se solapan ──");
  const lh = await prisma.planta.findUniqueOrThrow({ where: { slug: "lasheras" } });
  try {
    await prisma.horario.create({
      data: { plantaId: lh.id, diaSemana: 1, desde: 600, hasta: 800, slotsPorHora: 6 },
    });
    check(false, "el motor aceptó una banda que pisa 08:00–15:50 — NO debería");
    await prisma.horario.deleteMany({ where: { plantaId: lh.id, desde: 600 } });
  } catch {
    check(true, "el motor rechaza una banda que se solapa con otra del mismo día");
  }

  // Una banda de tarde que NO pisa sí debe entrar (el caso de Godoy Cruz).
  const nueva = await prisma.horario.create({
    data: { plantaId: lh.id, diaSemana: 1, desde: 1020, hasta: 1260, slotsPorHora: 6 },
  });
  check(true, "acepta una segunda banda del mismo día si no se pisa (17:00–21:00)");
  await prisma.horario.delete({ where: { id: nueva.id } });

  // ── 4. Concurrencia: dos turnos en el mismo cupo ──
  console.log("\n── Un solo turno por cupo ──");
  const linea = await prisma.linea.findFirstOrThrow({ where: { plantaId: lh.id } });
  const tipo = await prisma.plantaTipoVehiculo.findFirstOrThrow({ where: { plantaId: lh.id } });
  const inicio = new Date("2026-09-01T11:00:00.000Z");
  const base = {
    plantaId: lh.id,
    lineaId: linea.id,
    tipoVehiculoId: tipo.tipoVehiculoId,
    inicio,
    duracionMin: 10,
    dominio: "AAA111",
    titularNombre: "PRUEBA",
    titularEmail: "prueba@test.com",
  };

  const t1 = await prisma.turno.create({
    data: { ...base, estado: EstadoTurno.CONFIRMADO },
  });
  check(true, "primer turno tomado");

  try {
    await prisma.turno.create({ data: { ...base, estado: EstadoTurno.PENDIENTE_PAGO } });
    check(false, "entró un segundo turno en el mismo cupo — NO debería");
  } catch {
    check(true, "el segundo turno en el mismo cupo es rechazado por el índice");
  }

  // El índice parcial y el motor de disponibilidad tienen que coincidir estado
  // por estado. Si el motor esconde un cupo que el índice no protege, dos
  // personas se quedan con el mismo horario; al revés, la reserva falla con un
  // error que no se entiende. Ya se separaron una vez: el índice no incluía
  // PENDIENTE_CONFIRMACION y el motor sí, con lo cual un turno cargado por
  // teléfono desaparecía de la web pero la base dejaba pisarlo.
  const [{ indexdef }] = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
    `SELECT indexdef FROM pg_indexes WHERE indexname = 'turnos_cupo_ocupado'`
  );
  const enIndice = [...indexdef.matchAll(/'([A-Z_]+)'::"EstadoTurno"/g)].map((m) => m[1]).sort();
  const enMotor = [...ESTADOS_OCUPANTES].sort();
  check(
    JSON.stringify(enIndice) === JSON.stringify(enMotor),
    `el índice protege los mismos estados que esconde el motor (${enIndice.join(", ")})`
  );

  // ── 5. Al cancelar, el cupo se libera solo ──
  await prisma.turno.update({ where: { id: t1.id }, data: { estado: EstadoTurno.CANCELADO } });
  const t2 = await prisma.turno.create({ data: { ...base, estado: EstadoTurno.CONFIRMADO } });
  check(true, "tras cancelar, el cupo vuelve a estar disponible");

  await prisma.turno.deleteMany({ where: { id: { in: [t1.id, t2.id] } } });

  // ── 6. publicId opaco ──
  console.log("\n── Identificador público ──");
  check(
    /^[0-9a-f-]{36}$/.test(t2.publicId) && t2.publicId !== String(t2.id),
    `publicId es UUID y no el id secuencial (${t2.publicId})`
  );

  // ── 7. Coherencia de catálogo ──
  console.log("\n── Catálogo ──");
  const huerfanos = await prisma.$queryRawUnsafe<any[]>("SELECT * FROM tipos_sin_linea");
  check(huerfanos.length === 0, `ningún tipo de vehículo ofrecido sin línea que lo atienda`);

  const display = await prisma.plantaTipoVehiculo.findMany({
    where: { nombreDisplay: { not: null } },
    include: { planta: true, tipo: true },
  });
  console.log("    Overrides de nombre por planta:");
  for (const d of display) {
    console.log(`      ${d.planta.slug}: ${d.tipo.nombre} → ${d.nombreDisplay}`);
  }

  console.log(fallos === 0 ? "\n✅ Todo verificado\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
