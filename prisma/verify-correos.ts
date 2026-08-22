/**
 * Los seis correos, renderizados contra turnos reales de las tres plantas.
 *
 * Por qué existe: el aviso al cliente vive en la server action —`after(() =>
 * notificarReprogramacion(...))`— y las server actions no las toca ninguna otra
 * verificación. Nada probaba que las plantillas sobrevivieran a un turno de
 * verdad.
 *
 * Lo que más importa acá no es que el HTML sea lindo: es que no se escape un
 * `undefined`, un `NaN` o un `[object Object]` al cuerpo del correo. Un campo
 * nulo que llega a la plantilla no rompe nada —el correo sale igual— y termina
 * en la casilla de un cliente diciendo "Tu turno: undefined".
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient } from "@prisma/client";
import { datosDeCorreo } from "../lib/notificar";
import {
  turnoReservado, turnoConfirmado, turnoCancelado,
  turnoReprogramado, turnoVencido, turnoPorConfirmar,
} from "../lib/plantillas";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

/** Lo que nunca puede aparecer en un correo que sale a un cliente. */
const BASURA = ["undefined", "NaN", "[object Object]", "null,", ">null<"];

function revisar(nombre: string, correo: { asunto: string; html: string }, d: { codigo: string; dominio: string; titularNombre: string; plantaNombre: string }) {
  const { asunto, html } = correo;

  check(asunto.length > 0 && asunto.includes(d.plantaNombre), `${nombre}: el asunto nombra la planta`);
  check(html.startsWith("<!doctype html>"), `${nombre}: es un documento HTML completo`);

  const sucio = BASURA.filter((b) => html.includes(b));
  check(sucio.length === 0, `${nombre}: sin valores rotos en el cuerpo${sucio.length ? ` — apareció ${sucio.join(", ")}` : ""}`);

  const faltan = [d.codigo, d.dominio, d.titularNombre].filter((v) => !html.includes(v));
  check(faltan.length === 0, `${nombre}: trae código, dominio y titular${faltan.length ? ` — falta ${faltan.join(", ")}` : ""}`);
}

async function main() {
  console.log("\nCorreos del turno\n" + "─".repeat(50));

  for (const slug of ["lasheras", "maipu", "godoycruz"]) {
    const planta = await prisma.planta.findUnique({ where: { slug } });
    if (!planta) { check(false, `${slug}: la planta no existe`); continue; }

    // Un turno real de esta planta, no uno fabricado: interesa que las
    // plantillas aguanten los datos migrados, con sus huecos incluidos.
    const turno = await prisma.turno.findFirst({
      where: { plantaId: planta.id },
      orderBy: { inicio: "desc" },
    });
    if (!turno) { check(false, `${slug}: no hay turnos para probar`); continue; }

    const d = await datosDeCorreo(turno.publicId);
    if (!d) { check(false, `${slug}: no se pudieron armar los datos del correo`); continue; }

    console.log(`\n── ${planta.nombre} · turno ${d.codigo} ──`);

    revisar("reservado", turnoReservado(d), d);
    revisar("confirmado", turnoConfirmado(d), d);
    revisar("cancelado", turnoCancelado(d), d);
    revisar("reprogramado", turnoReprogramado(d), d);
    revisar("vencido", turnoVencido({ ...d, sinConfirmar: false }), d);
    revisar("vencido sin confirmar", turnoVencido({ ...d, sinConfirmar: true }), d);
    revisar(
      "por confirmar",
      turnoPorConfirmar({ ...d, urlConfirmar: `${d.urlTurno}/confirmar`, horasParaConfirmar: 24 }),
      d
    );

    // El correo de reprogramación es el que dispara el mostrador: tiene que
    // llevar la fecha nueva, que es todo el contenido del aviso.
    const reprog = turnoReprogramado(d);
    check(reprog.html.includes(d.cuando), "reprogramado: incluye la fecha nueva del turno");

    // Quien no puede reprogramar solo tiene que ver el WhatsApp en su lugar.
    // Si faltara, el correo lo deja sin ninguna salida.
    if (!planta.permiteReprogramar && planta.whatsappContacto) {
      check(
        turnoConfirmado(d).html.includes(planta.whatsappContacto),
        "confirmado: al que no puede reprogramar solo se le da el WhatsApp"
      );
    }

    // Los dos motivos de vencimiento tienen que decir cosas distintas: un turno
    // telefónico que nadie aceptó no venció "por falta de pago".
    const porPago = turnoVencido({ ...d, sinConfirmar: false });
    const porConfirmar = turnoVencido({ ...d, sinConfirmar: true });
    check(porPago.asunto !== porConfirmar.asunto, "vencido: distingue falta de pago de falta de confirmación");
  }

  console.log(fallos === 0 ? "\n✅ Correos verificados\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
