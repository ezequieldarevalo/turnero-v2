/**
 * Las columnas que puede mostrar la agenda, en su orden canónico.
 *
 * Vive aparte de la tabla que las dibuja porque la configuración también las
 * necesita, y la tabla es un componente de servidor con JSX: importarla desde
 * ahí arrastraría React a la validación.
 *
 * El orden de esta lista es el orden en que se muestran. Se guarda un
 * subconjunto, no una permutación: las dos configuraciones que había en las
 * consolas viejas —Revitotal y Godoy Cruz— son las dos subconjuntos de este
 * orden, y dejar reordenar libremente permitiría poner la hora después del
 * nombre sin que eso le sirva a nadie.
 */
export const COLUMNAS_AGENDA = [
  "orden",
  "numero",
  "estado",
  "fecha",
  "hora",
  "dominio",
  "nombre",
  "tipoVehiculo",
  "linea",
  "pago",
  "telefono",
] as const;

export type ColumnaAgenda = (typeof COLUMNAS_AGENDA)[number];

export const ETIQUETA_COLUMNA: Record<ColumnaAgenda, string> = {
  orden: "Nº de orden del día",
  numero: "Número de turno",
  estado: "Estado",
  fecha: "Fecha",
  hora: "Hora",
  dominio: "Dominio",
  nombre: "Nombre",
  tipoVehiculo: "Tipo de vehículo",
  linea: "Línea",
  pago: "Pago",
  telefono: "Teléfono",
};
