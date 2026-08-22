"use client";

import { useState, useTransition } from "react";
import Aro from "@/app/aro";
import { EstadoTurno } from "@prisma/client";
import { cobrar, realizar, ausente, cancelar, reprogramar, cuposParaMover, type DiaLibre } from "./acciones";

const MOTIVOS: Record<string, string> = {
  NO_EXISTE: "No se encontró el turno.",
  ESTADO_INVALIDO: "El turno ya no admite esta operación. Actualizá la página.",
  CUPO_TOMADO: "Alguien tomó ese horario recién. Elegí otro.",
  YA_COBRADO: "Este turno ya tiene un pago acreditado.",
  MONTO_INVALIDO: "El monto tiene que ser un número mayor que cero.",
};

const MEDIOS = ["Efectivo", "Débito", "Crédito", "Transferencia"];

type Modo = "nada" | "cobrar" | "reprogramar" | "cancelar";

export default function Operaciones({
  slug, publicId, estado, yaPaso, acreditado, precio, permisos,
}: {
  slug: string;
  publicId: string;
  estado: EstadoTurno;
  yaPaso: boolean;
  acreditado: number;
  precio: number;
  permisos: { cobrar: boolean; realizar: boolean; reprogramar: boolean; cancelar: boolean };
}) {
  const [pendiente, arrancar] = useTransition();
  const [modo, setModo] = useState<Modo>("nada");
  const [error, setError] = useState<string | null>(null);

  const [monto, setMonto] = useState(String(precio));
  const [metodo, setMetodo] = useState(MEDIOS[0]);
  const [motivo, setMotivo] = useState("");

  const [dias, setDias] = useState<DiaLibre[]>([]);
  const [fecha, setFecha] = useState<string | null>(null);
  const [cupo, setCupo] = useState<DiaLibre["horarios"][0] | null>(null);

  const abierto = ([
    EstadoTurno.PENDIENTE_CONFIRMACION,
    EstadoTurno.PENDIENTE_PAGO,
    EstadoTurno.CONFIRMADO,
  ] as EstadoTurno[]).includes(estado);

  const correr = (fn: () => Promise<{ ok: boolean; motivo?: string }>) =>
    arrancar(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) setModo("nada");
      else setError(MOTIVOS[r.motivo ?? ""] ?? "No se pudo completar la operación.");
    });

  function abrirReprogramar() {
    setError(null);
    arrancar(async () => {
      const d = await cuposParaMover(slug, publicId);
      setDias(d);
      setFecha(d[0]?.fecha ?? null);
      setCupo(null);
      setModo("reprogramar");
    });
  }

  // Cobrar solo tiene sentido mientras no haya un pago acreditado. Con uno ya
  // acreditado el botón desaparece: el mostrador no tiene por qué decidir si
  // "esta vez sí" corresponde cobrar de nuevo.
  const puedeCobrar = permisos.cobrar && abierto && acreditado === 0;
  const puedeCerrar = permisos.realizar && estado === EstadoTurno.CONFIRMADO && yaPaso;

  if (!abierto && !puedeCerrar) {
    return <p className="ops__cerrado">Este turno está {estado.toLowerCase()} y no admite más operaciones.</p>;
  }

  const horarios = dias.find((d) => d.fecha === fecha)?.horarios ?? [];

  return (
    <section className="ops">
      <h3 className="ficha__subtitulo">Acciones</h3>
      {error && <p className="ops__error" role="alert">{error}</p>}

      {modo === "nada" && (
        <div className="ops__botones">
          {puedeCobrar && (
            <button className="boton" onClick={() => { setError(null); setModo("cobrar"); }}>
              Registrar pago
            </button>
          )}
          {puedeCerrar && (
            <>
              <button className="boton" disabled={pendiente} onClick={() => correr(() => realizar(slug, publicId))}>
                Marcar como realizado
              </button>
              <button className="boton boton--suave" disabled={pendiente} onClick={() => correr(() => ausente(slug, publicId))}>
                No se presentó
              </button>
            </>
          )}
          {permisos.reprogramar && abierto && (
            <button className="boton boton--suave" disabled={pendiente} onClick={abrirReprogramar}>
              {pendiente ? <><Aro />Buscando…</> : "Cambiar fecha"}
            </button>
          )}
          {permisos.cancelar && abierto && (
            <button className="boton boton--peligro" onClick={() => { setError(null); setModo("cancelar"); }}>
              Cancelar turno
            </button>
          )}
        </div>
      )}

      {modo === "cobrar" && (
        <div className="ops__panel">
          <h4>Registrar un pago cobrado en el mostrador</h4>
          <div className="formulario">
            <div className="campo">
              <label htmlFor="monto">Monto</label>
              <input id="monto" type="number" min={1} step={1} value={monto}
                     onChange={(e) => setMonto(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="metodo">Medio</label>
              <select id="metodo" className="campo__select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                {MEDIOS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="ops__botones">
            <button className="boton" disabled={pendiente}
                    onClick={() => correr(() => cobrar(slug, publicId, { monto: Number(monto), metodo }))}>
              {pendiente ? <><Aro />Registrando…</> : "Registrar el pago"}
            </button>
            <button className="boton boton--suave" onClick={() => setModo("nada")}>Volver</button>
          </div>
        </div>
      )}

      {modo === "cancelar" && (
        <div className="ops__panel">
          <h4>Cancelar el turno</h4>
          <p>El horario queda disponible para otra persona.
            {acreditado > 0 && " Ojo: este turno tiene un pago acreditado, que no se devuelve solo."}
          </p>
          <div className="campo">
            <label htmlFor="motivo">Motivo <span className="campo__ayuda">(queda registrado)</span></label>
            <input id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                   placeholder="Lo pidió el cliente por teléfono" />
          </div>
          <div className="ops__botones">
            <button className="boton boton--peligro" disabled={pendiente}
                    onClick={() => correr(() => cancelar(slug, publicId, motivo || null))}>
              {pendiente ? <><Aro />Cancelando…</> : "Sí, cancelar"}
            </button>
            <button className="boton boton--suave" onClick={() => setModo("nada")}>Volver</button>
          </div>
        </div>
      )}

      {modo === "reprogramar" && (
        <div className="ops__panel">
          <h4>Elegí la nueva fecha</h4>
          {dias.length === 0 ? (
            <p>No hay cupos libres en la ventana de reserva.</p>
          ) : (
            <>
              <div className="formulario">
                <div className="campo">
                  <label htmlFor="dia">Día</label>
                  <select id="dia" className="campo__select" value={fecha ?? ""}
                          onChange={(e) => { setFecha(e.target.value); setCupo(null); }}>
                    {dias.map((d) => (
                      <option key={d.fecha} value={d.fecha}>
                        {d.fecha} — {d.horarios.length} libres
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="horarios">
                {horarios.map((h) => (
                  <button key={`${h.lineaId}-${h.iso}`}
                          className={`hora${cupo?.iso === h.iso && cupo?.lineaId === h.lineaId ? " hora--activa" : ""}`}
                          onClick={() => setCupo(h)}>
                    {h.hhmm}
                  </button>
                ))}
              </div>
              <div className="ops__botones">
                <button className="boton" disabled={!cupo || pendiente}
                        onClick={() => cupo && correr(() => reprogramar(slug, publicId, {
                          lineaId: cupo.lineaId, inicioIso: cupo.iso, duracionMin: cupo.duracionMin,
                        }))}>
                  {pendiente ? <><Aro />Cambiando…</> : "Confirmar la nueva fecha"}
                </button>
                <button className="boton boton--suave" onClick={() => setModo("nada")}>Volver</button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
