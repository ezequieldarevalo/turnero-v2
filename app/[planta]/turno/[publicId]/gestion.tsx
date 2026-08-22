"use client";

import { useState, useTransition } from "react";
import Aro from "@/app/aro";
import Calendario from "@/app/[planta]/calendario";
import { disponibilidadParaMover, cancelarTurno, reprogramarTurno } from "./acciones";
import type { DiaSerializado } from "@/app/[planta]/acciones";

const fechaLarga = (f: string) =>
  new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${f}T12:00:00Z`))
    .replace(/^\w/, (c) => c.toUpperCase());

const MOTIVOS: Record<string, string> = {
  NO_EXISTE: "No encontramos el turno.",
  ESTADO_INVALIDO: "El turno ya no admite cambios.",
  NO_PERMITIDO: "Esta planta no permite hacerlo desde acá. Comunicate con ellos.",
  FUERA_DE_PLAZO: "Ya pasó el plazo para hacerlo.",
  TOPE_REPROGRAMACIONES: "Alcanzaste el máximo de cambios de fecha permitidos.",
  CUPO_TOMADO: "Alguien tomó ese horario mientras elegías. Probá con otro.",
};

export default function Gestion({
  slug, publicId, puedeCancelar, puedeReprogramar,
}: {
  slug: string; publicId: string; puedeCancelar: boolean; puedeReprogramar: boolean;
}) {
  const [pendiente, arrancar] = useTransition();
  const [modo, setModo] = useState<"nada" | "cancelar" | "reprogramar">("nada");
  const [dias, setDias] = useState<DiaSerializado[]>([]);
  const [fecha, setFecha] = useState<string | null>(null);
  const [cupo, setCupo] = useState<DiaSerializado["horarios"][0] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const horarios = dias.find((d) => d.fecha === fecha)?.horarios ?? [];

  function abrirReprogramar() {
    setError(null);
    arrancar(async () => {
      const d = await disponibilidadParaMover(slug, publicId);
      setDias(d);
      setFecha(d[0]?.fecha ?? null);
      setCupo(null);
      setModo("reprogramar");
    });
  }

  function confirmarCancelar() {
    arrancar(async () => {
      const r = await cancelarTurno(slug, publicId);
      if (!r.ok) { setError(MOTIVOS[r.motivo] ?? "No pudimos cancelarlo."); setModo("nada"); }
    });
  }

  function confirmarReprogramar() {
    if (!cupo) return;
    arrancar(async () => {
      const r = await reprogramarTurno(slug, publicId, {
        lineaId: cupo.lineaId, inicioIso: cupo.iso, duracionMin: cupo.duracionMin,
      });
      if (r.ok) setModo("nada");
      else setError(MOTIVOS[r.motivo] ?? "No pudimos cambiar la fecha.");
    });
  }

  if (!puedeCancelar && !puedeReprogramar) return null;

  return (
    <section className="gestion">
      {error && <p className="gestion__error">{error}</p>}

      {modo === "nada" && (
        <div className="gestion__botones">
          {puedeReprogramar && (
            <button className="boton" onClick={abrirReprogramar} disabled={pendiente}>
              {pendiente ? <><Aro />Buscando…</> : "Cambiar la fecha"}
            </button>
          )}
          {puedeCancelar && (
            <button className="boton boton--suave" onClick={() => { setError(null); setModo("cancelar"); }}>
              Cancelar el turno
            </button>
          )}
        </div>
      )}

      {modo === "cancelar" && (
        <div className="gestion__panel">
          <h3>¿Seguro que querés cancelar?</h3>
          <p>El horario queda disponible para otra persona y no se puede deshacer.</p>
          <div className="gestion__botones">
            <button className="boton boton--peligro" onClick={confirmarCancelar} disabled={pendiente}>
              {pendiente ? <><Aro />Cancelando…</> : "Sí, cancelar el turno"}
            </button>
            <button className="boton boton--suave" onClick={() => setModo("nada")}>
              No, volver
            </button>
          </div>
        </div>
      )}

      {modo === "reprogramar" && (
        <div className="gestion__panel">
          <h3>Elegí la nueva fecha</h3>
          {dias.length === 0 ? (
            <p>No hay horarios disponibles por el momento.</p>
          ) : (
            <>
              <div className="selector">
                <Calendario
                  fechasDisponibles={new Set(dias.map((d) => d.fecha))}
                  seleccionada={fecha}
                  alSeleccionar={(f) => { setFecha(f); setCupo(null); }}
                />
                <div className="selector__horas">
                  <h3 className="selector__subtitulo">
                    {fecha ? `Horarios del ${fechaLarga(fecha).toLowerCase()}` : "Elegí un día"}
                  </h3>
                  <div className="horarios">
                    {horarios.map((h) => (
                      <button key={h.iso} className={`hora${cupo?.iso === h.iso ? " hora--activa" : ""}`}
                              onClick={() => setCupo(h)}>
                        {h.hhmm}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="gestion__botones">
                <button className="boton" disabled={!cupo || pendiente} onClick={confirmarReprogramar}>
                  {pendiente ? <><Aro />Cambiando…</> : "Confirmar la nueva fecha"}
                </button>
                <button className="boton boton--suave" onClick={() => setModo("nada")}>
                  Volver
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
