/**
 * Verificación del motor de disponibilidad contra los datos reales ya migrados.
 * Igual que verify.ts: no es un test suite, es la prueba de que el diseño
 * reproduce el comportamiento del sistema viejo.
 */
import { PrismaClient, EstadoTurno, TipoExcepcion } from "@prisma/client";
import { calcularDisponibilidad } from "../lib/disponibilidad";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const hhmm = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

async function main() {
  const AUTO = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
  const MOTO = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "MOTO HASTA 300 CC" } });

  for (const slug of ["lasheras", "maipu", "godoycruz"]) {
    const planta = await prisma.planta.findUniqueOrThrow({
      where: { slug },
      include: { lineas: true },
    });
    console.log(`\n── ${planta.nombre} ──`);

    const dias = await calcularDisponibilidad(prisma, { plantaSlug: slug, tipoVehiculoId: AUTO.id });
    const habil = dias.find((d) => {
      const dow = new Date(`${d.fecha}T12:00:00Z`).getUTCDay();
      return dow >= 1 && dow <= 5;
    })!;

    // Cupos por línea en un día hábil: debe coincidir con la capacidad relevada.
    const porLinea = new Map<number, number>();
    for (const c of habil.cupos) porLinea.set(c.lineaId, (porLinea.get(c.lineaId) ?? 0) + 1);
    const capacidad = slug === "godoycruz" ? 36 : 47;
    const lineasOfrecidas = porLinea.size;

    // Hay turnos reales migrados en fechas futuras: la oferta es capacidad
    // menos lo ya reservado. Verificar contra la capacidad pelada daría falso
    // negativo — el motor estaría descontando bien.
    const reservados = await prisma.turno.groupBy({
      by: ["lineaId"],
      where: {
        plantaId: planta.id,
        estado: { in: ["PENDIENTE_CONFIRMACION", "PENDIENTE_PAGO", "CONFIRMADO", "COMPLETADO"] },
        inicio: { gte: new Date(`${habil.fecha}T00:00:00-03:00`), lt: new Date(`${habil.fecha}T23:59:59-03:00`) },
      },
      _count: true,
    });
    const tomadosPorLinea = new Map(reservados.map((r) => [r.lineaId, r._count]));

    const detalle = [...porLinea.entries()]
      .map(([id, n]) => `${n}${tomadosPorLinea.get(id) ? `+${tomadosPorLinea.get(id)}` : ""}`)
      .join("/");

    check(
      [...porLinea.entries()].every(([id, n]) => n + (tomadosPorLinea.get(id) ?? 0) === capacidad),
      `${habil.fecha}: ${detalle} = ${capacidad} por línea (ofrecidos + ya reservados)`
    );

    // filtraLineaPorVehiculo: Godoy Cruz filtra, las otras dos no.
    const esperadoLineas = planta.filtraLineaPorVehiculo ? 2 : 3;
    check(
      lineasOfrecidas === esperadoLineas,
      `ofrece ${lineasOfrecidas} línea(s) para un auto ${planta.filtraLineaPorVehiculo ? "(filtra por categoría)" : "(no filtra)"}`
    );

    // Una moto: donde filtra, debe ver solo la línea de motos.
    const diasMoto = await calcularDisponibilidad(prisma, { plantaSlug: slug, tipoVehiculoId: MOTO.id });
    const lineasMoto = new Set(diasMoto[0]?.cupos.map((c) => c.lineaId)).size;
    check(
      lineasMoto === (planta.filtraLineaPorVehiculo ? 1 : 3),
      `una moto ve ${lineasMoto} línea(s)`
    );

    // Horario de apertura y cierre del primer día.
    const primero = habil.cupos[0], ultimo = habil.cupos[habil.cupos.length - 1];
    console.log(`    ${habil.fecha}: ${hhmm(primero.inicio, planta.timezone)} a ${hhmm(ultimo.inicio, planta.timezone)}, cada ${primero.duracionMin} min`);

    // Domingo cerrado.
    check(
      !dias.some((d) => new Date(`${d.fecha}T12:00:00Z`).getUTCDay() === 0),
      "no ofrece domingos"
    );

    // Ventana de reserva.
    const ultimoDia = dias[dias.length - 1].fecha;
    const diasAdelante = Math.round((new Date(ultimoDia).getTime() - Date.now()) / 86_400_000);
    check(
      diasAdelante <= planta.diasVentanaReserva && diasAdelante > planta.diasVentanaReserva - 10,
      `la ventana llega hasta ${ultimoDia} (~${diasAdelante} días, configurado ${planta.diasVentanaReserva})`
    );
  }

  // ── Un turno tomado desaparece de la oferta ──
  console.log(`\n── El cupo tomado deja de ofrecerse ──`);
  const dias = await calcularDisponibilidad(prisma, { plantaSlug: "maipu", tipoVehiculoId: AUTO.id });
  const objetivo = dias[0].cupos[0];
  const planta = await prisma.planta.findUniqueOrThrow({ where: { slug: "maipu" } });
  const t = await prisma.turno.create({
    data: {
      plantaId: planta.id, lineaId: objetivo.lineaId, tipoVehiculoId: AUTO.id,
      inicio: objetivo.inicio, duracionMin: objetivo.duracionMin,
      estado: EstadoTurno.PENDIENTE_PAGO,
      dominio: "TST000", titularNombre: "PRUEBA", titularEmail: "p@t.com",
    },
  });
  const despues = await calcularDisponibilidad(prisma, { plantaSlug: "maipu", tipoVehiculoId: AUTO.id });
  const sigue = despues[0].cupos.some(
    (c) => c.lineaId === objetivo.lineaId && c.inicio.getTime() === objetivo.inicio.getTime()
  );
  check(!sigue, "el cupo reservado ya no aparece");
  check(despues[0].cupos.length === dias[0].cupos.length - 1, "y solo desaparece ese");

  // Al reprogramar, el propio turno no debe bloquearse a sí mismo.
  const paraMover = await calcularDisponibilidad(prisma, {
    plantaSlug: "maipu", tipoVehiculoId: AUTO.id, excluirTurnoId: t.id,
  });
  check(
    paraMover[0].cupos.some((c) => c.inicio.getTime() === objetivo.inicio.getTime()),
    "al reprogramar, su propio cupo vuelve a estar disponible"
  );

  await prisma.turno.delete({ where: { id: t.id } });

  // ── Un bloqueo manual quita el cupo ──
  console.log(`\n── Excepciones de cupo ──`);
  const obj2 = dias[0].cupos[1];
  const exc = await prisma.excepcionCupo.create({
    data: {
      plantaId: planta.id, lineaId: obj2.lineaId, inicio: obj2.inicio,
      tipo: TipoExcepcion.BLOQUEAR, motivo: "prueba",
    },
  });
  const conBloqueo = await calcularDisponibilidad(prisma, { plantaSlug: "maipu", tipoVehiculoId: AUTO.id });
  check(
    !conBloqueo[0].cupos.some((c) => c.lineaId === obj2.lineaId && c.inicio.getTime() === obj2.inicio.getTime()),
    "un bloqueo manual saca el cupo de la oferta"
  );
  await prisma.excepcionCupo.delete({ where: { id: exc.id } });

  console.log(fallos === 0 ? "\n✅ Motor de disponibilidad verificado\n" : `\n❌ ${fallos} fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
