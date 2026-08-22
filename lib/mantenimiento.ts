/**
 * Trabajo periódico. Dos tareas, ambas idempotentes: correrlas de más no rompe
 * nada, y esa es la condición para poder programarlas sin miedo.
 *
 *  1. `vencerReservas` — libera los cupos retenidos por reservas que nunca se
 *     pagaron. Sin esto `venceAt` es decorativo: se escribe al reservar y nadie
 *     lo mira, así que un turno impago bloquea el horario para siempre.
 *
 *  2. `cerrarDia` — guarda cuántos cupos hubo y cuántos se vendieron en el día
 *     que terminó. La disponibilidad se calcula al vuelo desde la configuración
 *     vigente; una vez cambiada, cuánta capacidad hubo el mes pasado ya no se
 *     puede reconstruir. Este es el único registro.
 */
import { prisma } from "@/lib/prisma";
import { EstadoTurno, TipoExcepcion } from "@prisma/client";
import { ESTADOS_OCUPANTES, cuposDeLinea } from "@/lib/disponibilidad";
import { comoFechaSola, fechaLocal, rangoDelDia, sumarDias } from "@/lib/fechas";
import { buscarPagosPorReferencia } from "@/lib/mercadopago";
import { aplicarPago } from "@/lib/pagos";
import { notificarVencimiento } from "@/lib/notificar";
import { limpiarSesiones } from "@/lib/auth";

/** Los que retienen el cupo esperando algo que puede no llegar. */
const EN_ESPERA = [EstadoTurno.PENDIENTE_PAGO, EstadoTurno.PENDIENTE_CONFIRMACION];

export interface ResultadoVencimiento {
  revisados: number;
  vencidos: number;
  rescatados: number; // pagos que estaban y la notificación se había perdido
  sesiones: number; // sesiones vencidas que se borraron de paso
  errores: string[];
}

export async function vencerReservas(ahora = new Date()): Promise<ResultadoVencimiento> {
  const r: ResultadoVencimiento = { revisados: 0, vencidos: 0, rescatados: 0, sesiones: 0, errores: [] };

  // De paso, las sesiones del panel que ya expiraron: sin esto la tabla crece
  // para siempre con filas que no sirven para nada.
  r.sesiones = await limpiarSesiones(ahora);

  const pendientes = await prisma.turno.findMany({
    where: { estado: { in: EN_ESPERA }, venceAt: { not: null, lt: ahora } },
    include: { planta: { select: { id: true, slug: true } } },
    orderBy: { venceAt: "asc" },
  });

  for (const t of pendientes) {
    r.revisados++;

    // Antes de soltar el cupo, preguntarle a MercadoPago si el pago existe.
    // Un turno cargado por teléfono nunca tuvo preferencia: ahí no hay nada
    // que conciliar y se vence directo.
    if (t.estado === EstadoTurno.PENDIENTE_PAGO && t.preferenciaId) {
      try {
        const pagos = await buscarPagosPorReferencia(t.plantaId, t.planta.slug, t.publicId);
        const aprobado = pagos.find((p) => p.status === "approved");
        if (aprobado) {
          // Corre fuera de un request: el correo se manda acá mismo, no diferido.
          await aplicarPago(t.plantaId, t.planta.slug, aprobado, (fn) => void fn());
          r.rescatados++;
          console.warn(
            `[mantenimiento] ${t.planta.slug}/${t.publicId}: estaba pago y sin confirmar. ` +
              `Se perdió el webhook del pago ${aprobado.id}.`
          );
          continue;
        }
        // Efectivo emitido y todavía vigente: el cupón corre hasta su fecha.
        const enCurso = pagos.find(
          (p) => p.status === "pending" && p.date_of_expiration && new Date(p.date_of_expiration) > ahora
        );
        if (enCurso) {
          await prisma.turno.update({
            where: { id: t.id },
            data: { venceAt: new Date(enCurso.date_of_expiration) },
          });
          continue;
        }
      } catch (e) {
        // Si MercadoPago no responde NO se vence: se deja para la corrida
        // siguiente. Retener un cupo de más es reversible; sacarle el turno a
        // alguien que pagó, no.
        r.errores.push(`${t.planta.slug}/${t.publicId}: ${(e as Error).message}`);
        continue;
      }
    }

    // Condicional sobre el estado: si el pago entró entre la lectura y ahora,
    // el turno ya no está pendiente y este update no toca nada.
    const { count } = await prisma.turno.updateMany({
      where: { id: t.id, estado: t.estado },
      data: { estado: EstadoTurno.EXPIRADO, venceAt: null, pagoUrl: null },
    });
    if (count > 0) {
      r.vencidos++;
      await notificarVencimiento(
        t.publicId,
        t.estado === EstadoTurno.PENDIENTE_CONFIRMACION
      ).catch(() => {});
    }
  }

  return r;
}

export interface ResultadoCierre {
  fecha: string;
  filas: number;
}

/**
 * Cierra un día: por planta y línea, cuántos cupos ofreció la configuración y
 * cuántos se ocuparon. Por defecto el día de ayer, en la zona de cada planta.
 */
export async function cerrarDia(fecha?: string, ahora = new Date()): Promise<ResultadoCierre[]> {
  const plantas = await prisma.planta.findMany({
    where: { activa: true },
    include: { lineas: { where: { activa: true } }, horarios: true },
  });

  const salida: ResultadoCierre[] = [];

  for (const planta of plantas) {
    const dia = fecha ?? ayer(ahora, planta.timezone);

    const feriado = await prisma.feriado.findFirst({
      where: { plantaId: planta.id, fecha: comoFechaSola(dia) },
    });

    // El rango en la zona de la planta, no en UTC: el día 15 en Mendoza va de
    // las 03:00 UTC del 15 a las 03:00 UTC del 16.
    const { desde, hasta } = rangoDelDia(dia, planta.timezone);

    const [ocupados, excepciones] = await Promise.all([
      prisma.turno.groupBy({
        by: ["lineaId"],
        where: {
          plantaId: planta.id,
          estado: { in: ESTADOS_OCUPANTES },
          inicio: { gte: desde, lt: hasta },
          // Las atenciones sin turno previo no consumen cupo de ninguna línea:
          // contarlas como vendidas inflaría la ocupación por encima del 100%.
          lineaId: { not: null },
        },
        _count: true,
      }),
      prisma.excepcionCupo.findMany({
        where: { plantaId: planta.id, inicio: { gte: desde, lt: hasta } },
      }),
    ]);
    const vendidosPor = new Map(ocupados.map((o) => [o.lineaId, o._count]));

    let filas = 0;
    for (const linea of planta.lineas) {
      const base = feriado ? 0 : cuposDeLinea(planta.horarios, linea.id, dia, planta.timezone).length;
      const extra = excepciones.filter((e) => e.lineaId === linea.id);
      const ofrecidos =
        base +
        extra.filter((e) => e.tipo === TipoExcepcion.AGREGAR).length -
        extra.filter((e) => e.tipo === TipoExcepcion.BLOQUEAR).length;
      const vendidos = vendidosPor.get(linea.id) ?? 0;
      if (ofrecidos <= 0 && vendidos === 0) continue;

      const fechaSola = comoFechaSola(dia);
      await prisma.ocupacionDiaria.upsert({
        where: { plantaId_lineaId_fecha: { plantaId: planta.id, lineaId: linea.id, fecha: fechaSola } },
        update: { ofrecidos: Math.max(ofrecidos, 0), vendidos },
        create: {
          plantaId: planta.id, lineaId: linea.id, fecha: fechaSola,
          ofrecidos: Math.max(ofrecidos, 0), vendidos,
        },
      });
      filas++;
    }

    salida.push({ fecha: `${planta.slug} ${dia}`, filas });
  }

  return salida;
}

/** YYYY-MM-DD del día anterior en la zona horaria dada. */
const ayer = (ahora: Date, timezone: string) => sumarDias(fechaLocal(ahora, timezone), -1);
