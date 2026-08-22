"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Periodo } from "@/lib/reportes";

export default function Selector({
  slug, periodo, sugeridos, hoy,
}: {
  slug: string;
  periodo: Periodo;
  sugeridos: Periodo[];
  hoy: string;
}) {
  const router = useRouter();
  const [desde, setDesde] = useState(periodo.desde);
  const [hasta, setHasta] = useState(periodo.hasta);

  const ir = (d: string, h: string) =>
    router.push(`/admin/${slug}/reportes?desde=${d}&hasta=${h}`);

  return (
    <div className="reporte__selector">
      <div className="subnav">
        {sugeridos.map((p) => (
          <button key={p.etiqueta}
                  className={`subnav__item${p.desde === periodo.desde && p.hasta === periodo.hasta ? " subnav__item--activo" : ""}`}
                  onClick={() => ir(p.desde, p.hasta)}>
            {p.etiqueta}
          </button>
        ))}
      </div>
      <div className="reporte__rango">
        <input type="date" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)}
               aria-label="Desde" />
        <span className="apagado">a</span>
        <input type="date" value={hasta} max={hoy} onChange={(e) => setHasta(e.target.value)}
               aria-label="Hasta" />
        <button className="boton boton--suave boton--chico"
                disabled={!desde || !hasta || desde > hasta}
                onClick={() => ir(desde, hasta)}>
          Ver
        </button>
      </div>
    </div>
  );
}
