"use server";

import { prisma } from "@/lib/prisma";
import { calcularDisponibilidad } from "@/lib/disponibilidad";
import { headers } from "next/headers";
import { after } from "next/server";
import { notificarReserva } from "@/lib/notificar";

export interface DiaSerializado {
  fecha: string;
  horarios: { lineaId: number; iso: string; hhmm: string; duracionMin: number }[];
}

export async function obtenerDisponibilidad(
  slug: string,
  tipoVehiculoId: number
): Promise<DiaSerializado[]> {
  const planta = await prisma.planta.findUniqueOrThrow({
    where: { slug },
    select: { timezone: true },
  });

  const dias = await calcularDisponibilidad(prisma, { plantaSlug: slug, tipoVehiculoId });
  const fmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: planta.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return dias.map((d) => {
    // Un mismo horario puede estar libre en varias líneas. Al cliente se le
    // ofrece una sola vez; al reservar se toma la primera que quede libre.
    const porHora = new Map<string, { lineaId: number; iso: string; duracionMin: number }>();
    for (const c of d.cupos) {
      const hhmm = fmt.format(c.inicio);
      if (!porHora.has(hhmm)) {
        porHora.set(hhmm, { lineaId: c.lineaId, iso: c.inicio.toISOString(), duracionMin: c.duracionMin });
      }
    }
    return {
      fecha: d.fecha,
      horarios: [...porHora.entries()]
        .map(([hhmm, v]) => ({ hhmm, ...v }))
        .sort((a, b) => a.hhmm.localeCompare(b.hhmm)),
    };
  });
}

export type { DatosReserva, ResultadoReserva } from "@/lib/reservar";
import { reservar as reservarNucleo, type DatosReserva, type ResultadoReserva } from "@/lib/reservar";

export async function reservar(d: DatosReserva): Promise<ResultadoReserva> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const r = await reservarNucleo(d, ip);

  // Después de responder: el SMTP no debe demorar el redirect al pago.
  if (r.ok) after(() => notificarReserva(r.publicId));

  return r;
}
