/**
 * Qué puede hacer cada rol.
 *
 * El sistema viejo no tenía roles: la tabla `users` era nombre, correo y
 * contraseña, y cualquiera que entrara podía todo. Estos tres roles no son un
 * requisito heredado, son una decisión: la persona del mostrador no necesita
 * poder cambiar precios ni ver la facturación, y no dárselo la protege a ella
 * tanto como a la planta.
 *
 * La tabla es explícita a propósito. Un permiso que se deduce de una jerarquía
 * ("dueño puede todo lo del operador y además…") se lee bien hasta que hay que
 * quitarle uno solo al de arriba; enumerarlos deja la respuesta a la vista.
 */
import { Rol } from "@prisma/client";

export const PERMISOS = [
  "agenda.ver", // turnos del día y de días futuros
  "turno.buscar", // por patente o por número
  "turno.crear", // atención sin turno previo, o carga por teléfono
  "turno.cobrar", // registrar un pago hecho en el mostrador
  "turno.reprogramar",
  "turno.cancelar",
  "turno.realizar", // marcar como atendido
  "pagos.revisar", // los que llegaron sin turno o sobre un turno cancelado
  "reportes.ver", // ocupación y facturación
  "config.ver",
  "config.editar", // horarios, feriados, precios, tipos de vehículo, textos
  "credenciales.editar", // MercadoPago y SMTP de la planta
  "usuarios.gestionar", // altas y bajas dentro de la planta
  "plantas.gestionar", // crear plantas, asignar usuarios entre plantas
] as const;

export type Permiso = (typeof PERMISOS)[number];

const OPERADOR: Permiso[] = [
  "agenda.ver",
  "turno.buscar",
  "turno.crear",
  "turno.cobrar",
  "turno.reprogramar",
  "turno.cancelar",
  "turno.realizar",
];

const DUENO: Permiso[] = [
  ...OPERADOR,
  "pagos.revisar",
  "reportes.ver",
  "config.ver",
  "config.editar",
  "credenciales.editar",
  "usuarios.gestionar",
];

export const PERMISOS_POR_ROL: Record<Rol, readonly Permiso[]> = {
  [Rol.OPERADOR]: OPERADOR,
  [Rol.DUENO]: DUENO,
};

/**
 * El superadmin opera el servicio, no es un cliente: puede todo en cualquier
 * planta, y `plantas.gestionar` —dar de alta una planta, o sea cobrarle a
 * alguien— es suyo y de nadie más.
 */
export function puede(rol: Rol | "SUPERADMIN", permiso: Permiso): boolean {
  if (rol === "SUPERADMIN") return true;
  return PERMISOS_POR_ROL[rol].includes(permiso);
}

/**
 * Además del rol, la planta tiene que ofrecer la acción. Godoy Cruz registra la
 * atención en otro sistema: ahí `turno.realizar` no se ofrece ni al dueño.
 */
export function puedeEnPlanta(
  rol: Rol | "SUPERADMIN",
  permiso: Permiso,
  planta: { registraRealizacion: boolean }
): boolean {
  if (permiso === "turno.realizar" && !planta.registraRealizacion) return false;
  return puede(rol, permiso);
}
