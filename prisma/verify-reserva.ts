/**
 * Prueba de punta a punta del camino de reserva: el mismo código que corre
 * detrás del formulario público.
 */
import { PrismaClient, EstadoTurno } from "@prisma/client";
import { calcularDisponibilidad } from "../lib/disponibilidad";
import { reservar } from "../lib/reservar";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const SLUG = "maipu";

async function main() {
  await prisma.turno.deleteMany({ where: { dominio: "TST123" } });

  const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
  // La vigente de verdad, no una de prueba: lo que se comprueba es que el
  // turno quede atado a la que rige al reservar, sea cual sea. Fijar una propia
  // hacía que la prueba pasara por casualidad hasta que se publicó otra.
  const politica = await prisma.politicaPrivacidad.findFirst({
    where: { vigenteDesde: { lte: new Date() } },
    orderBy: { vigenteDesde: "desc" },
  });

  const dias = await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id });
  const cupo = dias[0].cupos[0];

  const base = {
    slug: SLUG, tipoVehiculoId: auto.id, lineaId: cupo.lineaId,
    inicioIso: cupo.inicio.toISOString(), duracionMin: cupo.duracionMin,
    nombre: "Juan Perez", dominio: "TST123", anio: "2015",
    email: "juan@ejemplo.com", telefono: "2615551234", combustible: "NAFTA",
    acepta: true,
  };

  // Camino de fallo: Maipú no tiene credenciales de MercadoPago, así que la
  // preferencia no se puede generar. Lo que se verifica es que el turno NO
  // quede tomando el cupo — si quedara, el cliente se autobloquearía.
  console.log("\n── Si no se puede generar el pago, el cupo vuelve ──");
  const fallo = await reservar(base, "200.1.2.3");
  check(!fallo.ok && (fallo as any).motivo === "PAGO_NO_DISPONIBLE", "devuelve el error");
  check(
    (await prisma.turno.count({ where: { dominio: "TST123" } })) === 0,
    "y no deja ningún turno fantasma"
  );
  const trasFallo = await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id });
  check(
    trasFallo[0].cupos.some((c) => c.inicio.getTime() === cupo.inicio.getTime() && c.lineaId === cupo.lineaId),
    "el cupo sigue disponible para reintentar"
  );

  console.log("\n── Reserva ──");
  // Se apaga el cobro para probar el resto del camino sin depender de la red.
  const plantaPrueba = await prisma.planta.update({ where: { slug: SLUG }, data: { requierePago: false } });
  const r = await reservar(base, "200.1.2.3");
  check(r.ok, r.ok ? `turno creado (publicId ${r.publicId.slice(0, 8)}…)` : `falló: ${(r as any).motivo}`);

  const turno = await prisma.turno.findFirstOrThrow({
    where: { dominio: "TST123" },
    include: { politica: true },
  });
  check(turno.estado === EstadoTurno.CONFIRMADO, `sin cobro queda en ${turno.estado}`);
  check(turno.titularEmail === "juan@ejemplo.com", "el correo se normaliza a minúsculas");
  check(turno.titularNombre === "JUAN PEREZ", "el nombre se normaliza a mayúsculas");

  console.log("\n── Consentimiento ──");
  check(
    !!politica && turno.politicaId === politica.id,
    `queda atado a la política vigente al reservar ("${turno.politica?.version}")`
  );
  check(!!turno.consentimientoAt, "con fecha y hora");
  check(turno.consentimientoIp === "200.1.2.3", `y la IP (${turno.consentimientoIp})`);

  console.log("\n── El cupo queda tomado ──");
  const despues = await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id });
  check(
    !despues[0].cupos.some((c) => c.inicio.getTime() === cupo.inicio.getTime() && c.lineaId === cupo.lineaId),
    "ya no se ofrece"
  );

  const segunda = await reservar({ ...base, dominio: "TST124" }, "200.1.2.4");
  check(!segunda.ok && (segunda as any).motivo === "CUPO_TOMADO", "una segunda reserva del mismo cupo es rechazada");

  console.log("\n── Validaciones ──");
  const libre = despues[0].cupos[0];
  const otro = { ...base, lineaId: libre.lineaId, inicioIso: libre.inicio.toISOString(), dominio: "TST125" };
  const sinConsent = await reservar({ ...otro, acepta: false }, null);
  check(!sinConsent.ok && (sinConsent as any).motivo === "SIN_CONSENTIMIENTO", "sin consentimiento no reserva");
  const mailMalo = await reservar({ ...otro, email: "no-es-un-mail" }, null);
  check(!mailMalo.ok && (mailMalo as any).motivo === "DATOS_INVALIDOS", "con correo inválido no reserva");

  console.log("\n── Al cancelar, el cupo vuelve ──");
  await prisma.turno.update({ where: { id: turno.id }, data: { estado: EstadoTurno.CANCELADO } });
  const final = await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id });
  check(
    final[0].cupos.some((c) => c.inicio.getTime() === cupo.inicio.getTime() && c.lineaId === cupo.lineaId),
    "vuelve a ofrecerse"
  );

  await prisma.turno.deleteMany({ where: { dominio: { startsWith: "TST12" } } });
  await prisma.planta.update({ where: { slug: SLUG }, data: { requierePago: true } });
  console.log(fallos === 0 ? "\n✅ Camino de reserva verificado\n" : `\n❌ ${fallos} fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
