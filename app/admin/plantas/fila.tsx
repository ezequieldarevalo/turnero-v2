"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { desactivar, reactivar } from "./acciones";

export interface PlantaFila {
  slug: string;
  nombre: string;
  direccion: string;
  color: string;
  activa: boolean;
  turnos: number;
  usuarios: number;
  lineas: number;
  falta: { clave: string; texto: string; ruta: string | null }[];
}

export default function Fila({ planta: p }: { planta: PlantaFila }) {
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <article className={`planta-fila${p.activa ? "" : " planta-fila--baja"}`}
             style={{ "--color": p.color } as React.CSSProperties}>
      <div className="planta-fila__datos">
        <Link className="planta-fila__nombre" href={`/admin/${p.slug}`}>{p.nombre}</Link>
        <span className="planta-fila__meta">
          /{p.slug} · {p.direccion}
        </span>
        <span className="planta-fila__meta">
          {p.turnos.toLocaleString("es-AR")} turnos · {p.lineas} línea{p.lineas === 1 ? "" : "s"} ·{" "}
          {p.usuarios} usuario{p.usuarios === 1 ? "" : "s"}
          {!p.activa && " · dada de baja"}
        </span>

        {p.falta.length > 0 && (
          <ul className="faltantes">
            {p.falta.map((f) => (
              <li key={f.clave}>
                {f.ruta ? <Link className="enlace" href={f.ruta}>{f.texto}</Link> : f.texto}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="ops__error">{error}</p>}
      </div>

      <button className="boton boton--suave boton--chico" disabled={pendiente}
              onClick={() => arrancar(async () => {
                setError(null);
                const r = p.activa ? await desactivar(p.slug) : await reactivar(p.slug);
                if (!r.ok) {
                  setError(r.motivo === "TIENE_TURNOS"
                    ? `Tiene ${r.detalle} turno(s) futuros sin atender. Movelos o esperá a que pasen.`
                    : "No se pudo.");
                }
              })}>
        {p.activa ? "Dar de baja" : "Reactivar"}
      </button>
    </article>
  );
}
