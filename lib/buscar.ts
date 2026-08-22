/**
 * Búsqueda de turnos desde el mostrador.
 *
 * El sistema viejo tenía dos endpoints separados —uno por número y otro por
 * patente— y la consola te hacía elegir de antemano cuál usabas. Acá hay una
 * sola caja: se mira lo que se tipeó y se decide solo. La persona que llega al
 * mostrador dice "AB123CD" o "mi turno es el 4F2A…" o "soy Pérez", y el
 * operador no tiene que traducir eso a una categoría antes de escribir.
 */
import { prisma } from "@/lib/prisma";
import { EstadoTurno, type Planta, type Prisma } from "@prisma/client";
import { codigoCorto, esCodigo, normalizarCodigo } from "@/lib/codigo";
import { normalizarDominio, pareceDominio } from "@/lib/dominio";

export type Campo = "codigo" | "dominio" | "email" | "telefono" | "nombre";

export interface Resultado {
  publicId: string;
  codigo: string;
  inicio: Date;
  estado: EstadoTurno;
  dominio: string;
  titularNombre: string;
  titularTelefono: string | null;
  titularEmail: string;
  tipoVehiculo: string;
  cobrado: number | null;
}

export interface Busqueda {
  consulta: string;
  campo: Campo;
  resultados: Resultado[];
  /** Cuántos hay en total, si se recortó la lista. */
  total: number;
}

const TOPE = 50;

export function detectarCampo(texto: string): Campo {
  if (esCodigo(texto)) return "codigo";
  if (texto.includes("@")) return "email";
  if (pareceDominio(texto)) return "dominio";
  if (/^\d{6,}$/.test(texto.replace(/[\s()-]/g, ""))) return "telefono";
  return "nombre";
}

export async function buscarTurnos(planta: Planta, consulta: string): Promise<Busqueda> {
  const texto = consulta.trim();
  if (texto.length < 3) {
    return { consulta: texto, campo: "nombre", resultados: [], total: 0 };
  }

  const campo = detectarCampo(texto);
  const donde: Prisma.TurnoWhereInput = { plantaId: planta.id, ...filtro(campo, texto) };

  const [total, turnos, oferta] = await Promise.all([
    prisma.turno.count({ where: donde }),
    prisma.turno.findMany({
      where: donde,
      // Lo más reciente primero: quien pregunta en el mostrador casi siempre
      // viene por el turno que tiene ahora, no por el de hace dos años.
      orderBy: { inicio: "desc" },
      take: TOPE,
      include: {
        tipo: { select: { nombre: true } },
        pagos: { select: { monto: true, estado: true } },
      },
    }),
    prisma.plantaTipoVehiculo.findMany({
      where: { plantaId: planta.id },
      select: { tipoVehiculoId: true, nombreDisplay: true },
    }),
  ]);

  const nombreDe = new Map(oferta.map((o) => [o.tipoVehiculoId, o.nombreDisplay]));

  return {
    consulta: texto,
    campo,
    total,
    resultados: turnos.map((t) => {
      const acreditado = t.pagos.filter((p) => p.estado === "approved").reduce((a, p) => a + p.monto, 0);
      return {
        publicId: t.publicId,
        codigo: codigoCorto(t.publicId),
        inicio: t.inicio,
        estado: t.estado,
        dominio: t.dominio,
        titularNombre: t.titularNombre,
        titularTelefono: t.titularTelefono,
        titularEmail: t.titularEmail,
        tipoVehiculo: nombreDe.get(t.tipoVehiculoId) ?? t.tipo.nombre,
        cobrado: acreditado > 0 ? acreditado : null,
      };
    }),
  };
}

function filtro(campo: Campo, texto: string): Prisma.TurnoWhereInput {
  switch (campo) {
    case "codigo":
      // El código son los últimos 8 caracteres del UUID sin guiones, y el UUID
      // termina en su último grupo: buscar por sufijo alcanza y usa igualdad
      // exacta de cadena, sin comodines al principio.
      return { publicId: { endsWith: normalizarCodigo(texto).toLowerCase() } };

    case "dominio":
      // Igualdad exacta: en la base las patentes están normalizadas, así que
      // `005-ESE` y `005ESE` son la misma fila y no hace falta probar variantes.
      return { dominio: normalizarDominio(texto) };

    case "email":
      // Sin distinguir mayúsculas, igual que el nombre. El camino de reserva
      // normaliza a minúsculas, pero los datos migrados no: 26.916 de los
      // 63.035 turnos traen el correo en mayúsculas desde el sistema viejo.
      // Comparando de forma sensible, el mostrador no encontraría a cuatro de
      // cada diez clientes buscándolos por su correo.
      return { titularEmail: { contains: texto.trim(), mode: "insensitive" } };

    case "telefono":
      return { titularTelefono: { contains: texto.replace(/[\s()-]/g, "") } };

    case "nombre": {
      // También se prueba como patente. No todas las patentes entran en los
      // formatos argentinos —hay extranjeras, viejas y cargadas con errores de
      // hace años—, y una que no encaje caería acá; buscar solo por nombre
      // devolvería vacío sin explicar por qué. Se busca por las dos y el
      // operador ve el resultado, no el criterio.
      const comoPatente = normalizarDominio(texto);
      const tambienPatente = comoPatente.length >= 5 && !texto.includes(" ");
      return {
        OR: [
          { titularNombre: { contains: texto, mode: "insensitive" } },
          ...(tambienPatente ? [{ dominio: { contains: comoPatente } }] : []),
        ],
      };
    }
  }
}

export const ETIQUETA_CAMPO: Record<Campo, string> = {
  codigo: "número de turno",
  dominio: "patente",
  email: "correo",
  telefono: "teléfono",
  nombre: "nombre o patente",
};
