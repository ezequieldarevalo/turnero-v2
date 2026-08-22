/**
 * Seed con los valores REALES relevados de las tres plantas.
 * Fuentes: tablas configs/precios/lineas/days de cada base, los .env, y el i18n del frontend.
 *
 * Horarios en minutos desde medianoche. `hasta` es exclusivo.
 *   480 = 08:00 · 770 = 12:50 · 780 = 13:00 · 950 = 15:50 · 1020 = 17:00
 *
 * El recorte a :50 de Revitotal deja de ser un algoritmo: es `hasta = 950`.
 */
import { PrismaClient, Rol } from "@prisma/client";

const prisma = new PrismaClient();

const HM = (h: number, m = 0) => h * 60 + m;

const LUN_A_VIE = [1, 2, 3, 4, 5];
const SABADO = 6;
// Domingo no tiene fila: sin horario = cerrado.

async function main() {
  // ── Catálogo global ────────────────────────────────────────
  const categorias = {
    L: await prisma.categoriaVehiculo.upsert({
      where: { codigo: "L" },
      update: {},
      create: { codigo: "L", nombre: "Livianos" },
    }),
    M: await prisma.categoriaVehiculo.upsert({
      where: { codigo: "M" },
      update: {},
      create: { codigo: "M", nombre: "Motos" },
    }),
    // Existe aunque hoy ninguna planta lo ofrezca.
    P: await prisma.categoriaVehiculo.upsert({
      where: { codigo: "P" },
      update: {},
      create: { codigo: "P", nombre: "Pesados" },
    }),
  };

  const tipos: Record<string, { id: number }> = {};
  for (const t of [
    { nombre: "AUTO PARTICULAR", categoriaId: categorias.L.id },
    { nombre: "CAMIONETA PARTICULAR", categoriaId: categorias.L.id },
    { nombre: "MOTO HASTA 300 CC", categoriaId: categorias.M.id },
    { nombre: "MOTO MAS DE 300 CC", categoriaId: categorias.M.id },
  ]) {
    tipos[t.nombre] = await prisma.tipoVehiculo.upsert({
      where: { nombre: t.nombre },
      update: {},
      create: t,
    });
  }

  // Precios idénticos en las tres plantas. El ORDEN es el del selector en vivo
  // (`vehicleTypeList` en lib/constants.ts), verificado contra el sitio público:
  // AUTOMOVIL · MOTO HASTA 300 CC · MOTO MAS DE 300 CC · CAMIONETA/SUV
  const OFERTA = [
    { nombre: "AUTO PARTICULAR", precio: 58600 },
    { nombre: "MOTO HASTA 300 CC", precio: 21700 },
    { nombre: "MOTO MAS DE 300 CC", precio: 40500 },
    { nombre: "CAMIONETA PARTICULAR", precio: 64700 },
  ];

  // Las Heras y Maipú renombran dos tipos en la pantalla. Godoy Cruz usa el del catálogo.
  const DISPLAY_REVITOTAL = {
    "AUTO PARTICULAR": "AUTOMOVIL",
    "CAMIONETA PARTICULAR": "CAMIONETA/SUV/UTILITARIO",
  } as const;

  // ── Avisos (salen del i18n del frontend) ───────────────────
  const AVISO_TARIFA =
    "Recuerde que deberá abonar la diferencia por la tarifa vigente al momento de realizar la inspección en el taller.";

  const avisosRevitotal = [
    { texto: AVISO_TARIFA, destacado: true },
    { texto: "Su turno estará confirmado una vez realizado el pago.", destacado: false },
    {
      texto: "Podrá abonar el turno a través de MERCADO PAGO con todas las tarjetas y en efectivo.",
      destacado: false,
    },
  ];

  const avisosGodoyCruz = [
    // El texto original decía "si su turno corresponde al año 2025". Se migra sin
    // el año: es el mismo problema que ya se corrigió en Las Heras y Maipú.
    { texto: AVISO_TARIFA, destacado: true },
    { texto: "Tenga en cuenta que su turno estará confirmado una vez realizado el pago.", destacado: false },
    { texto: "Podrá abonar el turno con Mercado Pago.", destacado: false },
    { texto: "Nuestro sistema lo redireccionará a la plataforma elegida para efectuarlo.", destacado: false },
  ];

  const MEDIOS_EXCLUIDOS = ["bapropagos", "cargavirtual", "redlink", "cobroexpress"];

  // ── Plantas ────────────────────────────────────────────────
  // Columnas de la tabla del día, tal como quedaron en cada consola vieja.
  // En Revitotal alguien comentó Orden/ID/Estado/Tipo y descomentó Monto y
  // Teléfono; en Godoy Cruz quedó al revés. Era la única diferencia real
  // entre las tres consolas, y acá pasa a ser un dato.
  const COLUMNAS_REVITOTAL = ["fecha", "hora", "dominio", "nombre", "pago", "telefono"];
  const COLUMNAS_GODOYCRUZ = ["orden", "numero", "estado", "fecha", "hora", "dominio", "nombre", "tipoVehiculo", "pago"];

  const INICIO_PRECIOS = new Date("2020-01-01T00:00:00.000Z");

  const PLANTAS = [
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
      permiteReprogramar: false, // manda a WhatsApp en vez de link
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
      permiteReprogramar: false,
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

  for (const p of PLANTAS) {
    // Los mismos datos para create y update: el seed tiene que ser idempotente
    // de verdad. Con `update: {}` un campo nuevo nunca llega a las plantas
    // que ya existen — pasó con hostLegacy.
    const datos = {
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

        filtraLineaPorVehiculo: p.filtraLineaPorVehiculo,
        registraRealizacion: p.registraRealizacion,
        columnasAgenda: p.columnasAgenda,
        jurisdiccion: "Mendoza",

        avisos: p.avisos,
        avisoTarifa: AVISO_TARIFA,
    };

    const planta = await prisma.planta.upsert({
      where: { slug: p.slug },
      update: datos,
      create: { slug: p.slug, ...datos },
    });

    // Oferta de tipos de vehículo, en el orden del selector
    for (const [i, { nombre, precio }] of OFERTA.entries()) {
      const datosTipo = {
        orden: i,
        nombreDisplay: (p.display as Record<string, string>)[nombre] ?? null,
      };
      await prisma.plantaTipoVehiculo.upsert({
        where: {
          plantaId_tipoVehiculoId: { plantaId: planta.id, tipoVehiculoId: tipos[nombre].id },
        },
        update: datosTipo,
        create: { plantaId: planta.id, tipoVehiculoId: tipos[nombre].id, ...datosTipo },
      });

      // El precio va aparte, como primera vigencia. La fecha es anterior a
      // cualquier turno migrado para que todo el histórico caiga bajo ella.
      await prisma.precioVigencia.upsert({
        where: {
          plantaId_tipoVehiculoId_vigenteDesde: {
            plantaId: planta.id, tipoVehiculoId: tipos[nombre].id, vigenteDesde: INICIO_PRECIOS,
          },
        },
        update: { precio },
        create: {
          plantaId: planta.id, tipoVehiculoId: tipos[nombre].id,
          precio, vigenteDesde: INICIO_PRECIOS,
        },
      });
    }

    // Líneas: dos de livianos y una de motos en las tres plantas.
    const lineas = [
      { categoriaId: categorias.L.id, numero: "1" },
      { categoriaId: categorias.L.id, numero: "2" },
      { categoriaId: categorias.M.id, numero: "1" },
    ];
    for (const l of lineas) {
      await prisma.linea.upsert({
        where: {
          plantaId_categoriaId_numero: {
            plantaId: planta.id,
            categoriaId: l.categoriaId,
            numero: l.numero,
          },
        },
        update: {},
        create: { plantaId: planta.id, ...l },
      });
    }

    // Horarios: aplican a todas las líneas (lineaId null) y a todos los meses (mes null).
    await prisma.horario.deleteMany({ where: { plantaId: planta.id } });
    await prisma.horario.createMany({
      data: [
        ...LUN_A_VIE.map((diaSemana) => ({
          plantaId: planta.id,
          diaSemana,
          desde: p.horario.habil[0],
          hasta: p.horario.habil[1],
          slotsPorHora: p.slotsPorHora,
        })),
        {
          plantaId: planta.id,
          diaSemana: SABADO,
          desde: p.horario.sabado[0],
          hasta: p.horario.sabado[1],
          slotsPorHora: p.slotsPorHora,
        },
      ],
    });

    console.log(`✓ ${p.nombre}`);
  }

  // ── Superadmin ─────────────────────────────────────────────
  // La contraseña se define por env y se hashea en el arranque real.
  // Acá queda el usuario creado sin hash para no meter un secreto en el repo.
  console.log(
    "\nFalta crear el superadmin. Las 3 cuentas viejas no se migran: son 2-6 usuarios en total."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
