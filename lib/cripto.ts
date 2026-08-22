/**
 * Cifrado de credenciales de terceros (los access token de MercadoPago).
 *
 * AES-256-GCM: además de cifrar, autentica. Si alguien altera el texto cifrado
 * en la base, el descifrado falla en vez de devolver basura silenciosamente.
 *
 * Formato guardado: iv(12) : tag(16) : cifrado, todo en base64 separado por ":".
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

function clave(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY tiene que ser 32 bytes en hexadecimal (64 caracteres). " +
        "Generala con: openssl rand -hex 32"
    );
  }
  return Buffer.from(hex, "hex");
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv(ALGO, clave(), iv);
  const cifrado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), cifrado].map((b) => b.toString("base64")).join(":");
}

export function descifrar(guardado: string): string {
  const [iv, tag, cifrado] = guardado.split(":").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv(ALGO, clave(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(cifrado), d.final()]).toString("utf8");
}
