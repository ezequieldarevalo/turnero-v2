"use client";

import { useState, useTransition } from "react";
import Aro from "@/app/aro";
import { nuevoHorario, quitarHorario } from "../acciones";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export interface Banda {
  id: number;
  diaSemana: number;
  dia: string;
  desde: string;
  hasta: string;
  slotsPorHora: number;
  cupos: number;
  cada: number;
  linea: string | null;
  mes: number | null;
}

export default function Editor({
  slug, soloLectura, bandas, lineas,
}: {
  slug: string;
  soloLectura: boolean;
  bandas: Banda[];
  lineas: { id: number; nombre: string }[];
}) {
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [diaSemana, setDia] = useState(1);
  const [desde, setDesde] = useState("08:00");
  const [hasta, setHasta] = useState("15:50");
  const [slots, setSlots] = useState(6);
  const [lineaId, setLineaId] = useState<number | null>(null);
  const [mes, setMes] = useState<number | null>(null);

  function agregar() {
    setError(null);
    arrancar(async () => {
      const r = await nuevoHorario(slug, { diaSemana, desde, hasta, slotsPorHora: slots, lineaId, mes });
      if (!r.ok) setError(r.detalle ?? "No se pudo agregar la banda.");
    });
  }

  function borrar(id: number) {
    setError(null);
    arrancar(async () => {
      const r = await quitarHorario(slug, id);
      if (!r.ok) setError(r.detalle ?? "No se pudo borrar.");
    });
  }

  const porDia = DIAS.map((_, i) => bandas.filter((b) => b.diaSemana === i));

  return (
    <>
      {error && <p className="ops__error" role="alert">{error}</p>}

      <div className="semana">
        {DIAS.map((nombre, i) => (
          <section key={i} className={`dia${porDia[i].length === 0 ? " dia--cerrado" : ""}`}>
            <h3 className="dia__nombre">{nombre}</h3>
            {porDia[i].length === 0 ? (
              <p className="dia__vacio">Cerrado</p>
            ) : (
              <ul className="dia__bandas">
                {porDia[i].map((b) => (
                  <li key={b.id} className="banda">
                    <div>
                      <span className="banda__horas">{b.desde} – {b.hasta}</span>
                      <span className="banda__detalle">
                        {b.cupos} turnos, uno cada {b.cada} min
                        {b.linea && ` · solo ${b.linea}`}
                        {b.mes !== null && ` · solo en ${MESES[b.mes - 1]}`}
                      </span>
                    </div>
                    {!soloLectura && (
                      <button className="banda__borrar" onClick={() => borrar(b.id)}
                              disabled={pendiente} aria-label={`Borrar la banda de ${b.desde} a ${b.hasta}`}>
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {!soloLectura && (
        <div className="ops__panel">
          <h4>Agregar una banda</h4>
          <div className="formulario">
            <div className="campo">
              <label htmlFor="dia">Día</label>
              <select id="dia" className="campo__select" value={diaSemana}
                      onChange={(e) => setDia(Number(e.target.value))}>
                {DIAS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="desde">Abre</label>
              <input id="desde" type="time" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="hasta">Cierra <span className="campo__ayuda">(último turno)</span></label>
              <input id="hasta" type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="slots">Turnos por hora</label>
              <input id="slots" type="number" min={1} max={60} value={slots}
                     onChange={(e) => setSlots(Number(e.target.value))} />
            </div>
            <div className="campo">
              <label htmlFor="linea">Línea</label>
              <select id="linea" className="campo__select" value={lineaId ?? ""}
                      onChange={(e) => setLineaId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Todas</option>
                {lineas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="mes">Mes</label>
              <select id="mes" className="campo__select" value={mes ?? ""}
                      onChange={(e) => setMes(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Todos</option>
                {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
          <p className="campo__ayuda">
            Una banda para un mes o una línea concreta pisa a la general, sin borrarla:
            sirve para un horario de verano sin tocar el resto del año.
          </p>
          <div className="ops__botones">
            <button className="boton" onClick={agregar} disabled={pendiente}>
              {pendiente ? <><Aro />Agregando…</> : "Agregar la banda"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
