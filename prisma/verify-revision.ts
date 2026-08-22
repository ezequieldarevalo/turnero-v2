/**
 * Pagos a revisar.
 *
 * El caso que más importa es el que estuvo roto: un pago que llega sin turno
 * que le corresponda tiene que quedar asentado igual. Iba con `turnoId: 0`, la
 * clave foránea lo rechazaba, y un `catch` vacío se comía el error — así que el
 * único caso en que ese código importaba, plata sin dueño, era justo el que se
 * perdía en silencio.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, EstadoTurno } from "@prisma/client";
import { aplicarPago } from "../lib/pagos";
import { pagosARevisar, pendientesDeRevision, marcarRevisado, atencionesSinCobrar } from "../lib/revision";
import { registrarAtencion } from "../lib/atencion";
import { cobrarEnMostrador } from "../lib/turnoAdmin";
import { vencerReservas } from "../lib/mantenimiento";
import { hoyLocal, rangoDelDia } from "../lib/fechas";
import { calcularDisponibilidad } from "../lib/disponibilidad";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const MARCA = "TSTREV";
const REFS = ["tstrev-huerfano", "tstrev-cancelado", "tstrev-normal"];

async function limpiar() {
  await prisma.pago.deleteMany({ where: { paymentId: { startsWith: "tstrev-" } } });
  const ids = (await prisma.turno.findMany({ where: { dominio: { startsWith: MARCA } }, select: { id: true } }))
    .map((t) => t.id);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { entidad: "turno", entidadId: { in: ids } } });
    await prisma.pago.deleteMany({ where: { turnoId: { in: ids } } });
    await prisma.turno.deleteMany({ where: { id: { in: ids } } });
  }
}

/** Un pago tal como lo devuelve la API de MercadoPago, en lo que importa. */
const pagoMp = (id: string, referencia: string, monto: number) => ({
  id,
  status: "approved",
  external_reference: referencia,
  transaction_amount: monto,
  payment_type_id: "ticket",
  payment_method_id: "rapipago",
  date_approved: new Date().toISOString(),
});

async function main() {
  await limpiar();

  const gc = await prisma.planta.findUniqueOrThrow({ where: { slug: "godoycruz" } });
  const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email: "dueno@revitotal.test" } });

  const antes = await pendientesDeRevision(gc.id);

  // ── Plata sin dueño ─────────────────────────────────────────
  console.log("\n── Un pago sin turno que le corresponda ──");
  const r1 = await aplicarPago(gc.id, "godoycruz", pagoMp("tstrev-huerfano", "referencia-que-no-existe", 58600), (f) => void f());
  check(r1.motivo === "SIN_TURNO", "se reconoce que no hay turno");

  const huerfano = await prisma.pago.findUnique({
    where: { proveedor_paymentId: { proveedor: "MERCADOPAGO", paymentId: "tstrev-huerfano" } },
  });
  check(!!huerfano, "y AUN ASÍ el pago queda asentado — es el bug que estaba perdiendo plata");
  check(huerfano?.turnoId === null, "con el turno en null, no en cero");
  check(huerfano?.monto === 58600, `por $${huerfano?.monto.toLocaleString("es-AR")}`);
  check(huerfano?.requiereRevision === true, "y marcado para revisar");

  const repetido = await aplicarPago(gc.id, "godoycruz", pagoMp("tstrev-huerfano", "referencia-que-no-existe", 58600), (f) => void f());
  check(
    (await prisma.pago.count({ where: { paymentId: "tstrev-huerfano" } })) === 1,
    "si MercadoPago reintenta, no se duplica"
  );

  // ── Pago sobre un turno que ya no vale ──────────────────────
  console.log("\n── Un pago sobre un turno cancelado ──");
  const cupo = (await calcularDisponibilidad(prisma, { plantaSlug: "godoycruz", tipoVehiculoId: auto.id }))[0].cupos[0];
  const turno = await prisma.turno.create({
    data: {
      plantaId: gc.id, lineaId: cupo.lineaId, tipoVehiculoId: auto.id,
      inicio: cupo.inicio, duracionMin: cupo.duracionMin,
      estado: EstadoTurno.CANCELADO,
      dominio: `${MARCA}01`, titularNombre: "PRUEBA", titularEmail: "prueba@ejemplo.com",
    },
  });

  await aplicarPago(gc.id, "godoycruz", pagoMp("tstrev-cancelado", turno.publicId, 58600), (f) => void f());
  const sobreCancelado = await prisma.pago.findUniqueOrThrow({
    where: { proveedor_paymentId: { proveedor: "MERCADOPAGO", paymentId: "tstrev-cancelado" } },
  });
  check(sobreCancelado.turnoId === turno.id, "el pago se ata al turno");
  check(sobreCancelado.requiereRevision === true, "y queda para revisar");
  check(
    (await prisma.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado === EstadoTurno.CANCELADO,
    "el turno NO se resucita: su horario puede tenerlo otra persona"
  );

  // ── La lista ────────────────────────────────────────────────
  console.log("\n── La lista ──");
  const lista = await pagosARevisar(gc.id);
  check(lista.length === antes.total + 2, `aparecen los ${lista.length - antes.total} casos nuevos`);
  const sinTurno = lista.find((p) => p.paymentId === "tstrev-huerfano");
  check(sinTurno?.turno === null, "el huérfano se muestra sin turno asociado");
  check(
    !!sinTurno?.motivo.includes("referencia-que-no-existe"),
    "y con la referencia que llegó, para poder buscarla en MercadoPago"
  );
  const conTurno = lista.find((p) => p.paymentId === "tstrev-cancelado");
  check(conTurno?.turno?.dominio === `${MARCA}01`, "el del turno cancelado muestra el vehículo");

  const pend = await pendientesDeRevision(gc.id);
  check(pend.total === lista.length && pend.monto >= 117200, `${pend.total} casos por $${pend.monto.toLocaleString("es-AR")}`);

  // ── Resolver ────────────────────────────────────────────────
  console.log("\n── Resolver un caso ──");
  const quien = { usuarioId: usuario.id, ip: "10.0.0.3" };
  const sinNota = await marcarRevisado(sobreCancelado.id, gc, "  ", quien);
  check(
    !sinNota.ok && sinNota.motivo === "SIN_NOTA",
    "sin escribir qué se hizo no se puede cerrar: bajarlo en silencio sería esconderlo"
  );

  const ok = await marcarRevisado(sobreCancelado.id, gc, "Se devolvió por MercadoPago", quien);
  check(ok.ok, "con la nota, sí");

  const cerrado = await prisma.pago.findUniqueOrThrow({ where: { id: sobreCancelado.id } });
  check(cerrado.requiereRevision === false, "sale de la lista");
  check(cerrado.notaRevision === "Se devolvió por MercadoPago", "queda escrito qué se hizo");
  check(cerrado.revisadoPorId === usuario.id, "quién lo hizo");
  check(!!cerrado.revisadoAt, "y cuándo");
  check(cerrado.monto === 58600, "el pago no se borra ni se altera: la plata entró igual");

  const dosVeces = await marcarRevisado(sobreCancelado.id, gc, "otra cosa", quien);
  check(!dosVeces.ok && dosVeces.motivo === "NO_EXISTE", "cerrarlo dos veces no pisa la nota anterior");

  const log = await prisma.auditLog.findFirst({
    where: { entidad: "pago", entidadId: sobreCancelado.id, accion: "pago.revisado" },
  });
  check(!!log, "y queda en la auditoría");

  // ── Atenciones sin cobrar ───────────────────────────────────
  console.log("\n── Atenciones sin cobrar ──");
  const operador = await prisma.usuario.findUniqueOrThrow({ where: { email: "operador@godoycruz.test" } });
  const quienOp = { usuarioId: operador.id, ip: null };

  const sinCobrar = await registrarAtencion(gc.id, {
    dominio: `${MARCA}77`, tipoVehiculoId: auto.id, titularNombre: "Sin Cobrar",
  }, quienOp);
  if (!sinCobrar.ok) throw new Error("no se pudo crear la atención");

  const recienHecha = await prisma.turno.findUniqueOrThrow({ where: { publicId: sinCobrar.publicId } });
  check(recienHecha.estado === "PENDIENTE_PAGO", "una atención sin cobrar queda impaga");
  check(recienHecha.venceAt === null, "y sin plazo: no hay cupo que liberar, la persona ya vino");

  // Las de hoy TAMBIÉN entran. Excluirlas hacía que quien acababa de cargar una
  // no la encontrara, y una lista donde no está lo que buscás deja de servir.
  const hoyMismo = (await atencionesSinCobrar(gc)).find((a) => a.publicId === sinCobrar.publicId);
  check(!!hoyMismo, "una atención impaga de hoy aparece en la lista");
  check(hoyMismo?.dias === 0, 'con antigüedad cero, que la pantalla muestra como "hoy"');

  // Se la corre a anteayer para comprobar el conteo de días.
  const anteayer = new Date(rangoDelDia(hoyLocal(gc.timezone), gc.timezone).desde.getTime() - 2 * 86_400_000);
  await prisma.turno.update({ where: { id: recienHecha.id }, data: { inicio: anteayer } });

  const deudas = await atencionesSinCobrar(gc);
  const mia = deudas.find((a) => a.publicId === sinCobrar.publicId);
  check(!!mia, `y sigue apareciendo con el correr de los días, entre ${deudas.length} sin cobrar`);
  check(mia?.dias === 2, `con su antigüedad (${mia?.dias} días)`);
  check(mia?.precio !== null, `y el importe que corresponde ($${mia?.precio?.toLocaleString("es-AR")})`);
  check(mia?.cargadaPor === operador.nombre, `y quién la cargó (${mia?.cargadaPor})`);
  check(
    deudas.every((a, i) => i === 0 || deudas[i - 1].dias >= a.dias),
    "la más vieja primero: es la que más urge"
  );

  // El proceso periódico NO la toca.
  const v = await vencerReservas();
  check(
    (await prisma.turno.findUniqueOrThrow({ where: { id: recienHecha.id } })).estado === "PENDIENTE_PAGO",
    `el proceso periódico no la vence (revisó ${v.revisados}): borrar una deuda por el paso del tiempo sería peor`
  );

  // Y se puede cobrar después, desde su ficha.
  check(
    (await cobrarEnMostrador(sinCobrar.publicId, gc.id, { monto: mia!.precio!, metodo: "Efectivo" }, quienOp)).ok,
    "se puede cobrar más tarde"
  );
  check(
    !(await atencionesSinCobrar(gc)).some((a) => a.publicId === sinCobrar.publicId),
    "y ahí sí sale de la lista"
  );

  // ── Aislamiento ─────────────────────────────────────────────
  console.log("\n── Aislamiento ──");
  const lh = await prisma.planta.findUniqueOrThrow({ where: { slug: "lasheras" } });
  const ajeno = await marcarRevisado(huerfano!.id, lh, "no corresponde", quien);
  check(!ajeno.ok, "un caso de Godoy Cruz no se resuelve desde Las Heras");
  check(
    (await pagosARevisar(lh.id)).every((p) => p.paymentId !== "tstrev-huerfano"),
    "ni aparece en su lista"
  );

  await limpiar();
  console.log(fallos === 0 ? "\n✅ Pagos a revisar verificados\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch(async (e) => { console.error(e); await limpiar().catch(() => {}); process.exit(1); })
  .finally(() => prisma.$disconnect());
