import { requerirPlanta } from "@/lib/sesionActual";
import { facturacion, ocupacion, actividad, periodosSugeridos } from "@/lib/reportes";
import { hoyLocal, fechaLarga } from "@/lib/fechas";
import Marco from "../marco";
import Selector from "./selector";
import Barras from "./barras";

export const dynamic = "force-dynamic";

const pesos = (n: number) => "$" + n.toLocaleString("es-AR");
const numero = (n: number) => n.toLocaleString("es-AR");

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const mesLargo = (clave: string) => {
  const [a, m] = clave.split("-");
  return `${MESES[Number(m) - 1]} ${a}`;
};

export default async function Reportes({
  params, searchParams,
}: {
  params: Promise<{ planta: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "reportes.ver");
  const { planta } = acceso;

  const sugeridos = periodosSugeridos(planta.timezone);
  const q = await searchParams;
  const valida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const periodo = valida(q.desde) && valida(q.hasta)
    ? { desde: q.desde!, hasta: q.hasta!, etiqueta: "período elegido" }
    : sugeridos[0];

  const [fact, ocup, act] = await Promise.all([
    facturacion(planta, periodo),
    ocupacion(planta, periodo),
    actividad(planta, periodo),
  ]);

  const sinCorte = ocup.diasDelPeriodo - ocup.diasConDato;

  return (
    <Marco acceso={acceso} activo="reportes">
      <h2 className="buscar__titulo">Reportes</h2>
      <Selector slug={slug} periodo={periodo} sugeridos={sugeridos} hoy={hoyLocal(planta.timezone)} />

      <p className="reporte__periodo">
        Del {fechaLarga(periodo.desde, planta.timezone).toLowerCase()} al{" "}
        {fechaLarga(periodo.hasta, planta.timezone).toLowerCase()}.
      </p>

      {/* ── Facturación ── */}
      <h3 className="ficha__subtitulo">Facturación</h3>
      <div className="resumen">
        <div className="resumen__dato">
          <span className="resumen__numero">{pesos(fact.total)}</span>
          <span className="resumen__etiqueta">cobrado</span>
        </div>
        <div className="resumen__dato">
          <span className="resumen__numero">{numero(fact.cantidad)}</span>
          <span className="resumen__etiqueta">{fact.cantidad === 1 ? "pago" : "pagos"}</span>
        </div>
        <div className="resumen__dato">
          <span className="resumen__numero">{pesos(fact.promedio)}</span>
          <span className="resumen__etiqueta">promedio por pago</span>
        </div>
      </div>
      <p className="campo__ayuda" style={{ marginBottom: 18 }}>
        Sale de los pagos acreditados, no del precio de lista ni de la cantidad de
        turnos: es la plata que efectivamente entró.
      </p>

      {fact.cantidad === 0 ? (
        <p className="apagado">No hay pagos acreditados en este período.</p>
      ) : (
        <>
          {fact.porMes.length > 1 && (
            <Barras titulo="Por mes"
                    filas={fact.porMes.map((m) => ({
                      etiqueta: mesLargo(m.clave), valor: m.monto, detalle: `${numero(m.cantidad)} pagos`,
                      texto: pesos(m.monto),
                    }))} />
          )}
          <div className="reporte__par">
            <Barras titulo="Por medio de pago"
                    filas={fact.porMedio.map((m) => ({
                      etiqueta: m.clave, valor: m.monto, detalle: `${numero(m.cantidad)} pagos`,
                      texto: pesos(m.monto),
                    }))} />
            <Barras titulo="Por tipo de vehículo"
                    filas={fact.porTipo.map((t) => ({
                      etiqueta: t.clave, valor: t.monto, detalle: `${numero(t.cantidad)} pagos`,
                      texto: pesos(t.monto),
                    }))} />
          </div>
        </>
      )}

      {/* ── Ocupación ── */}
      <h3 className="ficha__subtitulo">Ocupación</h3>
      {ocup.ofrecidos === 0 ? (
        <p className="apagado">
          No hay cortes de ocupación guardados en este período. El corte lo hace el
          proceso diario y no se puede reconstruir hacia atrás.
        </p>
      ) : (
        <>
          <div className="resumen">
            <div className="resumen__dato">
              <span className="resumen__numero">{ocup.porcentaje}%</span>
              <span className="resumen__etiqueta">de la capacidad vendida</span>
            </div>
            <div className="resumen__dato">
              <span className="resumen__numero">{numero(ocup.vendidos)}</span>
              <span className="resumen__etiqueta">cupos vendidos</span>
            </div>
            <div className="resumen__dato">
              <span className="resumen__numero">{numero(ocup.ofrecidos - ocup.vendidos)}</span>
              <span className="resumen__etiqueta">quedaron libres</span>
            </div>
          </div>

          {sinCorte > 0 && (
            <p className="campo__ayuda" style={{ marginBottom: 18 }}>
              {ocup.diasConDato} de los {ocup.diasDelPeriodo} días del período tienen corte
              guardado. Los otros {sinCorte} no aparecen: la capacidad de un día pasado no
              se puede recalcular, porque la disponibilidad se deriva de la configuración
              vigente y esa cambia.
            </p>
          )}

          {ocup.porMes.length > 1 && (
            <Barras titulo="Por mes"
                    filas={ocup.porMes.map((m) => ({
                      etiqueta: mesLargo(m.clave), valor: m.ofrecidos ? m.vendidos / m.ofrecidos : 0,
                      detalle: `${numero(m.vendidos)} de ${numero(m.ofrecidos)}`,
                      texto: `${m.ofrecidos ? Math.round((m.vendidos / m.ofrecidos) * 100) : 0}%`,
                    }))} />
          )}
          <Barras titulo="Por línea"
                  filas={ocup.porLinea.map((l) => ({
                    etiqueta: l.clave, valor: l.ofrecidos ? l.vendidos / l.ofrecidos : 0,
                    detalle: `${numero(l.vendidos)} de ${numero(l.ofrecidos)}`,
                    texto: `${l.ofrecidos ? Math.round((l.vendidos / l.ofrecidos) * 100) : 0}%`,
                  }))} />
        </>
      )}

      {/* ── Actividad ── */}
      <h3 className="ficha__subtitulo">Turnos</h3>
      {act.total === 0 ? (
        <p className="apagado">No hubo turnos en este período.</p>
      ) : (
        <div className="reporte__par">
          <Barras titulo="Cómo terminaron"
                  filas={act.porEstado.map((e) => ({
                    etiqueta: e.clave, valor: e.cantidad, texto: numero(e.cantidad),
                    detalle: `${Math.round((e.cantidad / act.total) * 100)}%`,
                  }))} />
          <Barras titulo="Por dónde entraron"
                  filas={act.porOrigen.map((o) => ({
                    etiqueta: o.clave, valor: o.cantidad, texto: numero(o.cantidad),
                    detalle: `${Math.round((o.cantidad / act.total) * 100)}%`,
                  }))} />
        </div>
      )}
    </Marco>
  );
}
