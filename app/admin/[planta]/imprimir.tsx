"use client";

/**
 * Botón de impresión de la planilla del día.
 *
 * Sin librería: `window.print()` y reglas `@media print` que esconden todo lo
 * que no es la tabla. La consola vieja usaba `react-to-print` para imprimir un
 * subárbol; con CSS se consigue lo mismo, sale mejor —el encabezado de la tabla
 * se repite en cada hoja, cosa que aquella no hacía— y no hay una dependencia
 * más que actualizar.
 */
export default function Imprimir({ etiqueta = "Imprimir" }: { etiqueta?: string }) {
  return (
    <button className="boton boton--suave boton--chico" onClick={() => window.print()}>
      {etiqueta}
    </button>
  );
}
