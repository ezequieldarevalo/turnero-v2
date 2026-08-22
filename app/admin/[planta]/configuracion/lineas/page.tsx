import { requerirPlanta } from "@/lib/sesionActual";
import { prisma } from "@/lib/prisma";
import { cuposDeLinea } from "@/lib/disponibilidad";
import { hoyLocal, sumarDias } from "@/lib/fechas";
import Marco from "../../marco";
import Subnav from "../subnav";
import Editor from "./editor";

export const dynamic = "force-dynamic";

export default async function Lineas({
  params,
}: {
  params: Promise<{ planta: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "config.ver");
  const { planta } = acceso;

  const [lineas, categorias, horarios] = await Promise.all([
    prisma.linea.findMany({
      where: { plantaId: planta.id },
      include: { categoria: true, _count: { select: { turnos: true } } },
      orderBy: [{ categoriaId: "asc" }, { numero: "asc" }],
    }),
    prisma.categoriaVehiculo.findMany({ orderBy: { id: "asc" } }),
    prisma.horario.findMany({ where: { plantaId: planta.id } }),
  ]);

  // Cuántos cupos aporta cada línea en un día hábil cualquiera: es la forma más
  // directa de mostrar que una línea es capacidad, no una etiqueta.
  const hoy = hoyLocal(planta.timezone);
  const filas = lineas.map((l) => {
    let cupos = 0;
    for (let i = 1; i <= 7; i++) {
      const n = cuposDeLinea(horarios, l.id, sumarDias(hoy, i), planta.timezone).length;
      if (n > cupos) cupos = n;
    }
    return {
      id: l.id,
      nombre: `${l.categoria.nombre} ${l.numero}`,
      categoria: l.categoria.nombre,
      numero: l.numero,
      activa: l.activa,
      turnos: l._count.turnos,
      cuposPorDia: cupos,
    };
  });

  return (
    <Marco acceso={acceso} activo="config">
      <h2 className="buscar__titulo">Configuración</h2>
      <Subnav slug={slug} activo="lineas" />

      <p className="buscar__ayuda">
        Una línea es un <strong>puesto donde entra un vehículo a que lo revisen</strong>.
        Cada una aporta su propia tanda de turnos: agregar una suma cupos desde el día
        siguiente, darla de baja los reduce. No se borran, porque sus turnos pasados
        cuelgan de ellas.
      </p>
      <p className="buscar__ayuda">
        {planta.filtraLineaPorVehiculo ? (
          <>
            Esta planta <strong>filtra por categoría</strong>: una moto solo entra a una
            línea de motos. Si un tipo de vehículo no tiene ninguna línea de su categoría,
            deja de ofrecerse.
          </>
        ) : (
          <>
            Esta planta <strong>no filtra por categoría</strong>: cualquier vehículo entra
            a cualquier línea, así que la categoría acá funciona como etiqueta. Lo cambia
            quien administra el servicio.
          </>
        )}
      </p>

      <Editor
        slug={slug}
        lineas={filas}
        categorias={categorias.map((c) => ({ id: c.id, nombre: c.nombre }))}
        soloLectura={!acceso.puede("config.editar")}
      />
    </Marco>
  );
}
