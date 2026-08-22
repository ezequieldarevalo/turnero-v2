import Link from "next/link";
import { notFound } from "next/navigation";
import { paraConfirmar } from "@/lib/turnoTelefonico";
import { hhmm, fechaLocal, fechaLarga } from "@/lib/fechas";
import Aceptar from "./aceptar";

export const dynamic = "force-dynamic";

const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

/**
 * Donde el titular acepta un turno que le cargaron por teléfono.
 *
 * Es el punto en el que el consentimiento pasa a ser real: hasta acá lo único
 * que hay es un operador diciendo que habló con alguien.
 */
export default async function Confirmar({
  params,
}: {
  params: Promise<{ planta: string; publicId: string }>;
}) {
  const { planta: slug, publicId } = await params;
  const t = await paraConfirmar(publicId, slug);

  // Ya confirmado, vencido, o inexistente: la página del turno explica cuál de
  // los tres es. Acá solo se atiende el caso en que todavía hay algo que decidir.
  if (!t) {
    const existe = await import("@/lib/prisma").then((m) =>
      m.prisma.turno.findFirst({ where: { publicId, planta: { slug } }, select: { id: true } })
    );
    if (!existe) notFound();
    return (
      <main className="contenedor">
        <div className="aviso">
          <p className="destacado">Este turno ya no está esperando tu confirmación.</p>
          <p>
            Puede que ya lo hayas confirmado, o que se haya vencido el plazo y el horario
            se haya liberado.
          </p>
        </div>
        <p style={{ marginTop: 18 }}>
          <Link className="enlace" href={`/${slug}/turno/${publicId}`}>Ver el estado de tu turno</Link>
        </p>
      </main>
    );
  }

  const fecha = fechaLocal(t.inicio, t.timezone);

  return (
    <main className="contenedor" style={{ "--planta-primario": t.colorPrimario } as React.CSSProperties}>
      <h1 className="titulo">Confirmá tu turno</h1>
      <p className="confirmar__bajada">
        Te cargamos este turno en {t.plantaNombre}. Revisá que esté todo bien y confirmalo.
      </p>

      <dl className="ficha">
        <div className="ficha__dato"><dt>Fecha</dt><dd>{fechaLarga(fecha, t.timezone)}</dd></div>
        <div className="ficha__dato"><dt>Hora</dt><dd>{hhmm(t.inicio, t.timezone)} hs</dd></div>
        <div className="ficha__dato"><dt>Vehículo</dt><dd>{t.tipoVehiculo} · {t.dominio}</dd></div>
        <div className="ficha__dato"><dt>A nombre de</dt><dd>{t.titularNombre}</dd></div>
        <div className="ficha__dato"><dt>Planta</dt><dd>{t.plantaNombre}</dd></div>
        <div className="ficha__dato"><dt>Dirección</dt><dd>{t.plantaDireccion}</dd></div>
        {t.precio !== null && (
          <div className="ficha__dato"><dt>Precio</dt><dd>{pesos(t.precio)}</dd></div>
        )}
      </dl>

      <Aceptar
        slug={slug}
        publicId={publicId}
        requierePago={t.requierePago}
        politica={t.politica}
      />
    </main>
  );
}
