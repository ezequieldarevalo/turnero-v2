/**
 * Qué ajustes puede tocar cada rol.
 *
 * Lo que se prueba no es "el dueño no puede" sino las dos cosas que hacen que
 * el permiso sirva: que el servidor rechace el cambio aunque el formulario no
 * lo haya ofrecido, y —sobre todo— que guardar la configuración **no apague en
 * silencio** un ajuste que el dueño no vio.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient } from "@prisma/client";
import { CAMPOS, guardarGenerales, editable, topeDe, type Campo } from "../lib/configuracion";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

const SLUG = "maipu";

async function main() {
  const original = await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } });
  const dueno = await prisma.usuario.findUniqueOrThrow({ where: { email: "dueno@revitotal.test" } });
  const sup = await prisma.usuario.findUniqueOrThrow({ where: { email: "ezequiel.d.arevalo@gmail.com" } });
  const comoDueno = { usuarioId: dueno.id, ip: "10.0.0.4" };
  const comoSuper = { usuarioId: sup.id, ip: "10.0.0.1" };

  try {
    // ── El reparto ────────────────────────────────────────────
    console.log("\n── El reparto ──");
    const bloqueados = (Object.keys(CAMPOS) as Campo[]).filter((c) => !editable(c, false));
    const libres = (Object.keys(CAMPOS) as Campo[]).filter((c) => editable(c, false));
    console.log(`  solo superadmin (${bloqueados.length}): ${bloqueados.join(", ")}`);
    console.log(`  el dueño maneja ${libres.length} ajustes`);

    check(bloqueados.includes("requierePago"), "apagar el cobro es solo del superadmin");
    check(bloqueados.includes("filtraLineaPorVehiculo"), "y el filtro de líneas por vehículo también");
    check(
      bloqueados.includes("pagoEfectivoMinutos") && bloqueados.includes("minutosMinimosEfectivo"),
      "los tiempos del efectivo, igual"
    );
    check(
      editable("pagoEfectivoHabilitado", false),
      "pero SI acepta efectivo lo decide la planta: es comercial, no técnico"
    );
    check(
      libres.length > bloqueados.length * 3,
      "la mayoría de los ajustes siguen siendo del dueño — el objetivo no es trabarlo"
    );
    for (const c of ["permiteCancelar", "permiteReprogramar", "avisoTarifa", "colorPrimario", "registraRealizacion"] as Campo[]) {
      check(editable(c, false), `${c}: del dueño`);
    }
    check(bloqueados.every((c) => editable(c, true)), "el superadmin puede todos");

    // ── El servidor no confía en la pantalla ──────────────────
    console.log("\n── Un campo bloqueado, mandado a mano ──");
    const intento = await guardarGenerales(
      original, { campos: { requierePago: "false" } }, comoDueno, false
    );
    check(
      !intento.ok && intento.motivo === "SIN_PERMISO",
      `el servidor lo rechaza aunque el formulario no lo haya ofrecido: "${!intento.ok ? intento.detalle : ""}"`
    );
    check(
      (await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } })).requierePago === true,
      "y la planta sigue cobrando"
    );

    const permitido = await guardarGenerales(
      original, { campos: { requierePago: "false" } }, comoSuper, true
    );
    check(permitido.ok, "el superadmin sí lo puede cambiar");
    await guardarGenerales(original, { campos: { requierePago: "on" } }, comoSuper, true);

    // ── El fallo silencioso que esto evita ────────────────────
    console.log("\n── Guardar como dueño no apaga nada ──");
    // Una casilla deshabilitada NO viaja en el formulario, y la ausencia de una
    // casilla se interpreta como "false". Si la acción recorriera todos los
    // campos, cada vez que un dueño guardara su color se apagaría el cobro.
    const soloLosSuyos: Partial<Record<Campo, string | null>> = {};
    for (const c of Object.keys(CAMPOS) as Campo[]) {
      if (!editable(c, false)) continue;
      const v = (original as Record<string, unknown>)[c];
      soloLosSuyos[c] = typeof v === "boolean" ? (v ? "on" : "false") : v === null ? null : String(v);
    }
    soloLosSuyos.colorPrimario = "#123456";

    const guardado = await guardarGenerales(original, { campos: soloLosSuyos }, comoDueno, false);
    check(guardado.ok, "el dueño guarda un cambio suyo");

    const tras = await prisma.planta.findUniqueOrThrow({ where: { slug: SLUG } });
    check(tras.colorPrimario === "#123456", "el color cambió");
    check(tras.requierePago === true, "y el cobro NO se apagó de paso");
    check(
      tras.filtraLineaPorVehiculo === original.filtraLineaPorVehiculo &&
        tras.pagoEfectivoMinutos === original.pagoEfectivoMinutos &&
        tras.minutosMinimosEfectivo === original.minutosMinimosEfectivo,
      "ni se movió ningún otro ajuste bloqueado"
    );

    // ── Topes distintos por rol ───────────────────────────────
    console.log("\n── Ventana de reserva: tope según el rol ──");
    check(topeDe("diasVentanaReserva", false) === 180, "el dueño llega hasta 180 días");
    check(topeDe("diasVentanaReserva", true) === 730, "el superadmin hasta 730");

    const pasado = await guardarGenerales(
      original, { campos: { diasVentanaReserva: "400" } }, comoDueno, false
    );
    check(
      !pasado.ok && pasado.motivo === "VALOR_INVALIDO",
      `400 días se rechaza para el dueño: "${!pasado.ok ? pasado.detalle : ""}"`
    );
    check(
      !pasado.ok && (pasado.detalle ?? "").includes("administra el servicio"),
      "y el mensaje dice a quién pedírselo, en vez de solo negarse"
    );

    const desdeSuper = await guardarGenerales(
      original, { campos: { diasVentanaReserva: "400" } }, comoSuper, true
    );
    check(desdeSuper.ok, "el superadmin sí lo puede subir a 400");
  } finally {
    await prisma.planta.update({
      where: { id: original.id },
      data: {
        requierePago: original.requierePago,
        colorPrimario: original.colorPrimario,
        diasVentanaReserva: original.diasVentanaReserva,
        filtraLineaPorVehiculo: original.filtraLineaPorVehiculo,
      },
    });
  }

  console.log(fallos === 0 ? "\n✅ Permisos de configuración verificados\n" : `\n❌ ${fallos} fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
