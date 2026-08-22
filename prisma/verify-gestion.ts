/**
 * Verificación de la gestión del turno por parte del cliente: cancelar y
 * reprogramar. Igual que las otras: no es un test suite, es la prueba de que
 * las reglas configurables por planta se respetan de verdad.
 *
 * Toca la configuración de la planta para probar los límites, y la restaura
 * siempre —incluso si algo explota a mitad de camino—.
 */
import { PrismaClient, EstadoTurno } from "@prisma/client";
import { calcularDisponibilidad } from "../lib/disponibilidad";
import { acciones, cancelar, reprogramar } from "../lib/gestionTurno";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const SLUG = "godoycruz"; // la única con permiteReprogramar = true
const MARCA = "TSTGES"; // dominio de los turnos de prueba
const horasHasta = (f: Date) => (f.getTime() - Date.now()) / 3_600_000;

async function main() {
  const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
  const original = await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } });

  const libres = (excluir?: number) =>
    calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id, excluirTurnoId: excluir });

  const crear = async (dia: number) => {
    const cupo = (await libres())[dia].cupos[0];
    return prisma.turno.create({
      data: {
        plantaId: original.id, lineaId: cupo.lineaId, tipoVehiculoId: auto.id,
        inicio: cupo.inicio, duracionMin: cupo.duracionMin,
        estado: EstadoTurno.CONFIRMADO,
        dominio: MARCA, titularNombre: "PRUEBA", titularEmail: "prueba@ejemplo.com",
        // para comprobar que cancelar los limpia
        pagoUrl: "https://ejemplo/checkout", venceAt: new Date(Date.now() + 7_200_000),
      },
    });
  };

  try {
    await prisma.turno.deleteMany({ where: { dominio: MARCA } });

    // ── Reprogramar ───────────────────────────────────────────
    console.log("\n── Reprogramar ──");
    let t = await crear(0);
    const inicioOriginal = t.inicio;
    const lineaOriginal = t.lineaId;

    const conExclusion = await libres(t.id);
    check(
      conExclusion[0].cupos.some(
        (c) => c.lineaId === lineaOriginal && c.inicio.getTime() === inicioOriginal.getTime()
      ),
      "al elegir nueva fecha, su propio horario vuelve a aparecer disponible"
    );
    const sinExclusion = await libres();
    check(
      !sinExclusion[0].cupos.some(
        (c) => c.lineaId === lineaOriginal && c.inicio.getTime() === inicioOriginal.getTime()
      ),
      "y para el resto del público ese horario está tomado"
    );

    const destino = conExclusion[1].cupos[0];
    const r = await reprogramar(t.publicId, SLUG, {
      lineaId: destino.lineaId, inicioIso: destino.inicio.toISOString(), duracionMin: destino.duracionMin,
    });
    check(r.ok, "se mueve a la nueva fecha");

    t = await prisma.turno.findUniqueOrThrow({ where: { id: t.id } });
    check(t.inicio.getTime() === destino.inicio.getTime(), "quedó en el horario elegido");
    check(t.reprogramaciones === 1, `el contador de reprogramaciones quedó en ${t.reprogramaciones}`);
    check(t.estado === EstadoTurno.CONFIRMADO, "conserva el estado: el pago sigue valiendo");

    check(
      (await libres())[0].cupos.some(
        (c) => c.lineaId === lineaOriginal && c.inicio.getTime() === inicioOriginal.getTime()
      ),
      "el horario que dejó volvió a la oferta"
    );

    // ── Cupo tomado por otro ──────────────────────────────────
    console.log("\n── Carrera por el mismo cupo ──");
    const ocupante = await crear(2);
    const choque = await reprogramar(t.publicId, SLUG, {
      lineaId: ocupante.lineaId!,
      inicioIso: ocupante.inicio.toISOString(),
      duracionMin: ocupante.duracionMin,
    });
    check(
      !choque.ok && choque.motivo === "CUPO_TOMADO",
      `mover el turno a un horario ya ocupado devuelve CUPO_TOMADO${
        !choque.ok && choque.motivo !== "CUPO_TOMADO" ? ` (dio ${choque.motivo})` : ""
      }`
    );
    t = await prisma.turno.findUniqueOrThrow({ where: { id: t.id } });
    check(t.reprogramaciones === 1, "y el intento fallido no incrementó el contador");

    // ── Tope de reprogramaciones ──────────────────────────────
    console.log("\n── Tope de reprogramaciones ──");
    await prisma.planta.update({ where: { id: original.id }, data: { maxReprogramaciones: 1 } });
    check(!(await acciones(t.publicId, SLUG)).reprogramar, "con el tope alcanzado, no se ofrece el botón");
    const otro = (await libres(t.id))[3].cupos[0];
    const r2 = await reprogramar(t.publicId, SLUG, {
      lineaId: otro.lineaId, inicioIso: otro.inicio.toISOString(), duracionMin: otro.duracionMin,
    });
    check(!r2.ok && r2.motivo === "TOPE_REPROGRAMACIONES", "y el intento directo se rechaza igual");
    await prisma.planta.update({ where: { id: original.id }, data: { maxReprogramaciones: null } });

    // ── Plazo mínimo ──────────────────────────────────────────
    console.log("\n── Plazo mínimo de cancelación ──");
    const minimo = Math.ceil(horasHasta(t.inicio)) + 24; // seguro por encima
    await prisma.planta.update({
      where: { id: original.id },
      data: { horasMinimasCancelacion: minimo, horasMinimasReprogramacion: minimo },
    });
    const acc = await acciones(t.publicId, SLUG);
    check(!acc.cancelar, `con ${minimo} horas de anticipación exigidas, no se puede cancelar`);
    check(!acc.reprogramar, "ni reprogramar");
    const rc = await cancelar(t.publicId, SLUG);
    check(!rc.ok && rc.motivo === "FUERA_DE_PLAZO", "el intento devuelve FUERA_DE_PLAZO");
    await prisma.planta.update({
      where: { id: original.id },
      data: {
        horasMinimasCancelacion: original.horasMinimasCancelacion,
        horasMinimasReprogramacion: original.horasMinimasReprogramacion,
      },
    });

    // ── Cancelar ──────────────────────────────────────────────
    console.log("\n── Cancelar ──");
    const antes = (await libres()).flatMap((d) => d.cupos).length;
    check((await cancelar(t.publicId, SLUG)).ok, "se cancela");
    t = await prisma.turno.findUniqueOrThrow({ where: { id: t.id } });
    check(t.estado === EstadoTurno.CANCELADO, "queda en CANCELADO: no se borra, deja rastro");
    check(t.pagoUrl === null && t.venceAt === null, "se limpia el link de pago");
    const despues = (await libres()).flatMap((d) => d.cupos).length;
    check(despues === antes + 1, `el cupo vuelve a la oferta (${antes} → ${despues})`);

    const rc3 = await cancelar(t.publicId, SLUG);
    check(!rc3.ok && rc3.motivo === "ESTADO_INVALIDO", "cancelar dos veces no hace nada");
    const acc2 = await acciones(t.publicId, SLUG);
    check(!acc2.cancelar && !acc2.reprogramar, "un turno cancelado no ofrece ninguna acción");

    // ── Planta con la autogestión apagada ─────────────────────
    console.log("\n── Planta que no permite reprogramar ──");
    const enMaipu = await prisma.turno.findFirstOrThrow({
      where: { planta: { slug: "maipu" }, estado: EstadoTurno.CONFIRMADO, inicio: { gt: new Date() } },
    });
    const accM = await acciones(enMaipu.publicId, "maipu");
    check(!accM.reprogramar, "Maipú no ofrece reprogramar: manda a WhatsApp");
    const rm = await reprogramar(enMaipu.publicId, "maipu", {
      lineaId: enMaipu.lineaId!, inicioIso: enMaipu.inicio.toISOString(), duracionMin: enMaipu.duracionMin,
    });
    check(!rm.ok && rm.motivo === "NO_PERMITIDO", "y forzarlo por la acción devuelve NO_PERMITIDO");

    // ── Turno de otra planta ──────────────────────────────────
    console.log("\n── Aislamiento entre plantas ──");
    const cruzado = await acciones(enMaipu.publicId, SLUG);
    check(!cruzado.cancelar && !cruzado.reprogramar, "un publicId de Maipú no opera bajo Godoy Cruz");
    const rx = await cancelar(enMaipu.publicId, SLUG);
    check(!rx.ok && rx.motivo === "NO_EXISTE", "y cancelarlo desde la otra planta da NO_EXISTE");
  } finally {
    await prisma.planta.update({
      where: { id: original.id },
      data: {
        maxReprogramaciones: original.maxReprogramaciones,
        horasMinimasCancelacion: original.horasMinimasCancelacion,
        horasMinimasReprogramacion: original.horasMinimasReprogramacion,
      },
    });
    await prisma.turno.deleteMany({ where: { dominio: MARCA } });
  }

  console.log(fallos === 0 ? "\n✅ Gestión del turno verificada\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
