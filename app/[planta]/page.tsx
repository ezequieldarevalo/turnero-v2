import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { preciosVigentes } from "@/lib/precios";
import Reserva from "./reserva";

export default async function Page({ params }: { params: Promise<{ planta: string }> }) {
  const { planta: slug } = await params;

  const planta = await prisma.planta.findUnique({
    where: { slug },
    select: {
      id: true,
      nombre: true,
      direccion: true,
      whatsappContacto: true,
      emailRemitente: true,
      avisos: true,
      camposRequeridos: true,
      tiposCombustible: true,
      requierePago: true,
      minutosExpiracionPago: true,
      pagoEfectivoHabilitado: true,
      tiposVehiculo: {
        where: { activo: true },
        orderBy: { orden: "asc" },
        select: {
          tipoVehiculoId: true,
          nombreDisplay: true,
          tipo: { select: { id: true, nombre: true } },
        },
      },
    },
  });

  if (!planta) notFound();

  // Los precios vigentes ahora mismo. Uno programado para el mes que viene
  // está en la base pero todavía no rige, así que no se muestra.
  const precios = await preciosVigentes(planta.id);

  const tipos = planta.tiposVehiculo.map((t) => ({
    id: t.tipo.id,
    nombre: t.nombreDisplay ?? t.tipo.nombre,
    precio: precios.get(t.tipoVehiculoId) ?? 0,
  }));

  // Una planta recién dada de alta tiene líneas pero todavía no ofrece nada. El
  // paso 1 con la lista vacía parece un sitio roto: es mejor decirlo.
  if (tipos.length === 0) {
    return (
      <main className="contenedor">
        <h1 className="titulo">{planta.nombre}</h1>
        <div className="aviso">
          <p className="destacado">Todavía no estamos tomando turnos por este sitio.</p>
          <p>
            Estamos terminando de configurarlo. Mientras tanto, comunicate con la planta
            {planta.whatsappContacto ? ` por WhatsApp al ${planta.whatsappContacto}` : ""}
            {planta.emailRemitente ? ` o escribinos a ${planta.emailRemitente}` : ""}.
          </p>
        </div>
        <p style={{ marginTop: 16, color: "var(--texto-suave)" }}>{planta.direccion}</p>
      </main>
    );
  }

  return (
    <main className="contenedor">
      <h1 className="titulo">Reserva de turno · {planta.nombre}</h1>

      <Reserva
        slug={slug}
        nombrePlanta={planta.nombre}
        direccion={planta.direccion}
        tipos={tipos}
        avisos={planta.avisos as { texto: string; destacado: boolean }[]}
        combustibles={planta.tiposCombustible as string[]}
        requierePago={planta.requierePago}
        horasParaPagar={Math.round(planta.minutosExpiracionPago / 60)}
        mediosEfectivo={planta.pagoEfectivoHabilitado}
      />
    </main>
  );
}
