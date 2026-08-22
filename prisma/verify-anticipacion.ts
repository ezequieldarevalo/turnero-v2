/**
 * Los dos mínimos de anticipación.
 *
 * El sistema viejo tenía un solo número, en días, y por eso estaba mal para los
 * dos casos: un día es demasiado para quien paga con tarjeta —tira a la basura
 * los cupos libres de esta misma tarde— y demasiado poco para quien va a pagar
 * un cupón en efectivo, que tarda en acreditarse.
 */
process.env.CORREO_DESACTIVADO = "1";

import { PrismaClient } from "@prisma/client";
import { calcularDisponibilidad } from "../lib/disponibilidad";
import { tiposExcluidosPara } from "../lib/pagos";
import { fechaLocal, hoyLocal } from "../lib/fechas";

const prisma = new PrismaClient();
let fallos = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) fallos++;
};

async function main() {
  const auto = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { nombre: "AUTO PARTICULAR" } });
  const lh = await prisma.planta.findUniqueOrThrow({ where: { slug: "lasheras" } });   // acepta efectivo
  const gc = await prisma.planta.findUniqueOrThrow({ where: { slug: "godoycruz" } });  // no lo acepta

  const original = { min: lh.minutosMinimosAnticipacion, efectivo: lh.minutosMinimosEfectivo };

  try {
    // ── El corte es un instante, no un día ────────────────────
    console.log("\n── El mínimo general ──");
    // Se simula estar parado un día hábil a las 08:05. Tiene que ser un día que
    // la planta abra: hoy puede caer domingo, y ahí no hay nada que ofrecer.
    const proximos = await calcularDisponibilidad(prisma, {
      plantaSlug: "lasheras", tipoVehiculoId: auto.id,
    });
    const diaHabil = proximos.find((d) => d.cupos.length > 20)!.fecha;
    const manana = new Date(`${diaHabil}T11:05:00.000Z`); // 08:05 en Mendoza

    await prisma.planta.update({
      where: { id: lh.id }, data: { minutosMinimosAnticipacion: 120 },
    });
    const conDosHoras = await calcularDisponibilidad(prisma, {
      plantaSlug: "lasheras", tipoVehiculoId: auto.id, hoy: manana,
    });
    const mismoDia = conDosHoras.find((d) => d.fecha === diaHabil);

    if (mismoDia) {
      const limite = new Date(manana.getTime() + 120 * 60_000);
      check(
        mismoDia.cupos.every((c) => c.inicio >= limite),
        `parado el ${diaHabil} a las 08:05 con 2 h de mínimo: ${mismoDia.cupos.length} cupos ese mismo día, ninguno antes de las ${
          new Intl.DateTimeFormat("es-AR", { timeZone: lh.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(limite)
        }`
      );
    } else {
      check(false, `el ${diaHabil} tendría que ofrecer cupos`);
    }

    await prisma.planta.update({
      where: { id: lh.id }, data: { minutosMinimosAnticipacion: 1440 },
    });
    const conUnDia = await calcularDisponibilidad(prisma, {
      plantaSlug: "lasheras", tipoVehiculoId: auto.id, hoy: manana,
    });
    const mismoDiaAntes = conUnDia.find((d) => d.fecha === diaHabil);
    check(
      !mismoDiaAntes,
      "con el viejo mínimo de 1 día, ese mismo día no ofrecía ni un cupo — eso es lo que se perdía"
    );

    const ganados = (mismoDia?.cupos.length ?? 0);
    check(ganados > 0, `${ganados} cupos por día que antes no se podían vender`);

    await prisma.planta.update({
      where: { id: lh.id }, data: { minutosMinimosAnticipacion: original.min },
    });

    // ── El efectivo tiene su propio mínimo ────────────────────
    console.log("\n── El mínimo del efectivo ──");
    const en1h = new Date(Date.now() + 60 * 60_000);
    const en3h = new Date(Date.now() + 3 * 60 * 60_000);
    const en4dias = new Date(Date.now() + 4 * 86_400_000);

    check(
      tiposExcluidosPara(lh, en1h).includes("ticket"),
      "para un turno dentro de 1 hora, Las Heras no ofrece efectivo"
    );
    check(
      tiposExcluidosPara(lh, en3h).includes("ticket"),
      "ni dentro de 3 horas: el cupón no llegaría a acreditarse"
    );
    check(
      tiposExcluidosPara(lh, en4dias).length === 0,
      `dentro de 4 días sí, porque supera los ${lh.minutosMinimosEfectivo} minutos configurados`
    );

    check(
      tiposExcluidosPara(gc, en4dias).includes("ticket"),
      "Godoy Cruz no ofrece efectivo nunca: lo tiene apagado"
    );

    // El turno se puede sacar igual: lo que desaparece es el medio de pago.
    const cercanos = await calcularDisponibilidad(prisma, {
      plantaSlug: "lasheras", tipoVehiculoId: auto.id,
    });
    const primero = cercanos[0]?.cupos[0];
    check(!!primero, "el cupo más cercano se sigue ofreciendo");
    if (primero) {
      const faltan = Math.round((primero.inicio.getTime() - Date.now()) / 60_000);
      const excluye = tiposExcluidosPara(lh, primero.inicio).includes("ticket");
      check(
        faltan < lh.minutosMinimosEfectivo ? excluye : !excluye,
        `faltan ${faltan} min para ese cupo: el efectivo ${excluye ? "no se ofrece" : "sí se ofrece"}, y el turno se saca igual`
      );
    }

    // ── Coherencia entre los dos ──────────────────────────────
    console.log("\n── Coherencia ──");
    check(
      lh.minutosMinimosEfectivo >= lh.minutosMinimosAnticipacion,
      `el mínimo de efectivo (${lh.minutosMinimosEfectivo}) es mayor que el general (${lh.minutosMinimosAnticipacion})`
    );
    check(
      lh.minutosMinimosEfectivo >= lh.pagoEfectivoMinutos,
      `y cubre la vida del cupón (${lh.pagoEfectivoMinutos} min)`
    );
  } finally {
    await prisma.planta.update({
      where: { id: lh.id },
      data: { minutosMinimosAnticipacion: original.min, minutosMinimosEfectivo: original.efectivo },
    });
  }

  console.log(fallos === 0 ? "\n✅ Anticipación verificada\n" : `\n❌ ${fallos} verificaciones fallaron\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
