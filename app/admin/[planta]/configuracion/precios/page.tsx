import { requerirPlanta } from "@/lib/sesionActual";
import { prisma } from "@/lib/prisma";
import { historial } from "@/lib/precios";
import Marco from "../../marco";
import Subnav from "../subnav";
import Tabla from "./tabla";

export const dynamic = "force-dynamic";

export default async function Precios({
  params,
}: {
  params: Promise<{ planta: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "config.ver");
  const { planta } = acceso;

  // El catálogo es global; cada planta elige su subconjunto. Se listan todos
  // para poder activar uno que hoy no se ofrece.
  const [tipos, oferta, lineas] = await Promise.all([
    prisma.tipoVehiculo.findMany({ include: { categoria: true }, orderBy: { id: "asc" } }),
    prisma.plantaTipoVehiculo.findMany({ where: { plantaId: planta.id } }),
    prisma.linea.findMany({ where: { plantaId: planta.id, activa: true }, select: { categoriaId: true } }),
  ]);

  const porTipo = new Map(oferta.map((o) => [o.tipoVehiculoId, o]));
  const categoriasConLinea = new Set(lineas.map((l) => l.categoriaId));

  const filas = await Promise.all(
    tipos.map(async (t, i) => {
      const o = porTipo.get(t.id);
      const vigencias = await historial(planta.id, t.id);
      return {
        id: t.id,
        nombre: t.nombre,
        categoria: t.categoria.nombre,
        nombreDisplay: o?.nombreDisplay ?? "",
        activo: o?.activo ?? false,
        orden: o?.orden ?? i,
        // Sin línea de su categoría, activarlo lo pondría en el selector
        // público sin un solo horario que ofrecer.
        sinLinea: planta.filtraLineaPorVehiculo && !categoriasConLinea.has(t.categoriaId),
        precios: vigencias.map((v) => ({
          id: v.id,
          precio: v.precio,
          desde: v.vigenteDesde.toISOString(),
          estado: v.estado,
          puestoPor: v.puestoPor,
        })),
      };
    })
  );

  return (
    <Marco acceso={acceso} activo="config">
      <h2 className="buscar__titulo">Configuración</h2>
      <Subnav slug={slug} activo="precios" />

      <p className="buscar__ayuda">
        Un cambio de precio es un hecho con fecha, no una edición: podés anotarlo para
        que entre en vigencia el día que corresponda y hasta entonces sigue rigiendo el
        anterior. Los precios que ya rigieron no se borran — son contra lo que se
        concilia lo cobrado.
      </p>

      <Tabla
        slug={slug}
        filas={filas}
        soloLectura={!acceso.puede("config.editar")}
        timezone={planta.timezone}
      />
    </Marco>
  );
}
