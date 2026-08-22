"use client";

import { useState, useTransition } from "react";
import Aro from "@/app/aro";
import { guardarOferta, ponerPrecio, anularPrecio } from "../acciones";

const MOTIVOS: Record<string, string> = {
  PRECIO_INVALIDO: "El precio va en pesos enteros.",
  FECHA_INVALIDA: "No se puede poner un precio con fecha pasada: eso reescribiría lo ya cobrado.",
  YA_EXISTE: "Ya hay un precio anotado para ese momento.",
  YA_VIGENTE: "Ese ya es el precio que rige.",
  NO_EXISTE: "No se encontró.",
  SIN_LINEA: "",
};

export interface Vigencia {
  id: number;
  precio: number;
  desde: string;
  estado: "vigente" | "programado" | "anterior";
  puestoPor: string | null;
}

export interface Fila {
  id: number;
  nombre: string;
  categoria: string;
  nombreDisplay: string;
  activo: boolean;
  orden: number;
  sinLinea: boolean;
  precios: Vigencia[];
}

const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

export default function Tabla({
  slug, filas, soloLectura, timezone,
}: {
  slug: string;
  filas: Fila[];
  soloLectura: boolean;
  timezone: string;
}) {
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat("es-AR", {
      timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));

  return (
    <>
      {error && <p className="ops__error" role="alert">{error}</p>}

      <ul className="tipos">
        {filas.map((f) => {
          const vigente = f.precios.find((p) => p.estado === "vigente");
          const programados = f.precios.filter((p) => p.estado === "programado");
          const anteriores = f.precios.filter((p) => p.estado === "anterior");

          return (
            <li key={f.id} className={`tipo${f.activo ? "" : " tipo--apagado"}`}>
              <div className="tipo__cabecera">
                <div>
                  <span className="tipo__nombre">{f.nombreDisplay || f.nombre}</span>
                  <span className="tipo__meta">
                    {f.categoria}
                    {!f.activo && " · no se ofrece"}
                    {f.sinLinea && " · sin línea que lo atienda"}
                  </span>
                </div>
                <div className="tipo__precio">
                  {vigente ? pesos(vigente.precio) : <span className="apagado">sin precio</span>}
                  {programados.length > 0 && (
                    <span className="tipo__proximo">
                      → {pesos(programados[programados.length - 1].precio)} el{" "}
                      {fecha(programados[programados.length - 1].desde)}
                    </span>
                  )}
                </div>
              </div>

              {programados.length > 0 && (
                <ul className="vigencias">
                  {programados.map((p) => (
                    <li key={p.id} className="vigencia vigencia--programada">
                      <span>
                        <strong>{pesos(p.precio)}</strong> desde el {fecha(p.desde)}
                        {p.puestoPor && <span className="apagado"> · {p.puestoPor}</span>}
                      </span>
                      {!soloLectura && (
                        <button className="banda__borrar" disabled={pendiente}
                                aria-label="Cancelar este cambio programado"
                                onClick={() => arrancar(async () => {
                                  setError(null);
                                  const r = await anularPrecio(slug, p.id);
                                  if (!r.ok) setError(MOTIVOS[r.motivo] ?? r.detalle ?? "No se pudo cancelar.");
                                })}>×</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {!soloLectura && (
                abierto === f.id ? (
                  <PanelPrecio
                    slug={slug}
                    tipoId={f.id}
                    actual={vigente?.precio ?? 0}
                    pendiente={pendiente}
                    arrancar={arrancar}
                    onError={setError}
                    onListo={() => setAbierto(null)}
                  />
                ) : (
                  <div className="tipo__acciones">
                    <button className="boton boton--suave boton--chico" onClick={() => { setError(null); setAbierto(f.id); }}>
                      Cambiar el precio
                    </button>
                    <Oferta slug={slug} fila={f} pendiente={pendiente} arrancar={arrancar} onError={setError} />
                  </div>
                )
              )}

              {anteriores.length > 0 && (
                <details className="tipo__historial">
                  <summary>Historial ({anteriores.length})</summary>
                  <ul className="vigencias">
                    {anteriores.map((p) => (
                      <li key={p.id} className="vigencia">
                        <span>
                          <strong>{pesos(p.precio)}</strong> desde el {fecha(p.desde)}
                          {p.puestoPor && <span className="apagado"> · {p.puestoPor}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function PanelPrecio({
  slug, tipoId, actual, pendiente, arrancar, onError, onListo,
}: {
  slug: string;
  tipoId: number;
  actual: number;
  pendiente: boolean;
  arrancar: (f: () => void) => void;
  onError: (s: string | null) => void;
  onListo: () => void;
}) {
  const [precio, setPrecio] = useState(String(actual));
  const [cuando, setCuando] = useState<"ahora" | "fecha">("ahora");
  const [desde, setDesde] = useState("");

  function guardar() {
    onError(null);
    arrancar(async () => {
      const r = await ponerPrecio(
        slug, tipoId, Math.round(Number(precio)),
        cuando === "fecha" && desde ? new Date(desde).toISOString() : null
      );
      if (r.ok) onListo();
      else onError(MOTIVOS[r.motivo] ?? r.detalle ?? "No se pudo guardar.");
    });
  }

  return (
    <div className="tipo__panel">
      <div className="formulario">
        <div className="campo">
          <label htmlFor={`p-${tipoId}`}>Precio nuevo</label>
          <input id={`p-${tipoId}`} type="number" min={0} step={100} value={precio}
                 onChange={(e) => setPrecio(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor={`c-${tipoId}`}>Entra en vigencia</label>
          <select id={`c-${tipoId}`} className="campo__select" value={cuando}
                  onChange={(e) => setCuando(e.target.value as "ahora" | "fecha")}>
            <option value="ahora">Ahora mismo</option>
            <option value="fecha">En una fecha</option>
          </select>
        </div>
        {cuando === "fecha" && (
          <div className="campo">
            <label htmlFor={`d-${tipoId}`}>Desde</label>
            <input id={`d-${tipoId}`} type="datetime-local" value={desde}
                   onChange={(e) => setDesde(e.target.value)} />
          </div>
        )}
      </div>
      <div className="ops__botones">
        <button className="boton" disabled={pendiente || (cuando === "fecha" && !desde)} onClick={guardar}>
          {pendiente ? <><Aro />Guardando…</> : cuando === "ahora" ? "Aplicar ahora" : "Programar"}
        </button>
        <button className="boton boton--suave" onClick={onListo}>Volver</button>
      </div>
    </div>
  );
}

function Oferta({
  slug, fila, pendiente, arrancar, onError,
}: {
  slug: string;
  fila: Fila;
  pendiente: boolean;
  arrancar: (f: () => void) => void;
  onError: (s: string | null) => void;
}) {
  function alternar() {
    onError(null);
    arrancar(async () => {
      const r = await guardarOferta(slug, fila.id, {
        nombreDisplay: fila.nombreDisplay || null,
        activo: !fila.activo,
        orden: fila.orden,
      });
      if (!r.ok) {
        onError(
          r.motivo === "SIN_LINEA"
            ? `${fila.nombre}: la planta no tiene ninguna línea de su categoría, así que activarlo lo dejaría sin horarios que ofrecer.`
            : r.detalle ?? "No se pudo guardar."
        );
      }
    });
  }

  return (
    <button className="boton boton--suave boton--chico" disabled={pendiente || (fila.sinLinea && !fila.activo)}
            onClick={alternar}>
      {fila.activo ? "Dejar de ofrecerlo" : "Ofrecerlo"}
    </button>
  );
}
