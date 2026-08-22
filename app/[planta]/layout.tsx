import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

/**
 * Resuelve el tenant por el path y aplica su identidad como variables CSS.
 * Los cuatro componentes Header del sistema viejo —que diferían solo en color
 * y texto— quedan reemplazados por esto.
 */
export default async function PlantaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ planta: string }>;
}) {
  const { planta: slug } = await params;

  const planta = await prisma.planta.findUnique({
    where: { slug },
    select: {
      nombre: true,
      activa: true,
      colorPrimario: true,
      colorAdvertencia: true,
      marcaTipo: true,
      marcaValor: true,
    },
  });

  if (!planta || !planta.activa) notFound();

  return (
    <div
      style={
        {
          "--planta-primario": planta.colorPrimario,
          "--planta-advertencia": planta.colorAdvertencia,
        } as React.CSSProperties
      }
    >
      <header className="cabecera">
        <div className="cabecera__contenido">
          {planta.marcaTipo === "logo" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={planta.marcaValor} alt={planta.nombre} height={40} />
          ) : (
            <span className="cabecera__marca">{planta.marcaValor}</span>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
