/**
 * Un gráfico de barras horizontales, en CSS.
 *
 * Sin librería a propósito: son barras proporcionales y una etiqueta. Meter una
 * dependencia de gráficos para esto agregaría kilos de JavaScript y una versión
 * más que mantener, en un proyecto cuyo criterio declarado es no sumar trabajo.
 */
export interface FilaBarra {
  etiqueta: string;
  /** Valor para la proporción. La barra más larga es el máximo de la serie. */
  valor: number;
  /** Lo que se muestra a la derecha. */
  texto: string;
  detalle?: string;
}

export default function Barras({ titulo, filas }: { titulo: string; filas: FilaBarra[] }) {
  if (!filas.length) return null;
  const max = Math.max(...filas.map((f) => f.valor), 0.0001);

  return (
    <section className="barras">
      <h4 className="barras__titulo">{titulo}</h4>
      <ul>
        {filas.map((f) => (
          <li key={f.etiqueta} className="barra">
            <span className="barra__etiqueta">{f.etiqueta}</span>
            <span className="barra__pista">
              <span className="barra__relleno" style={{ width: `${(f.valor / max) * 100}%` }} />
            </span>
            <span className="barra__valor">
              {f.texto}
              {f.detalle && <span className="barra__detalle">{f.detalle}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
