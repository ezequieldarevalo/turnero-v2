import Link from "next/link";
import type { Faltante } from "@/lib/plantas";

/**
 * Lo que le falta a la planta para poder vender un turno.
 *
 * Aparece arriba de la agenda porque es donde cae quien acaba de dar de alta la
 * planta. Sin esto, la única señal de que algo falta es que el sitio público no
 * muestra nada — y eso se descubre cuando ya hay un cliente del otro lado.
 */
export default function Pendientes({ falta }: { falta: Faltante[] }) {
  return (
    <section className="pendientes" role="status">
      <h2 className="pendientes__titulo">
        Esta planta todavía no puede tomar turnos
      </h2>
      <ul>
        {falta.map((f) => (
          <li key={f.clave}>
            {f.ruta ? <Link className="enlace" href={f.ruta}>{f.texto}</Link> : f.texto}
          </li>
        ))}
      </ul>
      <p className="pendientes__pie">
        Mientras tanto su sitio público avisa que no está tomando turnos, en vez de
        mostrar un formulario vacío.
      </p>
    </section>
  );
}
