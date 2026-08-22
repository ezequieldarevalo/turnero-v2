/**
 * Validación de lo que entra por los formularios.
 *
 * Lo que se prueba es lo que el sistema viejo NO hacía: rechazar del lado del
 * servidor. Sus reglas buenas —formato de patente, de año, de teléfono— vivían
 * en el navegador, y en el servidor solo había `required|string|max:N`. Toda
 * validación que solo corre en el cliente es decorativa.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, EstadoTurno } from "@prisma/client";
import {
  LARGOS, validarNombre, validarEmail, validarTelefono, validarAnio,
  validarDominio, validarCombustible, recortar,
} from "../lib/validaciones";
import { reservar } from "../lib/reservar";
import { registrarAtencion } from "../lib/atencion";
import { crearTurnoTelefonico } from "../lib/turnoTelefonico";
import { cobrarEnMostrador } from "../lib/turnoAdmin";
import { calcularDisponibilidad } from "../lib/disponibilidad";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const MARCA = "TSTVAL";

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

  // ── Las reglas sueltas ──────────────────────────────────────
  console.log("\n── Nombre ──");
  check(!!validarNombre("Jo"), "menos de tres letras se rechaza");
  check(!validarNombre("Ana Gómez"), "un nombre normal pasa");
  check(!validarNombre("MARÍA PEÑA"), "con acentos y ñ también — el viejo usaba [a-zA-Z] y los rechazaba");
  check(!validarNombre("O'Brien-Sosa"), "y con apóstrofo y guion");
  check(!!validarNombre("Ana <script>"), "con signos raros, no");
  check(!!validarNombre("x".repeat(LARGOS.nombre + 1)), `más de ${LARGOS.nombre} caracteres, tampoco`);

  console.log("\n── Correo ──");
  check(!validarEmail("ana@ejemplo.com.ar"), "un correo normal pasa");
  check(!!validarEmail("ana@ejemplo"), "sin dominio de primer nivel se rechaza");
  check(!!validarEmail("ana ejemplo.com"), "sin arroba tampoco");
  check(!!validarEmail(`${"x".repeat(200)}@ejemplo.com`), "y uno larguísimo, tampoco");

  console.log("\n── Teléfono ──");
  check(!validarTelefono("2615551234"), "diez dígitos pasan");
  check(!validarTelefono("(261) 555-1234"), "con paréntesis y guiones también: se cuentan los dígitos");
  check(!!validarTelefono("2615"), "cuatro dígitos se rechaza");
  check(!!validarTelefono("12345678901234567890"), "veinte, tampoco");

  console.log("\n── Año ──");
  const anioQueViene = new Date().getFullYear() + 1;
  check(!validarAnio("2015"), "un año normal pasa");
  check(!validarAnio(String(anioQueViene)), `el que viene también (${anioQueViene}): los 0km se patentan por adelantado`);
  check(!!validarAnio(String(anioQueViene + 1)), "el siguiente, no");
  check(!!validarAnio("1899"), "1899 tampoco");
  check(!!validarAnio("15"), "y dos dígitos no alcanzan");

  console.log("\n── Patente ──");
  check(!validarDominio("AB123CD", { categoria: "L", estricto: true }), "AB123CD es un auto válido");
  check(!validarDominio("ABC123", { categoria: "L", estricto: true }), "ABC123 también");
  check(!!validarDominio("A123BCD", { categoria: "L", estricto: true }), "pero una de moto no pasa como auto");
  check(!validarDominio("A123BCD", { categoria: "M", estricto: true }), "y sí pasa como moto");
  check(!!validarDominio("AB12", { categoria: "L", estricto: true }), "una demasiado corta se rechaza siempre");
  check(
    !validarDominio("QQ0000ZZ"),
    "sin `estricto` una patente fuera de formato pasa: en el mostrador hay extranjeras y viejas"
  );
  check(
    !!validarDominio("x".repeat(LARGOS.dominio + 1)),
    "pero el largo se controla igual"
  );

  console.log("\n── Recorte ──");
  check(recortar("  hola  ", "nombre") === "hola", "se limpian los espacios de los bordes");
  check(recortar("x".repeat(500), "observaciones").length === LARGOS.observaciones,
    `un texto largo se recorta a ${LARGOS.observaciones}, no se rechaza: es un campo opcional`);

  // ── Contra el camino real ───────────────────────────────────
  const gc = await prisma.planta.findUniqueOrThrow({ where: { slug: "godoycruz" } });
  const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
  const moto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "MOTO HASTA 300 CC" } });
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email: "operador@godoycruz.test" } });
  const quien = { usuarioId: usuario.id, ip: null };

  const cupo = (await calcularDisponibilidad(prisma, { plantaSlug: "godoycruz", tipoVehiculoId: auto.id }))[0].cupos[0];
  const base = {
    slug: "godoycruz", tipoVehiculoId: auto.id, lineaId: cupo.lineaId,
    inicioIso: cupo.inicio.toISOString(), duracionMin: cupo.duracionMin,
    nombre: "Ana Gómez", dominio: "AB123CD", anio: "2015",
    email: "ana@ejemplo.com", telefono: "2615551234", combustible: "NAFTA",
    acepta: true,
  };

  console.log("\n── Reserva pública: el servidor revalida ──");
  // Cada uno de estos pasa el formulario del navegador si alguien lo saltea.
  const casos: [string, Record<string, unknown>][] = [
    ["un nombre de 10.000 caracteres", { nombre: "x".repeat(10_000) }],
    ["una patente que no existe", { dominio: "NOESUNAPATENTE" }],
    ["una patente de moto para un auto", { dominio: "A123BCD" }],
    ["el año 3000", { anio: "3000" }],
    ["un teléfono de dos dígitos", { telefono: "12" }],
    ["un combustible inventado", { combustible: "PLUTONIO" }],
    ["un correo sin arroba", { email: "no-es-un-correo" }],
  ];
  for (const [texto, encima] of casos) {
    const r = await reservar({ ...base, ...encima, dominio: `${encima.dominio ?? base.dominio}` } as any, null);
    const rechazado = !r.ok && r.motivo === "DATOS_INVALIDOS";
    check(rechazado, `${texto}: ${rechazado ? `rechazado — "${(r as any).detalle}"` : "SE ACEPTÓ"}`);
  }

  const buena = await reservar({ ...base, dominio: `${MARCA}1` }, "1.2.3.4");
  check(!buena.ok, "y una patente que no encaja en el formato tampoco entra por la web");

  // La de moto sí, contra el tipo correcto.
  const cupoMoto = (await calcularDisponibilidad(prisma, { plantaSlug: "godoycruz", tipoVehiculoId: moto.id }))[0].cupos[0];
  const conMoto = await reservar({
    ...base, tipoVehiculoId: moto.id, lineaId: cupoMoto.lineaId,
    inicioIso: cupoMoto.inicio.toISOString(), duracionMin: cupoMoto.duracionMin,
    dominio: "A123BCD",
  }, "1.2.3.4");
  check(conMoto.ok, "una patente de moto con un tipo de moto sí entra");
  if (conMoto.ok) {
    await prisma.turno.deleteMany({ where: { publicId: conMoto.publicId } });
  }

  console.log("\n── Mostrador: permisivo con la patente, estricto con el resto ──");
  const rara = await registrarAtencion(gc.id, {
    dominio: `${MARCA}RARA`, tipoVehiculoId: auto.id, titularNombre: "Juan Extranjero",
  }, quien);
  check(rara.ok, "una patente fuera de formato se acepta: el operador tiene el vehículo delante");

  const malCorreo = await registrarAtencion(gc.id, {
    dominio: `${MARCA}2`, tipoVehiculoId: auto.id, titularNombre: "Juan Perez",
    titularEmail: "no-es-un-correo",
  }, quien);
  check(
    !malCorreo.ok && malCorreo.motivo === "DATOS_INVALIDOS",
    "pero un correo mal escrito no: sería un comprobante que no llega"
  );

  const largo = await registrarAtencion(gc.id, {
    dominio: `${MARCA}3`, tipoVehiculoId: auto.id, titularNombre: "x".repeat(500),
  }, quien);
  check(!largo.ok, "y un nombre de 500 caracteres tampoco");

  console.log("\n── Turno por teléfono ──");
  const cupoTel = (await calcularDisponibilidad(prisma, { plantaSlug: "godoycruz", tipoVehiculoId: auto.id }))[1].cupos[0];
  const sinCorreo = await crearTurnoTelefonico(gc.id, {
    lineaId: cupoTel.lineaId, inicioIso: cupoTel.inicio.toISOString(), duracionMin: cupoTel.duracionMin,
    tipoVehiculoId: auto.id, dominio: `${MARCA}4`, titularNombre: "Ana Gómez",
    titularEmail: "ana@ejemplo",
  }, quien);
  check(
    !sinCorreo.ok && sinCorreo.motivo === "DATOS_INVALIDOS",
    "un correo inválido se rechaza: es por donde se pide la confirmación"
  );

  console.log("\n── Cobro en mostrador ──");
  const conAtencion = await registrarAtencion(gc.id, {
    dominio: `${MARCA}5`, tipoVehiculoId: auto.id, titularNombre: "Para Cobrar",
  }, quien);
  if (conAtencion.ok) {
    const cero = await cobrarEnMostrador(conAtencion.publicId, gc.id, { monto: 0, metodo: "Efectivo" }, quien);
    check(!cero.ok && cero.motivo === "MONTO_INVALIDO", "cobrar cero se rechaza");
    const enorme = await cobrarEnMostrador(conAtencion.publicId, gc.id, { monto: 999_999_999, metodo: "Efectivo" }, quien);
    check(
      !enorme.ok && enorme.motivo === "MONTO_INVALIDO",
      "y un monto absurdo también: un cero de más descuadra la caja sin que nada lo frene"
    );
    const decimal = await cobrarEnMostrador(conAtencion.publicId, gc.id, { monto: 100.5, metodo: "Efectivo" }, quien);
    check(!decimal.ok, "los montos van en pesos enteros");
  }

  // ── Nada se guardó de los intentos rechazados ───────────────
  console.log("\n── Los rechazos no dejan basura ──");
  const quedaron = await prisma.turno.count({ where: { dominio: { startsWith: MARCA } } });
  check(
    quedaron === 2,
    `solo quedaron los ${quedaron} que se aceptaron a propósito, ninguno de los rechazados`
  );

  await limpiar();
  console.log(fallos === 0 ? "\n✅ Validaciones verificadas\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch(async (e) => { console.error(e); await limpiar().catch(() => {}); process.exit(1); })
  .finally(() => prisma.$disconnect());
