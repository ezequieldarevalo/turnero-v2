/**
 * Registro de lo que hace el personal en el panel.
 *
 * El sistema viejo no tenía nada de esto: si un turno aparecía cobrado, o
 * movido, o cancelado, no había forma de saber quién lo hizo. Con tres plantas
 * y varias personas por mostrador, eso es un problema el día que aparece una
 * diferencia de caja.
 *
 * Nunca hace fallar la operación que registra. Un turno cobrado y sin línea de
 * auditoría es un problema; un cobro rechazado porque no se pudo escribir la
 * auditoría es peor.
 */
import { prisma } from "@/lib/prisma";

export type AccionAuditada =
  | "turno.cobrado"
  | "turno.realizado"
  | "turno.ausente"
  | "turno.reprogramado"
  | "turno.cancelado"
  | "turno.creado"
  | "pago.revisado"
  | "config.editada"
  | "planta.creada"
  | "planta.desactivada"
  | "planta.reactivada"
  | "usuario.acceso"
  | "usuario.rol"
  | "usuario.baja"
  | "usuario.clave";

export async function auditar(datos: {
  plantaId: number;
  usuarioId: number | null;
  accion: AccionAuditada;
  entidad: string;
  entidadId?: number | null;
  antes?: unknown;
  despues?: unknown;
  ip?: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        plantaId: datos.plantaId,
        usuarioId: datos.usuarioId,
        accion: datos.accion,
        entidad: datos.entidad,
        entidadId: datos.entidadId ?? null,
        datosAntes: (datos.antes ?? undefined) as never,
        datosDespues: (datos.despues ?? undefined) as never,
        ip: datos.ip ?? null,
      },
    });
  } catch (e) {
    console.error("[auditoria] no se pudo registrar", datos.accion, e);
  }
}
