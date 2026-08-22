"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requerirPlanta } from "@/lib/sesionActual";
import { calcularDisponibilidad } from "@/lib/disponibilidad";
import { hhmm } from "@/lib/fechas";
import { notificarPorConfirmar } from "@/lib/notificar";
import { crearTurnoTelefonico, type DatosTelefonico, type Resultado } from "@/lib/turnoTelefonico";

export interface DiaConCupos {
  fecha: string;
  libres: number;
}

export interface Horario {
  iso: string;
  hhmm: string;
  lineaId: number;
  duracionMin: number;
}

/**
 * Los días que tienen algún cupo, con cuántos. Sin los horarios.
 *
 * Antes esta pantalla se traía los horarios de los 102 días de una: **un mega
 * de JSON y cuatro segundos** para abrirla, cuando el operador va a mirar un
 * día solo. Ahora la lista de días son cien números y las horas se piden al
 * elegir la fecha.
 */
export async function diasConCupos(slug: string, tipoVehiculoId: number): Promise<DiaConCupos[]> {
  await requerirPlanta(slug, "turno.crear");
  const dias = await calcularDisponibilidad(prisma, { plantaSlug: slug, tipoVehiculoId });
  return dias.map((d) => ({ fecha: d.fecha, libres: d.cupos.length }));
}

/**
 * Los horarios libres de un día, uno por hora.
 *
 * Si dos líneas tienen libre la misma hora, al operador le da igual cuál: elige
 * un horario, no un puesto. Se queda con una y el resto no viaja.
 */
export async function horariosDelDia(
  slug: string, tipoVehiculoId: number, fecha: string
): Promise<Horario[]> {
  const acceso = await requerirPlanta(slug, "turno.crear");
  const dias = await calcularDisponibilidad(prisma, { plantaSlug: slug, tipoVehiculoId, soloFecha: fecha });

  const porHora = new Map<string, Horario>();
  for (const c of dias[0]?.cupos ?? []) {
    const hora = hhmm(c.inicio, acceso.planta.timezone);
    if (porHora.has(hora)) continue;
    porHora.set(hora, {
      iso: c.inicio.toISOString(), hhmm: hora,
      lineaId: c.lineaId, duracionMin: c.duracionMin,
    });
  }
  return [...porHora.values()].sort((a, b) => a.iso.localeCompare(b.iso));
}

export async function crear(slug: string, datos: DatosTelefonico): Promise<Resultado> {
  const acceso = await requerirPlanta(slug, "turno.crear");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const r = await crearTurnoTelefonico(acceso.planta.id, datos, {
    usuarioId: acceso.sesion.usuarioId,
    ip,
  });

  if (r.ok) {
    revalidatePath(`/admin/${slug}`);
    // El correo sale después de responder: si el SMTP tarda, el operador no se
    // queda mirando una pantalla trabada con el cliente al teléfono.
    after(() => notificarPorConfirmar(r.publicId));
    redirect(`/admin/${slug}/turno/${r.publicId}`);
  }
  return r;
}
