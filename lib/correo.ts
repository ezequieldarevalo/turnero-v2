/**
 * Envío de correo, por planta.
 *
 * Dos reglas que vienen de lo que salió mal en el sistema viejo:
 *
 *  1. **Nunca se envía dentro de un webhook.** MercadoPago corta a los ~22
 *     segundos; si el SMTP tarda, la notificación se da por fallida y se
 *     reintenta. Es la explicación más probable de los grupos con 28 copias
 *     del mismo cobro. Acá se manda con `after()`, ya devuelta la respuesta.
 *  2. **El link de pago es el `init_point` real.** En el sistema viejo el
 *     correo decía "para pagar haga click aquí" con `href="#"`: quien cerraba
 *     la ventana del checkout perdía el turno sin manera de recuperarlo.
 */
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { descifrar } from "@/lib/cripto";

export class SinSmtp extends Error {
  constructor(slug: string) {
    super(`La planta "${slug}" no tiene credenciales de correo cargadas.`);
  }
}

interface Mensaje {
  para: string;
  asunto: string;
  html: string;
}

export async function enviar(plantaId: number, slug: string, m: Mensaje): Promise<void> {
  // Escape para las verificaciones y para desarrollo: las plantas tienen
  // credenciales SMTP reales cargadas, y probar contra ellas manda correo de
  // verdad a direcciones inventadas. Rebotar seguido ensucia la reputación del
  // remitente, que es justamente lo que hace que después los turnos reales
  // caigan en spam.
  if (process.env.CORREO_DESACTIVADO === "1") {
    console.log(`  [correo desactivado] "${m.asunto}" → ${m.para}`);
    return;
  }

  const [cred, planta] = await Promise.all([
    prisma.credencialSmtp.findUnique({ where: { plantaId } }),
    prisma.planta.findUniqueOrThrow({
      where: { id: plantaId },
      select: { emailRemitente: true, emailNombre: true },
    }),
  ]);
  if (!cred) throw new SinSmtp(slug);

  const transporte = nodemailer.createTransport({
    host: cred.host,
    port: cred.puerto,
    secure: cred.seguro,
    auth: { user: cred.usuario, pass: descifrar(cred.passwordCifrada) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  await transporte.sendMail({
    from: `"${planta.emailNombre}" <${planta.emailRemitente}>`,
    to: m.para,
    subject: m.asunto,
    html: m.html,
  });
}

/** Envía sin propagar el error: un fallo de correo no debe romper una reserva. */
export async function enviarSinFallar(plantaId: number, slug: string, m: Mensaje): Promise<void> {
  try {
    await enviar(plantaId, slug, m);
  } catch (e) {
    console.error(`[correo] no se pudo enviar a ${m.para} (${slug}):`, (e as Error).message);
  }
}
