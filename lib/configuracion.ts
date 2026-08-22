/**
 * Configuración de una planta.
 *
 * Todo esto hoy se hace a mano contra la base: no hay una sola pantalla en las
 * tres consolas viejas para tocar horarios, precios o feriados. Por eso esta
 * parte no es un port, es algo que no existía.
 *
 * Dos reglas que valen para todo el módulo:
 *
 *  - **Se valida acá, no solo en el formulario.** Las restricciones de verdad
 *    están en la base (el EXCLUDE de horarios, los CHECK de rangos), y un error
 *    de Postgres es ilegible para quien está cargando una banda horaria. Se
 *    traduce a algo que se entienda antes de que llegue.
 *  - **Todo cambio se audita** con quién y qué había antes. Cambiar un precio o
 *    un horario tiene consecuencias de plata, y hoy no queda rastro de nada.
 */
import { prisma } from "@/lib/prisma";
import type { Planta } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import type { Operador } from "@/lib/turnoAdmin";
import { COLUMNAS_AGENDA } from "@/lib/columnas";

export type Motivo =
  | "VALOR_INVALIDO"
  | "SIN_PERMISO"
  | "SOLAPAMIENTO"
  | "NO_EXISTE"
  | "TIENE_TURNOS"
  | "SIN_LINEA";

export type Resultado = { ok: true } | { ok: false; motivo: Motivo; detalle?: string };

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const NOMBRE_DIA = (n: number) => DIAS[n] ?? String(n);

// ─────────────────────────────────────────────────────────────
// Parámetros generales
// ─────────────────────────────────────────────────────────────

/**
 * Los campos que el panel deja editar, con su tipo y sus límites.
 *
 * `soloSuper` marca los que solo cambia quien administra el servicio. El
 * criterio no es "importante" —los precios y los horarios son importantísimos y
 * los maneja la planta— sino estos dos:
 *
 *  - **Quién se come la consecuencia.** Si el dueño pone 15 días de
 *    anticipación mínima se perjudica solo a él, y se da cuenta enseguida. Si
 *    apaga el cobro, el que deja de facturar es también el servicio.
 *  - **Si el error se nota.** Un error que rompe algo visible se arregla en
 *    cinco minutos. El peligroso es el que deja todo funcionando: los turnos
 *    siguen entrando, la agenda se ve normal, y lo que cambió no aparece hasta
 *    que alguien mira la caja.
 *
 * `maxDueno` es un tope más bajo para el dueño en campos que no son peligrosos
 * para su planta pero sí caros para la infraestructura compartida.
 */
export const CAMPOS = {
  nombre: { tipo: "texto", grupo: "identidad", etiqueta: "Nombre de la planta" },
  direccion: { tipo: "texto", grupo: "identidad", etiqueta: "Dirección" },
  marcaValor: { tipo: "texto", grupo: "identidad", etiqueta: "Texto de la marca" },
  colorPrimario: { tipo: "color", grupo: "identidad", etiqueta: "Color principal" },
  colorAdvertencia: { tipo: "color", grupo: "identidad", etiqueta: "Color de advertencia" },
  whatsappContacto: { tipo: "texto", grupo: "identidad", etiqueta: "WhatsApp de contacto", opcional: true },

  emailNombre: { tipo: "texto", grupo: "correo", etiqueta: "Nombre del remitente" },
  asuntoMail: { tipo: "texto", grupo: "correo", etiqueta: "Asunto de los correos" },

  // La disponibilidad se calcula al vuelo: 120 días son unos 17.000 cupos por
  // consulta y 730 son 103.000. Un dueño subiéndolo "por las dudas" degrada el
  // sitio de las otras plantas, que comparten la misma infraestructura.
  diasVentanaReserva: { tipo: "entero", grupo: "ventana", etiqueta: "Días hacia adelante que se pueden reservar", min: 1, max: 730, maxDueno: 180 },
  minutosMinimosAnticipacion: { tipo: "entero", grupo: "ventana", etiqueta: "Minutos mínimos de anticipación (pagando online)", min: 0, max: 43200 },
  minutosMinimosEfectivo: { tipo: "entero", grupo: "ventana", etiqueta: "Minutos mínimos para poder pagar en efectivo", min: 0, max: 43200, soloSuper: true },

  // El más peligroso de todos, y es una casilla. Apagado, cada turno queda
  // confirmado sin cobrar: no se rompe nada, no aparece ningún error, y se
  // puede perder una semana de facturación sin que nadie lo note.
  requierePago: { tipo: "si_no", grupo: "pago", etiqueta: "Cobra el turno por adelantado", soloSuper: true },
  minutosExpiracionPago: { tipo: "entero", grupo: "pago", etiqueta: "Minutos para pagar antes de liberar el cupo", min: 5, max: 10080 },
  minutosExpiracionConfirmacion: { tipo: "entero", grupo: "pago", etiqueta: "Minutos para confirmar un turno telefónico", min: 30, max: 20160 },
  pagoEfectivoHabilitado: { tipo: "si_no", grupo: "pago", etiqueta: "Acepta efectivo (Rapipago, Pago Fácil)" },
  // Los tiempos del efectivo, mal puestos, producen cupones pagados sobre
  // turnos ya vencidos: plata que hay que devolver de a una. Es exactamente lo
  // que pasaba en el sistema viejo. Si la planta ACEPTA efectivo sí es decisión
  // suya; cuánto vive el cupón, no.
  pagoEfectivoMinutos: { tipo: "entero", grupo: "pago", etiqueta: "Minutos de vigencia del cupón en efectivo", min: 60, max: 43200, soloSuper: true },
  margenPostEfectivoMin: { tipo: "entero", grupo: "pago", etiqueta: "Margen tras vencer el cupón, en minutos", min: 0, max: 1440, soloSuper: true },

  permiteCancelar: { tipo: "si_no", grupo: "autogestion", etiqueta: "El cliente puede cancelar solo" },
  permiteReprogramar: { tipo: "si_no", grupo: "autogestion", etiqueta: "El cliente puede cambiar la fecha solo" },
  horasMinimasCancelacion: { tipo: "entero", grupo: "autogestion", etiqueta: "Horas mínimas de anticipación para cancelar", min: 0, max: 720 },
  horasMinimasReprogramacion: { tipo: "entero", grupo: "autogestion", etiqueta: "Horas mínimas para cambiar la fecha", min: 0, max: 720 },
  maxReprogramaciones: { tipo: "entero", grupo: "autogestion", etiqueta: "Máximo de cambios de fecha", min: 0, max: 20, opcional: true },

  // Encenderlo donde estaba apagado hace que un tipo de vehículo necesite una
  // línea de su categoría que puede no existir, y el calendario se vacía para
  // ese tipo sin un solo mensaje de error.
  filtraLineaPorVehiculo: { tipo: "si_no", grupo: "reglas", etiqueta: "Cada tipo de vehículo usa solo las líneas de su categoría", soloSuper: true },
  turnosActivosPorPatente: { tipo: "entero", grupo: "reglas", etiqueta: "Turnos abiertos por patente", min: 1, max: 20, opcional: true },
  requiereRadicacionLocal: { tipo: "si_no", grupo: "reglas", etiqueta: "Exige radicación en la jurisdicción" },
  jurisdiccion: { tipo: "texto", grupo: "reglas", etiqueta: "Jurisdicción", opcional: true },

  registraRealizacion: { tipo: "si_no", grupo: "panel", etiqueta: "Se marca acá que el turno se realizó" },

  avisoTarifa: { tipo: "texto_largo", grupo: "textos", etiqueta: "Aviso sobre la tarifa", opcional: true },
} as const;

export type Campo = keyof typeof CAMPOS;

/** Si este campo lo puede tocar quien tiene este rol. */
export const editable = (campo: Campo, esSuperadmin: boolean): boolean =>
  esSuperadmin || !("soloSuper" in CAMPOS[campo]);

/** El tope que aplica a este rol: el dueño puede tener uno más bajo. */
export function topeDe(campo: Campo, esSuperadmin: boolean): number | undefined {
  const def = CAMPOS[campo] as { max?: number; maxDueno?: number };
  if (!esSuperadmin && def.maxDueno !== undefined) return def.maxDueno;
  return def.max;
}

export const GRUPOS: { id: string; titulo: string; ayuda?: string }[] = [
  { id: "identidad", titulo: "Identidad" },
  { id: "correo", titulo: "Correo", ayuda: "La dirección del remitente y la contraseña se cargan aparte, con las credenciales." },
  { id: "ventana", titulo: "Ventana de reserva", ayuda: "Los dos mínimos son distintos a propósito: quien paga online necesita apenas un par de horas, y quien paga en efectivo necesita que le alcance para ir a pagar el cupón y que se acredite. Un turno más cercano que el mínimo de efectivo se puede sacar igual, pero sin esa opción de pago." },
  { id: "pago", titulo: "Pago" },
  { id: "autogestion", titulo: "Qué puede hacer el cliente", ayuda: "Estos límites son solo para el cliente: el mostrador puede cancelar y reprogramar siempre." },
  { id: "reglas", titulo: "Reglas de negocio" },
  { id: "panel", titulo: "Panel" },
  { id: "textos", titulo: "Textos" },
];

export interface CambioGeneral {
  campos: Partial<Record<Campo, string | null>>;
  columnasAgenda?: string[];
  avisos?: { texto: string; destacado: boolean }[];
}

export async function guardarGenerales(
  entrada: Planta,
  cambio: CambioGeneral,
  quien: Operador,
  esSuperadmin = false
): Promise<Resultado> {
  // Se relee la planta en vez de confiar en el objeto que llega. Comparar
  // contra un dato viejo hace dos daños: un cambio que coincide con el valor
  // obsoleto se descarta en silencio, y el "antes" que queda en la auditoría
  // no es el que había de verdad.
  const planta = await prisma.planta.findUniqueOrThrow({ where: { id: entrada.id } });

  const datos: Record<string, unknown> = {};
  const antes: Record<string, unknown> = {};

  for (const [clave, valor] of Object.entries(cambio.campos)) {
    const def = CAMPOS[clave as Campo];
    if (!def) continue;

    // Se comprueba acá y no solo en la pantalla: el formulario es un endpoint,
    // y esconder un control no impide mandar el campo igual.
    if (!editable(clave as Campo, esSuperadmin)) {
      return {
        ok: false, motivo: "SIN_PERMISO",
        detalle: `"${def.etiqueta}" solo lo cambia quien administra el servicio.`,
      };
    }

    const actual = (planta as Record<string, unknown>)[clave];
    let nuevo: unknown;

    if (def.tipo === "si_no") {
      nuevo = valor === "on" || valor === "true";
    } else if (def.tipo === "entero") {
      const vacio = valor === null || valor === "";
      if (vacio) {
        if (!("opcional" in def && def.opcional)) {
          return { ok: false, motivo: "VALOR_INVALIDO", detalle: def.etiqueta };
        }
        nuevo = null;
      } else {
        const n = Number(valor);
        const min = "min" in def ? def.min : -Infinity;
        const max = topeDe(clave as Campo, esSuperadmin) ?? Infinity;
        if (!Number.isInteger(n) || n < min || n > max) {
          const propio = topeDe(clave as Campo, true);
          return {
            ok: false, motivo: "VALOR_INVALIDO",
            detalle:
              `${def.etiqueta}: tiene que ser un número entero entre ${min} y ${max}` +
              (!esSuperadmin && propio !== undefined && propio > max
                ? `. Para pasar de ${max} hace falta quien administra el servicio.`
                : ""),
          };
        }
        nuevo = n;
      }
    } else if (def.tipo === "color") {
      if (!/^#[0-9a-fA-F]{6}$/.test(valor ?? "")) {
        return { ok: false, motivo: "VALOR_INVALIDO", detalle: `${def.etiqueta}: no es un color válido` };
      }
      nuevo = valor;
    } else {
      const texto = (valor ?? "").trim();
      if (!texto && !("opcional" in def && def.opcional)) {
        return { ok: false, motivo: "VALOR_INVALIDO", detalle: `${def.etiqueta}: no puede quedar vacío` };
      }
      nuevo = texto || ("opcional" in def && def.opcional ? null : texto);
    }

    if (JSON.stringify(nuevo) !== JSON.stringify(actual)) {
      datos[clave] = nuevo;
      antes[clave] = actual;
    }
  }

  if (cambio.columnasAgenda) {
    // Se guardan en el orden canónico, no en el que llegue del formulario: la
    // tabla las lee tal cual y un orden arbitrario haría columnas ilegibles.
    const validas = COLUMNAS_AGENDA.filter((c) => cambio.columnasAgenda!.includes(c));
    if (validas.length === 0) {
      return { ok: false, motivo: "VALOR_INVALIDO", detalle: "La agenda necesita al menos una columna" };
    }
    if (JSON.stringify(validas) !== JSON.stringify(planta.columnasAgenda)) {
      datos.columnasAgenda = validas;
      antes.columnasAgenda = planta.columnasAgenda;
    }
  }

  if (cambio.avisos) {
    if (JSON.stringify(cambio.avisos) !== JSON.stringify(planta.avisos)) {
      datos.avisos = cambio.avisos;
      antes.avisos = planta.avisos;
    }
  }

  if (Object.keys(datos).length === 0) return { ok: true };

  await prisma.planta.update({ where: { id: planta.id }, data: datos });
  await auditar({
    plantaId: planta.id, usuarioId: quien.usuarioId, accion: "config.editada",
    entidad: "planta", entidadId: planta.id, ip: quien.ip,
    antes, despues: datos,
  });

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Horarios
// ─────────────────────────────────────────────────────────────

export const hhmmDeMinutos = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function minutosDeHhmm(texto: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min >= 0 && min <= 1440 ? min : null;
}

export interface BandaNueva {
  diaSemana: number;
  desde: string; // HH:MM
  hasta: string; // HH:MM, exclusivo
  slotsPorHora: number;
  lineaId: number | null; // null = todas las líneas
  mes: number | null; // null = todos los meses
}

export async function agregarHorario(
  planta: Planta,
  b: BandaNueva,
  quien: Operador
): Promise<Resultado> {
  const desde = minutosDeHhmm(b.desde);
  const hasta = minutosDeHhmm(b.hasta);

  if (desde === null || hasta === null) {
    return { ok: false, motivo: "VALOR_INVALIDO", detalle: "Las horas van en formato HH:MM" };
  }
  if (desde >= hasta) {
    return { ok: false, motivo: "VALOR_INVALIDO", detalle: "La hora de fin tiene que ser posterior a la de inicio" };
  }
  if (!Number.isInteger(b.slotsPorHora) || b.slotsPorHora < 1 || b.slotsPorHora > 60) {
    return { ok: false, motivo: "VALOR_INVALIDO", detalle: "Los turnos por hora van entre 1 y 60" };
  }
  if (b.diaSemana < 0 || b.diaSemana > 6) {
    return { ok: false, motivo: "VALOR_INVALIDO", detalle: "Día de la semana inválido" };
  }
  if (b.mes !== null && (b.mes < 1 || b.mes > 12)) {
    return { ok: false, motivo: "VALOR_INVALIDO", detalle: "Mes inválido" };
  }
  if (b.lineaId !== null) {
    const linea = await prisma.linea.findFirst({ where: { id: b.lineaId, plantaId: planta.id } });
    if (!linea) return { ok: false, motivo: "SIN_LINEA" };
  }

  try {
    const creado = await prisma.horario.create({
      data: {
        plantaId: planta.id, lineaId: b.lineaId, mes: b.mes,
        diaSemana: b.diaSemana, desde, hasta, slotsPorHora: b.slotsPorHora,
      },
    });
    await auditar({
      plantaId: planta.id, usuarioId: quien.usuarioId, accion: "config.editada",
      entidad: "horario", entidadId: creado.id, ip: quien.ip,
      despues: { ...b, desde, hasta },
    });
    return { ok: true };
  } catch (e: any) {
    // 23P01 es el EXCLUDE `horarios_sin_solapamiento`. Sin traducirlo, el
    // mensaje que ve quien carga una banda es un volcado de Postgres.
    if (String(e?.message ?? "").includes("horarios_sin_solapamiento") || e?.meta?.code === "23P01") {
      return {
        ok: false, motivo: "SOLAPAMIENTO",
        detalle: `Ya hay una banda que se pisa con ${b.desde}–${b.hasta} el ${NOMBRE_DIA(b.diaSemana)}`,
      };
    }
    throw e;
  }
}

export async function borrarHorario(
  planta: Planta,
  horarioId: number,
  quien: Operador
): Promise<Resultado> {
  const h = await prisma.horario.findFirst({ where: { id: horarioId, plantaId: planta.id } });
  if (!h) return { ok: false, motivo: "NO_EXISTE" };

  await prisma.horario.delete({ where: { id: h.id } });
  await auditar({
    plantaId: planta.id, usuarioId: quien.usuarioId, accion: "config.editada",
    entidad: "horario", entidadId: h.id, ip: quien.ip,
    antes: { diaSemana: h.diaSemana, desde: h.desde, hasta: h.hasta, slotsPorHora: h.slotsPorHora },
    despues: null,
  });
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Precios y tipos de vehículo
// ─────────────────────────────────────────────────────────────

/**
 * La oferta de un tipo: si se ofrece, con qué nombre y en qué orden.
 *
 * El precio NO está acá: tiene fecha de vigencia propia y vive en
 * `lib/precios.ts`. Mezclarlos obligaría a elegir una fecha cada vez que se
 * corrige una falta de ortografía en el nombre.
 */
export async function guardarTipo(
  planta: Planta,
  tipoVehiculoId: number,
  datos: { nombreDisplay: string | null; activo: boolean; orden: number },
  quien: Operador
): Promise<Resultado> {
  const actual = await prisma.plantaTipoVehiculo.findUnique({
    where: { plantaId_tipoVehiculoId: { plantaId: planta.id, tipoVehiculoId } },
  });

  // Activar un tipo sin línea de su categoría lo dejaría en el selector público
  // sin un solo horario que ofrecer: el cliente lo elige y no ve nada.
  if (datos.activo) {
    const tipo = await prisma.tipoVehiculo.findUniqueOrThrow({ where: { id: tipoVehiculoId } });
    if (planta.filtraLineaPorVehiculo) {
      const lineas = await prisma.linea.count({
        where: { plantaId: planta.id, categoriaId: tipo.categoriaId, activa: true },
      });
      if (lineas === 0) return { ok: false, motivo: "SIN_LINEA", detalle: tipo.nombre };
    }
  }

  await prisma.plantaTipoVehiculo.upsert({
    where: { plantaId_tipoVehiculoId: { plantaId: planta.id, tipoVehiculoId } },
    update: datos,
    create: { plantaId: planta.id, tipoVehiculoId, ...datos },
  });

  await auditar({
    plantaId: planta.id, usuarioId: quien.usuarioId, accion: "config.editada",
    entidad: "planta_tipo_vehiculo", entidadId: tipoVehiculoId, ip: quien.ip,
    antes: actual ? { activo: actual.activo, nombreDisplay: actual.nombreDisplay, orden: actual.orden } : null,
    despues: datos,
  });
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Líneas de atención
// ─────────────────────────────────────────────────────────────

/**
 * Las líneas son la capacidad física de la planta. Agregar una duplica los
 * cupos del día siguiente; desactivar una los reduce.
 */
export async function agregarLinea(
  planta: Planta,
  datos: { categoriaId: number; numero: string },
  quien: Operador
): Promise<Resultado> {
  const numero = datos.numero.trim();
  if (!numero) return { ok: false, motivo: "VALOR_INVALIDO", detalle: "Poné el número de la línea" };

  const categoria = await prisma.categoriaVehiculo.findUnique({ where: { id: datos.categoriaId } });
  if (!categoria) return { ok: false, motivo: "VALOR_INVALIDO", detalle: "Categoría inválida" };

  const existente = await prisma.linea.findUnique({
    where: {
      plantaId_categoriaId_numero: {
        plantaId: planta.id, categoriaId: datos.categoriaId, numero,
      },
    },
  });
  if (existente) {
    if (existente.activa) {
      return { ok: false, motivo: "VALOR_INVALIDO", detalle: `Ya existe la línea ${categoria.nombre} ${numero}` };
    }
    // Reactivar la que estaba dada de baja, en vez de crear una duplicada: sus
    // turnos históricos siguen colgando de ella.
    await prisma.linea.update({ where: { id: existente.id }, data: { activa: true } });
    await auditar({
      plantaId: planta.id, usuarioId: quien.usuarioId, accion: "config.editada",
      entidad: "linea", entidadId: existente.id, ip: quien.ip,
      antes: { activa: false }, despues: { activa: true },
    });
    return { ok: true };
  }

  const linea = await prisma.linea.create({
    data: { plantaId: planta.id, categoriaId: datos.categoriaId, numero },
  });
  await auditar({
    plantaId: planta.id, usuarioId: quien.usuarioId, accion: "config.editada",
    entidad: "linea", entidadId: linea.id, ip: quien.ip,
    despues: { categoria: categoria.nombre, numero },
  });
  return { ok: true };
}

/**
 * Da de baja una línea. No se borra: sus turnos pasados cuelgan de ella y son
 * la facturación histórica. Con turnos futuros sin atender no se puede: esa
 * gente quedaría citada en una línea que ya no existe.
 */
export async function desactivarLinea(
  planta: Planta,
  lineaId: number,
  quien: Operador
): Promise<Resultado> {
  const linea = await prisma.linea.findFirst({
    where: { id: lineaId, plantaId: planta.id },
    include: { categoria: true },
  });
  if (!linea) return { ok: false, motivo: "NO_EXISTE" };

  const futuros = await prisma.turno.count({
    where: {
      lineaId, inicio: { gte: new Date() },
      estado: { in: ["PENDIENTE_CONFIRMACION", "PENDIENTE_PAGO", "CONFIRMADO"] },
    },
  });
  if (futuros > 0) return { ok: false, motivo: "TIENE_TURNOS", detalle: String(futuros) };

  const activas = await prisma.linea.count({ where: { plantaId: planta.id, activa: true } });
  if (activas <= 1) {
    return { ok: false, motivo: "SIN_LINEA", detalle: "Es la única línea activa: la planta dejaría de ofrecer turnos" };
  }

  await prisma.linea.update({ where: { id: lineaId }, data: { activa: false } });
  await auditar({
    plantaId: planta.id, usuarioId: quien.usuarioId, accion: "config.editada",
    entidad: "linea", entidadId: lineaId, ip: quien.ip,
    antes: { activa: true, linea: `${linea.categoria.nombre} ${linea.numero}` },
    despues: { activa: false },
  });
  return { ok: true };
}
