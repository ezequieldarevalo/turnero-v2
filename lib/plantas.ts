/**
 * Alta y baja de plantas.
 *
 * Es el objetivo del proyecto: una planta tiene que ser una fila en una tabla,
 * no un despliegue. Hoy sumar un cliente significa clonar tres repositorios,
 * editar once líneas con el hostname, crear una base MySQL y levantar un
 * contenedor más. Acá es un formulario.
 *
 * El alta crea la planta **y sus líneas**, porque una planta sin líneas no
 * ofrece un solo turno: sería dar de alta un cliente que no funciona y dejarlo
 * descubrirlo solo.
 */
import { prisma } from "@/lib/prisma";
import { auditar } from "@/lib/auditoria";
import { validarEmail, validarTelefono, recortar } from "@/lib/validaciones";
import type { Operador } from "@/lib/turnoAdmin";

export type Motivo =
  | "SLUG_INVALIDO"
  | "SLUG_TOMADO"
  | "DATOS_INVALIDOS"
  | "SIN_LINEAS"
  | "NO_EXISTE"
  | "TIENE_TURNOS";

export type Resultado = { ok: true; slug: string } | { ok: false; motivo: Motivo; detalle?: string };

/** Minúsculas, sin acentos ni espacios: va en la URL pública de la planta. */
export const normalizarSlug = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Reservados por rutas propias del sitio. */
const PROHIBIDOS = ["admin", "api", "privacidad", "turno", "_next", "static", "favicon"];

export interface LineaNueva {
  categoriaId: number;
  numero: string;
}

export interface DatosPlanta {
  slug: string;
  nombre: string;
  direccion: string;
  marcaValor: string;
  colorPrimario: string;
  colorAdvertencia: string;
  emailRemitente: string;
  emailNombre: string;
  whatsappContacto?: string;
  jurisdiccion?: string;
  timezone: string;
  lineas: LineaNueva[];
}

export async function crearPlanta(d: DatosPlanta, quien: Operador): Promise<Resultado> {
  const slug = normalizarSlug(d.slug);

  if (slug.length < 3 || slug.length > 30) {
    return { ok: false, motivo: "SLUG_INVALIDO", detalle: "Entre 3 y 30 caracteres, letras y números" };
  }
  if (PROHIBIDOS.includes(slug)) {
    return { ok: false, motivo: "SLUG_INVALIDO", detalle: `"${slug}" está reservado por el sistema` };
  }
  if (!d.nombre.trim() || !d.direccion.trim() || !d.marcaValor.trim()) {
    return { ok: false, motivo: "DATOS_INVALIDOS", detalle: "Faltan el nombre, la dirección o la marca" };
  }
  const malCorreo = validarEmail(d.emailRemitente, "emailRemitente");
  if (malCorreo) return { ok: false, motivo: "DATOS_INVALIDOS", detalle: malCorreo.mensaje };
  if (d.whatsappContacto?.trim()) {
    const malTel = validarTelefono(d.whatsappContacto, "whatsappContacto");
    if (malTel) return { ok: false, motivo: "DATOS_INVALIDOS", detalle: `WhatsApp: ${malTel.mensaje}` };
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(d.colorPrimario) || !/^#[0-9a-fA-F]{6}$/.test(d.colorAdvertencia)) {
    return { ok: false, motivo: "DATOS_INVALIDOS", detalle: "Los colores van en hexadecimal (#RRGGBB)" };
  }
  // Sin líneas la planta no ofrece un solo turno. Dejarla crear así sería
  // entregar un cliente roto y que se entere el primer día.
  if (!d.lineas.length) return { ok: false, motivo: "SIN_LINEAS" };

  if (await prisma.planta.findUnique({ where: { slug } })) {
    return { ok: false, motivo: "SLUG_TOMADO", detalle: slug };
  }

  const planta = await prisma.planta.create({
    data: {
      slug,
      nombre: recortar(d.nombre, "texto"),
      direccion: recortar(d.direccion, "direccion"),
      marcaValor: recortar(d.marcaValor, "texto"),
      colorPrimario: d.colorPrimario,
      colorAdvertencia: d.colorAdvertencia,
      emailRemitente: recortar(d.emailRemitente, "email").toLowerCase(),
      emailNombre: recortar(d.emailNombre, "texto") || recortar(d.nombre, "texto"),
      asuntoMail: `Turno - ${recortar(d.nombre, "texto")}`,
      whatsappContacto: recortar(d.whatsappContacto, "telefono") || null,
      jurisdiccion: recortar(d.jurisdiccion, "texto") || null,
      timezone: d.timezone,
      lineas: {
        create: d.lineas.map((l) => ({ categoriaId: l.categoriaId, numero: l.numero.trim() })),
      },
    },
  });

  await auditar({
    plantaId: planta.id, usuarioId: quien.usuarioId, accion: "planta.creada",
    entidad: "planta", entidadId: planta.id, ip: quien.ip,
    despues: { slug, nombre: planta.nombre, lineas: d.lineas.length },
  });

  return { ok: true, slug };
}

/**
 * Da de baja una planta sin borrarla: sus turnos y sus pagos son historia
 * contable. Deja de aparecer en el panel y su sitio público deja de ofrecer
 * turnos, pero los links de los turnos ya emitidos siguen funcionando.
 */
export async function desactivarPlanta(slug: string, quien: Operador): Promise<Resultado> {
  const planta = await prisma.planta.findUnique({ where: { slug } });
  if (!planta) return { ok: false, motivo: "NO_EXISTE" };

  const futuros = await prisma.turno.count({
    where: {
      plantaId: planta.id,
      inicio: { gte: new Date() },
      estado: { in: ["PENDIENTE_CONFIRMACION", "PENDIENTE_PAGO", "CONFIRMADO"] },
    },
  });
  if (futuros > 0) return { ok: false, motivo: "TIENE_TURNOS", detalle: String(futuros) };

  await prisma.planta.update({ where: { id: planta.id }, data: { activa: false } });
  await auditar({
    plantaId: planta.id, usuarioId: quien.usuarioId, accion: "planta.desactivada",
    entidad: "planta", entidadId: planta.id, ip: quien.ip,
    antes: { activa: true }, despues: { activa: false },
  });
  return { ok: true, slug };
}

export async function reactivarPlanta(slug: string, quien: Operador): Promise<Resultado> {
  const planta = await prisma.planta.findUnique({ where: { slug } });
  if (!planta) return { ok: false, motivo: "NO_EXISTE" };
  await prisma.planta.update({ where: { id: planta.id }, data: { activa: true } });
  await auditar({
    plantaId: planta.id, usuarioId: quien.usuarioId, accion: "planta.reactivada",
    entidad: "planta", entidadId: planta.id, ip: quien.ip,
    antes: { activa: false }, despues: { activa: true },
  });
  return { ok: true, slug };
}

export interface Faltante {
  clave: string;
  texto: string;
  ruta: string | null;
}

/**
 * Qué le falta a una planta para poder vender un turno.
 *
 * Existe porque el alta deja la planta creada pero no operativa, y sin esta
 * lista el que la dio de alta no tiene forma de saber qué le falta hasta que un
 * cliente entra al sitio y no ve nada.
 */
export async function faltantes(plantaId: number, slug: string): Promise<Faltante[]> {
  const [lineas, tipos, horarios, mp, smtp] = await Promise.all([
    prisma.linea.count({ where: { plantaId, activa: true } }),
    prisma.plantaTipoVehiculo.count({ where: { plantaId, activo: true } }),
    prisma.horario.count({ where: { plantaId } }),
    prisma.mpCredencial.count({ where: { plantaId } }),
    prisma.credencialSmtp.count({ where: { plantaId } }),
  ]);

  const conPrecio = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(DISTINCT "tipoVehiculoId") AS n
    FROM precios_vigencia
    WHERE "plantaId" = ${plantaId} AND "vigenteDesde" <= now()
  `;
  const precios = Number(conPrecio[0]?.n ?? 0);
  const planta = await prisma.planta.findUniqueOrThrow({
    where: { id: plantaId }, select: { requierePago: true },
  });

  const falta: Faltante[] = [];
  if (lineas === 0) falta.push({ clave: "lineas", texto: "No tiene ninguna línea de atención", ruta: `/admin/${slug}/configuracion/lineas` });
  if (horarios === 0) falta.push({ clave: "horarios", texto: "No tiene horarios: está cerrada todos los días", ruta: `/admin/${slug}/configuracion/horarios` });
  if (tipos === 0) falta.push({ clave: "tipos", texto: "No ofrece ningún tipo de vehículo", ruta: `/admin/${slug}/configuracion/precios` });
  else if (precios < tipos) falta.push({ clave: "precios", texto: `${tipos - precios} tipo(s) ofrecidos sin precio cargado`, ruta: `/admin/${slug}/configuracion/precios` });
  if (planta.requierePago && mp === 0) falta.push({ clave: "mp", texto: "No tiene credenciales de MercadoPago: no puede cobrar", ruta: null });
  if (smtp === 0) falta.push({ clave: "smtp", texto: "No tiene credenciales de correo: no manda avisos", ruta: null });

  return falta;
}
