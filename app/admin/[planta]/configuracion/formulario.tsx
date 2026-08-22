"use client";

import { useState, useTransition } from "react";
import Aro from "@/app/aro";
import { guardarGeneral } from "./acciones";

export interface Def {
  tipo: string;
  grupo: string;
  etiqueta: string;
  min?: number;
  max?: number;
  opcional?: boolean;
  /** Solo lo cambia quien administra el servicio. Se muestra, en solo lectura. */
  bloqueado?: boolean;
}

/** Marca visible en los campos que solo cambia quien administra el servicio. */
function Candado() {
  return (
    <span className="candado" title="Solo lo cambia quien administra el servicio">
      <span aria-hidden="true">🔒</span>
      <span className="sr-only">Solo lo cambia quien administra el servicio</span>
    </span>
  );
}

export default function FormGeneral({
  slug, soloLectura, campos, grupos, valores, columnas, avisosTexto,
}: {
  slug: string;
  soloLectura: boolean;
  campos: Record<string, Def>;
  grupos: { id: string; titulo: string; ayuda?: string }[];
  valores: Record<string, string | boolean | null>;
  columnas: { id: string; etiqueta: string; activa: boolean }[];
  avisosTexto: string;
}) {
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  // Dos ajustes donde un aviso sirve más que un candado: el dueño los puede
  // cambiar —son su negocio— pero conviene que vea la consecuencia mientras lo
  // hace, no cuando le empiecen a llamar.
  const [permiteCancelar, setPermiteCancelar] = useState(valores.permiteCancelar === true);
  const [minutosPago, setMinutosPago] = useState(Number(valores.minutosExpiracionPago ?? 120));

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    setGuardado(false);
    arrancar(async () => {
      const r = await guardarGeneral(slug, form);
      if (r.ok) setGuardado(true);
      else setError(r.detalle ?? "No se pudo guardar.");
    });
  }

  const hayBloqueados = Object.values(campos).some((d) => d.bloqueado);

  return (
    <form className="config" onSubmit={enviar}>
      {error && <p className="ops__error" role="alert">{error}</p>}
      {guardado && <p className="config__ok" role="status">Cambios guardados.</p>}

      {grupos.map((g) => {
        const suyos = Object.entries(campos).filter(([, d]) => d.grupo === g.id);
        return (
          <fieldset key={g.id} className="config__grupo" disabled={soloLectura}>
            <legend>{g.titulo}</legend>
            {g.ayuda && <p className="config__ayuda">{g.ayuda}</p>}

            <div className="formulario">
              {suyos.map(([clave, d]) =>
                d.tipo === "si_no" ? (
                  <div key={clave} className="campo--ancho">
                    <label className={`opcion-check${d.bloqueado ? " opcion-check--bloqueada" : ""}`}>
                      <input type="checkbox" name={clave} disabled={d.bloqueado}
                             defaultChecked={valores[clave] === true}
                             onChange={clave === "permiteCancelar"
                               ? (e) => setPermiteCancelar(e.target.checked) : undefined} />
                      <span>{d.etiqueta}</span>
                      {d.bloqueado && <Candado />}
                    </label>
                    {clave === "permiteCancelar" && !permiteCancelar && (
                      <p className="config__alerta">
                        Sin esta opción, quien quiera cancelar tiene que llamar a la planta.
                        Los cupos que no se liberan solos se pierden.
                      </p>
                    )}
                  </div>
                ) : (
                  <div key={clave} className={`campo${d.tipo === "texto_largo" ? " campo--ancho" : ""}`}>
                    <label htmlFor={clave}>
                      {d.etiqueta}{" "}
                      {d.opcional && <span className="campo__ayuda">(opcional)</span>}
                      {d.bloqueado && <Candado />}
                    </label>
                    {d.tipo === "color" ? (
                      <input id={clave} name={clave} type="color" disabled={d.bloqueado}
                             defaultValue={String(valores[clave] ?? "#000000")} className="campo__color" />
                    ) : d.tipo === "entero" ? (
                      <input id={clave} name={clave} type="number" min={d.min} max={d.max} step={1}
                             disabled={d.bloqueado}
                             defaultValue={valores[clave] === null ? "" : String(valores[clave])}
                             onChange={clave === "minutosExpiracionPago"
                               ? (e) => setMinutosPago(Number(e.target.value)) : undefined} />
                    ) : (
                      <input id={clave} name={clave} disabled={d.bloqueado}
                             defaultValue={valores[clave] === null ? "" : String(valores[clave])} />
                    )}
                    {clave === "minutosExpiracionPago" && minutosPago > 0 && minutosPago < 60 && (
                      <p className="config__alerta">
                        Menos de una hora para pagar es poco: quien abre el correo más tarde
                        se encuentra el turno liberado.
                      </p>
                    )}
                    {clave === "diasVentanaReserva" && d.max !== undefined && d.max < 730 && (
                      <p className="campo__ayuda">
                        Hasta {d.max} días. Para más, pedíselo a quien administra el servicio.
                      </p>
                    )}
                  </div>
                )
              )}

              {g.id === "panel" && (
                <div className="campo campo--ancho">
                  <label>Columnas de la agenda</label>
                  <p className="campo__ayuda">
                    Se muestran en este orden, salteando las que no estén tildadas.
                  </p>
                  <div className="config__columnas">
                    {columnas.map((c) => (
                      <label key={c.id} className="opcion-check">
                        <input type="checkbox" name="columnasAgenda" value={c.id} defaultChecked={c.activa} />
                        <span>{c.etiqueta}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {g.id === "textos" && (
                <div className="campo campo--ancho">
                  <label htmlFor="avisos">Avisos del sitio público</label>
                  <p className="campo__ayuda">
                    Uno por línea. La que empiece con <code>*</code> se muestra destacada.
                  </p>
                  <textarea id="avisos" name="avisos" rows={6} className="campo__area"
                            defaultValue={avisosTexto} />
                </div>
              )}
            </div>
          </fieldset>
        );
      })}

      {!soloLectura && (
        <div className="ops__botones">
          <button className="boton" type="submit" disabled={pendiente}>
            {pendiente ? <><Aro />Guardando…</> : "Guardar cambios"}
          </button>
        </div>
      )}
      {soloLectura && (
        <p className="campo__ayuda">Podés ver la configuración pero no modificarla.</p>
      )}
      {!soloLectura && hayBloqueados && (
        <p className="campo__ayuda">
          Los ajustes con 🔒 los cambia quien administra el servicio. Son los que, mal
          puestos, dejan de facturar o vacían el calendario sin que se vea ningún error.
        </p>
      )}
    </form>
  );
}
