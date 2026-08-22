"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requerirPlanta } from "@/lib/sesionActual";
import {
  guardarGenerales, agregarHorario, borrarHorario, guardarTipo,
  agregarLinea, desactivarLinea,
  type BandaNueva, type Campo, type Resultado,
} from "@/lib/configuracion";
import { cerrar, reabrir, type Resultado as ResultadoCierre } from "@/lib/cierres";
import { CAMPOS, editable } from "@/lib/configuracion";
import { programarPrecio, cancelarProgramado, type Resultado as ResultadoPrecio } from "@/lib/precios";

async function contexto(slug: string) {
  const acceso = await requerirPlanta(slug, "config.editar");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return { acceso, quien: { usuarioId: acceso.sesion.usuarioId, ip } };
}

function refrescar(slug: string) {
  // La configuración cambia lo que se ve en todas partes: el color en la
  // cabecera, los precios en el selector, los horarios en la disponibilidad.
  revalidatePath(`/admin/${slug}`, "layout");
  revalidatePath(`/${slug}`, "layout");
}

export async function guardarGeneral(slug: string, form: FormData): Promise<Resultado> {
  const { acceso, quien } = await contexto(slug);
  const esSuper = acceso.rol === "SUPERADMIN";

  const campos: Partial<Record<Campo, string | null>> = {};
  for (const clave of Object.keys(CAMPOS) as Campo[]) {
    // Solo los que este rol puede tocar. Es imprescindible saltear los otros y
    // no mandarlos vacíos: una casilla deshabilitada NO viaja en el FormData, y
    // más abajo la ausencia se interpreta como "false". Recorrer todos los
    // campos apagaría `requierePago` cada vez que guarda un dueño — el fallo
    // silencioso exacto que este permiso existe para evitar.
    if (!editable(clave, esSuper)) continue;

    // Una casilla sin tildar tampoco viaja: para las que SÍ puede editar, su
    // ausencia es el valor.
    campos[clave] = CAMPOS[clave].tipo === "si_no"
      ? (form.get(clave) === null ? "false" : "on")
      : (form.get(clave) as string | null);
  }

  const columnasAgenda = form.getAll("columnasAgenda").map(String);

  // Un aviso por línea. La que arranca con "*" se muestra destacada.
  const avisos = String(form.get("avisos") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("*")
      ? { texto: l.slice(1).trim(), destacado: true }
      : { texto: l, destacado: false }));

  const r = await guardarGenerales(acceso.planta, { campos, columnasAgenda, avisos }, quien, esSuper);
  if (r.ok) refrescar(slug);
  return r;
}

export async function nuevoHorario(slug: string, banda: BandaNueva): Promise<Resultado> {
  const { acceso, quien } = await contexto(slug);
  const r = await agregarHorario(acceso.planta, banda, quien);
  if (r.ok) refrescar(slug);
  return r;
}

export async function quitarHorario(slug: string, id: number): Promise<Resultado> {
  const { acceso, quien } = await contexto(slug);
  const r = await borrarHorario(acceso.planta, id, quien);
  if (r.ok) refrescar(slug);
  return r;
}

export async function guardarOferta(
  slug: string,
  tipoVehiculoId: number,
  datos: { nombreDisplay: string | null; activo: boolean; orden: number }
): Promise<Resultado> {
  const { acceso, quien } = await contexto(slug);
  const r = await guardarTipo(acceso.planta, tipoVehiculoId, datos, quien);
  if (r.ok) refrescar(slug);
  return r;
}

/** `desdeIso` vacío = rige ya. Con fecha, queda programado. */
export async function ponerPrecio(
  slug: string,
  tipoVehiculoId: number,
  precio: number,
  desdeIso: string | null
): Promise<ResultadoPrecio> {
  const { acceso, quien } = await contexto(slug);
  const r = await programarPrecio(
    acceso.planta.id, tipoVehiculoId, precio,
    desdeIso ? new Date(desdeIso) : null, quien
  );
  if (r.ok) refrescar(slug);
  return r;
}

export async function anularPrecio(slug: string, id: number): Promise<ResultadoPrecio> {
  const { acceso, quien } = await contexto(slug);
  const r = await cancelarProgramado(acceso.planta.id, id, quien);
  if (r.ok) refrescar(slug);
  return r;
}

export async function nuevaLinea(
  slug: string, datos: { categoriaId: number; numero: string }
): Promise<Resultado> {
  const { acceso, quien } = await contexto(slug);
  const r = await agregarLinea(acceso.planta, datos, quien);
  if (r.ok) refrescar(slug);
  return r;
}

export async function bajaLinea(slug: string, lineaId: number): Promise<Resultado> {
  const { acceso, quien } = await contexto(slug);
  const r = await desactivarLinea(acceso.planta, lineaId, quien);
  if (r.ok) refrescar(slug);
  return r;
}

export async function cerrarDia(slug: string, fecha: string, descripcion: string): Promise<ResultadoCierre> {
  const { acceso, quien } = await contexto(slug);
  const r = await cerrar(acceso.planta, fecha, descripcion, quien);
  if (r.ok) refrescar(slug);
  return r;
}

export async function reabrirDia(slug: string, fecha: string): Promise<ResultadoCierre> {
  const { acceso, quien } = await contexto(slug);
  const r = await reabrir(acceso.planta, fecha, quien);
  if (r.ok) refrescar(slug);
  return r;
}
