import { requerirPlanta } from "@/lib/sesionActual";
import { pagosARevisar, atencionesSinCobrar } from "@/lib/revision";
import Link from "next/link";
import { fechaLocal, fechaLarga, hhmm } from "@/lib/fechas";
import Marco from "../marco";
import Caso from "./caso";

export const dynamic = "force-dynamic";

const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

export default async function Pagos({
  params,
}: {
  params: Promise<{ planta: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "pagos.revisar");
  const { planta } = acceso;

  const [casos, sinCobrar] = await Promise.all([
    pagosARevisar(planta.id),
    atencionesSinCobrar(planta),
  ]);
  const total = casos.reduce((a, c) => a + c.monto, 0);
  const adeudado = sinCobrar.reduce((a, c) => a + (c.precio ?? 0), 0);

  return (
    <Marco acceso={acceso} activo="pagos">
      <h2 className="buscar__titulo">Pagos a revisar</h2>
      <p className="buscar__ayuda">
        Plata que entró y que el sistema no puede aplicar solo: o llegó sin turno que
        le corresponda, o llegó sobre un turno que ya estaba cancelado o vencido. En
        ninguno de los dos casos se revive el turno por las suyas — el horario puede
        tenerlo otra persona.
      </p>

      {casos.length === 0 ? (
        <p className="apagado" style={{ marginBottom: 28 }}>
          No hay ningún pago esperando revisión.
        </p>
      ) : (
        <>
          <div className="resumen">
            <div className="resumen__dato resumen__dato--alerta">
              <span className="resumen__numero">{casos.length}</span>
              <span className="resumen__etiqueta">{casos.length === 1 ? "caso" : "casos"}</span>
            </div>
            <div className="resumen__dato">
              <span className="resumen__numero">{pesos(total)}</span>
              <span className="resumen__etiqueta">en juego</span>
            </div>
          </div>

          <ul className="casos">
            {casos.map((c) => (
              <li key={c.id}>
                <Caso
                  slug={slug}
                  caso={{
                    ...c,
                    cuando: c.fechaPago
                      ? `${fechaLarga(fechaLocal(c.fechaPago, planta.timezone), planta.timezone)} ${hhmm(c.fechaPago, planta.timezone)} hs`
                      : "sin fecha de acreditación",
                    montoTexto: pesos(c.monto),
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="buscar__titulo" style={{ marginTop: 36 }}>Atenciones sin cobrar</h2>
      <p className="buscar__ayuda">
        Gente que se atendió sin turno previo y quedó impaga. No vencen solas —la
        persona vino y la atendieron, no hay cupo que liberar— y pasado su día
        desaparecen de la agenda, así que se juntan acá hasta que se cobren o se
        cancelen.
      </p>

      {sinCobrar.length === 0 ? (
        <p className="apagado">No hay ninguna atención sin cobrar.</p>
      ) : (
        <>
          <div className="resumen">
            <div className="resumen__dato resumen__dato--alerta">
              <span className="resumen__numero">{sinCobrar.length}</span>
              <span className="resumen__etiqueta">
                {sinCobrar.length === 1 ? "atención" : "atenciones"}
              </span>
            </div>
            <div className="resumen__dato">
              <span className="resumen__numero">{pesos(adeudado)}</span>
              <span className="resumen__etiqueta">sin cobrar</span>
            </div>
          </div>

          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Cuándo</th>
                  <th scope="col" className="col--num">Antigüedad</th>
                  <th scope="col">Dominio</th>
                  <th scope="col">Nombre</th>
                  <th scope="col">Vehículo</th>
                  <th scope="col" className="col--num">Importe</th>
                  <th scope="col">Cargada por</th>
                  <th scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {sinCobrar.map((a) => (
                  <tr key={a.publicId} className="fila--impaga">
                    <td>
                      {fechaLarga(fechaLocal(a.inicio, planta.timezone), planta.timezone)}{" "}
                      {hhmm(a.inicio, planta.timezone)}
                    </td>
                    <td className="col--num">
                      {a.dias === 0 ? "hoy" : `${a.dias} ${a.dias === 1 ? "día" : "días"}`}
                    </td>
                    <td className="col--dominio">{a.dominio}</td>
                    <td>{a.titularNombre}</td>
                    <td>{a.tipoVehiculo}</td>
                    <td className="col--num">
                      {a.precio !== null ? pesos(a.precio) : <span className="apagado">—</span>}
                    </td>
                    <td className="apagado">{a.cargadaPor ?? "—"}</td>
                    <td className="col--accion">
                      <Link className="enlace" href={`/admin/${slug}/turno/${a.publicId}`}>
                        Cobrar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Marco>
  );
}
