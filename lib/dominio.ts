/**
 * La patente, en una sola forma.
 *
 * En las bases viejas el mismo vehículo aparece cargado de las dos maneras
 * —`005-ESE` y `005ESE`—: 30.508 turnos con guiones contra 32.529 sin. Como el
 * sistema viejo busca por igualdad exacta, pedir el historial de un auto
 * devuelve la mitad de sus visitas, y cuál mitad depende de cómo lo tipeó quien
 * lo cargó ese día.
 *
 * La solución no es que la búsqueda pruebe las dos formas: es que en la base
 * haya una sola. Se normaliza al guardar, y la migración normaliza lo viejo.
 */

export function normalizarDominio(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "") // guiones, espacios, puntos
    .slice(0, 20);
}

/** ABC123 (vieja) o AB123CD (Mercosur). Motos Mercosur: A123BCD. */
const FORMATOS = [
  /^[A-Z]{3}\d{3}$/, // ABC123
  /^[A-Z]{2}\d{3}[A-Z]{2}$/, // AB123CD
  /^[A-Z]\d{3}[A-Z]{3}$/, // A123BCD, motos
  /^\d{3}[A-Z]{3}$/, // 005ESE, formato viejo invertido presente en los datos
];

/**
 * Si parece una patente argentina. Se usa solo para decidir cómo interpretar lo
 * que se tipea en la búsqueda — **no** para rechazar cargas: hay vehículos con
 * patentes de otras provincias, extranjeras o mal cargadas de hace años, y
 * negarse a guardarlas rompería el mostrador por una cuestión de forma.
 */
export const pareceDominio = (texto: string) =>
  FORMATOS.some((f) => f.test(normalizarDominio(texto)));
