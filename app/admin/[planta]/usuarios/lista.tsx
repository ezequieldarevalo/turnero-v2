"use client";

import { useState, useTransition } from "react";
import Aro from "@/app/aro";
import { Rol } from "@prisma/client";
import { invitar, ponerRol, sacar, nuevaClave } from "./acciones";
import type { UsuarioDePlanta } from "@/lib/gestionUsuarios";

const MOTIVOS: Record<string, string> = {
  CORREO_INVALIDO: "Ese correo no es válido.",
  NOMBRE_INVALIDO: "Poné el nombre de la persona.",
  YA_TIENE_ACCESO: "Esa persona ya tiene acceso a esta planta.",
  ES_SUPERADMIN: "Esa cuenta administra el servicio y ya ve todas las plantas.",
  ULTIMO_DUENO: "Es el único dueño de la planta. Nombrá a otro antes de sacarlo, o quedaría sin nadie que pueda configurarla.",
  VOS_MISMO: "No podés hacerte eso a vos mismo.",
  NO_EXISTE: "No se encontró.",
};

const ROLES: { valor: Rol; texto: string }[] = [
  { valor: Rol.OPERADOR, texto: "Operador" },
  { valor: Rol.DUENO, texto: "Dueño" },
];

export default function Lista({
  slug, usuarios, yo,
}: {
  slug: string;
  usuarios: UsuarioDePlanta[];
  yo: number;
}) {
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clave, setClave] = useState<{ email: string; valor: string } | null>(null);

  const [abierto, setAbierto] = useState(false);
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<Rol>(Rol.OPERADOR);

  const correr = (fn: () => Promise<{ ok: boolean; motivo?: string; detalle?: string; clave?: string }>, quien?: string) =>
    arrancar(async () => {
      setError(null);
      setClave(null);
      const r = await fn();
      if (!r.ok) { setError(r.detalle ?? MOTIVOS[r.motivo ?? ""] ?? "No se pudo completar."); return; }
      if (r.clave && quien) setClave({ email: quien, valor: r.clave });
    });

  const fecha = (d: Date | null) =>
    d ? new Intl.DateTimeFormat("es-AR", { dateStyle: "short" }).format(new Date(d)) : "nunca entró";

  return (
    <>
      {error && <p className="ops__error" role="alert">{error}</p>}

      {clave && (
        <div className="clave-nueva" role="status">
          <p><strong>Contraseña para {clave.email}</strong></p>
          <p className="clave-nueva__valor">{clave.valor}</p>
          <p>
            Pasásela por un canal seguro. <strong>No se vuelve a mostrar</strong> y no
            queda guardada en ningún lado: si se pierde, se genera otra.
          </p>
        </div>
      )}

      <div className="tabla-scroll">
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Correo</th>
              <th scope="col">Rol</th>
              <th scope="col">Último acceso</th>
              <th scope="col"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className={u.activo ? undefined : "fila--apagada"}>
                <td>
                  {u.nombre}
                  {u.id === yo && <span className="apagado"> · vos</span>}
                  {u.otrasPlantas > 0 && (
                    <span className="apagado"> · también en {u.otrasPlantas} planta{u.otrasPlantas > 1 ? "s" : ""}</span>
                  )}
                </td>
                <td>{u.email}</td>
                <td>
                  <select className="celda celda--corta" value={u.rol} disabled={pendiente || u.id === yo}
                          onChange={(e) => correr(() => ponerRol(slug, u.id, e.target.value as Rol))}>
                    {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
                  </select>
                </td>
                <td className="apagado">{fecha(u.ultimoAcceso)}</td>
                <td className="col--accion">
                  {u.id !== yo && (
                    <>
                      <button className="boton boton--suave boton--chico" disabled={pendiente}
                              onClick={() => correr(() => nuevaClave(slug, u.id), u.email)}>
                        Nueva contraseña
                      </button>{" "}
                      <button className="boton boton--suave boton--chico" disabled={pendiente}
                              onClick={() => correr(() => sacar(slug, u.id))}>
                        Sacar acceso
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!abierto ? (
        <div className="ops__botones">
          <button className="boton" onClick={() => { setError(null); setAbierto(true); }}>
            Dar acceso a alguien
          </button>
        </div>
      ) : (
        <div className="ops__panel">
          <h4>Dar acceso</h4>
          <div className="formulario">
            <div className="campo">
              <label htmlFor="nombre">Nombre</label>
              <input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
            </div>
            <div className="campo">
              <label htmlFor="email">Correo</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="rol">Rol</label>
              <select id="rol" className="campo__select" value={rol}
                      onChange={(e) => setRol(e.target.value as Rol)}>
                {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
              </select>
            </div>
          </div>
          <div className="ops__botones">
            <button className="boton" disabled={pendiente || !email || !nombre}
                    onClick={() => correr(async () => {
                      const r = await invitar(slug, { email, nombre, rol });
                      if (r.ok) { setEmail(""); setNombre(""); setAbierto(false); }
                      return r;
                    }, email)}>
              {pendiente ? <><Aro />Guardando…</> : "Dar acceso"}
            </button>
            <button className="boton boton--suave" onClick={() => setAbierto(false)}>Volver</button>
          </div>
        </div>
      )}
    </>
  );
}
