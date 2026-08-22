/**
 * Turno cargado por teléfono, de punta a punta.
 *
 * Lo que hay que probar es el motivo por el que existe el estado intermedio:
 * el cupo se retiene, pero el consentimiento no existe hasta que lo da el
 * titular con su propio click. Y si no lo da, el horario vuelve solo.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, EstadoTurno, OrigenTurno } from "@prisma/client";
import { calcularDisponibilidad } from "../lib/disponibilidad";
import { crearTurnoTelefonico, confirmarTitular, paraConfirmar } from "../lib/turnoTelefonico";
import { vencerReservas } from "../lib/mantenimiento";
import { agendaDelDia } from "../lib/agenda";
import { fechaLocal } from "../lib/fechas";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const MARCA = "TSTTEL";
const SLUG = "maipu"; // requierePago = true, maxReprogramaciones = 2

async function limpiar() {
  const ids = (await prisma.turno.findMany({ where: { dominio: { startsWith: MARCA } }, select: { id: true } }))
    .map((t) => t.id);
  if (!ids.length) return;
  await prisma.auditLog.deleteMany({ where: { entidad: "turno", entidadId: { in: ids } } });
  await prisma.pago.deleteMany({ where: { turnoId: { in: ids } } });
  await prisma.turno.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await limpiar();

  const planta = await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } });
  const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email: "dueno@revitotal.test" } });
  const quien = { usuarioId: usuario.id, ip: "10.0.0.7" };

  const libre = async (i = 0) =>
    (await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id }))
      .flatMap((d) => d.cupos)[i];

  const base = async (i = 0, dominio = `${MARCA}01`) => {
    const c = await libre(i);
    return {
      lineaId: c.lineaId, inicioIso: c.inicio.toISOString(), duracionMin: c.duracionMin,
      tipoVehiculoId: auto.id, dominio, titularNombre: "Ana Gómez",
      titularEmail: "ana@ejemplo.com", titularTelefono: "2615559999",
    };
  };

  // ── Validaciones ────────────────────────────────────────────
  console.log("\n── Validaciones ──");
  const sinCorreo = await crearTurnoTelefonico(planta.id, { ...(await base()), titularEmail: "no-es-correo" }, quien);
  check(
    !sinCorreo.ok && sinCorreo.motivo === "DATOS_INVALIDOS",
    "sin un correo válido no se crea: es por donde se pide la confirmación"
  );

  // ── Creación ────────────────────────────────────────────────
  console.log("\n── Reserva del cupo ──");
  const cupo = await libre(0);
  const r = await crearTurnoTelefonico(planta.id, await base(0), quien);
  check(r.ok, "se crea el turno");
  if (!r.ok) return;

  const t = await prisma.turno.findUniqueOrThrow({ where: { publicId: r.publicId } });
  check(t.estado === EstadoTurno.PENDIENTE_CONFIRMACION, "queda esperando que el titular lo acepte");
  check(t.origen === OrigenTurno.ADMIN, "con origen ADMIN: ahora sí se puede medir cuántos entran por teléfono");
  check(t.creadoPorId === usuario.id, "y con qué operador lo cargó");
  check(t.consentimientoAt === null, "sin consentimiento: el operador no lo puede dar por otro");
  check(t.politicaId === null, "ni versión de política aceptada");
  check(t.venceAt !== null, "con plazo para confirmar");
  const horas = Math.round(((t.venceAt!.getTime() - Date.now()) / 3_600_000));
  check(
    Math.abs(horas - planta.minutosExpiracionConfirmacion / 60) <= 1,
    `de ${horas} horas, el minutosExpiracionConfirmacion de la planta`
  );

  const trasCrear = (await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id }))
    .flatMap((d) => d.cupos);
  check(
    !trasCrear.some((c) => c.lineaId === cupo.lineaId && c.inicio.getTime() === cupo.inicio.getTime()),
    "el cupo queda retenido: no se lo puede llevar otro mientras espera"
  );

  // Sobre el mismo cupo exacto, no sobre "el primero que esté libre": un cupo
  // es línea + horario, y a las 08:00 hay uno por cada línea. Pidiendo el
  // siguiente libre nunca se choca con nada y la prueba no probaría nada.
  const choque = await crearTurnoTelefonico(
    planta.id,
    {
      ...(await base(0, `${MARCA}02`)),
      lineaId: cupo.lineaId,
      inicioIso: cupo.inicio.toISOString(),
      duracionMin: cupo.duracionMin,
    },
    quien
  );
  check(
    !choque.ok && choque.motivo === "CUPO_TOMADO",
    "y un segundo intento sobre el mismo cupo se rechaza, no lo duplica"
  );

  // ── Lo que ve el titular ────────────────────────────────────
  console.log("\n── Pantalla de confirmación ──");
  const vista = await paraConfirmar(r.publicId, SLUG);
  check(!!vista, "el titular puede ver el turno a confirmar");
  check(vista?.dominio === `${MARCA}01`, "con su vehículo");
  check(vista?.requierePago === true, "y sabe que después hay que pagar");
  check(vista?.precio !== null, `con el precio a la vista ($${vista?.precio?.toLocaleString("es-AR")})`);

  const ajena = await paraConfirmar(r.publicId, "godoycruz");
  check(ajena === null, "desde otra planta no se puede confirmar");

  // ── Confirmación ────────────────────────────────────────────
  console.log("\n── El titular acepta ──");
  const sinAceptar = await confirmarTitular(r.publicId, SLUG, { acepta: false, ip: "200.1.2.3" });
  check(
    !sinAceptar.ok && sinAceptar.motivo === "SIN_CONSENTIMIENTO",
    "sin tildar la aceptación no se confirma"
  );

  const ok = await confirmarTitular(r.publicId, SLUG, { acepta: true, ip: "200.1.2.3" });
  check(ok.ok, "aceptando, sí");

  const confirmado = await prisma.turno.findUniqueOrThrow({
    where: { publicId: r.publicId }, include: { politica: true },
  });
  check(
    confirmado.estado === EstadoTurno.PENDIENTE_PAGO,
    "pasa a esperar el pago, porque Maipú cobra"
  );
  check(!!confirmado.consentimientoAt, "ahora sí queda el consentimiento, con fecha y hora");
  check(confirmado.consentimientoIp === "200.1.2.3", "y la IP desde donde se dio");
  check(!!confirmado.politicaId, `atado a la versión "${confirmado.politica?.version}"`);
  check(
    confirmado.venceAt !== null &&
      Math.abs((confirmado.venceAt.getTime() - Date.now()) / 60_000 - planta.minutosExpiracionPago) < 2,
    `y arranca el plazo de pago de ${planta.minutosExpiracionPago} minutos`
  );

  const dosVeces = await confirmarTitular(r.publicId, SLUG, { acepta: true, ip: "200.1.2.3" });
  check(!dosVeces.ok && dosVeces.motivo === "ESTADO_INVALIDO", "confirmar dos veces no hace nada");

  // ── Si no confirma, el cupo vuelve ──────────────────────────
  console.log("\n── Si el titular nunca confirma ──");
  const otro = await crearTurnoTelefonico(planta.id, await base(0, `${MARCA}03`), quien);
  if (!otro.ok) return;
  const cupoOtro = await prisma.turno.findUniqueOrThrow({ where: { publicId: otro.publicId } });

  await prisma.turno.update({
    where: { id: cupoOtro.id },
    data: { venceAt: new Date(Date.now() - 60_000) },
  });
  const vencidos = await vencerReservas();
  check(vencidos.vencidos >= 1, `el proceso periódico lo vence (${vencidos.vencidos} en total)`);

  const trasVencer = await prisma.turno.findUniqueOrThrow({ where: { id: cupoOtro.id } });
  check(trasVencer.estado === EstadoTurno.EXPIRADO, "queda EXPIRADO");
  const vuelto = (await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id }))
    .flatMap((d) => d.cupos);
  check(
    vuelto.some((c) => c.lineaId === cupoOtro.lineaId && c.inicio.getTime() === cupoOtro.inicio.getTime()),
    "y el horario vuelve a la oferta"
  );

  const tardio = await confirmarTitular(otro.publicId, SLUG, { acepta: true, ip: "1.2.3.4" });
  check(
    !tardio.ok && tardio.motivo === "ESTADO_INVALIDO",
    "confirmarlo después ya no revive un cupo que puede haber tomado otro"
  );

  // ── En la agenda ────────────────────────────────────────────
  console.log("\n── En la agenda ──");
  const dia = fechaLocal(confirmado.inicio, planta.timezone);
  const agenda = await agendaDelDia(planta, dia);
  const fila = agenda.filas.find((f) => f.publicId === r.publicId);
  check(!!fila, "el turno telefónico figura en la agenda del día");
  check(agenda.total.impagos >= 1, "y se cuenta entre los que faltan pagar");

  await limpiar();
  console.log(fallos === 0 ? "\n✅ Turno por teléfono verificado\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch(async (e) => { console.error(e); await limpiar().catch(() => {}); process.exit(1); })
  .finally(() => prisma.$disconnect());
