/**
 * La política de privacidad y el consentimiento.
 *
 * Lo que hay que probar no es que la página se vea: es que el consentimiento
 * sea demostrable. Guardar un booleano "aceptó" no prueba nada — hay que poder
 * exhibir QUÉ texto aceptó esa persona y CUÁNDO, aunque la política haya
 * cambiado tres veces desde entonces.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient } from "@prisma/client";
import { marcado } from "../lib/marcado";
import { reservar } from "../lib/reservar";
import { calcularDisponibilidad } from "../lib/disponibilidad";
import { renderToStaticMarkup } from "react-dom/server";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

// Formato de patente válido —tres letras y tres números— porque la reserva
// pública ahora valida el formato del lado del servidor. "TSTPRI" se rechazaba,
// que es justamente lo que esa validación tiene que hacer.
const MARCA = "TST900";

async function limpiar() {
  const ids = (await prisma.turno.findMany({ where: { dominio: MARCA }, select: { id: true } })).map((t) => t.id);
  if (ids.length) {
    await prisma.pago.deleteMany({ where: { turnoId: { in: ids } } });
    await prisma.turno.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.politicaPrivacidad.deleteMany({ where: { version: { startsWith: "tst-" } } });
}

async function main() {
  await limpiar();

  // ── El texto se convierte sin ejecutar nada ─────────────────
  console.log("\n── Conversión del texto ──");
  const html = renderToStaticMarkup(marcado(
    "### Un título\n\nUn párrafo con **negrita** y un [enlace](https://ejemplo.com).\n\n" +
    "- primer punto\n- segundo punto\n\n> una cita\n\n---\n\nfinal."
  ) as any);

  check(html.includes("<h4>Un título</h4>"), "los encabezados salen debajo del título de la página");
  check(html.includes("<strong>negrita</strong>"), "la negrita se convierte");
  check(html.includes('href="https://ejemplo.com"') && html.includes('target="_blank"'),
    "los enlaces externos abren en otra pestaña");
  check(html.includes("<li>primer punto</li>"), "las listas se convierten");
  check(html.includes("<blockquote>"), "las citas también");

  const peligroso = renderToStaticMarkup(marcado(
    'Texto <script>alert(1)</script> y un [enlace](javascript:alert(2)).'
  ) as any);
  check(
    !peligroso.includes("<script>") && peligroso.includes("&lt;script&gt;"),
    "una etiqueta script en el texto se muestra como texto, no se ejecuta"
  );
  check(
    !peligroso.includes("javascript:"),
    "y un enlace javascript: se descarta — una política no puede ejecutar código"
  );

  // ── Versiones ───────────────────────────────────────────────
  console.log("\n── Versiones ──");
  const vieja = await prisma.politicaPrivacidad.create({
    data: {
      version: "tst-vieja", texto: "### Vieja\n\nGuardamos tus datos tres años.",
      vigenteDesde: new Date(Date.now() - 10 * 86_400_000),
    },
  });
  const nueva = await prisma.politicaPrivacidad.create({
    data: {
      version: "tst-nueva", texto: "### Nueva\n\nGuardamos tus datos cinco años.",
      vigenteDesde: new Date(Date.now() - 1000),
    },
  });

  const vigente = await prisma.politicaPrivacidad.findFirst({ orderBy: { vigenteDesde: "desc" } });
  check(vigente?.id === nueva.id, "la vigente es la de fecha más reciente ya empezada");

  const futura = await prisma.politicaPrivacidad.create({
    data: {
      version: "tst-futura", texto: "### Futura\n\nTodavía no rige.",
      vigenteDesde: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  const vigenteAhora = await prisma.politicaPrivacidad.findFirst({
    where: { vigenteDesde: { lte: new Date() } }, orderBy: { vigenteDesde: "desc" },
  });
  check(
    vigenteAhora?.id === nueva.id,
    "una política con fecha futura no rige todavía, aunque esté cargada"
  );
  await prisma.politicaPrivacidad.delete({ where: { id: futura.id } });

  // ── El turno queda atado a la versión que aceptó ────────────
  console.log("\n── Lo que aceptó cada persona ──");
  const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
  const cupo = (await calcularDisponibilidad(prisma, { plantaSlug: "maipu", tipoVehiculoId: auto.id }))[0].cupos[0];
  await prisma.planta.update({ where: { slug: "maipu" }, data: { requierePago: false } });

  const r = await reservar({
    slug: "maipu", tipoVehiculoId: auto.id, lineaId: cupo.lineaId,
    inicioIso: cupo.inicio.toISOString(), duracionMin: cupo.duracionMin,
    nombre: "Ana Prueba", dominio: MARCA, anio: "2015",
    email: "ana@ejemplo.com", telefono: "2615550000", combustible: "NAFTA",
    acepta: true,
  }, "200.1.2.3");
  await prisma.planta.update({ where: { slug: "maipu" }, data: { requierePago: true } });
  check(r.ok, "se reserva aceptando la política");
  if (!r.ok) return;

  const turno = await prisma.turno.findUniqueOrThrow({
    where: { publicId: r.publicId }, include: { politica: true },
  });
  check(turno.politicaId === nueva.id, `queda atado a "${turno.politica?.version}", la vigente al reservar`);
  check(!!turno.consentimientoAt, "con la fecha en que lo aceptó");
  check(turno.consentimientoIp === "200.1.2.3", "y desde qué IP");

  // Cambia la política DESPUÉS de que reservó.
  const posterior = await prisma.politicaPrivacidad.create({
    data: {
      version: "tst-posterior", texto: "### Posterior\n\nAhora los guardamos diez años.",
      vigenteDesde: new Date(),
    },
  });
  const ahoraVigente = await prisma.politicaPrivacidad.findFirst({ orderBy: { vigenteDesde: "desc" } });
  check(ahoraVigente?.id === posterior.id, "se publica una versión nueva");

  const sinTocar = await prisma.turno.findUniqueOrThrow({
    where: { id: turno.id }, include: { politica: true },
  });
  check(
    sinTocar.politicaId === nueva.id,
    `el turno de Ana sigue apuntando a "${sinTocar.politica?.version}": no se le cambia lo que aceptó`
  );
  check(
    sinTocar.politica?.texto.includes("cinco años") ?? false,
    "y ese texto se puede exhibir tal como era, no como quedó después"
  );

  // ── Los turnos migrados no tienen consentimiento ────────────
  console.log("\n── El histórico migrado ──");
  const migrados = await prisma.turno.count({ where: { legacyId: { not: null } } });
  const conConsentimiento = await prisma.turno.count({
    where: { legacyId: { not: null }, consentimientoAt: { not: null } },
  });
  check(
    conConsentimiento === 0,
    `ninguno de los ${migrados.toLocaleString("es-AR")} turnos migrados tiene consentimiento: no se inventa hacia atrás`
  );

  await limpiar();
  await prisma.politicaPrivacidad.deleteMany({ where: { version: { startsWith: "tst-" } } });
  console.log(fallos === 0 ? "\n✅ Privacidad verificada\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch(async (e) => {
    console.error(e);
    await prisma.planta.update({ where: { slug: "maipu" }, data: { requierePago: true } }).catch(() => {});
    await limpiar().catch(() => {});
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
