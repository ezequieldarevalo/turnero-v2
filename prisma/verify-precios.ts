/**
 * Precios con fecha de vigencia.
 *
 * Lo central: un aumento anotado para el mes que viene no puede cambiarle el
 * importe a nadie hasta que llegue esa fecha, y un turno reservado antes del
 * aumento se paga al precio que vio la persona en pantalla, no al de hoy.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, EstadoTurno } from "@prisma/client";
import {
  preciosVigentes, precioVigente, historial, programarPrecio, cancelarProgramado,
} from "../lib/precios";
import { tiposDePlanta } from "../lib/atencion";
import { calcularDisponibilidad } from "../lib/disponibilidad";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const SLUG = "godoycruz";
const MARCA = "TSTPRE";
const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

async function limpiar(plantaId: number, tipoId: number) {
  await prisma.precioVigencia.deleteMany({
    where: { plantaId, tipoVehiculoId: tipoId, vigenteDesde: { gt: new Date("2020-06-01") } },
  });
  const ids = (await prisma.turno.findMany({ where: { dominio: { startsWith: MARCA } }, select: { id: true } }))
    .map((t) => t.id);
  if (ids.length) {
    await prisma.pago.deleteMany({ where: { turnoId: { in: ids } } });
    await prisma.turno.deleteMany({ where: { id: { in: ids } } });
  }
}

async function main() {
  const gc = await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } });
  const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email: "dueno@revitotal.test" } });
  const quien = { usuarioId: usuario.id, ip: "10.0.0.2" };

  await limpiar(gc.id, auto.id);

  try {
    const base = (await precioVigente(gc.id, auto.id))!;
    console.log(`\n── Precio de partida: ${pesos(base)} ──`);

    // ── Validaciones ──────────────────────────────────────────
    console.log("\n── Validaciones ──");
    const negativo = await programarPrecio(gc.id, auto.id, -100, null, quien);
    check(!negativo.ok && negativo.motivo === "PRECIO_INVALIDO", "un precio negativo se rechaza");

    const ayer = new Date(Date.now() - 86_400_000);
    const atras = await programarPrecio(gc.id, auto.id, 70000, ayer, quien);
    check(
      !atras.ok && atras.motivo === "FECHA_INVALIDA",
      "no se puede poner un precio con fecha pasada: reescribiría lo ya cobrado"
    );

    const igual = await programarPrecio(gc.id, auto.id, base, null, quien);
    check(!igual.ok && igual.motivo === "YA_VIGENTE", "poner el mismo precio que ya rige no crea una fila al pedo");

    // ── Programado a futuro ───────────────────────────────────
    console.log("\n── Un aumento para dentro de 30 días ──");
    const enUnMes = new Date(Date.now() + 30 * 86_400_000);
    const nuevo = Math.round(base * 1.25);
    const prog = await programarPrecio(gc.id, auto.id, nuevo, enUnMes, quien);
    check(prog.ok, `se anota ${pesos(nuevo)} para el ${enUnMes.toISOString().slice(0, 10)}`);

    check(
      (await precioVigente(gc.id, auto.id)) === base,
      `hoy sigue rigiendo ${pesos(base)}: anotarlo no lo aplica`
    );
    check(
      (await precioVigente(gc.id, auto.id, new Date(Date.now() + 31 * 86_400_000))) === nuevo,
      `pasada la fecha rige ${pesos(nuevo)}, sin que nadie tenga que entrar a cambiarlo`
    );
    check(
      (await precioVigente(gc.id, auto.id, new Date(enUnMes.getTime() - 1000))) === base,
      "un segundo antes, todavía el viejo"
    );

    // Lo que ve el público y el mostrador es el vigente, no el programado.
    const tipos = await tiposDePlanta(gc.id);
    check(
      tipos.find((t) => t.id === auto.id)?.precio === base,
      "el selector del sitio y el del mostrador muestran el vigente"
    );

    // ── Historial ─────────────────────────────────────────────
    console.log("\n── Historial ──");
    const h = await historial(gc.id, auto.id);
    check(h[0].estado === "programado" && h[0].precio === nuevo, "el programado aparece como tal");
    check(h[1].estado === "vigente" && h[1].precio === base, "y debajo el que rige hoy");
    check(h[0].puestoPor === usuario.nombre, `con quién lo puso (${h[0].puestoPor})`);

    // ── El precio de un turno es el de cuando se reservó ───────
    console.log("\n── El turno conserva su precio ──");
    const cupo = (await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id }))[0].cupos[0];
    const turno = await prisma.turno.create({
      data: {
        plantaId: gc.id, lineaId: cupo.lineaId, tipoVehiculoId: auto.id,
        inicio: cupo.inicio, duracionMin: cupo.duracionMin, estado: EstadoTurno.PENDIENTE_PAGO,
        dominio: `${MARCA}01`, titularNombre: "PRUEBA", titularEmail: "p@t.com",
      },
    });
    check(
      (await precioVigente(gc.id, auto.id, turno.creadoAt)) === base,
      `reservado hoy, su precio es ${pesos(base)}`
    );

    // Ahora el aumento entra en vigencia de verdad. Se lo ancla un instante
    // DESPUÉS de la creación del turno: si se usara "hace un segundo" a secas,
    // el turno —creado hace milisegundos— caería del lado nuevo y la prueba
    // mediría el reloj en vez de la regla.
    await prisma.precioVigencia.updateMany({
      where: { plantaId: gc.id, tipoVehiculoId: auto.id, precio: nuevo },
      data: { vigenteDesde: new Date(turno.creadoAt.getTime() + 1) },
    });
    check(
      (await precioVigente(gc.id, auto.id)) === nuevo,
      `pasado el aumento, el precio de lista es ${pesos(nuevo)}`
    );
    check(
      (await precioVigente(gc.id, auto.id, turno.creadoAt)) === base,
      `pero ese turno se sigue cobrando ${pesos(base)}: es lo que la persona vio en pantalla`
    );

    // ── Cancelar un programado ────────────────────────────────
    console.log("\n── Cancelar un cambio ──");
    const otro = new Date(Date.now() + 60 * 86_400_000);
    await programarPrecio(gc.id, auto.id, nuevo + 5000, otro, quien);
    const pend = (await historial(gc.id, auto.id)).find((v) => v.estado === "programado")!;
    check(!!pend, "queda otro programado");

    const anulado = await cancelarProgramado(gc.id, pend.id, quien);
    check(anulado.ok, "un cambio que todavía no rigió se puede cancelar");
    check(
      !(await historial(gc.id, auto.id)).some((v) => v.id === pend.id),
      "y desaparece de la lista"
    );

    const vigenteAhora = (await historial(gc.id, auto.id)).find((v) => v.estado === "vigente")!;
    const borrarHistoria = await cancelarProgramado(gc.id, vigenteAhora.id, quien);
    check(
      !borrarHistoria.ok && borrarHistoria.motivo === "YA_VIGENTE",
      "pero uno que ya rigió no: es contra lo que se concilia lo cobrado"
    );

    // ── Varios tipos de una sola consulta ─────────────────────
    console.log("\n── Todos los precios de la planta ──");
    const mapa = await preciosVigentes(gc.id);
    const ofrecidos = await prisma.plantaTipoVehiculo.count({ where: { plantaId: gc.id, activo: true } });
    check(mapa.size >= ofrecidos, `${mapa.size} precios vigentes para ${ofrecidos} tipos ofrecidos`);
    check(mapa.get(auto.id) === nuevo, "y el del auto es el nuevo");

    // Aislamiento entre plantas.
    const lh = await prisma.planta.findUniqueOrThrow({ where: { slug: "lasheras" } });
    const enLh = await precioVigente(lh.id, auto.id);
    check(enLh !== nuevo, `el aumento de Godoy Cruz no tocó a Las Heras (${pesos(enLh ?? 0)})`);
  } finally {
    await limpiar(gc.id, auto.id);
  }

  console.log(fallos === 0 ? "\n✅ Precios verificados\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
