/**
 * La búsqueda del mostrador, contra los 63.037 turnos reales.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient } from "@prisma/client";
import { buscarTurnos, detectarCampo } from "../lib/buscar";
import { codigoCorto } from "../lib/codigo";
import { normalizarDominio } from "../lib/dominio";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

async function main() {
  const gc = await prisma.planta.findUniqueOrThrow({ where: { slug: "godoycruz" } });
  const lh = await prisma.planta.findUniqueOrThrow({ where: { slug: "lasheras" } });

  // ── Qué se entiende de lo que se tipea ──────────────────────
  console.log("\n── Reconocimiento de lo que se tipea ──");
  const casos: [string, string][] = [
    ["AB123CD", "dominio"],
    ["ab123cd", "dominio"],
    ["ABC123", "dominio"],
    ["ZZ-098-SG", "dominio"],
    ["4F2A9C10", "codigo"],
    ["4f2a9c10", "codigo"],
    ["juan@ejemplo.com", "email"],
    ["2615551234", "telefono"],
    ["261 555-1234", "telefono"],
    ["PEREZ", "nombre"],
    ["Juan Perez", "nombre"],
  ];
  for (const [texto, esperado] of casos) {
    const dio = detectarCampo(texto);
    check(dio === esperado, `"${texto}" → ${dio}${dio === esperado ? "" : ` (esperaba ${esperado})`}`);
  }

  // ── Por código ──────────────────────────────────────────────
  console.log("\n── Por número de turno ──");
  const alguno = await prisma.turno.findFirstOrThrow({
    where: { plantaId: gc.id },
    select: { publicId: true, dominio: true, titularNombre: true, titularEmail: true, titularTelefono: true },
  });
  const codigo = codigoCorto(alguno.publicId);

  const porCodigo = await buscarTurnos(gc, codigo);
  check(porCodigo.campo === "codigo", `"${codigo}" se busca como número de turno`);
  check(porCodigo.total === 1, "devuelve exactamente uno");
  check(porCodigo.resultados[0]?.publicId === alguno.publicId, "y es el que corresponde");

  const conEspacios = await buscarTurnos(gc, ` ${codigo.slice(0, 4)}-${codigo.slice(4)} `);
  check(
    conEspacios.resultados[0]?.publicId === alguno.publicId,
    "escrito con guiones y espacios encuentra lo mismo"
  );

  const minusculas = await buscarTurnos(gc, codigo.toLowerCase());
  check(minusculas.total === 1, "y en minúsculas también");

  // ── Por patente ─────────────────────────────────────────────
  console.log("\n── Por patente ──");
  const porDominio = await buscarTurnos(gc, alguno.dominio);
  check(porDominio.campo === "dominio" || porDominio.campo === "nombre", `"${alguno.dominio}" se busca por patente`);
  check(porDominio.total >= 1, `${porDominio.total} turno(s) de esa patente`);
  check(
    porDominio.resultados.every((r) => r.dominio.includes(alguno.dominio)),
    "todos los resultados son de esa patente"
  );

  // Una patente con muchas visitas: el historial completo del vehículo.
  const repetidas = await prisma.turno.groupBy({
    by: ["dominio"], where: { plantaId: gc.id }, _count: true,
    orderBy: { _count: { dominio: "desc" } }, take: 1,
  });
  const frecuente = repetidas[0];
  const historial = await buscarTurnos(gc, frecuente.dominio);
  check(
    historial.total === frecuente._count,
    `${frecuente.dominio}: aparecen sus ${historial.total} visitas, no solo la última`
  );
  const ordenado = historial.resultados.every(
    (r, i) => i === 0 || historial.resultados[i - 1].inicio >= r.inicio
  );
  check(ordenado, "de la más reciente a la más vieja");

  // ── Por nombre, correo y teléfono ───────────────────────────
  console.log("\n── Por nombre, correo y teléfono ──");
  const apellido = alguno.titularNombre.split(" ").pop()!;
  if (apellido.length >= 3) {
    const porNombre = await buscarTurnos(gc, apellido.toLowerCase());
    check(porNombre.total >= 1, `"${apellido.toLowerCase()}" en minúsculas encuentra ${porNombre.total}`);
    check(
      porNombre.resultados.every((r) => r.titularNombre.toUpperCase().includes(apellido.toUpperCase())),
      "sin importar mayúsculas: los nombres están guardados en mayúscula"
    );
  }

  const porCorreo = await buscarTurnos(gc, alguno.titularEmail);
  check(porCorreo.campo === "email" && porCorreo.total >= 1, `por correo: ${porCorreo.total} turno(s)`);

  if (alguno.titularTelefono && /^\d{6,}$/.test(alguno.titularTelefono)) {
    const porTel = await buscarTurnos(gc, alguno.titularTelefono);
    check(porTel.campo === "telefono" && porTel.total >= 1, `por teléfono: ${porTel.total} turno(s)`);
  }

  // ── Una sola forma de la patente ────────────────────────────
  console.log("\n── Patentes normalizadas ──");
  const sucias = await prisma.turno.count({
    where: { OR: [{ dominio: { contains: "-" } }, { dominio: { contains: " " } }, { dominio: { contains: "." } }] },
  });
  check(sucias === 0, `ninguna patente guardada con separadores (${sucias})`);
  const distintas = await prisma.turno.findMany({ select: { dominio: true }, distinct: ["dominio"] });
  check(
    distintas.every((d) => d.dominio === normalizarDominio(d.dominio)),
    `las ${distintas.length} patentes distintas están en su forma canónica`
  );

  // ── Patentes que no encajan en ningún formato ───────────────
  console.log("\n── Patentes fuera de formato ──");
  const rara = await prisma.turno.findFirst({
    where: { plantaId: gc.id, dominio: { not: { contains: " " } } },
    select: { dominio: true },
    orderBy: { id: "desc" },
  });
  // El caso real: una patente extranjera o cargada con un error no coincide con
  // ningún formato argentino y cae en la rama "nombre". Tiene que encontrarse
  // igual, o el mostrador ve una lista vacía sin saber por qué.
  const inventada = "QQ0000ZZ";
  const sinFormato = detectarCampo(inventada);
  check(sinFormato === "nombre", `"${inventada}" no encaja en ningún formato: se busca por nombre o patente`);
  if (rara) {
    const hallada = await buscarTurnos(gc, rara.dominio);
    check(hallada.total >= 1, `y una patente real (${rara.dominio}) se encuentra igual`);
  }

  // ── Aislamiento y bordes ────────────────────────────────────
  console.log("\n── Aislamiento y bordes ──");
  const cruzada = await buscarTurnos(lh, codigo);
  check(cruzada.total === 0, "un turno de Godoy Cruz no aparece buscando desde Las Heras");

  const corta = await buscarTurnos(gc, "ab");
  check(corta.resultados.length === 0, "con menos de 3 caracteres no se busca nada");

  const nada = await buscarTurnos(gc, "ZZZZZZZZZZ");
  check(nada.total === 0 && nada.resultados.length === 0, "una consulta sin resultados devuelve la lista vacía");

  const inyeccion = await buscarTurnos(gc, "%_' OR 1=1 --");
  check(inyeccion.total === 0, "los comodines de SQL viajan como texto, no como patrón");

  // ── Tope ────────────────────────────────────────────────────
  const comun = await prisma.turno.groupBy({
    by: ["titularNombre"], where: { plantaId: gc.id }, _count: true,
    orderBy: { _count: { titularNombre: "desc" } }, take: 1,
  });
  const muchos = await buscarTurnos(gc, comun[0].titularNombre.split(" ")[0]);
  check(
    muchos.resultados.length <= 50,
    `una consulta amplia se recorta a ${muchos.resultados.length} filas, informando el total (${muchos.total})`
  );

  console.log(fallos === 0 ? "\n✅ Búsqueda verificada\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
