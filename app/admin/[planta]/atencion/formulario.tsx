"use client";

import { useState, useTransition } from "react";
import Aro from "@/app/aro";
import { registrar } from "./acciones";

const MOTIVOS: Record<string, string> = {
  DATOS_INVALIDOS: "Falta la patente o el nombre.",
  TIPO_NO_OFRECIDO: "Esta planta no ofrece ese tipo de vehículo.",
  MONTO_INVALIDO: "El monto tiene que ser un número mayor que cero.",
};

const MEDIOS = ["Efectivo", "Débito", "Crédito", "Transferencia"];

export interface Tipo {
  id: number;
  nombre: string;
  precio: number;
}

export default function Formulario({
  slug, tipos, puedeCobrar,
}: {
  slug: string;
  tipos: Tipo[];
  puedeCobrar: boolean;
}) {
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [tipoId, setTipoId] = useState(tipos[0]?.id ?? 0);
  const [dominio, setDominio] = useState("");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [cobra, setCobra] = useState(puedeCobrar);
  const [metodo, setMetodo] = useState(MEDIOS[0]);
  const [monto, setMonto] = useState("");

  const tipo = tipos.find((t) => t.id === tipoId);
  // El precio de lista se propone, pero se puede pisar: hay descuentos,
  // diferencias por convenio y vueltas de revisión que no se cobran igual.
  const montoEfectivo = monto === "" ? String(tipo?.precio ?? "") : monto;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    arrancar(async () => {
      const r = await registrar(slug, {
        dominio, tipoVehiculoId: tipoId, titularNombre: nombre,
        titularEmail: email, titularTelefono: telefono, observaciones,
        cobro: cobra ? { monto: Number(montoEfectivo), metodo } : undefined,
      });
      // Si sale bien, la acción redirige a la ficha y esto no se ejecuta.
      if (!r.ok) setError(r.detalle ?? MOTIVOS[r.motivo] ?? "No se pudo registrar.");
    });
  }

  if (!tipos.length) {
    return <p className="agenda__vacio">Esta planta no tiene tipos de vehículo cargados.</p>;
  }

  return (
    <form className="atencion" onSubmit={enviar}>
      {error && <p className="ops__error" role="alert">{error}</p>}

      <div className="formulario">
        <div className="campo">
          <label htmlFor="dominio">Patente</label>
          <input id="dominio" value={dominio} required autoFocus
                 onChange={(e) => setDominio(e.target.value.toUpperCase())}
                 placeholder="AB123CD" style={{ textTransform: "uppercase" }} />
        </div>

        <div className="campo">
          <label htmlFor="tipo">Tipo de vehículo</label>
          <select id="tipo" className="campo__select" value={tipoId}
                  onChange={(e) => { setTipoId(Number(e.target.value)); setMonto(""); }}>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre} — ${t.precio.toLocaleString("es-AR")}
              </option>
            ))}
          </select>
        </div>

        <div className="campo campo--ancho">
          <label htmlFor="nombre">Nombre del titular</label>
          <input id="nombre" value={nombre} required
                 onChange={(e) => setNombre(e.target.value)} />
        </div>

        <div className="campo">
          <label htmlFor="email">
            Correo <span className="campo__ayuda">(opcional)</span>
          </label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="campo">
          <label htmlFor="telefono">
            Teléfono <span className="campo__ayuda">(opcional)</span>
          </label>
          <input id="telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        </div>

        <div className="campo campo--ancho">
          <label htmlFor="obs">
            Observaciones <span className="campo__ayuda">(opcional)</span>
          </label>
          <input id="obs" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </div>
      </div>

      {puedeCobrar && (
        <div className="atencion__cobro">
          <label className="opcion-check">
            <input type="checkbox" checked={cobra} onChange={(e) => setCobra(e.target.checked)} />
            <span>Cobrar ahora</span>
          </label>

          {cobra && (
            <div className="formulario">
              <div className="campo">
                <label htmlFor="monto">Monto</label>
                <input id="monto" type="number" min={1} step={1} value={montoEfectivo}
                       onChange={(e) => setMonto(e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="medio">Medio</label>
                <select id="medio" className="campo__select" value={metodo}
                        onChange={(e) => setMetodo(e.target.value)}>
                  {MEDIOS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
          )}
          {!cobra && (
            <p className="campo__ayuda">
              Sin cobrar queda impaga y se puede cobrar después desde su ficha.
            </p>
          )}
        </div>
      )}

      <div className="ops__botones">
        <button className="boton" type="submit" disabled={pendiente}>
          {pendiente ? <><Aro />Registrando…</> : cobra ? "Registrar y cobrar" : "Registrar la atención"}
        </button>
      </div>
    </form>
  );
}
