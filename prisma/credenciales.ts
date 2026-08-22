/**
 * Carga las credenciales de MercadoPago de una planta, cifradas.
 *
 *   npx tsx prisma/credenciales.ts godoycruz
 *
 * Pide los valores por teclado para que no queden en el historial del shell
 * ni en el archivo. En la base se guardan cifrados con AES-256-GCM.
 */
import { PrismaClient } from "@prisma/client";
import { cifrar, descifrar } from "../lib/cripto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Uso: npx tsx prisma/credenciales.ts <slug>");
    process.exit(1);
  }

  const planta = await prisma.planta.findUniqueOrThrow({ where: { slug } });
  const rl = createInterface({ input: stdin, output: stdout });

  console.log(`\nCredenciales de MercadoPago para ${planta.nombre}`);
  console.log("Se guardan cifradas. Dejá en blanco para conservar lo que ya esté.\n");
  console.log("Para probar usá las credenciales de PRUEBA de MercadoPago");
  console.log("(el access token empieza con TEST-). Las productivas empiezan con APP_USR-.\n");

  const accessToken = (await rl.question("Access token: ")).trim();
  const publicKey = (await rl.question("Public key: ")).trim();
  const webhookSecret = (await rl.question("Clave secreta del webhook (opcional): ")).trim();
  rl.close();

  const existente = await prisma.mpCredencial.findUnique({ where: { plantaId: planta.id } });

  if (!accessToken && !existente) {
    console.error("\nHace falta al menos el access token la primera vez.");
    process.exit(1);
  }

  const datos = {
    accessTokenCifrado: accessToken ? cifrar(accessToken) : existente!.accessTokenCifrado,
    publicKey: publicKey || existente?.publicKey || "",
    webhookSecretCifrado: webhookSecret
      ? cifrar(webhookSecret)
      : existente?.webhookSecretCifrado ?? "",
  };

  await prisma.mpCredencial.upsert({
    where: { plantaId: planta.id },
    update: datos,
    create: { plantaId: planta.id, ...datos },
  });

  // Comprobación de ida y vuelta: si la clave de cifrado estuviera mal,
  // conviene enterarse ahora y no cuando alguien intente pagar.
  const guardado = await prisma.mpCredencial.findUniqueOrThrow({ where: { plantaId: planta.id } });
  const recuperado = descifrar(guardado.accessTokenCifrado);
  const tipo = recuperado.startsWith("TEST-") ? "PRUEBA" : recuperado.startsWith("APP_USR-") ? "PRODUCCIÓN" : "desconocido";

  console.log(`\n✓ Guardadas y verificadas · token de ${tipo} · ${recuperado.slice(0, 12)}…`);
  if (tipo === "PRODUCCIÓN") {
    console.log("  ⚠ Es un token productivo: los pagos van a ser reales.");
  }
  console.log();
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
