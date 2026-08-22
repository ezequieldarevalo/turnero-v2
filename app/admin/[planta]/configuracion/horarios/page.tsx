import { requerirPlanta } from "@/lib/sesionActual";
import { prisma } from "@/lib/prisma";
import { hhmmDeMinutos, NOMBRE_DIA } from "@/lib/configuracion";
import Marco from "../../marco";
import Subnav from "../subnav";
import Editor from "./editor";

export const dynamic = "force-dynamic";

export default async function Horarios({
  params,
}: {
  params: Promise<{ planta: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "config.ver");
  const { planta } = acceso;

  const [horarios, lineas] = await Promise.all([
    prisma.horario.findMany({
      where: { plantaId: planta.id },
      orderBy: [{ diaSemana: "asc" }, { desde: "asc" }],
    }),
    prisma.linea.findMany({
      where: { plantaId: planta.id },
      include: { categoria: true },
      orderBy: [{ categoriaId: "asc" }, { numero: "asc" }],
    }),
  ]);

  const nombreLinea = new Map(lineas.map((l) => [l.id, `${l.categoria.nombre} ${l.numero}`]));

  const bandas = horarios.map((h) => ({
    id: h.id,
    diaSemana: h.diaSemana,
    dia: NOMBRE_DIA(h.diaSemana),
    desde: hhmmDeMinutos(h.desde),
    hasta: hhmmDeMinutos(h.hasta),
    slotsPorHora: h.slotsPorHora,
    cupos: Math.ceil(((h.hasta - h.desde) * h.slotsPorHora) / 60),
    cada: Math.round(60 / h.slotsPorHora),
    linea: h.lineaId === null ? null : nombreLinea.get(h.lineaId) ?? `#${h.lineaId}`,
    mes: h.mes,
  }));

  return (
    <Marco acceso={acceso} activo="config">
      <h2 className="buscar__titulo">Configuración</h2>
      <Subnav slug={slug} activo="horarios" />

      <p className="buscar__ayuda">
        Cada banda dice a qué hora abre y cierra un día de la semana, y cuántos turnos
        entran por hora. Sin banda, ese día está cerrado. La hora de cierre es
        exclusiva: hasta las 15:50 con 6 por hora significa que el último turno es a
        las 15:50.
      </p>

      <Editor
        slug={slug}
        soloLectura={!acceso.puede("config.editar")}
        bandas={bandas}
        lineas={lineas.map((l) => ({ id: l.id, nombre: `${l.categoria.nombre} ${l.numero}` }))}
      />
    </Marco>
  );
}
