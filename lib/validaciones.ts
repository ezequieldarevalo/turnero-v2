/**
 * Validación de lo que entra por los formularios.
 *
 * Vive del lado del servidor a propósito. El sistema viejo tenía las reglas
 * buenas en el navegador —formato de patente, de año, de teléfono— y en el
 * servidor solo `required|string|max:N`. Toda esa validación es decorativa: una
 * server action es un endpoint, y el navegador es de quien lo está usando.
 *
 * Los largos importan más de lo que parece. Las columnas de texto en Postgres
 * no tienen límite, así que sin esto un nombre de diez megas entra y se guarda.
 */

/** Largo máximo por campo. Los del sistema viejo, que salieron de su uso real. */
export const LARGOS = {
  nombre: 100,
  dominio: 20,
  email: 150,
  telefono: 20,
  anio: 4,
  combustible: 30,
  marca: 40,
  modelo: 50,
  observaciones: 300,
  motivo: 200,
  descripcion: 200,
  nota: 500,
  direccion: 200,
  texto: 200,
} as const;

export interface Falla {
  campo: string;
  mensaje: string;
}

const soloLetras = /^[\p{L}\p{M}\s'.-]+$/u;
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/** Patentes argentinas por categoría. */
const FORMATOS: Record<string, RegExp> = {
  // ABC123 (vieja) y AB123CD (Mercosur)
  L: /^([A-Z]{3}\d{3}|[A-Z]{2}\d{3}[A-Z]{2})$/,
  // A123BCD (Mercosur moto) y 123ABC (vieja)
  M: /^([A-Z]\d{3}[A-Z]{3}|\d{3}[A-Z]{3})$/,
  P: /^([A-Z]{3}\d{3}|[A-Z]{2}\d{3}[A-Z]{2})$/,
};

export function largo(campo: keyof typeof LARGOS, valor: string, etiqueta: string): Falla | null {
  if (valor.length > LARGOS[campo]) {
    return { campo, mensaje: `${etiqueta}: no puede pasar de ${LARGOS[campo]} caracteres` };
  }
  return null;
}

export function validarNombre(valor: string, campo = "nombre"): Falla | null {
  const n = valor.trim();
  if (n.length < 3) return { campo, mensaje: "El nombre tiene que tener al menos 3 letras" };
  if (n.length > LARGOS.nombre) return { campo, mensaje: `El nombre no puede pasar de ${LARGOS.nombre} caracteres` };
  // Con `\p{L}` entran los acentos y la ñ. El sistema viejo usaba `[a-zA-Z]`
  // y rechazaba a cualquiera que se llamara PEÑA o MARÍA.
  if (!soloLetras.test(n)) return { campo, mensaje: "El nombre solo puede tener letras" };
  return null;
}

export function validarEmail(valor: string, campo = "email"): Falla | null {
  const e = valor.trim();
  if (!e) return { campo, mensaje: "Falta el correo electrónico" };
  if (e.length > LARGOS.email) return { campo, mensaje: `El correo no puede pasar de ${LARGOS.email} caracteres` };
  if (!CORREO.test(e)) return { campo, mensaje: "Ese correo no parece válido" };
  return null;
}

export function validarTelefono(valor: string, campo = "telefono"): Falla | null {
  const soloDigitos = valor.replace(/\D/g, "");
  if (!soloDigitos) return { campo, mensaje: "Falta el teléfono" };
  if (soloDigitos.length < 8 || soloDigitos.length > 16) {
    return { campo, mensaje: "El teléfono tiene que tener entre 8 y 16 dígitos" };
  }
  return null;
}

export function validarAnio(valor: string, campo = "anio", ahora = new Date()): Falla | null {
  if (!/^\d{4}$/.test(valor.trim())) return { campo, mensaje: "El año va con cuatro dígitos" };
  const n = Number(valor);
  // El límite de arriba es el año que viene: los 0km se patentan por adelantado.
  const maximo = ahora.getFullYear() + 1;
  if (n < 1900 || n > maximo) {
    return { campo, mensaje: `El año tiene que estar entre 1900 y ${maximo}` };
  }
  return null;
}

/**
 * La patente.
 *
 * `estricto` va en el formulario público, donde el formato atrapa errores de
 * tipeo antes de que alguien reserve para un vehículo que no existe. En el
 * mostrador va apagado: el operador tiene el auto delante, y hay patentes
 * extranjeras, viejas y cargadas con errores de hace años que igual hay que
 * poder atender. Rechazarlas dejaría a la planta sin poder cobrar una revisión
 * por una cuestión de forma.
 */
export function validarDominio(
  valor: string,
  opts: { categoria?: string; estricto?: boolean } = {}
): Falla | null {
  const d = valor.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (d.length < 5) return { campo: "dominio", mensaje: "La patente es demasiado corta" };
  if (d.length > LARGOS.dominio) {
    return { campo: "dominio", mensaje: `La patente no puede pasar de ${LARGOS.dominio} caracteres` };
  }
  if (!opts.estricto) return null;

  const formato = opts.categoria ? FORMATOS[opts.categoria] : null;
  if (formato && !formato.test(d)) {
    return {
      campo: "dominio",
      mensaje: opts.categoria === "M"
        ? "Revisá la patente: para motos va A123BCD o 123ABC"
        : "Revisá la patente: va ABC123 o AB123CD",
    };
  }
  return null;
}

export function validarCombustible(
  valor: string,
  permitidos: string[],
  campo = "combustible"
): Falla | null {
  if (!valor.trim()) return { campo, mensaje: "Elegí el tipo de combustible" };
  if (!permitidos.includes(valor)) {
    return { campo, mensaje: `Combustible no válido. Son: ${permitidos.join(", ")}` };
  }
  return null;
}

/** La primera falla de una lista, o null si están todas bien. */
export const primera = (...fallas: (Falla | null)[]): Falla | null => fallas.find(Boolean) ?? null;

/** Recorta a su largo máximo. Para campos opcionales donde cortar es mejor que rechazar. */
export const recortar = (valor: string | undefined | null, campo: keyof typeof LARGOS): string =>
  (valor ?? "").trim().slice(0, LARGOS[campo]);
