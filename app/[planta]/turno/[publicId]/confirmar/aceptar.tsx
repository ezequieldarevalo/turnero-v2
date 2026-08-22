"use client";

import { useState, useTransition } from "react";
import Aro from "@/app/aro";
import { confirmar } from "./acciones";

const MOTIVOS: Record<string, string> = {
  SIN_CONSENTIMIENTO: "Para confirmar hace falta que aceptes el tratamiento de tus datos.",
  NO_EXISTE: "No encontramos el turno.",
  ESTADO_INVALIDO: "Este turno ya no está esperando confirmación.",
  VENCIDO: "Se venció el plazo y el horario quedó disponible para otra persona.",
};

export default function Aceptar({
  slug, publicId, requierePago, politica,
}: {
  slug: string;
  publicId: string;
  requierePago: boolean;
  politica: { id: number; version: string; texto: string } | null;
}) {
  const [pendiente, arrancar] = useTransition();
  const [acepta, setAcepta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  function enviar() {
    setError(null);
    arrancar(async () => {
      const r = await confirmar(slug, publicId, acepta);
      if (!r.ok) {
        setError(MOTIVOS[r.motivo] ?? "No pudimos confirmar el turno.");
        return;
      }
      // Con pago, se va derecho al checkout. Sin pago, el turno ya está listo.
      if (r.urlPago) window.location.href = r.urlPago;
      else setListo(true);
    });
  }

  if (listo) {
    return (
      <div className="aviso" style={{ marginTop: 20 }}>
        <p className="destacado">Listo, tu turno está confirmado.</p>
        <p>Te mandamos un correo con todos los datos. Te esperamos.</p>
      </div>
    );
  }

  return (
    <div className="confirmar">
      {error && <p className="ops__error" role="alert">{error}</p>}

      <label className="opcion-check">
        <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
        <span>
          Acepto que se traten mis datos personales para gestionar este turno
          {politica && (
            <>
              , según la{" "}
              <a href={`/${slug}/privacidad`} target="_blank" rel="noreferrer">
                política de privacidad
              </a>{" "}
              vigente ({politica.version})
            </>
          )}
          .
        </span>
      </label>

      <button className="boton" onClick={enviar} disabled={!acepta || pendiente}>
        {pendiente
          ? <><Aro />Confirmando…</>
          : requierePago
            ? "Confirmar e ir a pagar"
            : "Confirmar mi turno"}
      </button>

      {requierePago && (
        <p className="campo__ayuda">
          Al confirmar vas a MercadoPago. Si cerrás la ventana, el link de pago también
          te llega por correo.
        </p>
      )}
    </div>
  );
}
