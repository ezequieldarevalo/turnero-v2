"use client";

import Link from "next/link";
import Aro from "@/app/aro";
import { useState, useTransition } from "react";
import { resolver } from "./acciones";

const MOTIVOS: Record<string, string> = {
  NO_EXISTE: "Este caso ya fue resuelto por otra persona. Actualizá la página.",
  SIN_NOTA: "Escribí qué se hizo: sin eso, marcarlo como resuelto solo lo esconde.",
};

export interface CasoVista {
  id: number;
  paymentId: string;
  proveedor: string;
  estado: string;
  montoTexto: string;
  metodo: string | null;
  cuando: string;
  motivo: string;
  turno: { publicId: string; codigo: string; dominio: string; estado: string } | null;
}

export default function Caso({ slug, caso }: { slug: string; caso: CasoVista }) {
  const [pendiente, arrancar] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);

  function enviar() {
    setError(null);
    arrancar(async () => {
      const r = await resolver(slug, caso.id, nota);
      if (!r.ok) setError(MOTIVOS[r.motivo] ?? "No se pudo guardar.");
    });
  }

  return (
    <article className="caso">
      <header className="caso__cabecera">
        <div>
          <span className="caso__monto">{caso.montoTexto}</span>
          <span className="caso__medio">
            {caso.metodo ?? caso.proveedor} · {caso.estado} · {caso.cuando}
          </span>
        </div>
        <span className="caso__ref">{caso.paymentId}</span>
      </header>

      <p className="caso__motivo">{caso.motivo}</p>

      {caso.turno ? (
        <p className="caso__turno">
          Turno{" "}
          <Link className="enlace" href={`/admin/${slug}/turno/${caso.turno.publicId}`}>
            {caso.turno.codigo} · {caso.turno.dominio}
          </Link>{" "}
          — hoy está {caso.turno.estado.toLowerCase()}.
        </p>
      ) : (
        <p className="caso__turno apagado">
          No hay ningún turno asociado. Buscá la patente o el nombre en MercadoPago
          para saber de quién es.
        </p>
      )}

      {!abierto ? (
        <button className="boton boton--suave boton--chico" onClick={() => setAbierto(true)}>
          Marcar como resuelto
        </button>
      ) : (
        <div className="caso__resolver">
          {error && <p className="ops__error" role="alert">{error}</p>}
          <div className="campo">
            <label htmlFor={`nota-${caso.id}`}>
              ¿Qué se hizo? <span className="campo__ayuda">(queda registrado con tu nombre)</span>
            </label>
            <input id={`nota-${caso.id}`} value={nota} onChange={(e) => setNota(e.target.value)}
                   placeholder="Se devolvió por MercadoPago el 16/8" autoFocus />
          </div>
          <div className="ops__botones">
            <button className="boton" disabled={pendiente} onClick={enviar}>
              {pendiente ? <><Aro />Guardando…</> : "Guardar"}
            </button>
            <button className="boton boton--suave" onClick={() => setAbierto(false)}>Volver</button>
          </div>
        </div>
      )}
    </article>
  );
}
