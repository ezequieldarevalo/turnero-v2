"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { calcularDisponibilidad } from "@/lib/disponibilidad";
import { cancelar, reprogramar, type Resultado } from "@/lib/gestionTurno";
import { notificarCancelacion, notificarReprogramacion } from "@/lib/notificar";
import type { DiaSerializado } from "@/app/[planta]/acciones";

/** Disponibilidad para mover un turno. Excluye el propio, así puede quedarse en su horario. */
export async function disponibilidadParaMover(
  slug: string,
  publicId: string
): Promise<DiaSerializado[]> {
  const turno = await prisma.turno.findFirst({
    where: { publicId, planta: { slug } },
    include: { planta: { select: { timezone: true } } },
  });
  if (!turno) return [];

  const dias = await calcularDisponibilidad(prisma, {
    plantaSlug: slug,
    tipoVehiculoId: turno.tipoVehiculoId,
    excluirTurnoId: turno.id,
  });

  const fmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: turno.planta.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  });

  return dias.map((d) => {
    const porHora = new Map<string, { lineaId: number; iso: string; duracionMin: number }>();
    for (const c of d.cupos) {
      const hhmm = fmt.format(c.inicio);
      if (!porHora.has(hhmm)) {
        porHora.set(hhmm, { lineaId: c.lineaId, iso: c.inicio.toISOString(), duracionMin: c.duracionMin });
      }
    }
    return {
      fecha: d.fecha,
      horarios: [...porHora.entries()].map(([hhmm, v]) => ({ hhmm, ...v }))
        .sort((a, b) => a.hhmm.localeCompare(b.hhmm)),
    };
  });
}

export async function cancelarTurno(slug: string, publicId: string): Promise<Resultado> {
  const r = await cancelar(publicId, slug);
  if (r.ok) {
    after(() => notificarCancelacion(publicId));
    revalidatePath(`/${slug}/turno/${publicId}`);
  }
  return r;
}

export async function reprogramarTurno(
  slug: string,
  publicId: string,
  destino: { lineaId: number; inicioIso: string; duracionMin: number }
): Promise<Resultado> {
  const r = await reprogramar(publicId, slug, destino);
  if (r.ok) {
    after(() => notificarReprogramacion(publicId));
    revalidatePath(`/${slug}/turno/${publicId}`);
  }
  return r;
}
