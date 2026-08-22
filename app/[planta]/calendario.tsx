"use client";

import { useMemo, useState } from "react";

const DIAS_SEMANA = ["LU", "MA", "MI", "JU", "VI", "SÁ", "DO"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Semanas de un mes, empezando en lunes y completando los bordes. */
function construirMes(anio: number, mes: number): Date[][] {
  const primero = new Date(anio, mes, 1);
  const cursor = new Date(primero);
  // getDay(): 0=domingo. Retrocedemos hasta el lunes anterior.
  cursor.setDate(cursor.getDate() - ((primero.getDay() + 6) % 7));

  const semanas: Date[][] = [];
  while (semanas.length < 6) {
    const semana: Date[] = [];
    for (let i = 0; i < 7; i++) {
      semana.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    semanas.push(semana);
    // Si ya pasamos el último día del mes, no hace falta una fila más.
    if (cursor.getMonth() !== mes && cursor.getDate() > 7) break;
  }
  return semanas;
}

export default function Calendario({
  fechasDisponibles,
  seleccionada,
  alSeleccionar,
}: {
  fechasDisponibles: Set<string>;
  seleccionada: string | null;
  alSeleccionar: (fecha: string) => void;
}) {
  const ordenadas = useMemo(() => [...fechasDisponibles].sort(), [fechasDisponibles]);
  const primeraDisponible = ordenadas[0];
  const ultimaDisponible = ordenadas[ordenadas.length - 1];

  const inicial = seleccionada ?? primeraDisponible;
  const [anio, setAnio] = useState(() => Number(inicial.slice(0, 4)));
  const [mes, setMes] = useState(() => Number(inicial.slice(5, 7)) - 1);

  const semanas = useMemo(() => construirMes(anio, mes), [anio, mes]);

  const limiteMin = primeraDisponible.slice(0, 7);
  const limiteMax = ultimaDisponible.slice(0, 7);
  const actual = `${anio}-${String(mes + 1).padStart(2, "0")}`;

  const mover = (delta: number) => {
    const d = new Date(anio, mes + delta, 1);
    setAnio(d.getFullYear());
    setMes(d.getMonth());
  };

  return (
    <div className="calendario">
      <div className="calendario__barra">
        <button
          type="button"
          className="calendario__nav"
          onClick={() => mover(-1)}
          disabled={actual <= limiteMin}
          aria-label="Mes anterior"
        >
          ‹
        </button>
        <span className="calendario__mes">
          {MESES[mes]} {anio}
        </span>
        <button
          type="button"
          className="calendario__nav"
          onClick={() => mover(1)}
          disabled={actual >= limiteMax}
          aria-label="Mes siguiente"
        >
          ›
        </button>
      </div>

      <div className="calendario__grilla" role="grid">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="calendario__encabezado">{d}</div>
        ))}

        {semanas.flat().map((fecha) => {
          const clave = iso(fecha);
          const deOtroMes = fecha.getMonth() !== mes;
          const disponible = fechasDisponibles.has(clave);
          const elegida = clave === seleccionada;

          return (
            <button
              key={clave}
              type="button"
              className={[
                "calendario__dia",
                deOtroMes && "calendario__dia--fuera",
                disponible && "calendario__dia--libre",
                elegida && "calendario__dia--elegido",
              ].filter(Boolean).join(" ")}
              disabled={!disponible}
              onClick={() => alSeleccionar(clave)}
              aria-pressed={elegida}
            >
              {fecha.getDate()}
            </button>
          );
        })}
      </div>

      <p className="calendario__leyenda">
        <span className="calendario__muestra" /> días con turnos disponibles
      </p>
    </div>
  );
}
