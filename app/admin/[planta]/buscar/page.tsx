import Link from "next/link";
import { requerirPlanta } from "@/lib/sesionActual";
import { buscarTurnos, ETIQUETA_CAMPO } from "@/lib/buscar";
import { ETIQUETA_ESTADO } from "@/lib/agenda";
import { fechaLocal, hhmm } from "@/lib/fechas";
import Marco from "../marco";
import Caja from "./caja";

export const dynamic = "force-dynamic";

const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

export default async function Buscar({
  params, searchParams,
}: {
  params: Promise<{ planta: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "turno.buscar");
  const { planta } = acceso;

  const q = (await searchParams).q ?? "";
  const busqueda = q.trim().length >= 3 ? await buscarTurnos(planta, q) : null;

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("es-AR", {
      timeZone: planta.timezone, day: "2-digit", month: "2-digit", year: "numeric",
    }).format(d);

  return (
    <Marco acceso={acceso} activo="buscar">
      <h2 className="buscar__titulo">Buscar un turno</h2>
      <p className="buscar__ayuda">
        Escribí la patente, el número de turno, el nombre, el correo o el teléfono.
        No hace falta elegir cuál: se reconoce solo.
      </p>

      <Caja slug={slug} inicial={q} />

      {busqueda && (
        <>
          <p className="buscar__resumen">
            {busqueda.total === 0 ? (
              <>Sin resultados para <strong>{busqueda.consulta}</strong> como {ETIQUETA_CAMPO[busqueda.campo]}.</>
            ) : (
              <>
                {busqueda.total} {busqueda.total === 1 ? "turno" : "turnos"} para{" "}
                <strong>{busqueda.consulta}</strong> como {ETIQUETA_CAMPO[busqueda.campo]}
                {busqueda.resultados.length < busqueda.total &&
                  ` — se muestran los ${busqueda.resultados.length} más recientes`}
                .
              </>
            )}
          </p>

          {busqueda.total === 0 ? (
            <p className="buscar__sugerencia">
              Si la persona sacó el turno en otra planta, no va a aparecer acá. Probá
              también con una parte del dato: escribiendo <code>PEREZ</code> aparecen
              todos los apellidos que lo contengan.
            </p>
          ) : (
            <div className="tabla-scroll">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col" className="col--num">Hora</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Dominio</th>
                    <th scope="col">Nombre</th>
                    <th scope="col">Vehículo</th>
                    <th scope="col" className="col--num">Cobrado</th>
                    <th scope="col"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {busqueda.resultados.map((r) => (
                    <tr key={r.publicId}>
                      <td>
                        <Link className="enlace" href={`/admin/${slug}?dia=${fechaLocal(r.inicio, planta.timezone)}`}>
                          {fmt(r.inicio)}
                        </Link>
                      </td>
                      <td className="col--num">{hhmm(r.inicio, planta.timezone)}</td>
                      <td>
                        <span className={`pastilla pastilla--${r.estado.toLowerCase()}`}>
                          {ETIQUETA_ESTADO[r.estado]}
                        </span>
                      </td>
                      <td className="col--dominio">{r.dominio}</td>
                      <td>{r.titularNombre}</td>
                      <td>{r.tipoVehiculo}</td>
                      <td className="col--num">
                        {r.cobrado !== null ? pesos(r.cobrado) : <span className="apagado">—</span>}
                      </td>
                      <td className="col--accion">
                        <Link className="enlace" href={`/admin/${slug}/turno/${r.publicId}`}>Ver</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Marco>
  );
}
