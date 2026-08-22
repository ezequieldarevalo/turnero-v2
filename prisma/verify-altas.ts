/**
 * Alta de plantas, de usuarios y de líneas.
 *
 * Es el objetivo del proyecto puesto a prueba: dar de alta un cliente tiene que
 * ser un formulario, no clonar tres repositorios. Y lo que más importa acá no
 * es que se pueda crear, sino que **no se pueda dejar algo inoperable**: una
 * planta sin líneas, una planta sin dueño, un usuario sin plantas que igual
 * puede entrar.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient, Rol } from "@prisma/client";
import { crearPlanta, desactivarPlanta, faltantes, normalizarSlug } from "../lib/plantas";
import { darAcceso, cambiarRol, quitarAcceso, usuariosDe, reiniciarClave } from "../lib/gestionUsuarios";
import { agregarLinea, desactivarLinea, agregarHorario } from "../lib/configuracion";
import { calcularDisponibilidad } from "../lib/disponibilidad";
import { passwordValida, sesionDeToken, crearSesion } from "../lib/auth";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const SLUG = "tstplanta";
const CORREOS = ["tst-operador@prueba.local", "tst-dueno@prueba.local", "tst-otro@prueba.local"];

async function limpiar() {
  const p = await prisma.planta.findUnique({ where: { slug: SLUG } });
  if (p) {
    await prisma.auditLog.deleteMany({ where: { plantaId: p.id } });
    await prisma.usuarioPlanta.deleteMany({ where: { plantaId: p.id } });
    await prisma.precioVigencia.deleteMany({ where: { plantaId: p.id } });
    await prisma.horario.deleteMany({ where: { plantaId: p.id } });
    await prisma.linea.deleteMany({ where: { plantaId: p.id } });
    await prisma.planta.delete({ where: { id: p.id } });
  }
  await prisma.usuario.deleteMany({ where: { email: { in: CORREOS } } });
}

async function main() {
  await limpiar();

  const sup = await prisma.usuario.findUniqueOrThrow({ where: { email: "ezequiel.d.arevalo@gmail.com" } });
  const quien = { usuarioId: sup.id, ip: "10.0.0.1" };
  const categorias = await prisma.categoriaVehiculo.findMany({ orderBy: { id: "asc" } });

  const base = {
    slug: SLUG, nombre: "Planta de Prueba", direccion: "Calle Falsa 123",
    marcaValor: "PRUEBA", colorPrimario: "#112233", colorAdvertencia: "#d68227",
    emailRemitente: "turnos@prueba.local", emailNombre: "Prueba",
    timezone: "America/Argentina/Mendoza",
    lineas: [{ categoriaId: categorias[0].id, numero: "1" }],
  };

  try {
    // ── Validaciones del alta ─────────────────────────────────
    console.log("\n── Alta de una planta ──");
    check(
      normalizarSlug("Revitotal San Martín!") === "revitotalsanmartin",
      `el slug se normaliza para la URL: "Revitotal San Martín!" → "${normalizarSlug("Revitotal San Martín!")}"`
    );

    const reservado = await crearPlanta({ ...base, slug: "admin" }, quien);
    check(!reservado.ok && reservado.motivo === "SLUG_INVALIDO", '"admin" está reservado por el sistema');

    const sinLineas = await crearPlanta({ ...base, lineas: [] }, quien);
    check(
      !sinLineas.ok && sinLineas.motivo === "SIN_LINEAS",
      "sin líneas no se crea: sería entregar un cliente que no ofrece ningún turno"
    );

    const correoMalo = await crearPlanta({ ...base, emailRemitente: "no-es-correo" }, quien);
    check(!correoMalo.ok, "con un remitente inválido tampoco");

    const r = await crearPlanta(base, quien);
    check(r.ok, "se crea la planta");
    const planta = await prisma.planta.findUniqueOrThrow({
      where: { slug: SLUG }, include: { lineas: true },
    });
    check(planta.lineas.length === 1, "con su línea");
    check(planta.activa, "y activa");

    const repetida = await crearPlanta(base, quien);
    check(!repetida.ok && repetida.motivo === "SLUG_TOMADO", "dos plantas no pueden compartir la dirección web");

    // ── Qué le falta para vender ──────────────────────────────
    console.log("\n── Lo que le falta ──");
    const falta = await faltantes(planta.id, SLUG);
    const claves = falta.map((f) => f.clave);
    console.log(`  ${falta.map((f) => f.texto).join(" · ")}`);
    check(claves.includes("horarios"), "avisa que no tiene horarios");
    check(claves.includes("tipos"), "ni tipos de vehículo");
    check(claves.includes("mp") && claves.includes("smtp"), "ni credenciales de cobro y correo");
    check(!claves.includes("lineas"), "pero líneas sí tiene: se crearon con el alta");

    const vacia = await calcularDisponibilidad(prisma, {
      plantaSlug: SLUG, tipoVehiculoId: (await prisma.tipoVehiculo.findFirstOrThrow()).id,
    });
    check(vacia.length === 0, "y efectivamente no ofrece un solo turno todavía");

    // ── Se vuelve operativa ───────────────────────────────────
    console.log("\n── Se la pone a funcionar ──");
    for (const dia of [1, 2, 3, 4, 5]) {
      await agregarHorario(planta, {
        diaSemana: dia, desde: "09:00", hasta: "13:00", slotsPorHora: 4, lineaId: null, mes: null,
      }, quien);
    }
    const tipo = await prisma.tipoVehiculo.findFirstOrThrow({ where: { categoriaId: categorias[0].id } });
    await prisma.plantaTipoVehiculo.create({
      data: { plantaId: planta.id, tipoVehiculoId: tipo.id, activo: true, orden: 0 },
    });
    await prisma.precioVigencia.create({
      data: { plantaId: planta.id, tipoVehiculoId: tipo.id, precio: 50000, vigenteDesde: new Date() },
    });

    const conCupos = await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: tipo.id });
    check(conCupos.length > 0, `con horarios y precio ya ofrece turnos en ${conCupos.length} días`);
    const restante = (await faltantes(planta.id, SLUG)).map((f) => f.clave);
    check(
      !restante.includes("horarios") && !restante.includes("tipos") && !restante.includes("precios"),
      `y la lista de pendientes se reduce a: ${restante.join(", ")}`
    );

    // ── Líneas: capacidad, no etiquetas ───────────────────────
    console.log("\n── Líneas ──");
    const antes = conCupos.flatMap((d) => d.cupos).length;
    check((await agregarLinea(planta, { categoriaId: categorias[0].id, numero: "2" }, quien)).ok, "se agrega una segunda línea");
    const despues = (await calcularDisponibilidad(prisma, { plantaSlug: SLUG, tipoVehiculoId: tipo.id }))
      .flatMap((d) => d.cupos).length;
    check(despues === antes * 2, `los cupos se duplican (${antes} → ${despues}): una línea es capacidad`);

    const dup = await agregarLinea(planta, { categoriaId: categorias[0].id, numero: "2" }, quien);
    check(!dup.ok, "no se puede repetir el mismo número en la misma categoría");

    const lineas = await prisma.linea.findMany({ where: { plantaId: planta.id, activa: true } });
    check((await desactivarLinea(planta, lineas[1].id, quien)).ok, "una línea se da de baja");
    const sola = await prisma.linea.findMany({ where: { plantaId: planta.id, activa: true } });
    check(
      !(await desactivarLinea(planta, sola[0].id, quien)).ok,
      "pero la última no: la planta dejaría de ofrecer turnos"
    );
    check(
      (await prisma.linea.count({ where: { plantaId: planta.id } })) === 2,
      "las dadas de baja no se borran: sus turnos históricos cuelgan de ellas"
    );

    // ── Usuarios ──────────────────────────────────────────────
    console.log("\n── Usuarios ──");
    const alta = await darAcceso(planta.id, {
      email: CORREOS[1], nombre: "Dueño Prueba", rol: Rol.DUENO,
    }, quien);
    check(alta.ok && !!alta.clave, "al dar de alta a alguien nuevo se genera una contraseña");

    const nuevo = await prisma.usuario.findUniqueOrThrow({ where: { email: CORREOS[1] } });
    check(
      alta.ok && !!alta.clave && (await passwordValida(alta.clave, nuevo.passwordHash)),
      "y esa contraseña sirve para entrar"
    );
    check(!nuevo.passwordHash.includes(alta.ok ? alta.clave ?? "" : ""), "sin quedar guardada en claro");

    // Con nombre válido: si fuera corto se rechazaría antes por otro motivo y
    // la prueba pasaría por la razón equivocada.
    const repe = await darAcceso(planta.id, { email: CORREOS[1], nombre: "Dueño Prueba", rol: Rol.OPERADOR }, quien);
    check(!repe.ok && repe.motivo === "YA_TIENE_ACCESO", "dos veces a la misma planta, no");

    // La misma persona en dos plantas: una cuenta, una contraseña.
    const gc = await prisma.planta.findUniqueOrThrow({ where: { slug: "godoycruz" } });
    const enOtra = await darAcceso(gc.id, { email: CORREOS[1], nombre: "Dueño Prueba", rol: Rol.OPERADOR }, quien);
    check(enOtra.ok && !enOtra.clave, "en otra planta se reusa la cuenta, sin contraseña nueva");
    check(
      (await prisma.usuarioPlanta.count({ where: { usuarioId: nuevo.id } })) === 2,
      "la misma persona trabaja en dos plantas con un solo usuario"
    );
    await prisma.usuarioPlanta.delete({ where: { usuarioId_plantaId: { usuarioId: nuevo.id, plantaId: gc.id } } });

    const superYa = await darAcceso(planta.id, {
      email: "ezequiel.d.arevalo@gmail.com", nombre: "Ezequiel", rol: Rol.DUENO,
    }, quien);
    check(!superYa.ok && superYa.motivo === "ES_SUPERADMIN", "al superadmin no se le da acceso: ya ve todo");

    // ── No dejar la planta sin dueño ──────────────────────────
    console.log("\n── La planta no puede quedar sin dueño ──");
    const propio = { usuarioId: nuevo.id, ip: null };
    const bajarse = await cambiarRol(planta.id, nuevo.id, Rol.OPERADOR, quien);
    check(
      !bajarse.ok && bajarse.motivo === "ULTIMO_DUENO",
      "bajar al único dueño se rechaza: nadie podría configurarla ni dar de alta gente"
    );
    const sacarse = await quitarAcceso(planta.id, nuevo.id, quien);
    check(!sacarse.ok && sacarse.motivo === "ULTIMO_DUENO", "y sacarle el acceso, tampoco");

    const propioRol = await cambiarRol(planta.id, nuevo.id, Rol.OPERADOR, propio);
    check(!propioRol.ok && propioRol.motivo === "VOS_MISMO", "nadie se cambia el rol a sí mismo");

    await darAcceso(planta.id, { email: CORREOS[2], nombre: "Segundo Dueño", rol: Rol.DUENO }, quien);
    check((await cambiarRol(planta.id, nuevo.id, Rol.OPERADOR, quien)).ok, "con dos dueños, sí se puede bajar a uno");

    // ── Sacar el acceso echa de verdad ────────────────────────
    console.log("\n── Sacar el acceso ──");
    const conSesion = await prisma.usuario.findUniqueOrThrow({ where: { email: CORREOS[1] } });
    const { token } = await crearSesion(conSesion.id);
    check(!!(await sesionDeToken(token)), "el usuario tiene una sesión abierta");

    check((await quitarAcceso(planta.id, conSesion.id, quien)).ok, "se le saca el acceso");
    check(
      (await sesionDeToken(token)) === null,
      "y su sesión abierta deja de servir: no le queda ninguna planta"
    );
    check(
      !(await prisma.usuario.findUniqueOrThrow({ where: { id: conSesion.id } })).activo,
      "la cuenta queda desactivada — un usuario sin plantas que puede entrar es una cuenta viva sin dueño"
    );

    const otro = await prisma.usuario.findUniqueOrThrow({ where: { email: CORREOS[2] } });
    const reinicio = await reiniciarClave(planta.id, otro.id, quien);
    check(reinicio.ok && !!reinicio.clave, "se le puede generar una contraseña nueva");

    const lista = await usuariosDe(planta.id);
    check(lista.length === 1 && lista[0].email === CORREOS[2], "la lista muestra a quien queda");

    // ── Baja de la planta ─────────────────────────────────────
    console.log("\n── Baja de la planta ──");
    const conTurnos = await desactivarPlanta("godoycruz", quien);
    check(
      !conTurnos.ok && conTurnos.motivo === "TIENE_TURNOS",
      `una planta con ${conTurnos.ok ? "" : conTurnos.detalle} turnos futuros no se da de baja`
    );

    check((await desactivarPlanta(SLUG, quien)).ok, "una sin turnos futuros, sí");
    check(
      !(await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } })).activa,
      "queda inactiva, no borrada: sus turnos y pagos son historia contable"
    );
  } finally {
    await limpiar();
  }

  console.log(fallos === 0 ? "\n✅ Altas verificadas\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch(async (e) => { console.error(e); await limpiar().catch(() => {}); process.exit(1); })
  .finally(() => prisma.$disconnect());
