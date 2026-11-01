/**
 * Configuración declarativa de las tres plantas: los valores REALES relevados.
 * Fuentes: tablas configs/precios/lineas/days de cada base, los .env, y el i18n
 * del frontend.
 *
 * Vive separado de `seed.ts` para que `comparar-config.ts` lea exactamente lo
 * mismo que el seed escribe. Si los datos estuvieran duplicados en los dos
 * archivos, el comparador mentiría apenas uno de los dos cambiara.
 *
 * Horarios en minutos desde medianoche. `hasta` es exclusivo.
 *   480 = 08:00 · 770 = 12:50 · 780 = 13:00 · 950 = 15:50 · 1020 = 17:00
 *
 * El recorte a :50 de Revitotal deja de ser un algoritmo: es `hasta = 950`.
 */

export const HM = (h: number, m = 0) => h * 60 + m;

export const LUN_A_VIE = [1, 2, 3, 4, 5];
export const SABADO = 6;
// Domingo no tiene fila: sin horario = cerrado.

// ── Catálogo global ────────────────────────────────────────
export const CATEGORIAS = [
  { codigo: "L", nombre: "Livianos" },
  { codigo: "M", nombre: "Motos" },
  // Existe aunque hoy ninguna planta lo ofrezca.
  { codigo: "P", nombre: "Pesados" },
];

export const TIPOS = [
  { nombre: "AUTO PARTICULAR", categoria: "L" },
  { nombre: "CAMIONETA PARTICULAR", categoria: "L" },
  { nombre: "MOTO HASTA 300 CC", categoria: "M" },
  { nombre: "MOTO MAS DE 300 CC", categoria: "M" },
];

// Dos de livianos y una de motos en las tres plantas.
export const LINEAS = [
  { categoria: "L", numero: "1" },
  { categoria: "L", numero: "2" },
  { categoria: "M", numero: "1" },
];

export const OFERTA = [
  { nombre: "AUTO PARTICULAR", precio: 70000 },
  { nombre: "MOTO HASTA 300 CC", precio: 26000 },
  { nombre: "MOTO MAS DE 300 CC", precio: 48500 },
  { nombre: "CAMIONETA PARTICULAR", precio: 77500 },
];

// Las Heras y Maipú renombran dos tipos en la pantalla. Godoy Cruz usa el del catálogo.
export const DISPLAY_REVITOTAL = {
  "AUTO PARTICULAR": "AUTOMOVIL",
  "CAMIONETA PARTICULAR": "CAMIONETA/SUV/UTILITARIO",
} as const;

// ── Avisos (salen del i18n del frontend) ───────────────────
export const AVISO_TARIFA =
  "Recuerde que deberá abonar la diferencia por la tarifa vigente al momento de realizar la inspección en el taller.";

export const avisosRevitotal = [
  { texto: AVISO_TARIFA, destacado: true },
  { texto: "Su turno estará confirmado una vez realizado el pago.", destacado: false },
  {
    texto: "Podrá abonar el turno a través de MERCADO PAGO con todas las tarjetas y en efectivo.",
    destacado: false,
  },
];

export const avisosGodoyCruz = [
  // El texto original decía "si su turno corresponde al año 2025". Se migra sin
  // el año: es el mismo problema que ya se corrigió en Las Heras y Maipú.
  { texto: AVISO_TARIFA, destacado: true },
  { texto: "Tenga en cuenta que su turno estará confirmado una vez realizado el pago.", destacado: false },
  { texto: "Podrá abonar el turno con Mercado Pago.", destacado: false },
  { texto: "Nuestro sistema lo redireccionará a la plataforma elegida para efectuarlo.", destacado: false },
];

export const MEDIOS_EXCLUIDOS = ["bapropagos", "cargavirtual", "redlink", "cobroexpress"];

// ── Plantas ────────────────────────────────────────────────
// Columnas de la tabla del día, tal como quedaron en cada consola vieja.
// En Revitotal alguien comentó Orden/ID/Estado/Tipo y descomentó Monto y
// Teléfono; en Godoy Cruz quedó al revés. Era la única diferencia real
// entre las tres consolas, y acá pasa a ser un dato.
export const COLUMNAS_REVITOTAL = ["fecha", "hora", "dominio", "nombre", "pago", "telefono"];
export const COLUMNAS_GODOYCRUZ = ["orden", "numero", "estado", "fecha", "hora", "dominio", "nombre", "tipoVehiculo", "pago"];

export const INICIO_PRECIOS = new Date("2020-01-01T00:00:00.000Z");

export const PLANTAS = [
  {
    slug: "lasheras",
    hostLegacy: "lhrevitotal.reviturnos.com.ar",
    nombre: "Revitotal Las Heras",
    direccion: "Acceso Norte Lateral Este S/N Km 6,5 - Bº El Plumerillo, Las Heras",
    marcaValor: "REVITOTAL",
    colorPrimario: "#74ACDF", // era rgb(116,172,223)
    colorAdvertencia: "#b80000",
    emailRemitente: "turnoslasheras@revitotal.com.ar",
    emailNombre: "Revitotal Las Heras",
    whatsappContacto: "261-770-0710",
    permiteReprogramar: true,
    maxReprogramaciones: 2, // después del tope, solo por WhatsApp
    pagoEfectivoHabilitado: true,
    registraRealizacion: true,
    columnasAgenda: COLUMNAS_REVITOTAL,
    filtraLineaPorVehiculo: false, // IGNORE_LINES=true
    avisos: avisosRevitotal,
    display: DISPLAY_REVITOTAL,
    horario: { habil: [HM(8), HM(15, 50)], sabado: [HM(8), HM(12, 50)] },
    slotsPorHora: 6, // un turno cada 10 minutos
  },
  {
    slug: "maipu",
    hostLegacy: "marevitotal.reviturnos.com.ar",
    nombre: "Revitotal Maipú",
    direccion: "Mallea S/N entre Alsina y Dorrego, General Gutiérrez, Maipú",
    marcaValor: "REVITOTAL",
    colorPrimario: "#74ACDF",
    colorAdvertencia: "#b80000",
    emailRemitente: "turnosmaipu@revitotal.com.ar",
    emailNombre: "Revitotal Maipú",
    whatsappContacto: "261-770-0710",
    permiteReprogramar: true,
    maxReprogramaciones: 2,
    pagoEfectivoHabilitado: true,
    registraRealizacion: true,
    columnasAgenda: COLUMNAS_REVITOTAL,
    filtraLineaPorVehiculo: false,
    avisos: avisosRevitotal,
    display: DISPLAY_REVITOTAL,
    horario: { habil: [HM(8), HM(15, 50)], sabado: [HM(8), HM(12, 50)] },
    slotsPorHora: 6,
  },
  {
    slug: "godoycruz",
    hostLegacy: "rtogodoycruz.reviturnos.com.ar",
    nombre: "RTVO Centro Express Godoy Cruz",
    direccion: "Luis María Drago 51, Godoy Cruz, Mendoza",
    marcaValor: "RTO GODOY CRUZ",
    colorPrimario: "#052c33",
    colorAdvertencia: "#d68227",
    // La tabla `lineas` de Godoy Cruz no tiene columna email —a diferencia
    // de las otras dos—, así que este dato no salió del relevamiento sino
    // de la cuenta SMTP real: turnos@rtogodoycruz.com.ar
    emailRemitente: "turnos@rtogodoycruz.com.ar",
    emailNombre: "RTO Godoy Cruz",
    whatsappContacto: null,
    permiteReprogramar: true,
    maxReprogramaciones: 2,
    pagoEfectivoHabilitado: false,
    // Godoy Cruz registra la atención en otro sistema: acá no se ofrece.
    registraRealizacion: false,
    columnasAgenda: COLUMNAS_GODOYCRUZ,
    filtraLineaPorVehiculo: true,
    avisos: avisosGodoyCruz,
    display: {} as Record<string, string>,
    horario: { habil: [HM(8), HM(17)], sabado: [HM(8), HM(13)] },
    slotsPorHora: 4, // un turno cada 15 minutos
  },
];

export type PlantaSeed = (typeof PLANTAS)[number];

/** Los campos de la fila `plantas`, tal como los escribe el seed. */
export function datosPlanta(p: PlantaSeed) {
  return {
      nombre: p.nombre,
      direccion: p.direccion,
      marcaTipo: "texto",
      marcaValor: p.marcaValor,
      colorPrimario: p.colorPrimario,
      colorAdvertencia: p.colorAdvertencia,
      emailRemitente: p.emailRemitente,
      emailNombre: p.emailNombre,
      asuntoMail: `Turno - ${p.nombre}`,
      whatsappContacto: p.whatsappContacto,
      hostLegacy: p.hostLegacy,

      diasVentanaReserva: 120,
      // Dos horas para quien paga online; para efectivo el cupón vive 48 h y
      // la acreditación tarda, así que ese camino necesita 50.
      minutosMinimosAnticipacion: 120,
      minutosMinimosEfectivo: 3000,

      requierePago: true,
      minutosExpiracionPago: 120,
      pagoEfectivoHabilitado: p.pagoEfectivoHabilitado,
      pagoEfectivoMinutos: 2880,
      margenPostEfectivoMin: 120,
      mediosPagoExcluidos: MEDIOS_EXCLUIDOS,

      permiteCancelar: true,
      permiteReprogramar: p.permiteReprogramar,
      maxReprogramaciones: p.maxReprogramaciones,

      filtraLineaPorVehiculo: p.filtraLineaPorVehiculo,
      registraRealizacion: p.registraRealizacion,
      columnasAgenda: p.columnasAgenda,
      jurisdiccion: "Mendoza",

      avisos: p.avisos,
      avisoTarifa: AVISO_TARIFA,
  };
}

/** Las filas de `horarios` que le corresponden a una planta. */
export function horariosDe(p: PlantaSeed) {
  return [
    ...LUN_A_VIE.map((diaSemana) => ({
      diaSemana,
      desde: p.horario.habil[0],
      hasta: p.horario.habil[1],
      slotsPorHora: p.slotsPorHora,
    })),
    {
      diaSemana: SABADO,
      desde: p.horario.sabado[0],
      hasta: p.horario.sabado[1],
      slotsPorHora: p.slotsPorHora,
    },
  ];
}
