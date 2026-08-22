"use client";

import { useState, useTransition } from "react";
import Aro from "@/app/aro";
import { cerrarDia, reabrirDia } from "../acciones";

export interface Fila {
  fecha: string;
  texto: string;
  descripcion: string;
  /** De dónde sale el cierre: una fila propia o los cupos tapados uno por uno. */
  origen: "feriado" | "bloqueos";
  pasado: boolean;
}

export interface Anio {
  anio: string;
  dias: Fila[];
}

export default function Editor({
  slug, proximos, anteriores, hoy, soloLectura,
}: {
  slug: string;
  proximos: Fila[];
  anteriores: Anio[];
  hoy: string;
  soloLectura: boolean;
}) {
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fecha, setFecha] = useState("");
  const [descripcion, setDescripcion] = useState("");

  function agregar() {
    setError(null);
    arrancar(async () => {
      const r = await cerrarDia(slug, fecha, descripcion);
      if (r.ok) { setFecha(""); setDescripcion(""); return; }
      if (r.motivo === "TIENE_TURNOS") {
        setError(
          `Ese día ya tiene ${r.detalle} turno(s) reservado(s). Movelos o cancelalos primero, ` +
          `o van a quedar citados un día que el sistema considera cerrado.`
        );
      } else if (r.motivo === "SIN_MOTIVO") {
        setError("Escribí el motivo: dentro de un año nadie va a acordarse de por qué se cerró.");
      } else setError(r.detalle ?? "No se pudo cerrar el día.");
    });
  }

  function borrar(f: string) {
    setError(null);
    arrancar(async () => {
      const r = await reabrirDia(slug, f);
      if (!r.ok) setError(r.detalle ?? "No se pudo borrar.");
    });
  }

  return (
    <>
      {error && <p className="ops__error" role="alert">{error}</p>}

      {!soloLectura && (
        <div className="ops__panel">
          <h4>Cerrar un día entero</h4>
          <div className="formulario">
            <div className="campo">
              <label htmlFor="fecha">Fecha</label>
              <input id="fecha" type="date" value={fecha} min={hoy}
                     onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="desc">Motivo</label>
              <input id="desc" value={descripcion} placeholder="Feriado nacional / mantenimiento"
                     onChange={(e) => setDescripcion(e.target.value)} />
            </div>
          </div>
          <div className="ops__botones">
            <button className="boton" disabled={!fecha || !descripcion || pendiente} onClick={agregar}>
              {pendiente ? <><Aro />Guardando…</> : "Cerrar ese día"}
            </button>
          </div>
        </div>
      )}

      <h3 className="ficha__subtitulo">Próximos</h3>
      {proximos.length === 0 ? (
        <p className="apagado">No hay días cerrados por delante.</p>
      ) : (
        <ul className="feriados">
          {proximos.map((f) => (
            <li key={f.fecha} className="feriado">
              <div>
                <span className="feriado__fecha">
                  {f.texto}
                  {/* El año solo cuando no es el corriente: repetirlo en cada
                      renglón de este año sería ruido. */}
                  {f.fecha.slice(0, 4) !== hoy.slice(0, 4) && (
                    <span className="apagado"> de {f.fecha.slice(0, 4)}</span>
                  )}
                </span>
                <span className="feriado__desc">
                  {f.descripcion}
                  {/* Los cierres hechos tapando cupos uno por uno vienen del
                      sistema viejo. Se marcan para saber que esa fila resume
                      muchas, y que al reabrir se levantan todas. */}
                  {f.origen === "bloqueos" && <span className="apagado"> · por cupos bloqueados</span>}
                </span>
              </div>
              {!soloLectura && (
                <button className="banda__borrar" disabled={pendiente}
                        onClick={() => borrar(f.fecha)}
                        aria-label={`Volver a abrir el ${f.texto}`}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {anteriores.length > 0 && (
        <>
          <h3 className="ficha__subtitulo">Anteriores</h3>
          {anteriores.map(({ anio, dias }, i) => (
            <details key={anio} className="anio" open={i === 0}>
              <summary className="anio__titulo">
                {anio} <span className="apagado">· {dias.length} {dias.length === 1 ? "día" : "días"}</span>
              </summary>
              <ul className="feriados feriados--pasados">
                {dias.map((f) => (
                  <li key={f.fecha} className="feriado">
                    <div>
                      <span className="feriado__fecha">{f.texto}</span>
                      <span className="feriado__desc">{f.descripcion}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </>
      )}
    </>
  );
}
