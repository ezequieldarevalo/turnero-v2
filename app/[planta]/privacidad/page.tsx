import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { marcado } from "@/lib/marcado";
import { fechaLarga } from "@/lib/fechas";

export const dynamic = "force-dynamic";

/**
 * La política de privacidad, por planta.
 *
 * Acepta `?version=` para poder mostrar **exactamente el texto que alguien
 * aceptó**, y no el vigente hoy. Sin eso, guardar `politicaId` en cada turno
 * no serviría de nada: al primer cambio de política, la prueba del
 * consentimiento apuntaría a un texto que la persona nunca leyó.
 */
export default async function Privacidad({
  params, searchParams,
}: {
  params: Promise<{ planta: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { planta: slug } = await params;
  const { version } = await searchParams;

  const planta = await prisma.planta.findUnique({
    where: { slug },
    select: { nombre: true, direccion: true, colorPrimario: true, emailRemitente: true, timezone: true },
  });
  if (!planta) notFound();

  const politica = version
    ? await prisma.politicaPrivacidad.findUnique({ where: { version } })
    : await prisma.politicaPrivacidad.findFirst({ orderBy: { vigenteDesde: "desc" } });

  const vigente = await prisma.politicaPrivacidad.findFirst({ orderBy: { vigenteDesde: "desc" } });
  const esVigente = politica && vigente && politica.id === vigente.id;

  return (
    <main
      className="contenedor legal"
      style={{ "--planta-primario": planta.colorPrimario } as React.CSSProperties}
    >
      <h1 className="titulo">Política de privacidad</h1>
      <p className="legal__planta">{planta.nombre}</p>

      {!politica ? (
        <div className="aviso">
          <p className="destacado">Todavía no hay una política publicada.</p>
          <p>
            Si querés saber qué hacemos con tus datos, escribinos a{" "}
            <a href={`mailto:${planta.emailRemitente}`}>{planta.emailRemitente}</a>.
          </p>
        </div>
      ) : (
        <>
          <p className="legal__version">
            Versión <strong>{politica.version}</strong>, vigente desde el{" "}
            {fechaLarga(politica.vigenteDesde.toISOString().slice(0, 10), planta.timezone).toLowerCase()}.
          </p>

          {!esVigente && (
            <div className="aviso">
              <p className="destacado">Estás viendo una versión anterior.</p>
              <p>
                Es la que estaba vigente cuando reservaste.{" "}
                <Link href={`/${slug}/privacidad`}>Ver la política actual</Link>.
              </p>
            </div>
          )}

          <article className="legal__texto">{marcado(politica.texto)}</article>
        </>
      )}

      <p className="legal__volver">
        <Link href={`/${slug}`}>← Volver a sacar un turno</Link>
      </p>
    </main>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ planta: string }> }) {
  const { planta: slug } = await params;
  const p = await prisma.planta.findUnique({ where: { slug }, select: { nombre: true } });
  return { title: p ? `Política de privacidad · ${p.nombre}` : "Política de privacidad" };
}
