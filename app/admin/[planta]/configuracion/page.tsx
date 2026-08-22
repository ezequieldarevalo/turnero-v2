import { requerirPlanta } from "@/lib/sesionActual";
import { CAMPOS, GRUPOS, editable, topeDe, type Campo } from "@/lib/configuracion";
import { COLUMNAS_AGENDA, ETIQUETA_COLUMNA } from "@/lib/columnas";
import Marco from "../marco";
import Subnav from "./subnav";
import FormGeneral, { type Def } from "./formulario";

export const dynamic = "force-dynamic";

export default async function General({
  params,
}: {
  params: Promise<{ planta: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "config.ver");
  const { planta } = acceso;

  const esSuper = acceso.rol === "SUPERADMIN";
  const puedeEditar = acceso.puede("config.editar");

  const valores: Record<string, string | boolean | null> = {};
  const campos: Record<string, Def> = {};
  for (const clave of Object.keys(CAMPOS) as Campo[]) {
    const v = (planta as Record<string, unknown>)[clave];
    valores[clave] = typeof v === "boolean" ? v : v === null || v === undefined ? null : String(v);
    campos[clave] = {
      ...CAMPOS[clave],
      max: topeDe(clave, esSuper),
      // Se muestran igual, en solo lectura: esconderlos haría creer que el
      // ajuste no existe, y el dueño llamaría lo mismo pero sin saber qué pedir.
      bloqueado: !editable(clave, esSuper),
    };
  }

  const avisos = (planta.avisos as { texto: string; destacado: boolean }[] | null) ?? [];

  return (
    <Marco acceso={acceso} activo="config">
      <h2 className="buscar__titulo">Configuración</h2>
      <Subnav slug={slug} activo="general" />

      <FormGeneral
        slug={slug}
        soloLectura={!puedeEditar}
        campos={campos}
        grupos={GRUPOS}
        valores={valores}
        columnas={COLUMNAS_AGENDA.map((c) => ({
          id: c,
          etiqueta: ETIQUETA_COLUMNA[c],
          activa: ((planta.columnasAgenda as string[]) ?? []).includes(c),
        }))}
        avisosTexto={avisos.map((a) => (a.destacado ? `*${a.texto}` : a.texto)).join("\n")}
      />
    </Marco>
  );
}
