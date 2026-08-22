/**
 * Seed con los valores REALES relevados de las tres plantas.
 *
 * Los datos viven en `configPlantas.ts`; acá está solamente la escritura.
 * `comparar-config.ts` lee ese mismo archivo para contrastarlo contra la base.
 */
import { PrismaClient } from "@prisma/client";
import {
  CATEGORIAS,
  TIPOS,
  LINEAS,
  OFERTA,
  INICIO_PRECIOS,
  PLANTAS,
  datosPlanta,
  horariosDe,
} from "./configPlantas";

const prisma = new PrismaClient();

async function main() {
  // ── Catálogo global ────────────────────────────────────────
  const categorias: Record<string, { id: number }> = {};
  for (const c of CATEGORIAS) {
    categorias[c.codigo] = await prisma.categoriaVehiculo.upsert({
      where: { codigo: c.codigo },
      update: {},
      create: c,
    });
  }

  const tipos: Record<string, { id: number }> = {};
  for (const t of TIPOS) {
    tipos[t.nombre] = await prisma.tipoVehiculo.upsert({
      where: { nombre: t.nombre },
      update: {},
      create: { nombre: t.nombre, categoriaId: categorias[t.categoria].id },
    });
  }

  // ── Plantas ────────────────────────────────────────────────
  for (const p of PLANTAS) {
    // Los mismos datos para create y update: el seed tiene que ser idempotente
    // de verdad. Con `update: {}` un campo nuevo nunca llega a las plantas
    // que ya existen — pasó con hostLegacy.
    const datos = datosPlanta(p);

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

    // Líneas
    for (const l of LINEAS) {
      const categoriaId = categorias[l.categoria].id;
      await prisma.linea.upsert({
        where: {
          plantaId_categoriaId_numero: { plantaId: planta.id, categoriaId, numero: l.numero },
        },
        update: {},
        create: { plantaId: planta.id, categoriaId, numero: l.numero },
      });
    }

    // Horarios: aplican a todas las líneas (lineaId null) y a todos los meses (mes null).
    await prisma.horario.deleteMany({ where: { plantaId: planta.id } });
    await prisma.horario.createMany({
      data: horariosDe(p).map((h) => ({ plantaId: planta.id, ...h })),
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
