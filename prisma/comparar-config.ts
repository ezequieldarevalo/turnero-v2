/**
 * Compara la configuración que hay HOY en la base contra la que produciría el
 * seed, y lista diferencia por diferencia.
 *
 *   npm run config:comparar
 *
 * Para qué sirve: la base local se usó para probar, y se editó configuración a
 * mano desde la consola. Los datos se re-migran desde cero en el cutover, pero
 * la configuración no viaja sola: sale de `configPlantas.ts`. Todo lo que se
 * haya tocado a mano quedó fuera de ese archivo y se perdería sin avisar.
 *
 * Este script no arregla nada ni escribe. Solo dice en qué difieren, para que
 * la decisión —era juego, o era una corrección real que hay que subir al
 * seed— la tome una persona.
 *
 * Alcance: solo lo que el seed es dueño de escribir —planta, oferta de tipos,
 * precios, líneas y horarios—. Turnos, pagos, ocupación, feriados y bloqueos
 * son territorio de `migrar.ts`, que en el cutover los rehace desde el dump
 * fresco: ahí no hay nada que conservar.
 *
 * Ojo con lo que NO puede ver: si producción cambió un precio y acá nadie lo
 * tocó, la base local y el seed coinciden y este script no dice nada. Contra
 * producción hay que comparar aparte, con la base viva.
 */
import { PrismaClient } from "@prisma/client";
import {
  CATEGORIAS,
  TIPOS,
  LINEAS,
  OFERTA,
  INICIO_PRECIOS,
  PLANTAS,
  datosPlanta,
  horariosDe,
} from "./configPlantas";

const prisma = new PrismaClient();

/**
 * Campos de `plantas` que el seed NO define: quedan en el default del esquema.
 * Si alguno está distinto, lo cambió una persona desde la consola y el seed no
 * lo sabe. Es la mitad de la deriva que más fácil pasa desapercibida.
 */
const DEFAULTS_DEL_ESQUEMA: Record<string, unknown> = {
  dominio: null,
  timezone: "America/Argentina/Mendoza",
  activa: true,
  minutosExpiracionConfirmacion: 1440,
  horasMinimasCancelacion: 0,
  horasMinimasReprogramacion: 0,
  turnosActivosPorPatente: null,
  requiereRadicacionLocal: false,
  camposRequeridos: ["nombre", "dominio", "anio", "email", "telefono", "combustible"],
  tiposCombustible: ["NAFTA", "DIESEL", "GAS"],
  avisoTemporal: null,
};

let diferencias = 0;

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const mostrar = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
  return s.length > 90 ? s.slice(0, 87) + "…" : s;
};

function dif(campo: string, base: unknown, esperado: unknown, nota = "") {
  diferencias++;
  console.log(`  ✗ ${campo}${nota ? ` (${nota})` : ""}`);
  console.log(`      base : ${mostrar(base)}`);
  console.log(`      seed : ${mostrar(esperado)}`);
}

function aviso(texto: string) {
  diferencias++;
  console.log(`  ✗ ${texto}`);
}

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

async function main() {
  console.log("\nConfiguración en la base vs. la del seed\n" + "═".repeat(48));

  // ── Catálogo global ────────────────────────────────────────
  console.log("\nCatálogo global");
  const categoriasBase = await prisma.categoriaVehiculo.findMany();
  const tiposBase = await prisma.tipoVehiculo.findMany({ include: { categoria: true } });

  for (const c of CATEGORIAS) {
    const enBase = categoriasBase.find((x) => x.codigo === c.codigo);
    if (!enBase) aviso(`falta la categoría "${c.codigo}"`);
    else if (enBase.nombre !== c.nombre) dif(`categoría ${c.codigo}.nombre`, enBase.nombre, c.nombre);
  }
  for (const c of categoriasBase) {
    if (!CATEGORIAS.some((x) => x.codigo === c.codigo)) {
      aviso(`categoría "${c.codigo}" (${c.nombre}) está en la base y no en el seed`);
    }
  }
  for (const t of TIPOS) {
    const enBase = tiposBase.find((x) => x.nombre === t.nombre);
    if (!enBase) aviso(`falta el tipo de vehículo "${t.nombre}"`);
    else if (enBase.categoria.codigo !== t.categoria) {
      dif(`tipo "${t.nombre}".categoría`, enBase.categoria.codigo, t.categoria);
    }
  }
  for (const t of tiposBase) {
    if (!TIPOS.some((x) => x.nombre === t.nombre)) {
      aviso(`tipo de vehículo "${t.nombre}" está en la base y no en el seed`);
    }
  }
  if (diferencias === 0) console.log("  ✓ sin diferencias");

  // ── Plantas del seed ───────────────────────────────────────
  for (const p of PLANTAS) {
    console.log(`\n${p.slug}\n${"─".repeat(48)}`);
    const antes = diferencias;

    const planta = await prisma.planta.findUnique({
      where: { slug: p.slug },
      include: {
        tiposVehiculo: { include: { tipo: true } },
        precios: { include: { tipo: true }, orderBy: { vigenteDesde: "asc" } },
        lineas: { include: { categoria: true } },
        horarios: true,
        feriados: { orderBy: { fecha: "asc" } },
        excepciones: true,
      },
    });

    if (!planta) {
      aviso("la planta no existe en la base");
      continue;
    }

    // Campos que el seed sí define
    const esperados = datosPlanta(p) as Record<string, unknown>;
    const fila = planta as unknown as Record<string, unknown>;
    for (const [campo, valor] of Object.entries(esperados)) {
      if (!igual(fila[campo], valor)) dif(campo, fila[campo], valor);
    }

    // Campos que el seed no define: cualquier cambio salió de la consola
    for (const [campo, valor] of Object.entries(DEFAULTS_DEL_ESQUEMA)) {
      if (!igual(fila[campo], valor)) {
        dif(campo, fila[campo], valor, "el seed no lo define: quedaría en el default");
      }
    }

    // ── Oferta de tipos de vehículo ──────────────────────────
    for (const [i, { nombre }] of OFERTA.entries()) {
      const oferta = planta.tiposVehiculo.find((o) => o.tipo.nombre === nombre);
      if (!oferta) {
        aviso(`no ofrece "${nombre}"`);
        continue;
      }
      const displayEsperado = (p.display as Record<string, string>)[nombre] ?? null;
      if (oferta.orden !== i) dif(`oferta "${nombre}".orden`, oferta.orden, i);
      if (!igual(oferta.nombreDisplay, displayEsperado)) {
        dif(`oferta "${nombre}".nombreDisplay`, oferta.nombreDisplay, displayEsperado);
      }
      if (!oferta.activo) dif(`oferta "${nombre}".activo`, false, true);
    }
    for (const o of planta.tiposVehiculo) {
      if (!OFERTA.some((x) => x.nombre === o.tipo.nombre)) {
        aviso(`ofrece "${o.tipo.nombre}", que el seed no da de alta`);
      }
    }

    // ── Precios ──────────────────────────────────────────────
    for (const { nombre, precio } of OFERTA) {
      const inicial = planta.precios.find(
        (v) => v.tipo.nombre === nombre && v.vigenteDesde.getTime() === INICIO_PRECIOS.getTime()
      );
      if (!inicial) aviso(`falta el precio inicial de "${nombre}"`);
      else if (inicial.precio !== precio) {
        dif(`precio inicial "${nombre}"`, inicial.precio, precio);
      }
    }
    // Vigencias que el seed no crea: son altas hechas desde la consola. No son
    // un error —el precio cambia por resolución— pero el seed no las tiene, así
    // que en una base nueva no existirían.
    const extra = planta.precios.filter(
      (v) => v.vigenteDesde.getTime() !== INICIO_PRECIOS.getTime()
    );
    for (const v of extra) {
      aviso(
        `vigencia de precio agregada a mano: "${v.tipo.nombre}" $${v.precio} ` +
          `desde ${v.vigenteDesde.toISOString().slice(0, 10)}`
      );
    }

    // ── Líneas ───────────────────────────────────────────────
    for (const l of LINEAS) {
      const enBase = planta.lineas.find(
        (x) => x.categoria.codigo === l.categoria && x.numero === l.numero
      );
      if (!enBase) aviso(`falta la línea ${l.categoria}${l.numero}`);
      else if (!enBase.activa) dif(`línea ${l.categoria}${l.numero}.activa`, false, true);
    }
    for (const l of planta.lineas) {
      if (!LINEAS.some((x) => x.categoria === l.categoria.codigo && x.numero === l.numero)) {
        aviso(`línea ${l.categoria.codigo}${l.numero} está en la base y no en el seed`);
      }
    }

    // ── Horarios ─────────────────────────────────────────────
    // El seed borra y rehace: son exactamente seis filas, sin línea ni mes.
    const clave = (h: {
      diaSemana: number;
      desde: number;
      hasta: number;
      slotsPorHora: number;
      lineaId?: number | null;
      mes?: number | null;
    }) => `${h.diaSemana}|${h.desde}|${h.hasta}|${h.slotsPorHora}|${h.lineaId ?? ""}|${h.mes ?? ""}`;

    const enBase = new Map(planta.horarios.map((h) => [clave(h), h]));
    const esperadosH = new Map(horariosDe(p).map((h) => [clave(h), h]));

    for (const [k, h] of esperadosH) {
      if (!enBase.has(k)) {
        aviso(
          `falta el horario de ${DIAS[h.diaSemana]} ${hhmm(h.desde)}–${hhmm(h.hasta)} ` +
            `(${h.slotsPorHora}/hora)`
        );
      }
    }
    for (const [k, h] of enBase) {
      if (!esperadosH.has(k)) {
        aviso(
          `horario que el seed no crea: ${DIAS[h.diaSemana]} ${hhmm(h.desde)}–${hhmm(h.hasta)} ` +
            `(${h.slotsPorHora}/hora${h.lineaId ? `, línea ${h.lineaId}` : ""}` +
            `${h.mes ? `, mes ${h.mes}` : ""})`
        );
      }
    }

    // ── Calendario: territorio de la migración, no del seed ──
    // `migrar.ts` crea los feriados y los bloqueos desde el sistema viejo, y en
    // el cutover los rehace desde el dump fresco. No son deriva. Van como dato,
    // no como diferencia — con una salvedad: un feriado cargado a mano desde la
    // consola es indistinguible de uno migrado, porque la tabla no guarda de
    // dónde vino. Si hiciera falta distinguirlos, la columna hay que agregarla.
    const futuros = planta.feriados.filter((f) => f.fecha >= new Date());
    console.log(
      `  · calendario: ${planta.feriados.length} feriados ` +
        `(${futuros.length} a futuro), ${planta.excepciones.length} bloqueos de cupo` +
        ` — los rehace la migración`
    );

    if (diferencias === antes) console.log("  ✓ sin diferencias");
  }

  // ── Plantas que el seed no conoce ──────────────────────────
  const todas = await prisma.planta.findMany({ select: { slug: true, nombre: true } });
  const ajenas = todas.filter((x) => !PLANTAS.some((p) => p.slug === x.slug));
  if (ajenas.length) {
    console.log(`\nPlantas fuera del seed\n${"─".repeat(48)}`);
    for (const x of ajenas) aviso(`"${x.slug}" (${x.nombre}) — el seed no la crea`);
  }

  // ── Cierre ─────────────────────────────────────────────────
  console.log("\n" + "═".repeat(48));
  if (diferencias === 0) {
    console.log("La base coincide con el seed.\n");
  } else {
    console.log(`${diferencias} diferencia(s).\n`);
    console.log("Cada una es una de dos cosas:");
    console.log("  · juego — se pierde sola cuando se rehaga la base, no hay nada que hacer;");
    console.log("  · una corrección real — hay que subirla a prisma/configPlantas.ts,");
    console.log("    o no va a existir en producción.\n");
    console.log("Esto compara contra el SEED, no contra producción: si producción");
    console.log("cambió algo que acá nadie tocó, no aparece en esta lista.\n");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
