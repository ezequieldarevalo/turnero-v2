/**
 * Atención sin turno previo.
 *
 * Lo que hay que probar es que NO se comporte como un turno: que no le saque el
 * cupo a nadie, que varias puedan entrar a la vez, y que no consuma capacidad
 * en el cierre del día.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, EstadoTurno, OrigenTurno } from "@prisma/client";
import { registrarAtencion, tiposDePlanta } from "../lib/atencion";
import { calcularDisponibilidad } from "../lib/disponibilidad";
import { cerrarDia } from "../lib/mantenimiento";
import { agendaDelDia } from "../lib/agenda";
import { buscarTurnos } from "../lib/buscar";
import { cobrarEnMostrador } from "../lib/turnoAdmin";
import { hoyLocal } from "../lib/fechas";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const PATENTE = "TST999XX";

async function limpiar() {
  const ids = (await prisma.turno.findMany({
    where: { dominio: { startsWith: "TST999" } }, select: { id: true },
  })).map((t) => t.id);
  if (!ids.length) return;
  await prisma.auditLog.deleteMany({ where: { entidad: "turno", entidadId: { in: ids } } });
  await prisma.pago.deleteMany({ where: { turnoId: { in: ids } } });
  await prisma.turno.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await limpiar();

  const gc = await prisma.planta.findUniqueOrThrow({ where: { slug: "godoycruz" } });
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email: "operador@godoycruz.test" } });
  const quien = { usuarioId: usuario.id, ip: "10.0.0.9" };
  const tipos = await tiposDePlanta(gc.id);
  const auto = tipos.find((t) => t.nombre.includes("AUTO"))!;

  console.log(`\n── Tipos que ofrece ${gc.nombre} ──`);
  check(tipos.length > 0, tipos.map((t) => `${t.nombre} $${t.precio.toLocaleString("es-AR")}`).join(" · "));

  // ── Validaciones ────────────────────────────────────────────
  console.log("\n── Validaciones ──");
  const sinNombre = await registrarAtencion(gc.id, {
    dominio: PATENTE, tipoVehiculoId: auto.id, titularNombre: "  ",
  }, quien);
  check(!sinNombre.ok && sinNombre.motivo === "DATOS_INVALIDOS", "sin nombre no se registra");

  const sinPatente = await registrarAtencion(gc.id, {
    dominio: "AB", tipoVehiculoId: auto.id, titularNombre: "Juan",
  }, quien);
  check(!sinPatente.ok && sinPatente.motivo === "DATOS_INVALIDOS", "con una patente demasiado corta tampoco");

  const tipoAjeno = await prisma.tipoVehiculo.findFirst({
    where: { plantas: { none: { plantaId: gc.id } } },
  });
  if (tipoAjeno) {
    const malTipo = await registrarAtencion(gc.id, {
      dominio: PATENTE, tipoVehiculoId: tipoAjeno.id, titularNombre: "Juan",
    }, quien);
    check(
      !malTipo.ok && malTipo.motivo === "TIPO_NO_OFRECIDO",
      `un tipo que la planta no ofrece (${tipoAjeno.nombre}) se rechaza`
    );
  }

  // ── Registro y cobro en un paso ─────────────────────────────
  console.log("\n── Registro con cobro ──");
  const antes = (await calcularDisponibilidad(prisma, { plantaSlug: "godoycruz", tipoVehiculoId: auto.id }))
    .flatMap((d) => d.cupos).length;

  const r = await registrarAtencion(gc.id, {
    dominio: "tst-999-xx", tipoVehiculoId: auto.id, titularNombre: "juan pérez",
    titularTelefono: "2615550000",
    cobro: { monto: auto.precio, metodo: "Efectivo" },
  }, quien);
  check(r.ok, "se registra");
  if (!r.ok) return;

  const t = await prisma.turno.findUniqueOrThrow({
    where: { publicId: r.publicId }, include: { pagos: true },
  });
  check(t.lineaId === null, "queda sin línea: no reservó ningún cupo");
  check(t.duracionMin === 0, "y sin duración: la atención ya está pasando");
  check(t.estado === EstadoTurno.CONFIRMADO, "cobrada en el momento, queda confirmada");
  check(t.origen === OrigenTurno.ADMIN, "con origen ADMIN, distinguible de las de la web");
  check(t.creadoPorId === usuario.id, "y con quién la cargó");
  check(t.dominio === "TST999XX", `la patente se normaliza ("tst-999-xx" → ${t.dominio})`);
  check(t.titularNombre === "JUAN PÉREZ", "y el nombre se pasa a mayúsculas");
  check(t.pagos.length === 1 && t.pagos[0].monto === auto.precio, `queda el cobro de $${auto.precio.toLocaleString("es-AR")}`);
  check(
    t.consentimientoAt === null,
    "sin consentimiento: el titular no lo dio en ningún lado y no se inventa"
  );

  const despues = (await calcularDisponibilidad(prisma, { plantaSlug: "godoycruz", tipoVehiculoId: auto.id }))
    .flatMap((d) => d.cupos).length;
  check(despues === antes, `no le sacó el cupo a nadie (${antes} → ${despues})`);

  // ── Varias a la vez ─────────────────────────────────────────
  console.log("\n── Varias al mismo tiempo ──");
  const enParalelo = await Promise.all(
    ["TST999AA", "TST999BB", "TST999CC"].map((p) =>
      registrarAtencion(gc.id, { dominio: p, tipoVehiculoId: auto.id, titularNombre: "Prueba" }, quien)
    )
  );
  check(
    enParalelo.every((x) => x.ok),
    "tres personas que llegan juntas entran las tres — sin línea, el índice de cupos no aplica"
  );

  // ── Aparece donde tiene que aparecer ────────────────────────
  console.log("\n── Dónde aparece ──");
  const hoy = hoyLocal(gc.timezone);
  const agenda = await agendaDelDia(gc, hoy);
  const enAgenda = agenda.filas.find((f) => f.publicId === r.publicId);
  check(!!enAgenda, "figura en la agenda del día");
  check(enAgenda?.linea === "Sin turno previo", 'la columna de línea dice "Sin turno previo"');
  check(agenda.total.cobrado >= auto.precio, `y su cobro entra en el total del día ($${agenda.total.cobrado.toLocaleString("es-AR")})`);

  const busqueda = await buscarTurnos(gc, "TST999XX");
  check(busqueda.total === 1, "se encuentra buscando por patente");

  // ── No infla la ocupación ───────────────────────────────────
  console.log("\n── Cierre del día ──");
  await cerrarDia(hoy);
  const filas = await prisma.ocupacionDiaria.findMany({
    where: { plantaId: gc.id, fecha: new Date(`${hoy}T00:00:00.000Z`) },
  });
  const vendidos = filas.reduce((a, f) => a + f.vendidos, 0);
  const atencionesHoy = await prisma.turno.count({
    where: { plantaId: gc.id, lineaId: null, inicio: { gte: new Date(`${hoy}T00:00:00-03:00`) } },
  });
  check(
    atencionesHoy >= 4,
    `hay ${atencionesHoy} atenciones sin turno hoy`
  );
  check(
    filas.every((f) => f.vendidos <= f.ofrecidos),
    `ninguna línea vendió más de lo que ofreció (${vendidos} vendidos en total)`
  );

  await limpiar();
  await prisma.ocupacionDiaria.deleteMany({
    where: { plantaId: gc.id, fecha: new Date(`${hoy}T00:00:00.000Z`) },
  });

  console.log(fallos === 0 ? "\n✅ Atención sin turno previo verificada\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch(async (e) => { console.error(e); await limpiar().catch(() => {}); process.exit(1); })
  .finally(() => prisma.$disconnect());
