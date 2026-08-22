"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { detectarCampo, ETIQUETA_CAMPO } from "@/lib/buscar";

export default function Caja({ slug, inicial }: { slug: string; inicial: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState(inicial);

  const listo = texto.trim().length >= 3;
  // Se muestra qué se va a buscar antes de buscar: así, si alguien tipea una
  // patente con un error y el sistema la toma como nombre, se ve en el momento
  // en vez de después, con una lista vacía y sin explicación.
  const campo = listo ? ETIQUETA_CAMPO[detectarCampo(texto.trim())] : null;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (listo) router.push(`/admin/${slug}/buscar?q=${encodeURIComponent(texto.trim())}`);
  }

  return (
    <form className="buscar__form" onSubmit={enviar} role="search">
      <input
        className="buscar__campo"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="AB123CD · 4F2A9C10 · Pérez · 2615551234"
        aria-label="Patente, número de turno, nombre, correo o teléfono"
        autoFocus
      />
      <button className="boton" type="submit" disabled={!listo}>Buscar</button>
      {campo && <span className="buscar__campo-detectado">Buscando por {campo}</span>}
    </form>
  );
}
