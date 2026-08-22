import Link from "next/link";
import { ETIQUETA_ESTADO, type FilaAgenda } from "@/lib/agenda";
import { hhmm } from "@/lib/fechas";
import { EstadoTurno } from "@prisma/client";
import { COLUMNAS_AGENDA, type ColumnaAgenda } from "@/lib/columnas";

/**
 * Las columnas salen de `planta.columnasAgenda`. Las tres consolas viejas
 * resolvían esto comentando y descomentando las mismas líneas en cada copia
 * del archivo: Revitotal mostraba monto y teléfono, Godoy Cruz mostraba orden,
 * número, estado y tipo de vehículo.
 */
const COLUMNAS = {
  orden: { titulo: "#", clase: "col--num" },
  numero: { titulo: "Número", clase: "col--codigo" },
  estado: { titulo: "Estado", clase: "" },
  fecha: { titulo: "Fecha", clase: "" },
  hora: { titulo: "Hora", clase: "col--num" },
  dominio: { titulo: "Dominio", clase: "col--dominio" },
  nombre: { titulo: "Nombre", clase: "" },
  tipoVehiculo: { titulo: "Vehículo", clase: "" },
  linea: { titulo: "Línea", clase: "" },
  pago: { titulo: "Pago", clase: "col--num" },
  telefono: { titulo: "Teléfono", clase: "col--num" },
} as const;

export type Columna = ColumnaAgenda;

export const COLUMNAS_VALIDAS = COLUMNAS_AGENDA;

const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

function celda(c: Columna, f: FilaAgenda, i: number, timezone: string) {
  switch (c) {
    case "orden": return i + 1;
    case "numero": return f.codigo;
    case "estado": return (
      <span className={`pastilla pastilla--${f.estado.toLowerCase()}`}>{ETIQUETA_ESTADO[f.estado]}</span>
    );
    case "fecha": return new Intl.DateTimeFormat("es-AR", { timeZone: timezone, day: "2-digit", month: "2-digit" }).format(f.inicio);
    case "hora": return hhmm(f.inicio, timezone);
    case "dominio": return f.dominio;
    case "nombre": return f.titularNombre;
    case "tipoVehiculo": return f.tipoVehiculo;
    case "linea": return f.linea;
    case "pago": return f.cobrado !== null ? pesos(f.cobrado) : <span className="apagado">—</span>;
    case "telefono": return f.titularTelefono || <span className="apagado">—</span>;
  }
}

export default function Tabla({
  filas, columnas, slug, timezone, cerca,
}: {
  filas: FilaAgenda[];
  columnas: Columna[];
  slug: string;
  timezone: string;
  /** Días cercanos con turnos, para que el vacío no sea un callejón sin salida. */
  cerca?: { fecha: string; texto: string }[];
}) {
  // Un domingo, o cualquier día cerrado, deja la agenda vacía con toda razón.
  // Decir solo "no hay turnos" obliga a adivinar hacia dónde moverse; se
  // ofrecen los días con movimiento más próximos.
  if (!filas.length) {
    return (
      <div className="agenda__vacio">
        <p>No hay turnos para este día.</p>
        {cerca && cerca.length > 0 && (
          <div className="agenda__cerca">
            <span>Días con turnos cerca:</span>
            <ul>
              {cerca.map((d) => (
                <li key={d.fecha}>
                  <Link className="enlace" href={`/admin/${slug}?dia=${d.fecha}`}>{d.texto}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tabla-scroll">
      <table className="tabla">
        <thead>
          <tr>
            {columnas.map((c) => (
              <th key={c} className={COLUMNAS[c].clase} scope="col">{COLUMNAS[c].titulo}</th>
            ))}
            <th scope="col"><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={f.publicId} className={f.estado === EstadoTurno.PENDIENTE_PAGO ? "fila--impaga" : undefined}>
              {columnas.map((c) => (
                <td key={c} className={COLUMNAS[c].clase}>{celda(c, f, i, timezone)}</td>
              ))}
              <td className="col--accion">
                <Link className="enlace" href={`/admin/${slug}/turno/${f.publicId}`}>Ver</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
