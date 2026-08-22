"use client";

import { useState, useTransition, useEffect } from "react";
import Aro from "@/app/aro";
import Cargando from "@/app/cargando";
import { crear, diasConCupos, horariosDelDia, type DiaConCupos, type Horario } from "./acciones";
import type { Tipo } from "../atencion/formulario";

const MOTIVOS: Record<string, string> = {
  DATOS_INVALIDOS: "Falta la patente, el nombre o un correo válido.",
  TIPO_NO_OFRECIDO: "Esta planta no ofrece ese tipo de vehículo.",
  CUPO_TOMADO: "Alguien tomó ese horario recién. Elegí otro.",
};

export default function Formulario({ slug, tipos }: { slug: string; tipos: Tipo[] }) {
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [tipoId, setTipoId] = useState(tipos[0]?.id ?? 0);
  const [dias, setDias] = useState<DiaConCupos[] | null>(null);
  const [fecha, setFecha] = useState<string | null>(null);
  const [horarios, setHorarios] = useState<Horario[] | null>(null);
  const [cupo, setCupo] = useState<Horario | null>(null);

  const [dominio, setDominio] = useState("");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [observaciones, setObservaciones] = useState("");

  // Los días dependen del tipo de vehículo: en Godoy Cruz cada categoría tiene
  // sus propias líneas, así que cambiar de tipo cambia la oferta. Se piden solo
  // los días con su cantidad de libres, no los horarios: eso era un mega de
  // JSON y cuatro segundos de espera para abrir la pantalla.
  useEffect(() => {
    let vigente = true;
    setDias(null);
    setHorarios(null);
    setCupo(null);
    diasConCupos(slug, tipoId).then((d) => {
      if (!vigente) return;
      setDias(d);
      setFecha(d[0]?.fecha ?? null);
    });
    return () => { vigente = false; };
  }, [slug, tipoId]);

  // Las horas del día elegido, recién cuando hay día.
  useEffect(() => {
    if (!fecha) { setHorarios(null); return; }
    let vigente = true;
    setHorarios(null);
    setCupo(null);
    horariosDelDia(slug, tipoId, fecha).then((h) => { if (vigente) setHorarios(h); });
    return () => { vigente = false; };
  }, [slug, tipoId, fecha]);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!cupo) return;
    setError(null);
    arrancar(async () => {
      const r = await crear(slug, {
        lineaId: cupo.lineaId, inicioIso: cupo.iso, duracionMin: cupo.duracionMin,
        tipoVehiculoId: tipoId, dominio, titularNombre: nombre,
        titularEmail: email, titularTelefono: telefono, observaciones,
      });
      if (!r.ok) setError(r.detalle ?? MOTIVOS[r.motivo] ?? "No se pudo crear el turno.");
    });
  }

  if (!tipos.length) {
    return <p className="agenda__vacio">Esta planta no tiene tipos de vehículo cargados.</p>;
  }

  return (
    <form className="atencion" onSubmit={enviar}>
      {error && <p className="ops__error" role="alert">{error}</p>}

      {dias === null && <Cargando texto="Buscando los días con cupo…" />}

      <div className="formulario">
        <div className="campo">
          <label htmlFor="tipo">Tipo de vehículo</label>
          <select id="tipo" className="campo__select" value={tipoId}
                  onChange={(e) => setTipoId(Number(e.target.value))}>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre} — ${t.precio.toLocaleString("es-AR")}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="dia">Día</label>
          <select id="dia" className="campo__select" value={fecha ?? ""} disabled={!dias?.length}
                  onChange={(e) => setFecha(e.target.value)}>
            {dias === null && <option>Buscando días con cupo…</option>}
            {dias?.length === 0 && <option>Sin cupos disponibles</option>}
            {dias?.map((d) => (
              <option key={d.fecha} value={d.fecha}>{d.fecha} — {d.libres} libres</option>
            ))}
          </select>
        </div>
      </div>

      {fecha && horarios === null && <Cargando texto="Buscando horarios de ese día…" chico />}

      {horarios !== null && horarios.length > 0 && (
        <div className="telefono__horarios">
          <span className="campo__ayuda">Elegí la hora</span>
          <div className="horarios">
            {horarios.map((h) => (
              <button type="button" key={`${h.lineaId}-${h.iso}`}
                      className={`hora${cupo?.iso === h.iso && cupo?.lineaId === h.lineaId ? " hora--activa" : ""}`}
                      onClick={() => setCupo(h)}>
                {h.hhmm}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="formulario">
        <div className="campo">
          <label htmlFor="dominio">Patente</label>
          <input id="dominio" value={dominio} required
                 onChange={(e) => setDominio(e.target.value.toUpperCase())}
                 placeholder="AB123CD" style={{ textTransform: "uppercase" }} />
        </div>
        <div className="campo">
          <label htmlFor="telefono">
            Teléfono <span className="campo__ayuda">(opcional)</span>
          </label>
          <input id="telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        </div>
        <div className="campo campo--ancho">
          <label htmlFor="nombre">Nombre del titular</label>
          <input id="nombre" value={nombre} required onChange={(e) => setNombre(e.target.value)} />
        </div>
        <div className="campo campo--ancho">
          <label htmlFor="email">
            Correo <span className="campo__ayuda">(a esta dirección se le manda la confirmación)</span>
          </label>
          <input id="email" type="email" value={email} required
                 onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="campo campo--ancho">
          <label htmlFor="obs">
            Observaciones <span className="campo__ayuda">(opcional)</span>
          </label>
          <input id="obs" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </div>
      </div>

      <div className="ops__botones">
        <button className="boton" type="submit" disabled={!cupo || pendiente}>
          {pendiente ? <><Aro />Reservando…</> : "Reservar y mandar la confirmación"}
        </button>
      </div>
      {!cupo && dias?.length ? (
        <p className="campo__ayuda">Elegí un horario para continuar.</p>
      ) : null}
    </form>
  );
}
