/**
 * El código corto de un turno: lo que la persona dice por teléfono y lo que el
 * mostrador tipea para buscarla.
 *
 * Sale del FINAL del `publicId`, no del principio. Un UUIDv7 arranca con la
 * marca de tiempo de su creación, así que los primeros caracteres son iguales
 * para todo lo creado en el mismo instante: los 63.037 turnos migrados
 * comparten apenas 7 prefijos distintos. La cola sí es aleatoria — con los
 * últimos 8 caracteres no hay un solo choque en toda la base.
 *
 * No es un identificador: para eso está el `publicId` entero. Es una ayuda para
 * encontrar el turno, y por eso la búsqueda por código nunca devuelve un turno
 * directamente, sino los que coinciden.
 */

const LARGO = 8;

export function codigoCorto(publicId: string): string {
  return publicId.replace(/-/g, "").slice(-LARGO).toUpperCase();
}

/** Normaliza lo que tipea el operador: mayúsculas, sin espacios ni guiones. */
export function normalizarCodigo(texto: string): string {
  return texto.replace(/[\s-]/g, "").toUpperCase();
}

export const esCodigo = (texto: string) =>
  new RegExp(`^[0-9A-F]{${LARGO}}$`).test(normalizarCodigo(texto));
