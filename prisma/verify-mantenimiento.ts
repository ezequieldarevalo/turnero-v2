/**
 * Verificación del trabajo periódico: vencimiento de reservas impagas y cierre
 * diario de ocupación.
 *
 * La parte de conciliación consulta MercadoPago de verdad, con las credenciales
 * de prueba de Godoy Cruz. Es a propósito: lo que hay que probar es justamente
 * que antes de soltar un cupo se le pregunte a MercadoPago si el pago existe.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, EstadoTurno } from "@prisma/client";
import { calcularDisponibilidad, cuposDeLinea } from "../lib/disponibilidad";
import { vencerReservas, cerrarDia } from "../lib/mantenimiento";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const MARCA = "TSTMNT";
const HACE_UNA_HORA = () => new Date(Date.now() - 3_600_000);
const EN_UNA_HORA = () => new Date(Date.now() + 3_600_000);

async function main() {
  await prisma.turno.deleteMany({ where: { dominio: MARCA } });

  const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
  const gc = await prisma.planta.findUniqueOrThrow({ where: { slug: "godoycruz" } });
  const maipu = await prisma.planta.findUniqueOrThrow({ where: { slug: "maipu" } });

  /** Toma cupos libres distintos para no chocar entre sí. */
  const disponibles = async (slug: string, n: number) => {
    const dias = await calcularDisponibilidad(prisma, { plantaSlug: slug, tipoVehiculoId: auto.id });
    return dias.flatMap((d) => d.cupos).slice(0, n);
  };

  const crear = async (
    plantaId: number,
    cupo: { lineaId: number; inicio: Date; duracionMin: number },
    datos: { estado: EstadoTurno; venceAt: Date | null; preferenciaId?: string | null }
  ) =>
    prisma.turno.create({
      data: {
        plantaId, lineaId: cupo.lineaId, tipoVehiculoId: auto.id,
        inicio: cupo.inicio, duracionMin: cupo.duracionMin,
        dominio: MARCA, titularNombre: "PRUEBA", titularEmail: "prueba@ejemplo.com",
        pagoUrl: "https://ejemplo/checkout",
        ...datos,
      },
    });

  const cuposGc = await disponibles("godoycruz", 4);
  const cuposMaipu = await disponibles("maipu", 1);

  // ── Vencimiento ─────────────────────────────────────────────
  console.log("\n── Vencer reservas impagas ──");

  // Cargado por teléfono, nunca aceptado: no hay preferencia, no hay nada que
  // consultar. Es el caso limpio.
  const telefono = await crear(gc.id, cuposGc[0], {
    estado: EstadoTurno.PENDIENTE_CONFIRMACION, venceAt: HACE_UNA_HORA(), preferenciaId: null,
  });
  // Impago con preferencia real: obliga a consultar MercadoPago.
  const impago = await crear(gc.id, cuposGc[1], {
    estado: EstadoTurno.PENDIENTE_PAGO, venceAt: HACE_UNA_HORA(), preferenciaId: "1234567890-fake",
  });
  // Todavía en plazo.
  const enPlazo = await crear(gc.id, cuposGc[2], {
    estado: EstadoTurno.PENDIENTE_PAGO, venceAt: EN_UNA_HORA(), preferenciaId: "1234567890-fake",
  });
  // Ya pagado, con un venceAt viejo que nadie limpió: no se toca.
  const pagado = await crear(gc.id, cuposGc[3], {
    estado: EstadoTurno.CONFIRMADO, venceAt: HACE_UNA_HORA(),
  });
  // Planta sin credenciales de MercadoPago: la consulta va a fallar.
  const sinCred = await crear(maipu.id, cuposMaipu[0], {
    estado: EstadoTurno.PENDIENTE_PAGO, venceAt: HACE_UNA_HORA(), preferenciaId: "1234567890-fake",
  });

  const mios = [telefono, impago, enPlazo, pagado, sinCred].map((t) => t.publicId);
  const r = await vencerReservas();
  console.log(
    `  (${r.revisados} revisados, ${r.vencidos} liberados, ${r.rescatados} rescatados, ${r.errores.length} con error)`
  );
  // La tarea corre sobre toda la base, no solo sobre lo que crea esta prueba.
  // Si había reservas impagas de verdad vencidas, también las libera —que es
  // lo correcto—, así que se avisa en vez de dejarlo como ruido en los números.
  const ajenos = r.revisados - mios.filter((id) => id !== enPlazo.publicId && id !== pagado.publicId).length;
  if (ajenos > 0) console.log(`  ℹ ${ajenos} reserva(s) impaga(s) reales también estaban vencidas y se liberaron`);

  const leer = async (id: number) => prisma.turno.findUniqueOrThrow({ where: { id } });

  check((await leer(telefono.id)).estado === EstadoTurno.EXPIRADO,
    "el turno por teléfono que nadie aceptó se libera");
  check((await leer(enPlazo.id)).estado === EstadoTurno.PENDIENTE_PAGO,
    "el que todavía está en plazo no se toca");
  check((await leer(pagado.id)).estado === EstadoTurno.CONFIRMADO,
    "un turno ya pagado no se vence, aunque le haya quedado un venceAt viejo");

  const t1 = await leer(telefono.id);
  check(t1.venceAt === null && t1.pagoUrl === null,
    "al vencer se limpian el plazo y el link de pago");

  // La consulta a MercadoPago no encuentra pagos para esa referencia, así que
  // el turno se libera. Si MercadoPago no contesta, no se libera: eso también
  // es correcto, y se informa aparte.
  const tImpago = await leer(impago.id);
  const errorGc = r.errores.find((e) => e.includes(impago.publicId));
  if (errorGc) {
    console.log(`  ⚠ MercadoPago no respondió, así que el impago quedó retenido: ${errorGc}`);
    check(tImpago.estado === EstadoTurno.PENDIENTE_PAGO,
      "y ante esa falla el cupo se retiene en vez de soltarse a ciegas");
  } else {
    check(tImpago.estado === EstadoTurno.EXPIRADO,
      "el impago se libera recién después de confirmar contra MercadoPago que no hay pago");
  }

  const tSinCred = await leer(sinCred.id);
  check(tSinCred.estado === EstadoTurno.PENDIENTE_PAGO,
    "si no se puede consultar a MercadoPago, el turno NO se vence");
  check(r.errores.some((e) => e.includes(sinCred.publicId)),
    "y el problema queda informado en lugar de pasar en silencio");

  // Se comprueban los cupos exactos, no un total: la tarea corre sobre toda la
  // base y un conteo global mezcla lo propio con lo ajeno.
  const oferta = await calcularDisponibilidad(prisma, { plantaSlug: "godoycruz", tipoVehiculoId: auto.id });
  const seOfrece = (c: { lineaId: number; inicio: Date }) =>
    oferta.some((d) => d.cupos.some((x) => x.lineaId === c.lineaId && x.inicio.getTime() === c.inicio.getTime()));

  check(seOfrece(cuposGc[0]), "el cupo del turno vencido vuelve a estar disponible");
  check(!seOfrece(cuposGc[2]), "el del que sigue en plazo continúa retenido");
  check(!seOfrece(cuposGc[3]), "y el del turno pagado también");
  if (!errorGc) check(seOfrece(cuposGc[1]), "el del impago conciliado también vuelve");

  console.log("\n── Correrlo dos veces no hace daño ──");
  const r2 = await vencerReservas();
  check(r2.vencidos === 0, "la segunda corrida no vence nada nuevo");
  check((await leer(telefono.id)).estado === EstadoTurno.EXPIRADO, "y lo ya vencido sigue igual");

  await prisma.turno.deleteMany({ where: { dominio: MARCA } });

  // ── Cierre diario ───────────────────────────────────────────
  console.log("\n── Cierre diario ──");

  // Un día pasado con turnos reales migrados.
  const ultimo = await prisma.turno.findFirstOrThrow({
    where: { plantaId: gc.id, inicio: { lt: new Date() }, estado: { in: ["CONFIRMADO", "COMPLETADO"] } },
    orderBy: { inicio: "desc" },
  });
  const dia = new Intl.DateTimeFormat("en-CA", {
    timeZone: gc.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(ultimo.inicio);

  await prisma.ocupacionDiaria.deleteMany({ where: { plantaId: gc.id, fecha: new Date(`${dia}T00:00:00Z`) } });
  await cerrarDia(dia);

  const filas = await prisma.ocupacionDiaria.findMany({
    where: { plantaId: gc.id, fecha: new Date(`${dia}T00:00:00Z`) },
    orderBy: { lineaId: "asc" },
  });
  check(filas.length > 0, `${dia}: quedaron ${filas.length} líneas registradas`);

  const horarios = await prisma.horario.findMany({ where: { plantaId: gc.id } });
  for (const f of filas) {
    const esperado = cuposDeLinea(horarios, f.lineaId, dia, gc.timezone).length;
    check(f.ofrecidos === esperado,
      `línea ${f.lineaId}: ofrecidos ${f.ofrecidos} = la capacidad que dictan las reglas (${esperado})`);

    const reales = await prisma.turno.count({
      where: {
        plantaId: gc.id, lineaId: f.lineaId,
        estado: { in: ["PENDIENTE_CONFIRMACION", "PENDIENTE_PAGO", "CONFIRMADO", "COMPLETADO"] },
        inicio: { gte: new Date(`${dia}T00:00:00Z`), lte: new Date(`${dia}T23:59:59.999Z`) },
      },
    });
    check(f.vendidos === reales, `línea ${f.lineaId}: vendidos ${f.vendidos} = los turnos que hubo (${reales})`);
  }

  const total = filas.reduce((a, f) => a + f.vendidos, 0);
  const cap = filas.reduce((a, f) => a + f.ofrecidos, 0);
  console.log(`  (${total}/${cap} cupos vendidos ese día — ${Math.round((total / cap) * 100)}%)`);

  await cerrarDia(dia);
  const otraVez = await prisma.ocupacionDiaria.count({
    where: { plantaId: gc.id, fecha: new Date(`${dia}T00:00:00Z`) },
  });
  check(otraVez === filas.length, "correr el cierre dos veces no duplica filas");

  console.log(fallos === 0 ? "\n✅ Trabajo periódico verificado\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch(async (e) => {
    console.error(e);
    await prisma.turno.deleteMany({ where: { dominio: MARCA } }).catch(() => {});
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
