import { notFound } from "next/navigation";
import { codigoCorto } from "@/lib/codigo";
import { prisma } from "@/lib/prisma";
import { acciones } from "@/lib/gestionTurno";
import Gestion from "./gestion";

/**
 * Página a la que vuelve el cliente después de pagar. En el sistema viejo no
 * existía: se quedaba en MercadoPago sin saber si su turno había quedado.
 *
 * Es también la que se manda por correo, con el publicId opaco en la URL en
 * vez del id secuencial que hoy es enumerable.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ planta: string; publicId: string }>;
}) {
  const { planta: slug, publicId } = await params;

  const turno = await prisma.turno.findFirst({
    where: { publicId, planta: { slug } },
    include: {
      planta: { select: { nombre: true, direccion: true, whatsappContacto: true, permiteReprogramar: true } },
      tipo: { select: { nombre: true } },
      pagos: { orderBy: { creadoAt: "desc" }, take: 1 },
      politica: { select: { version: true } },
    },
  });

  if (!turno) notFound();

  const permitido = await acciones(publicId, slug);

  const fmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Mendoza",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const cuando = fmt.format(turno.inicio).replace(/^\w/, (c) => c.toUpperCase());

  const estados = {
    CONFIRMADO: { clase: "exito", titulo: "Tu turno está confirmado" },
    COMPLETADO: { clase: "exito", titulo: "Turno realizado" },
    PENDIENTE_PAGO: { clase: "aviso", titulo: "Falta el pago" },
    PENDIENTE_CONFIRMACION: { clase: "aviso", titulo: "Falta que confirmes el turno" },
    CANCELADO: { clase: "error", titulo: "Turno cancelado" },
    EXPIRADO: { clase: "error", titulo: "El turno venció sin pagarse" },
    AUSENTE: { clase: "error", titulo: "Turno registrado como ausente" },
  } as const;

  const e = estados[turno.estado];
  const pago = turno.pagos[0];

  return (
    <main className="contenedor">
      <h1 className="titulo">Tu turno · {turno.planta.nombre}</h1>

      <div className={`mensaje mensaje--${e.clase === "exito" ? "exito" : e.clase === "error" ? "error" : "aviso"}`}>
        <h2>{e.titulo}</h2>
        <p><strong>{cuando} hs</strong></p>
        <p className="mensaje__detalle">{turno.planta.direccion}</p>
      </div>

      <dl className="resumen" style={{ marginTop: 20 }}>
        <div><dt>Vehículo</dt><dd>{turno.tipo.nombre} · {turno.dominio}</dd></div>
        <div><dt>A nombre de</dt><dd>{turno.titularNombre}</dd></div>
        <div><dt>Código de turno</dt><dd style={{ fontVariantNumeric: "tabular-nums" }}>{codigoCorto(turno.publicId)}</dd></div>
        {pago?.estado === "approved" && (
          <div><dt>Pago</dt><dd>Acreditado · ${pago.monto.toLocaleString("es-AR")}</dd></div>
        )}
        {/* Enlaza la versión EXACTA que aceptó, no la vigente hoy. Es lo que
            convierte el `politicaId` guardado en algo consultable: si la
            política cambió después, la persona puede leer lo que aceptó. */}
        {turno.politica && turno.consentimientoAt && (
          <div>
            <dt>Datos personales</dt>
            <dd>
              Aceptaste la{" "}
              <a href={`/${slug}/privacidad?version=${encodeURIComponent(turno.politica.version)}`}>
                política de privacidad
              </a>{" "}
              el {new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Mendoza", dateStyle: "long" }).format(turno.consentimientoAt)}
            </dd>
          </div>
        )}
      </dl>

      {turno.estado === "PENDIENTE_PAGO" && (
        <>
          {turno.pagoUrl && (
            <div className="acciones" style={{ justifyContent: "flex-start" }}>
              <a className="boton" href={turno.pagoUrl}>Pagar el turno</a>
            </div>
          )}
          <p className="pago__nota">
            {turno.venceAt
              ? `Tenés tiempo hasta el ${new Intl.DateTimeFormat("es-AR", {
                  timeZone: "America/Argentina/Mendoza",
                  day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false,
                }).format(turno.venceAt)} hs. Pasado ese plazo el turno se libera.`
              : "Si no completás el pago, el turno se libera automáticamente."}
            {" "}Si ya pagaste, la acreditación puede demorar unos minutos.
          </p>
        </>
      )}

      <Gestion
        slug={slug}
        publicId={publicId}
        puedeCancelar={permitido.cancelar}
        puedeReprogramar={permitido.reprogramar}
      />

      {/*
        El WhatsApp va SIEMPRE, no solo cuando no hay botones. Los dos caminos
        conviven: el cliente se autogestiona hasta el tope de reprogramaciones,
        y a partir de ahí —o si necesita algo que la pantalla no resuelve— tiene
        a dónde escribir. Cuando el botón desaparece por haber llegado al tope,
        esta línea es lo único que le queda: si también dependiera de que no
        haya botones, el cliente se quedaría sin salida y sin explicación.
      */}
      {turno.estado === "CONFIRMADO" && (
        <p className="pago__nota">
          {permitido.reprogramar || permitido.cancelar
            ? turno.planta.whatsappContacto
              ? `¿Necesitás algo más? Escribinos por WhatsApp al ${turno.planta.whatsappContacto}.`
              : null
            : turno.planta.whatsappContacto
              ? `Para reprogramar o cancelar, comunicate por WhatsApp al ${turno.planta.whatsappContacto}.`
              : "Para reprogramar o cancelar, comunicate con la planta."}
        </p>
      )}
    </main>
  );
}
