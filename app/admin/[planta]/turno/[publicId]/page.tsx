import Link from "next/link";
import { notFound } from "next/navigation";
import { EstadoTurno } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requerirPlanta } from "@/lib/sesionActual";
import { ETIQUETA_ESTADO } from "@/lib/agenda";
import { codigoCorto } from "@/lib/codigo";
import { precioVigente } from "@/lib/precios";
import { fechaLocal, fechaLarga, hhmm } from "@/lib/fechas";
import Marco from "../../marco";
import Operaciones from "./operaciones";

export const dynamic = "force-dynamic";

const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

export default async function Ficha({
  params,
}: {
  params: Promise<{ planta: string; publicId: string }>;
}) {
  const { planta: slug, publicId } = await params;
  const acceso = await requerirPlanta(slug, "agenda.ver");
  const { planta, puede } = acceso;

  const turno = await prisma.turno.findFirst({
    where: { publicId, plantaId: planta.id },
    include: {
      tipo: true,
      linea: { include: { categoria: true } },
      pagos: { orderBy: { creadoAt: "asc" } },
      creadoPor: { select: { nombre: true } },
    },
  });
  if (!turno) notFound();

  const oferta = await prisma.plantaTipoVehiculo.findUnique({
    where: { plantaId_tipoVehiculoId: { plantaId: planta.id, tipoVehiculoId: turno.tipoVehiculoId } },
  });
  // El precio que regía cuando se reservó este turno, no el de hoy: si hubo un
  // aumento en el medio, cobrarle el nuevo sería cambiarle el trato.
  const precioTurno = await precioVigente(planta.id, turno.tipoVehiculoId, turno.creadoAt);

  const acreditado = turno.pagos
    .filter((p) => p.estado === "approved")
    .reduce((a, p) => a + p.monto, 0);

  const fecha = fechaLocal(turno.inicio, planta.timezone);
  const yaPaso = turno.inicio < new Date();

  const datos: [string, React.ReactNode][] = [
    ["Estado", <span className={`pastilla pastilla--${turno.estado.toLowerCase()}`}>{ETIQUETA_ESTADO[turno.estado]}</span>],
    ["Número", codigoCorto(turno.publicId)],
    ["Fecha", <Link className="enlace" href={`/admin/${slug}?dia=${fecha}`}>{fechaLarga(fecha, planta.timezone)}</Link>],
    ["Hora", `${hhmm(turno.inicio, planta.timezone)} hs`],
    ["Línea", turno.linea ? `${turno.linea.categoria.nombre} ${turno.linea.numero}` : "Sin turno previo"],
    ["Vehículo", `${oferta?.nombreDisplay ?? turno.tipo.nombre} · ${turno.dominio}`],
    ["Titular", turno.titularNombre],
    ["Correo", turno.titularEmail],
    ["Teléfono", turno.titularTelefono || "—"],
    ["Precio del turno", precioTurno !== null ? pesos(precioTurno) : "—"],
    ["Cobrado", acreditado > 0 ? pesos(acreditado) : "—"],
  ];

  if (turno.marca || turno.modelo || turno.anio) {
    datos.push(["Marca y modelo", [turno.marca, turno.modelo, turno.anio].filter(Boolean).join(" ") || "—"]);
  }
  if (turno.reprogramaciones > 0) {
    datos.push(["Cambios de fecha", String(turno.reprogramaciones)]);
  }
  if (turno.creadoPor) datos.push(["Cargado por", turno.creadoPor.nombre]);
  if (turno.observaciones) datos.push(["Observaciones", turno.observaciones]);
  if (turno.legacyId) datos.push(["Número anterior", `${turno.legacyPlanta} #${turno.legacyId}`]);

  return (
    <Marco acceso={acceso} activo="agenda">
      <p className="miga">
        <Link className="enlace" href={`/admin/${slug}?dia=${fecha}`}>‹ Agenda del {fechaLarga(fecha, planta.timezone).toLowerCase()}</Link>
      </p>

      <h2 className="ficha__titulo">
        {turno.dominio} <span className="ficha__titular">· {turno.titularNombre}</span>
      </h2>

      <dl className="ficha">
        {datos.map(([k, v]) => (
          <div key={k} className="ficha__dato">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {turno.pagos.length > 0 && (
        <>
          <h3 className="ficha__subtitulo">Pagos</h3>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Medio</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="col--num">Monto</th>
                  <th scope="col">Referencia</th>
                </tr>
              </thead>
              <tbody>
                {turno.pagos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.fechaPago ? `${fechaLarga(fechaLocal(p.fechaPago, planta.timezone), planta.timezone)} ${hhmm(p.fechaPago, planta.timezone)}` : "—"}</td>
                    <td>{p.metodo ?? p.proveedor}</td>
                    <td>{p.estado}{p.requiereRevision && <span className="pastilla pastilla--pendiente_pago"> a revisar</span>}</td>
                    <td className="col--num">{pesos(p.monto)}</td>
                    <td className="col--codigo">{p.paymentId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Operaciones
        slug={slug}
        publicId={turno.publicId}
        estado={turno.estado}
        yaPaso={yaPaso}
        acreditado={acreditado}
        precio={precioTurno ?? 0}
        permisos={{
          cobrar: puede("turno.cobrar"),
          realizar: puede("turno.realizar"),
          reprogramar: puede("turno.reprogramar"),
          cancelar: puede("turno.cancelar"),
        }}
      />
    </Marco>
  );
}
