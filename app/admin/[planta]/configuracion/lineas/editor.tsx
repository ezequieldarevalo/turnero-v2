"use client";

import { useState, useTransition } from "react";
import Aro from "@/app/aro";
import { nuevaLinea, bajaLinea } from "../acciones";

export interface Fila {
  id: number;
  nombre: string;
  categoria: string;
  numero: string;
  activa: boolean;
  turnos: number;
  cuposPorDia: number;
}

export default function Editor({
  slug, lineas, categorias, soloLectura,
}: {
  slug: string;
  lineas: Fila[];
  categorias: { id: number; nombre: string }[];
  soloLectura: boolean;
}) {
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [categoriaId, setCategoriaId] = useState(categorias[0]?.id ?? 0);
  const [numero, setNumero] = useState("");

  const activas = lineas.filter((l) => l.activa);
  const bajas = lineas.filter((l) => !l.activa);
  const total = activas.reduce((a, l) => a + l.cuposPorDia, 0);

  return (
    <>
      {error && <p className="ops__error" role="alert">{error}</p>}

      {activas.length > 0 && (
        <div className="resumen">
          <div className="resumen__dato">
            <span className="resumen__numero">{activas.length}</span>
            <span className="resumen__etiqueta">{activas.length === 1 ? "línea" : "líneas"}</span>
          </div>
          <div className="resumen__dato">
            <span className="resumen__numero">{total}</span>
            <span className="resumen__etiqueta">cupos en el día más cargado</span>
          </div>
        </div>
      )}

      <ul className="feriados">
        {activas.map((l) => (
          <li key={l.id} className="feriado">
            <div>
              <span className="feriado__fecha">{l.nombre}</span>
              <span className="feriado__desc">
                {l.cuposPorDia > 0
                  ? `${l.cuposPorDia} cupos por día`
                  : "sin horarios: no ofrece ningún cupo"}
                {l.turnos > 0 && ` · ${l.turnos.toLocaleString("es-AR")} turnos históricos`}
              </span>
            </div>
            {!soloLectura && (
              <button className="banda__borrar" disabled={pendiente}
                      aria-label={`Dar de baja ${l.nombre}`}
                      onClick={() => arrancar(async () => {
                        setError(null);
                        const r = await bajaLinea(slug, l.id);
                        if (!r.ok) {
                          setError(r.motivo === "TIENE_TURNOS"
                            ? `${l.nombre} tiene ${r.detalle} turno(s) futuros. Movelos antes: esa gente quedaría citada en una línea que ya no existe.`
                            : r.detalle ?? "No se pudo dar de baja.");
                        }
                      })}>×</button>
            )}
          </li>
        ))}
      </ul>

      {bajas.length > 0 && (
        <details className="anio">
          <summary className="anio__titulo">
            Dadas de baja <span className="apagado">· {bajas.length}</span>
          </summary>
          <ul className="feriados feriados--pasados">
            {bajas.map((l) => (
              <li key={l.id} className="feriado">
                <div>
                  <span className="feriado__fecha">{l.nombre}</span>
                  <span className="feriado__desc">
                    {l.turnos.toLocaleString("es-AR")} turnos históricos · se puede reactivar
                    volviéndola a agregar
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!soloLectura && (
        <div className="ops__panel">
          <h4>Agregar una línea</h4>
          <div className="formulario">
            <div className="campo">
              <label htmlFor="cat">Categoría</label>
              <select id="cat" className="campo__select" value={categoriaId}
                      onChange={(e) => setCategoriaId(Number(e.target.value))}>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="num">Número</label>
              <input id="num" value={numero} placeholder="3"
                     onChange={(e) => setNumero(e.target.value)} />
            </div>
          </div>
          <div className="ops__botones">
            <button className="boton" disabled={!numero.trim() || pendiente}
                    onClick={() => arrancar(async () => {
                      setError(null);
                      const r = await nuevaLinea(slug, { categoriaId, numero });
                      if (r.ok) setNumero("");
                      else setError(r.detalle ?? "No se pudo agregar.");
                    })}>
              {pendiente ? <><Aro />Agregando…</> : "Agregar"}
            </button>
          </div>
          <p className="campo__ayuda">
            Una línea nueva empieza a ofrecer cupos con los horarios que ya tenga la
            planta, desde el día siguiente.
          </p>
        </div>
      )}
    </>
  );
}
