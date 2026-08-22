/**
 * Un cupo con una reserva vencida encima vuelve a estar libre al instante.
 *
 * El sistema viejo compara `vencimiento` contra el reloj en cada consulta de
 * disponibilidad, así que un horario abandonado reaparece en el momento. El
 * nuevo dependía del proceso periódico: hasta que el cron no marcaba la reserva
 * como vencida, el cupo seguía tapado. Con el cron cada 5 minutos eso son hasta
 * 5 minutos de un horario retenido por alguien que ya lo perdió — y el 21% de
 * las reservas vencen sin pagarse, así que no es un caso raro.
 *
 * Son dos mitades y las dos tienen que estar:
 *   1. la disponibilidad no cuenta como ocupadas las reservas ya vencidas;
 *   2. al reservar, el choque contra el índice único distingue una reserva viva
 *      de una muerta: la muerta se vence y el cupo se toma.
 *
 * Sin la segunda, la primera ofrecería un horario que después se rechaza.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, EstadoTurno } from "@prisma/client";
import { calcularDisponibilidad } from "../lib/disponibilidad";
import { reservar } from "../lib/reservar";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

// Patentes con formato válido: `reservar()` valida el formato de verdad, así
// que no sirve una marca inventada. ZZ9 no la usa nadie y alcanza para limpiar.
const MARCA = "ZZ9";
const SLUG = "godoycruz";

async function limpiar() {
  const ids = (await prisma.turno.findMany({
    where: { dominio: { startsWith: MARCA } }, select: { id: true },
  })).map((t) => t.id);
  if (!ids.length) return;
  await prisma.auditLog.deleteMany({ where: { entidad: "turno", entidadId: { in: ids } } });
  await prisma.pago.deleteMany({ where: { turnoId: { in: ids } } });
  await prisma.turno.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await limpiar();
  console.log("\nCupo retenido por una reserva vencida\n" + "─".repeat(50));

  const planta = await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } });
  const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });

  const libres = async () =>
    (await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id }))
      .flatMap((d) => d.cupos);

  const cupo = (await libres())[0];
  const ocupado = (c: { lineaId: number; inicio: Date }, lista: any[]) =>
    !lista.some((x) => x.lineaId === c.lineaId && x.inicio.getTime() === c.inicio.getTime());

  // ── Una reserva viva sí tapa el cupo ────────────────────────
  console.log("\n── Con la reserva viva ──");
  const viva = await prisma.turno.create({
    data: {
      plantaId: planta.id, lineaId: cupo.lineaId, tipoVehiculoId: auto.id,
      inicio: cupo.inicio, duracionMin: cupo.duracionMin,
      estado: EstadoTurno.PENDIENTE_PAGO,
      venceAt: new Date(Date.now() + 3_600_000), // vence en una hora
      dominio: `${MARCA}01TA`, titularNombre: "PRUEBA", titularEmail: "prueba@ejemplo.com",
    },
  });
  check(ocupado(cupo, await libres()), "el cupo no se ofrece");

  const rechazo = await reservar({
    slug: SLUG, tipoVehiculoId: auto.id, lineaId: cupo.lineaId,
    inicioIso: cupo.inicio.toISOString(), duracionMin: cupo.duracionMin,
    nombre: "Otra Persona", dominio: `${MARCA}02TA`, anio: "2020",
    email: "otra@ejemplo.com", telefono: "2615551234", combustible: "NAFTA", acepta: true,
  }, null);
  check(!rechazo.ok && rechazo.motivo === "CUPO_TOMADO", "y si otro lo intenta, se le rechaza");

  // ── Vencida, el cupo vuelve sin esperar al cron ─────────────
  console.log("\n── Pasado el plazo, sin que corra el cron ──");
  await prisma.turno.update({
    where: { id: viva.id },
    data: { venceAt: new Date(Date.now() - 60_000) }, // venció hace un minuto
  });

  const sigueEnEspera = await prisma.turno.findUniqueOrThrow({ where: { id: viva.id } });
  check(
    sigueEnEspera.estado === EstadoTurno.PENDIENTE_PAGO,
    "la reserva sigue en PENDIENTE_PAGO: nadie la marcó todavía"
  );
  check(!ocupado(cupo, await libres()), "pero el cupo ya se ofrece de nuevo");

  const tomado = await reservar({
    slug: SLUG, tipoVehiculoId: auto.id, lineaId: cupo.lineaId,
    inicioIso: cupo.inicio.toISOString(), duracionMin: cupo.duracionMin,
    nombre: "Otra Persona", dominio: `${MARCA}03TA`, anio: "2020",
    email: "otra@ejemplo.com", telefono: "2615551234", combustible: "NAFTA", acepta: true,
  }, null);
  check(tomado.ok, "y otra persona puede tomarlo de verdad, no solo verlo");

  const anterior = await prisma.turno.findUniqueOrThrow({ where: { id: viva.id } });
  check(anterior.estado === EstadoTurno.EXPIRADO, "la reserva muerta queda marcada como EXPIRADO");
  check(
    anterior.venceAt === null && anterior.pagoUrl === null,
    "sin plazo ni link de pago colgando"
  );

  const nuevo = await prisma.turno.findFirst({ where: { dominio: `${MARCA}03TA` } });
  check(
    nuevo?.lineaId === cupo.lineaId && nuevo?.inicio.getTime() === cupo.inicio.getTime(),
    "y el turno nuevo quedó en ese mismo horario"
  );

  // ── El cupo no se entrega dos veces ─────────────────────────
  console.log("\n── El cupo no se entrega dos veces ──");
  const tercero = await reservar({
    slug: SLUG, tipoVehiculoId: auto.id, lineaId: cupo.lineaId,
    inicioIso: cupo.inicio.toISOString(), duracionMin: cupo.duracionMin,
    nombre: "Tercero Mas", dominio: `${MARCA}04TA`, anio: "2020",
    email: "tercero@ejemplo.com", telefono: "2615551234", combustible: "NAFTA", acepta: true,
  }, null);
  check(
    !tercero.ok && tercero.motivo === "CUPO_TOMADO",
    "un tercero se choca contra la reserva nueva, que está viva"
  );

  await limpiar();
  console.log(fallos === 0 ? "\n✅ Cupos vencidos verificados\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch(async (e) => { console.error(e); await limpiar().catch(() => {}); process.exit(1); })
  .finally(() => prisma.$disconnect());
