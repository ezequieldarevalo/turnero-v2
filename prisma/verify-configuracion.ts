/**
 * Configuración de la planta.
 *
 * Lo que se prueba es que la pantalla no pueda dejar la planta en un estado
 * incoherente: horarios que se pisan, un tipo de vehículo activo sin línea que
 * lo atienda, un día cerrado con gente ya citada. Y que cada cambio quede
 * atribuido, porque tocar un precio o un horario mueve plata.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, EstadoTurno } from "@prisma/client";
import {
  guardarGenerales, agregarHorario, borrarHorario, guardarTipo,
  minutosDeHhmm, hhmmDeMinutos,
} from "../lib/configuracion";
import { cerrar, reabrir, diasCerrados } from "../lib/cierres";
import { calcularDisponibilidad } from "../lib/disponibilidad";
import { fechaLocal, sumarDias, hoyLocal } from "../lib/fechas";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const SLUG = "godoycruz";
const MARCA = "TSTCFG";

async function limpiar() {
  const p = await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } });
  await prisma.horario.deleteMany({ where: { plantaId: p.id, diaSemana: 0 } }); // domingo: no existe en el seed
  await prisma.feriado.deleteMany({ where: { plantaId: p.id, descripcion: { startsWith: MARCA } } });
  const ids = (await prisma.turno.findMany({ where: { dominio: { startsWith: MARCA } }, select: { id: true } }))
    .map((t) => t.id);
  if (ids.length) {
    await prisma.pago.deleteMany({ where: { turnoId: { in: ids } } });
    await prisma.turno.deleteMany({ where: { id: { in: ids } } });
  }
}

async function main() {
  await limpiar();

  const original = await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } });
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email: "ezequiel.d.arevalo@gmail.com" } });
  const quien = { usuarioId: usuario.id, ip: "10.0.0.1" };

  try {
    // ── Horas ─────────────────────────────────────────────────
    console.log("\n── Conversión de horas ──");
    check(minutosDeHhmm("08:00") === 480, '"08:00" son 480 minutos');
    check(minutosDeHhmm("15:50") === 950, '"15:50" son 950');
    check(hhmmDeMinutos(950) === "15:50", "y vuelve igual");
    check(minutosDeHhmm("25:00") === null, '"25:00" se rechaza');
    check(minutosDeHhmm("ocho") === null, "un texto cualquiera también");

    // ── Parámetros generales ──────────────────────────────────
    console.log("\n── Parámetros generales ──");
    const fuera = await guardarGenerales(original, {
      campos: { diasVentanaReserva: "9999" },
    }, quien);
    check(
      !fuera.ok && fuera.motivo === "VALOR_INVALIDO",
      `un valor fuera de rango se rechaza con un mensaje legible: "${!fuera.ok ? fuera.detalle : ""}"`
    );

    const vacio = await guardarGenerales(original, { campos: { nombre: "  " } }, quien);
    check(!vacio.ok, "un campo obligatorio no puede quedar vacío");

    const colorMalo = await guardarGenerales(original, { campos: { colorPrimario: "rojo" } }, quien);
    check(!colorMalo.ok, "un color que no es hexadecimal tampoco");

    const ok = await guardarGenerales(original, {
      campos: { diasVentanaReserva: "90", horasMinimasCancelacion: "24" },
    }, quien);
    check(ok.ok, "un cambio válido se guarda");

    const tras = await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } });
    check(tras.diasVentanaReserva === 90, "queda en 90 días de ventana");
    check(tras.horasMinimasCancelacion === 24, "y 24 horas mínimas para cancelar");

    const log = await prisma.auditLog.findFirst({
      where: { entidad: "planta", entidadId: original.id, accion: "config.editada" },
      orderBy: { id: "desc" },
    });
    check(!!log && log.usuarioId === usuario.id, "el cambio queda auditado con quién lo hizo");
    check(
      (log?.datosAntes as any)?.diasVentanaReserva === original.diasVentanaReserva,
      `y con el valor anterior (${original.diasVentanaReserva})`
    );

    // Efecto real sobre la disponibilidad.
    const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
    const dias = await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id });
    check(dias.length <= 90, `la ventana se aplica al vuelo: ${dias.length} días ofrecidos, ninguno más allá de 90`);

    // Columnas de la agenda.
    const sinColumnas = await guardarGenerales(tras, { campos: {}, columnasAgenda: [] }, quien);
    check(!sinColumnas.ok, "la agenda no puede quedarse sin ninguna columna");

    const desordenadas = await guardarGenerales(tras, {
      campos: {}, columnasAgenda: ["pago", "hora", "dominio", "inventada"],
    }, quien);
    check(desordenadas.ok, "se aceptan las columnas conocidas");
    const conCols = await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } });
    check(
      JSON.stringify(conCols.columnasAgenda) === JSON.stringify(["hora", "dominio", "pago"]),
      "guardadas en el orden canónico y sin la inventada"
    );

    // ── Horarios ──────────────────────────────────────────────
    console.log("\n── Horarios ──");
    const invertida = await agregarHorario(tras, {
      diaSemana: 0, desde: "15:00", hasta: "08:00", slotsPorHora: 4, lineaId: null, mes: null,
    }, quien);
    check(!invertida.ok, "una banda que cierra antes de abrir se rechaza");

    const nueva = await agregarHorario(tras, {
      diaSemana: 0, desde: "09:00", hasta: "13:00", slotsPorHora: 4, lineaId: null, mes: null,
    }, quien);
    check(nueva.ok, "se puede abrir el domingo de 09:00 a 13:00");

    const pisada = await agregarHorario(tras, {
      diaSemana: 0, desde: "12:00", hasta: "14:00", slotsPorHora: 4, lineaId: null, mes: null,
    }, quien);
    check(
      !pisada.ok && pisada.motivo === "SOLAPAMIENTO",
      `una banda que se pisa con esa se rechaza con un mensaje entendible: "${!pisada.ok ? pisada.detalle : ""}"`
    );

    const pegada = await agregarHorario(tras, {
      diaSemana: 0, desde: "13:00", hasta: "15:00", slotsPorHora: 4, lineaId: null, mes: null,
    }, quien);
    check(pegada.ok, "una que arranca justo donde termina la otra sí entra: el cierre es exclusivo");

    // El domingo pasa a tener cupos, sin tocar nada más.
    const conDomingo = await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id });
    const hayDomingo = conDomingo.some((d) => new Date(`${d.fecha}T12:00:00Z`).getUTCDay() === 0);
    check(hayDomingo, "y el domingo empieza a ofrecer turnos de inmediato, sin regenerar nada");

    const domingos = await prisma.horario.findMany({ where: { plantaId: tras.id, diaSemana: 0 } });
    for (const h of domingos) await borrarHorario(tras, h.id, quien);
    const sinDomingo = await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id });
    check(
      !sinDomingo.some((d) => new Date(`${d.fecha}T12:00:00Z`).getUTCDay() === 0),
      "y al borrarlas vuelve a estar cerrado"
    );

    const ajeno = await borrarHorario(tras, 999999, quien);
    check(!ajeno.ok && ajeno.motivo === "NO_EXISTE", "no se puede borrar un horario que no es de la planta");

    // ── Oferta de tipos ───────────────────────────────────────
    // El precio ya no vive acá: tiene fecha de vigencia propia y se verifica
    // en verify-precios.ts. Lo que queda es qué tipos se ofrecen y cómo.
    console.log("\n── Oferta de tipos de vehículo ──");
    const antesOferta = await prisma.plantaTipoVehiculo.findUniqueOrThrow({
      where: { plantaId_tipoVehiculoId: { plantaId: tras.id, tipoVehiculoId: auto.id } },
    });
    const renombrado = await guardarTipo(tras, auto.id, {
      nombreDisplay: "AUTO", activo: true, orden: antesOferta.orden,
    }, quien);
    check(renombrado.ok, "se puede cambiar el nombre con que se muestra un tipo");
    check(
      (await prisma.plantaTipoVehiculo.findUniqueOrThrow({
        where: { plantaId_tipoVehiculoId: { plantaId: tras.id, tipoVehiculoId: auto.id } },
      })).nombreDisplay === "AUTO",
      "y queda guardado"
    );

    // Un tipo cuya categoría no tiene línea en esta planta.
    const sinLineaAqui = await prisma.tipoVehiculo.findFirst({
      where: { categoria: { lineas: { none: { plantaId: tras.id, activa: true } } } },
      include: { categoria: true },
    });
    if (sinLineaAqui) {
      const r = await guardarTipo(tras, sinLineaAqui.id, {
        nombreDisplay: null, activo: true, orden: 9,
      }, quien);
      check(
        !r.ok && r.motivo === "SIN_LINEA",
        `activar ${sinLineaAqui.nombre} se rechaza: la planta no tiene línea de ${sinLineaAqui.categoria.nombre}`
      );
    }

    await guardarTipo(tras, auto.id, {
      nombreDisplay: antesOferta.nombreDisplay, activo: antesOferta.activo, orden: antesOferta.orden,
    }, quien);

    // ── Días cerrados ─────────────────────────────────────────
    console.log("\n── Días cerrados ──");
    const hoy = hoyLocal(tras.timezone);
    const libre = sumarDias(hoy, 45);

    const sinMotivo = await cerrar(tras, libre, "  ", quien);
    check(!sinMotivo.ok && sinMotivo.motivo === "SIN_MOTIVO", "cerrar un día sin escribir el motivo se rechaza");

    const puesto = await cerrar(tras, libre, `${MARCA} prueba`, quien);
    check(puesto.ok, `se cierra el ${libre}`);
    const listados = await diasCerrados(tras, libre, libre);
    check(
      listados.length === 1 && listados[0].origen === "feriado",
      "y aparece en la lista de días cerrados como una sola fila"
    );

    const trasFeriado = await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id });
    check(!trasFeriado.some((d) => d.fecha === libre), "ese día deja de ofrecer turnos");

    // Un día con gente ya citada no se puede cerrar.
    const conGente = trasFeriado.find((d) => d.cupos.length > 0)!;
    const cupo = conGente.cupos[0];
    await prisma.turno.create({
      data: {
        plantaId: tras.id, lineaId: cupo.lineaId, tipoVehiculoId: auto.id,
        inicio: cupo.inicio, duracionMin: cupo.duracionMin, estado: EstadoTurno.CONFIRMADO,
        dominio: `${MARCA}01`, titularNombre: "PRUEBA", titularEmail: "p@t.com",
      },
    });
    const ocupado = await cerrar(tras, conGente.fecha, `${MARCA} choque`, quien);
    check(
      !ocupado.ok && ocupado.motivo === "TIENE_TURNOS",
      `cerrar el ${conGente.fecha} se rechaza: tiene ${!ocupado.ok ? ocupado.detalle : ""} turno(s) citado(s)`
    );

    check((await reabrir(tras, libre, quien)).ok, "el día se puede volver a abrir");
    const reabierto = await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: auto.id });
    check(reabierto.some((d) => d.fecha === libre), "y el día vuelve a ofrecer turnos");
  } finally {
    // Se restaura la planta tal como estaba, campo por campo.
    await prisma.planta.update({
      where: { id: original.id },
      data: {
        diasVentanaReserva: original.diasVentanaReserva,
        horasMinimasCancelacion: original.horasMinimasCancelacion,
        columnasAgenda: original.columnasAgenda as never,
      },
    });
    await limpiar();
  }

  console.log(fallos === 0 ? "\n✅ Configuración verificada\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
