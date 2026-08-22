/**
 * Carga las credenciales de correo de una planta y prueba el envío.
 *
 *   npx tsx prisma/smtp.ts godoycruz
 *   npx tsx prisma/smtp.ts godoycruz --probar tu@correo.com
 *
 * La contraseña se pide por teclado y se guarda cifrada.
 */
import { PrismaClient } from "@prisma/client";
import { cifrar } from "../lib/cripto";
import { enviar } from "../lib/correo";
import { turnoReservado } from "../lib/plantillas";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Uso: npx tsx prisma/smtp.ts <slug> [--probar destino@correo.com]");
    process.exit(1);
  }

  const planta = await prisma.planta.findUniqueOrThrow({ where: { slug } });
  const iProbar = process.argv.indexOf("--probar");
  const destino = iProbar > -1 ? process.argv[iProbar + 1] : null;

  // ── Modo prueba: usa lo que ya esté cargado ──
  if (destino) {
    console.log(`\nEnviando un correo de prueba a ${destino}…`);
    const { asunto, html } = turnoReservado({
      plantaNombre: planta.nombre,
      plantaDireccion: planta.direccion,
      colorPrimario: planta.colorPrimario,
      tipoVehiculo: "AUTO PARTICULAR",
      dominio: "ABC123",
      titularNombre: "Prueba",
      cuando: "Viernes, 21 de agosto 12:45 hs",
      codigo: "PRUEBA01",
      urlTurno: `${process.env.PUBLIC_BASE_URL}/${slug}/turno/prueba`,
      urlPago: "https://www.mercadopago.com.ar/checkout/ejemplo",
      precio: 58600,
      horasParaPagar: Math.round(planta.minutosExpiracionPago / 60),
      avisoTarifa: planta.avisoTarifa,
    });
    await enviar(planta.id, slug, { para: destino, asunto, html });
    console.log("  ✓ enviado. Revisá la bandeja, y también el spam.\n");
    return;
  }

  // ── Carga ──
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`\nCredenciales de correo para ${planta.nombre}`);
  console.log(`Remitente configurado: ${planta.emailRemitente}`);
  console.log("La contraseña se guarda cifrada. Dejá en blanco para conservar la actual.\n");

  const host = (await rl.question("Servidor SMTP (ej. smtp.hostinger.com): ")).trim();
  const puerto = (await rl.question("Puerto [587]: ")).trim() || "587";
  const usuario = (await rl.question(`Usuario [${planta.emailRemitente}]: `)).trim() || planta.emailRemitente;
  const password = (await rl.question("Contraseña: ")).trim();
  rl.close();

  const existente = await prisma.credencialSmtp.findUnique({ where: { plantaId: planta.id } });
  if (!password && !existente) {
    console.error("\nHace falta la contraseña la primera vez.");
    process.exit(1);
  }

  await prisma.credencialSmtp.upsert({
    where: { plantaId: planta.id },
    update: {
      host: host || existente!.host,
      puerto: Number(puerto),
      usuario,
      seguro: Number(puerto) === 465,
      ...(password ? { passwordCifrada: cifrar(password) } : {}),
    },
    create: {
      plantaId: planta.id,
      host,
      puerto: Number(puerto),
      usuario,
      seguro: Number(puerto) === 465,
      passwordCifrada: cifrar(password),
    },
  });

  console.log(`\n✓ Guardadas. Probá el envío con:`);
  console.log(`    npx tsx prisma/smtp.ts ${slug} --probar tu@correo.com\n`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
