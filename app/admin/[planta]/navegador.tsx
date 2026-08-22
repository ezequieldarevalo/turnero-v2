"use client";

import { useRouter } from "next/navigation";

/**
 * Movimiento entre días.
 *
 * Las flechas saltan al día con turnos más cercano, no al siguiente del
 * calendario: en temporada baja puede haber una semana entera vacía y avanzar
 * de a un día es tedioso. El campo de fecha queda para ir a cualquier día,
 * tenga turnos o no.
 */
export default function Navegador({
  slug, fecha, hoy, conTurnos,
}: {
  slug: string;
  fecha: string;
  hoy: string;
  conTurnos: string[];
}) {
  const router = useRouter();
  const ir = (f: string) => router.push(f === hoy ? `/admin/${slug}` : `/admin/${slug}?dia=${f}`);

  const anterior = [...conTurnos].reverse().find((f) => f < fecha);
  const siguiente = conTurnos.find((f) => f > fecha);

  return (
    <div className="navegador">
      <button
        className="navegador__flecha"
        onClick={() => anterior && ir(anterior)}
        disabled={!anterior}
        title={anterior ? `Ir al ${anterior}` : "No hay días con turnos antes de este"}
        aria-label="Día anterior con turnos"
      >
        ‹
      </button>

      <input
        className="navegador__fecha"
        type="date"
        value={fecha}
        onChange={(e) => e.target.value && ir(e.target.value)}
        aria-label="Ir a una fecha"
      />

      <button
        className="navegador__flecha"
        onClick={() => siguiente && ir(siguiente)}
        disabled={!siguiente}
        title={siguiente ? `Ir al ${siguiente}` : "No hay días con turnos después de este"}
        aria-label="Día siguiente con turnos"
      >
        ›
      </button>

      {fecha !== hoy && (
        <button className="boton boton--suave boton--chico" onClick={() => ir(hoy)}>
          Hoy
        </button>
      )}
    </div>
  );
}
