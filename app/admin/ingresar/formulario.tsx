"use client";

import { useActionState } from "react";
import Aro from "@/app/aro";
import { ingresar } from "./acciones";

export default function Formulario({ volver }: { volver?: string }) {
  const [estado, accion, pendiente] = useActionState(ingresar, null);

  return (
    <form action={accion} className="ingresar__form">
      <input type="hidden" name="volver" value={volver ?? ""} />

      <div className="campo">
        <label htmlFor="email">Correo</label>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>

      <div className="campo">
        <label htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>

      {estado?.error && (
        <p className="ingresar__error" role="alert">
          {estado.error}
        </p>
      )}

      <button className="boton" type="submit" disabled={pendiente}>
        {pendiente ? <><Aro />Entrando…</> : "Entrar"}
      </button>
    </form>
  );
}
