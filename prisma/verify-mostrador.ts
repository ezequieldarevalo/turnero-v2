/**
 * Las operaciones del mostrador sobre un turno.
 *
 * Lo central acá es que el mostrador NO hereda los límites del cliente: si los
 * heredara, al cliente que ya gastó sus dos reprogramaciones y llama por
 * WhatsApp no se lo podría atender del otro lado de ese WhatsApp.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, EstadoTurno } from "@prisma/client";
import { calcularDisponibilidad } from "../lib/disponibilidad";
import { acciones as accionesCliente, reprogramar as reprogramarCliente } from "../lib/gestionTurno";
import {
  cobrarEnMostrador, marcarRealizado, marcarAusente,
  reprogramarDesdeMostrador, cancelarDesdeMostrador,
} from "../lib/turnoAdmin";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const MARCA = "TSTMOS";

/**
 * Un turno con un pago asentado no se puede borrar: la clave foránea de `pagos`
 * lo retiene, y está bien que así sea — un cobro no debe desaparecer porque
 * alguien borre el turno. Para limpiar hay que sacar los pagos primero.
 */
async function limpiar() {
  const ids = (await prisma.turno.findMany({ where: { dominio: MARCA }, select: { id: true } }))
    .map((t) => t.id);
  if (!ids.length) return;
  await prisma.auditLog.deleteMany({ where: { entidad: "turno", entidadId: { in: ids } } });
  await prisma.pago.deleteMany({ where: { turnoId: { in: ids } } });
  await prisma.turno.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await limpiar();

  const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
  const operadorUsr = await prisma.usuario.findUniqueOrThrow({ where: { email: "operador@godoycruz.test" } });
  const quien = { usuarioId: operadorUsr.id, ip: "10.0.0.5" };

  const nuevo = async (slug: string, dia = 0, estado: EstadoTurno = EstadoTurno.PENDIENTE_PAGO) => {
    const planta = await prisma.planta.findUniqueOrThrow({ where: { slug } });
    const dias = await calcularDisponibilidad(prisma, { plantaSlug: slug, tipoVehiculoId: auto.id });
    const c = dias[dia].cupos[0];
    const t = await prisma.turno.create({
      data: {
        plantaId: planta.id, lineaId: c.lineaId, tipoVehiculoId: auto.id,
        inicio: c.inicio, duracionMin: c.duracionMin, estado,
        dominio: MARCA, titularNombre: "PRUEBA", titularEmail: "prueba@ejemplo.com",
        venceAt: new Date(Date.now() + 7_200_000), pagoUrl: "https://ejemplo/checkout",
      },
    });
    return { turno: t, planta };
  };

  // ── Cobro en mostrador ──────────────────────────────────────
  console.log("\n── Cobro en mostrador ──");
  let { turno: t, planta: gc } = await nuevo("godoycruz");

  const malo = await cobrarEnMostrador(t.publicId, gc.id, { monto: 0, metodo: "Efectivo" }, quien);
  check(!malo.ok && malo.motivo === "MONTO_INVALIDO", "un monto en cero se rechaza");

  const r = await cobrarEnMostrador(t.publicId, gc.id, { monto: 58600, metodo: "Efectivo" }, quien);
  check(r.ok, "se registra el cobro");

  t = await prisma.turno.findUniqueOrThrow({ where: { id: t.id } });
  check(t.estado === EstadoTurno.CONFIRMADO, "el turno queda confirmado");
  check(t.venceAt === null && t.pagoUrl === null, "y deja de estar esperando un pago online");

  const pagos = await prisma.pago.findMany({ where: { turnoId: t.id } });
  check(pagos.length === 1 && pagos[0].monto === 58600, "queda un pago de $58.600 asentado");
  check(pagos[0].estado === "approved", "acreditado, no pendiente");

  const repetido = await cobrarEnMostrador(t.publicId, gc.id, { monto: 58600, metodo: "Efectivo" }, quien);
  check(!repetido.ok && repetido.motivo === "YA_COBRADO", "cobrarlo dos veces se rechaza");
  check(
    (await prisma.pago.count({ where: { turnoId: t.id } })) === 1,
    "y no deja un segundo cobro — es el bug de los 23.882 duplicados, cerrado por el índice único"
  );

  // ── Auditoría ───────────────────────────────────────────────
  console.log("\n── Auditoría ──");
  const log = await prisma.auditLog.findFirst({
    where: { entidad: "turno", entidadId: t.id, accion: "turno.cobrado" },
  });
  check(!!log, "el cobro queda registrado en la auditoría");
  check(log?.usuarioId === operadorUsr.id, "con quién lo hizo");
  check(log?.ip === "10.0.0.5", "y desde dónde");
  check(
    (log?.datosDespues as any)?.monto === 58600,
    "junto con el monto y el medio, no solo el hecho de que pasó"
  );

  // ── Cierre de la atención ───────────────────────────────────
  console.log("\n── Cierre de la atención ──");
  const hecho = await marcarRealizado(t.publicId, gc.id, quien);
  check(hecho.ok, "se marca como realizado");
  check(
    (await prisma.turno.findUniqueOrThrow({ where: { id: t.id } })).estado === EstadoTurno.COMPLETADO,
    "queda en COMPLETADO"
  );
  const otraVez = await marcarRealizado(t.publicId, gc.id, quien);
  check(!otraVez.ok && otraVez.motivo === "ESTADO_INVALIDO", "y no se puede volver a marcar");
  const tarde = await cobrarEnMostrador(t.publicId, gc.id, { monto: 100, metodo: "Efectivo" }, quien);
  check(!tarde.ok && tarde.motivo === "ESTADO_INVALIDO", "ni cobrar un turno ya cerrado");

  const { turno: t2 } = await nuevo("godoycruz", 1, EstadoTurno.CONFIRMADO);
  check((await marcarAusente(t2.publicId, gc.id, quien)).ok, "un turno se puede marcar como no presentado");
  check(
    (await prisma.turno.findUniqueOrThrow({ where: { id: t2.id } })).estado === EstadoTurno.AUSENTE,
    "queda AUSENTE: consumió el cupo, a diferencia de cancelado"
  );

  // ── El mostrador no hereda los límites del cliente ──────────
  console.log("\n── Las Heras: el cliente reprograma hasta el tope, el mostrador siempre ──");
  const { turno: lh, planta: plantaLh } = await nuevo("lasheras", 0, EstadoTurno.CONFIRMADO);

  const alPrincipio = await accionesCliente(lh.publicId, "lasheras");
  check(alPrincipio.reprogramar, "al cliente se le ofrece reprogramar");

  // Gastadas las dos, el botón desaparece y de ahí en más es por WhatsApp. Se
  // simula el contador en vez de reprogramar dos veces de verdad: lo que se
  // prueba es el tope, no el camino de reserva, que ya tiene su verificación.
  await prisma.turno.update({ where: { id: lh.id }, data: { reprogramaciones: 2 } });

  const enElTope = await accionesCliente(lh.publicId, "lasheras");
  check(!enElTope.reprogramar, "gastadas las dos, ya no se le ofrece");
  const intentoCliente = await reprogramarCliente(lh.publicId, "lasheras", {
    lineaId: lh.lineaId!, inicioIso: lh.inicio.toISOString(), duracionMin: lh.duracionMin,
  });
  check(
    !intentoCliente.ok && intentoCliente.motivo === "TOPE_REPROGRAMACIONES",
    "y si lo fuerza, se le rechaza"
  );

  const libres = await calcularDisponibilidad(prisma, {
    plantaSlug: "lasheras", tipoVehiculoId: auto.id, excluirTurnoId: lh.id,
  });
  const destino = libres[2].cupos[0];
  const desdeMostrador = await reprogramarDesdeMostrador(lh.publicId, plantaLh.id, {
    lineaId: destino.lineaId, inicioIso: destino.inicio.toISOString(), duracionMin: destino.duracionMin,
  }, quien);
  check(desdeMostrador.ok, "el mostrador sí lo mueve — es quien atiende ese WhatsApp");
  check(
    (await prisma.turno.findUniqueOrThrow({ where: { id: lh.id } })).inicio.getTime() === destino.inicio.getTime(),
    "y el turno quedó en la fecha nueva"
  );

  // ── Tope de reprogramaciones: tampoco aplica al mostrador ───
  await prisma.planta.update({ where: { id: plantaLh.id }, data: { maxReprogramaciones: 1 } });
  const otro = (await calcularDisponibilidad(prisma, {
    plantaSlug: "lasheras", tipoVehiculoId: auto.id, excluirTurnoId: lh.id,
  }))[3].cupos[0];
  const segunda = await reprogramarDesdeMostrador(lh.publicId, plantaLh.id, {
    lineaId: otro.lineaId, inicioIso: otro.inicio.toISOString(), duracionMin: otro.duracionMin,
  }, quien);
  check(segunda.ok, "el tope de cambios es del cliente: el mostrador lo mueve igual");
  await prisma.planta.update({ where: { id: plantaLh.id }, data: { maxReprogramaciones: 2 } });

  // ── Cupo tomado ─────────────────────────────────────────────
  console.log("\n── Carrera por el cupo ──");
  const { turno: ocupante } = await nuevo("lasheras", 5, EstadoTurno.CONFIRMADO);
  const choque = await reprogramarDesdeMostrador(lh.publicId, plantaLh.id, {
    lineaId: ocupante.lineaId!, inicioIso: ocupante.inicio.toISOString(), duracionMin: ocupante.duracionMin,
  }, quien);
  check(!choque.ok && choque.motivo === "CUPO_TOMADO", "mover a un horario ocupado devuelve CUPO_TOMADO");

  // ── Cancelación con motivo ──────────────────────────────────
  console.log("\n── Cancelación desde el mostrador ──");
  const antes = (await calcularDisponibilidad(prisma, { plantaSlug: "lasheras", tipoVehiculoId: auto.id }))
    .flatMap((d) => d.cupos).length;
  const cancel = await cancelarDesdeMostrador(lh.publicId, plantaLh.id, "Lo pidió por teléfono", quien);
  check(cancel.ok, "se cancela");
  const trasCancelar = await prisma.turno.findUniqueOrThrow({ where: { id: lh.id } });
  check(trasCancelar.estado === EstadoTurno.CANCELADO, "queda CANCELADO");
  check(trasCancelar.observaciones === "Lo pidió por teléfono", "el motivo queda escrito en el turno");
  const despues = (await calcularDisponibilidad(prisma, { plantaSlug: "lasheras", tipoVehiculoId: auto.id }))
    .flatMap((d) => d.cupos).length;
  check(despues === antes + 1, `y el cupo vuelve a la oferta (${antes} → ${despues})`);

  const logCancel = await prisma.auditLog.findFirst({
    where: { entidad: "turno", entidadId: lh.id, accion: "turno.cancelado" },
  });
  check(!!logCancel, "la cancelación también queda auditada");

  // ── Aislamiento entre plantas ───────────────────────────────
  console.log("\n── Aislamiento ──");
  const { turno: enMaipu } = await nuevo("maipu", 0, EstadoTurno.CONFIRMADO);
  const cruzado = await cobrarEnMostrador(enMaipu.publicId, gc.id, { monto: 100, metodo: "Efectivo" }, quien);
  check(!cruzado.ok && cruzado.motivo === "NO_EXISTE", "un turno de Maipú no se opera desde Godoy Cruz");

  await limpiar();
  console.log(fallos === 0 ? "\n✅ Mostrador verificado\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch(async (e) => {
    console.error(e);
    await prisma.planta.update({ where: { slug: "lasheras" }, data: { maxReprogramaciones: 2 } }).catch(() => {});
    await limpiar().catch(() => {});
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
