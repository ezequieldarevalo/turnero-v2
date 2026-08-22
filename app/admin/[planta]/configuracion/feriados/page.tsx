import Link from "next/link";
import { requerirPlanta } from "@/lib/sesionActual";
import { prisma } from "@/lib/prisma";
import { diasCerrados } from "@/lib/cierres";
import { hoyLocal, sumarDias } from "@/lib/fechas";
import Marco from "../../marco";
import Subnav from "../subnav";
import Editor from "./editor";

export const dynamic = "force-dynamic";

/** "Miércoles 8 de octubre". Sin año: en la lista lo pone el encabezado del grupo. */
const conDia = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
  })
    .format(new Date(`${iso}T00:00:00.000Z`))
    .replace(/^\w/, (c) => c.toUpperCase())
    .replace(",", "");

export default async function DiasCerrados({
  params,
}: {
  params: Promise<{ planta: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "config.ver");
  const { planta } = acceso;

  const [lineas, horarios] = await Promise.all([
    prisma.linea.findMany({ where: { plantaId: planta.id, activa: true }, select: { id: true } }),
    prisma.horario.findMany({ where: { plantaId: planta.id } }),
  ]);

  const hoy = hoyLocal(planta.timezone);
  // Todo el historial y dos años hacia adelante: los feriados trasladables del
  // año que viene ya se publican con anticipación.
  const cerrados = await diasCerrados(
    { ...planta, lineas, horarios },
    "2018-01-01",
    sumarDias(hoy, 730)
  );

  const filas = cerrados.map((c) => ({
    fecha: c.fecha,
    texto: conDia(c.fecha),
    descripcion: c.descripcion,
    origen: c.origen,
    pasado: c.fecha < hoy,
  }));

  const proximos = filas.filter((f) => !f.pasado);

  // Los anteriores, agrupados por año y del año más reciente al más viejo. Sin
  // el año, una lista de "lunes 25 de mayo / viernes 1 de mayo" de seis años
  // distintos parece desordenada aunque esté perfectamente ordenada.
  const anios = new Map<string, typeof filas>();
  for (const f of filas.filter((x) => x.pasado)) {
    const anio = f.fecha.slice(0, 4);
    (anios.get(anio) ?? anios.set(anio, []).get(anio)!).push(f);
  }
  const anteriores = [...anios.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([anio, dias]) => ({ anio, dias }));

  return (
    <Marco acceso={acceso} activo="config">
      <h2 className="buscar__titulo">Configuración</h2>
      <Subnav slug={slug} activo="feriados" />

      <p className="buscar__ayuda">
        Los días marcados acá no ofrecen ningún turno, sin importar los horarios.
        Un día que ya tiene gente citada no se puede cerrar: primero hay que
        moverla, desde <Link className="enlace" href={`/admin/${slug}`}>la agenda</Link>.
      </p>

      <Editor
        slug={slug}
        proximos={proximos}
        anteriores={anteriores}
        hoy={hoy}
        soloLectura={!acceso.puede("config.editar")}
      />
    </Marco>
  );
}
