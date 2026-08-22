"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { requerirPlanta } from "@/lib/sesionActual";
import { calcularDisponibilidad } from "@/lib/disponibilidad";
import { prisma } from "@/lib/prisma";
import { hhmm } from "@/lib/fechas";
import { notificarReprogramacion, notificarCancelacion, notificarConfirmacion } from "@/lib/notificar";
import {
  cobrarEnMostrador, marcarRealizado, marcarAusente,
  reprogramarDesdeMostrador, cancelarDesdeMostrador,
  type Resultado,
} from "@/lib/turnoAdmin";
import type { Permiso } from "@/lib/permisos";

/**
 * Cada acción vuelve a resolver el acceso desde la sesión. No alcanza con que
 * la pantalla haya escondido el botón: una server action es un endpoint, y
 * cualquiera con sesión puede invocarla con los argumentos que quiera.
 */
async function operar(slug: string, permiso: Permiso) {
  const acceso = await requerirPlanta(slug, permiso);
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return { acceso, quien: { usuarioId: acceso.sesion.usuarioId, ip } };
}

function refrescar(slug: string, publicId: string) {
  revalidatePath(`/admin/${slug}/turno/${publicId}`);
  revalidatePath(`/admin/${slug}`);
}

export async function cobrar(
  slug: string, publicId: string, datos: { monto: number; metodo: string; observaciones?: string }
): Promise<Resultado> {
  const { acceso, quien } = await operar(slug, "turno.cobrar");
  const r = await cobrarEnMostrador(publicId, acceso.planta.id, datos, quien);
  if (r.ok) {
    refrescar(slug, publicId);
    after(() => notificarConfirmacion(publicId));
  }
  return r;
}

export async function realizar(slug: string, publicId: string): Promise<Resultado> {
  const { acceso, quien } = await operar(slug, "turno.realizar");
  const r = await marcarRealizado(publicId, acceso.planta.id, quien);
  if (r.ok) refrescar(slug, publicId);
  return r;
}

export async function ausente(slug: string, publicId: string): Promise<Resultado> {
  const { acceso, quien } = await operar(slug, "turno.realizar");
  const r = await marcarAusente(publicId, acceso.planta.id, quien);
  if (r.ok) refrescar(slug, publicId);
  return r;
}

export async function cancelar(slug: string, publicId: string, motivo: string | null): Promise<Resultado> {
  const { acceso, quien } = await operar(slug, "turno.cancelar");
  const r = await cancelarDesdeMostrador(publicId, acceso.planta.id, motivo, quien);
  if (r.ok) {
    refrescar(slug, publicId);
    after(() => notificarCancelacion(publicId));
  }
  return r;
}

export async function reprogramar(
  slug: string, publicId: string, destino: { lineaId: number; inicioIso: string; duracionMin: number }
): Promise<Resultado> {
  const { acceso, quien } = await operar(slug, "turno.reprogramar");
  const r = await reprogramarDesdeMostrador(publicId, acceso.planta.id, destino, quien);
  if (r.ok) {
    refrescar(slug, publicId);
    after(() => notificarReprogramacion(publicId));
  }
  return r;
}

export interface DiaLibre {
  fecha: string;
  horarios: { iso: string; hhmm: string; lineaId: number; duracionMin: number }[];
}

/** Cupos libres para mover el turno, con su propio horario incluido. */
export async function cuposParaMover(slug: string, publicId: string): Promise<DiaLibre[]> {
  const { acceso } = await operar(slug, "turno.reprogramar");
  const turno = await prisma.turno.findFirst({
    where: { publicId, plantaId: acceso.planta.id },
    select: { id: true, tipoVehiculoId: true },
  });
  if (!turno) return [];

  const dias = await calcularDisponibilidad(prisma, {
    plantaSlug: slug,
    tipoVehiculoId: turno.tipoVehiculoId,
    excluirTurnoId: turno.id,
  });

  return dias.map((d) => ({
    fecha: d.fecha,
    horarios: d.cupos.map((c) => ({
      iso: c.inicio.toISOString(),
      hhmm: hhmm(c.inicio, acceso.planta.timezone),
      lineaId: c.lineaId,
      duracionMin: c.duracionMin,
    })),
  }));
}
