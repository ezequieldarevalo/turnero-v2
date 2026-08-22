/**
 * Migración de una planta desde su base MySQL vieja a la base nueva.
 *
 *   npx tsx prisma/migrar.ts maipu
 *   npx tsx prisma/migrar.ts maipu --commit     (sin esto es simulacro)
 *
 * La base MySQL de origen se deduce del slug; usuario y contraseña salen del
 * `.env`. Ver `conexionMysql()`.
 *
 * Es idempotente: borra lo que haya migrado antes de esa planta y lo rehace.
 * Pensado para correrse muchas veces contra una copia hasta que salga limpio.
 *
 * Decisiones, todas fundadas en el relevamiento de los datos reales:
 *
 *  - Se migran SOLO las reservas reales (turnos con datos_turno). Los ~215.000
 *    cupos vacíos no se copian: se agregan a ocupacion_diaria y se descartan.
 *  - Estados: P→CONFIRMADO, T→COMPLETADO, C→CONFIRMADO, R vencido→EXPIRADO.
 *    D/I/N no son turnos: son cupos libres o bloqueados.
 *  - Los `I` futuros son bloqueos vigentes → excepciones_cupo.
 *  - Los tipos de vehículo guardados con el nombre de pantalla se normalizan.
 *  - Los cobros se deduplican por nro_op (el bug de idempotencia dejó miles).
 */
import { PrismaClient, EstadoTurno, OrigenTurno, ProveedorPago, TipoExcepcion } from "@prisma/client";
import { normalizarDominio } from "../lib/dominio";
import mysql from "mysql2/promise";

const prisma = new PrismaClient();

const slug = process.argv[2];
const COMMIT = process.argv.includes("--commit");
if (!slug) {
  console.error("Uso: npx tsx prisma/migrar.ts <slug> [--commit]");
  process.exit(1);
}

/**
 * De dónde lee esta planta.
 *
 * Cada Laravel tiene su propia base y puede tener su propio usuario, así que las
 * credenciales se buscan primero con sufijo por planta y después en las
 * genéricas. Nada de esto se escribe acá: va en el `.env`, que está ignorado por
 * git.
 *
 *   MYSQL_USER_GODOYCRUZ / MYSQL_PASSWORD_GODOYCRUZ / MYSQL_DB_GODOYCRUZ
 *   MYSQL_USER           / MYSQL_PASSWORD           / MYSQL_DB
 *
 * Contra la copia local en Docker no hace falta definir nada: los valores por
 * defecto son los de siempre.
 */
const BASE_LEGACY: Record<string, string> = {
  godoycruz: "rtogc",
  lasheras: "lhrevitotal",
  maipu: "marevitotal",
};

function conexionMysql(slug: string) {
  const suf = slug.toUpperCase();
  const de = (clave: string, porDefecto: string) =>
    process.env[`${clave}_${suf}`] ?? process.env[clave] ?? porDefecto;

  return {
    host: de("MYSQL_HOST", "127.0.0.1"),
    port: Number(de("MYSQL_PORT", "3307")),
    user: de("MYSQL_USER", "root"),
    password: de("MYSQL_PASSWORD", "root"),
    database: de("MYSQL_DB", BASE_LEGACY[slug] ?? slug),
  };
}

// Mendoza es UTC-3 todo el año, sin horario de verano.
const OFFSET = "-03:00";

const ESTADOS: Record<string, EstadoTurno> = {
  P: EstadoTurno.CONFIRMADO, // pagado
  T: EstadoTurno.COMPLETADO, // realizado
  C: EstadoTurno.CONFIRMADO, // confirmado sin pago
};

/// El frontend viejo llegó a mandar el nombre de PANTALLA en vez del real.
/// En Maipú hay 488 registros así. Se normalizan al nombre del catálogo.
const ALIAS_TIPO: Record<string, string> = {
  AUTOMOVIL: "AUTO PARTICULAR",
  "CAMIONETA/SUV/UTILITARIO": "CAMIONETA PARTICULAR",
};

const PROVEEDORES: Record<string, ProveedorPago> = {
  MercadoPago: ProveedorPago.MERCADOPAGO,
  Yacare: ProveedorPago.YACARE,
  Administracion: ProveedorPago.EFECTIVO,
};

const problemas: string[] = [];
const nota = (s: string) => problemas.push(s);

async function main() {
  const planta = await prisma.planta.findUnique({
    where: { slug },
    include: { lineas: { include: { categoria: true } }, horarios: true },
  });
  if (!planta) throw new Error(`No existe la planta "${slug}". Corré el seed primero.`);

  const conexion = conexionMysql(slug);
  console.log(`Origen MySQL: ${conexion.user}@${conexion.host}:${conexion.port}/${conexion.database}`);
  const my = await mysql.createConnection({ ...conexion, dateStrings: true });

  const q = async <T = any>(sql: string, args: any[] = []): Promise<T[]> =>
    (await my.execute(sql, args))[0] as T[];

  console.log(`\n${COMMIT ? "MIGRANDO" : "SIMULACRO —"} ${planta.nombre}\n${"─".repeat(50)}`);

  // ── Mapas de referencia ──────────────────────────────────────
  const tiposDb = await prisma.tipoVehiculo.findMany();
  const tipoPorNombre = new Map(tiposDb.map((t) => [t.nombre, t]));

  // Las líneas viejas se llaman "Maipu - L1"; la parte útil es el sufijo.
  const lineasViejas = await q("SELECT id, nombre, tipo_vehiculo FROM lineas");
  const lineaMap = new Map<number, number>();
  for (const lv of lineasViejas) {
    const m = String(lv.nombre).match(/([LMP])\s*(\d+)\s*$/i);
    if (!m) {
      nota(`Línea vieja ${lv.id} ("${lv.nombre}") con nombre no interpretable`);
      continue;
    }
    const [, cat, num] = m;
    const nueva = planta.lineas.find(
      (l) => l.categoria.codigo === cat.toUpperCase() && l.numero === num
    );
    if (!nueva) {
      nota(`Sin línea nueva para ${cat}${num} (vieja id ${lv.id})`);
      continue;
    }
    lineaMap.set(lv.id, nueva.id);
  }

  const duracionNominal = Math.round(60 / (planta.horarios[0]?.slotsPorHora ?? 6));

  // ── Limpieza de una corrida anterior ─────────────────────────
  if (COMMIT) {
    await prisma.$transaction([
      prisma.pago.deleteMany({ where: { plantaId: planta.id } }),
      prisma.turno.deleteMany({ where: { plantaId: planta.id } }),
      prisma.excepcionCupo.deleteMany({ where: { plantaId: planta.id } }),
      prisma.ocupacionDiaria.deleteMany({ where: { plantaId: planta.id } }),
      prisma.feriado.deleteMany({ where: { plantaId: planta.id } }),
    ]);
  }

  // ── 1. Turnos con datos de cliente ───────────────────────────
  const filas = await q(`
    SELECT t.id, t.fecha, t.hora, t.estado, t.origen, t.observaciones,
           t.vencimiento, t.id_linea, t.id_cobro_yac,
           d.nombre, d.dominio, d.email, d.telefono, d.tipo_vehiculo,
           d.marca, d.modelo, d.anio, d.combustible, d.inscr_mendoza
    FROM turnos t
    JOIN datos_turno d ON d.id_turno = t.id
    JOIN (SELECT id_turno, MIN(id) id FROM datos_turno GROUP BY id_turno) u ON u.id = d.id
    ORDER BY t.id`);

  const ahora = new Date();
  const turnos: any[] = [];
  let sinTipo = 0, sinLinea = 0, estadoRaro = 0, bloqueadosConDatos = 0, liberadosConDatos = 0;

  for (const f of filas) {
    const nombreTipo = ALIAS_TIPO[f.tipo_vehiculo] ?? f.tipo_vehiculo;
    const tipo = tipoPorNombre.get(nombreTipo);
    if (!tipo) { sinTipo++; continue; }

    // id_linea = 0 es lo que insertaba crearTurno desde administración:
    // apunta a una línea que no existe. Se asigna la primera de la categoría
    // que corresponde al vehículo.
    const lineaId =
      lineaMap.get(f.id_linea) ??
      planta.lineas.find((l) => l.categoriaId === tipo.categoriaId)?.id;
    if (!lineaId) { sinLinea++; continue; }

    let estado = ESTADOS[f.estado];
    if (!estado) {
      if (f.estado === "R") {
        const vence = f.vencimiento ? new Date(`${f.vencimiento.replace(" ", "T")}${OFFSET}`) : null;
        estado = !vence || vence < ahora ? EstadoTurno.EXPIRADO : EstadoTurno.PENDIENTE_PAGO;
      } else if (f.estado === "D") {
        // Cupo liberado que quedó con los datos del cliente colgados. Lo produce
        // reprogramarTurno cuando falla el update que mueve los datos al turno
        // nuevo: loguea el error y libera el viejo igual. La reserva se perdió.
        estado = EstadoTurno.CANCELADO;
        liberadosConDatos++;
      } else if (f.estado === "I" || f.estado === "N") {
        // Reserva sin pagar sobre un cupo que la planta bloqueó después.
        // Ninguna de estas tiene cobro asociado: se verificó sobre los datos.
        estado = EstadoTurno.EXPIRADO;
        bloqueadosConDatos++;
      } else { estadoRaro++; continue; }
    }

    turnos.push({
      plantaId: planta.id,
      lineaId,
      tipoVehiculoId: tipo.id,
      inicio: new Date(`${f.fecha}T${f.hora}${OFFSET}`),
      duracionMin: duracionNominal,
      estado,
      origen: f.origen === "A" ? OrigenTurno.ADMIN : OrigenTurno.WEB,
      observaciones: f.observaciones || null,
      // Una sola forma. En las bases viejas el mismo vehículo está cargado
      // como `005-ESE` y como `005ESE`, y buscar por patente devolvía
      // media historia según cómo lo hubiera tipeado quien lo cargó.
      dominio: normalizarDominio(String(f.dominio || "")),
      titularNombre: f.nombre || "",
      // A minúsculas, como hace el camino de reserva. El sistema viejo guardaba
      // tal cual venía del formulario, y quedó casi la mitad en mayúsculas: si
      // no se normaliza acá, el mismo cliente entra dos veces según cómo haya
      // tipeado, y buscarlo por correo depende de adivinar el formato.
      titularEmail: (f.email || "").trim().toLowerCase(),
      titularTelefono: f.telefono || null,
      marca: f.marca === "SIN ESPECIFICAR" ? null : f.marca,
      modelo: f.modelo === "SIN ESPECIFICAR" ? null : f.modelo,
      anio: Number(f.anio) || null,
      combustible: f.combustible || null,
      radicacionLocal: String(f.inscr_mendoza).toUpperCase().startsWith("S"),
      legacyPlanta: slug,
      legacyId: f.id,
      legacyExternalRef: f.id_cobro_yac ? `${slug}:${f.id_cobro_yac}` : null,
    });
  }

  if (sinTipo) nota(`${sinTipo} turnos descartados: tipo de vehículo no reconocido`);
  if (sinLinea) nota(`${sinLinea} turnos descartados: sin línea destino`);
  if (estadoRaro) nota(`${estadoRaro} turnos descartados: estado inesperado`);
  if (bloqueadosConDatos) nota(`${bloqueadosConDatos} reservas impagas sobre cupos bloqueados → EXPIRADO`);
  if (liberadosConDatos) nota(`${liberadosConDatos} reservas cuyo cupo se liberó dejando los datos colgados → CANCELADO`);

  // Dos turnos ocupantes no pueden compartir cupo. En los datos viejos SÍ pasa:
  // es la carrera de confirmQuote (chequea y después actualiza sin condición).
  // No se descartan en silencio — se listan para resolución manual.
  const OCUPAN = [EstadoTurno.PENDIENTE_PAGO, EstadoTurno.CONFIRMADO, EstadoTurno.COMPLETADO];
  const ocupado = new Map<string, any>();
  const colisiones: any[][] = [];
  const aInsertar: any[] = [];

  for (const t of turnos) {
    if (!OCUPAN.includes(t.estado)) { aInsertar.push(t); continue; }
    const k = `${t.lineaId}|${t.inicio.toISOString()}`;
    const previo = ocupado.get(k);
    if (previo) { colisiones.push([previo, t]); continue; }
    ocupado.set(k, t);
    aInsertar.push(t);
  }

  if (COMMIT) {
    for (let i = 0; i < aInsertar.length; i += 1000) {
      await prisma.turno.createMany({ data: aInsertar.slice(i, i + 1000) });
    }
  }
  console.log(`Turnos           ${aInsertar.length.toLocaleString()}`);

  if (colisiones.length) {
    nota(`${colisiones.length} cupos con DOS turnos pagos (operación en lote de 2022). NO se migró el segundo:`);
    for (const [a, b] of colisiones) {
      const f = new Date(a.inicio.getTime() - 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
      problemas.push(`     ${f} · línea ${a.lineaId} · queda ${a.dominio} (id ${a.legacyId}) — SIN MIGRAR ${b.dominio} (id ${b.legacyId})`);
    }
  }

  // ── 2. Pagos, deduplicados ───────────────────────────────────
  const cobros = await q(`
    SELECT c.id, c.fecha, c.monto, c.metodo, c.nro_op, c.origen, c.id_turno, c.id_cobro
    FROM cobros c JOIN datos_turno d ON d.id_turno = c.id_turno
    ORDER BY c.id`);

  const idPorLegacy = COMMIT
    ? new Map((await prisma.turno.findMany({
        where: { plantaId: planta.id },
        select: { id: true, legacyId: true },
      })).map((t) => [t.legacyId!, t.id]))
    : new Map<number, number>();

  /**
   * Qué turnos viejos van a existir del otro lado.
   *
   * En una corrida real sale de los ids recién insertados. En simulacro no hay
   * ids, pero sí se sabe cuáles quedaron afuera —los segundos turnos de un cupo
   * con dos pagos—, y hay que descartar sus cobros igual. Si no, el simulacro
   * suma toda la plata, informa que los montos coinciden y el chequeo de
   * conciliación no puede fallar nunca. Es justo el número que se mira antes de
   * escribir.
   */
  const legacyMigrados = COMMIT
    ? new Set(idPorLegacy.keys())
    : new Set(aInsertar.map((t) => t.legacyId as number));

  const vistos = new Set<string>();
  const pagosSinTurno: any[] = [];
  const pagos: any[] = [];
  let duplicados = 0;

  for (const c of cobros) {
    const prov = PROVEEDORES[c.origen] ?? ProveedorPago.MERCADOPAGO;
    // Los de Administración usan nro_op = 0: colisionarían entre sí.
    const paymentId = c.nro_op && c.nro_op !== "0" ? String(c.nro_op) : `LEGACY-${slug}-${c.id}`;
    const clave = `${prov}:${paymentId}`;
    if (vistos.has(clave)) { duplicados++; continue; }
    vistos.add(clave);

    const turnoId = idPorLegacy.get(c.id_turno);
    if (!legacyMigrados.has(c.id_turno)) { pagosSinTurno.push(c); continue; }

    pagos.push({
      plantaId: planta.id,
      turnoId: turnoId ?? null,
      proveedor: prov,
      paymentId,
      estado: "approved",
      monto: Number(c.monto) || 0,
      metodo: c.metodo || null,
      fechaPago: parseFecha(c.fecha),
      legacyId: c.id,
    });
  }

  if (duplicados) nota(`${duplicados} cobros duplicados descartados (bug de idempotencia)`);
  const pagosDeCancelados = await q(`
    SELECT COUNT(*) n, COALESCE(SUM(c.monto),0) monto FROM cobros c
    JOIN turnos t ON t.id = c.id_turno WHERE t.estado = 'D'`);
  if (Number(pagosDeCancelados[0].n))
    nota(`⚠ ${pagosDeCancelados[0].n} pago(s) por $${Number(pagosDeCancelados[0].monto).toLocaleString()} de personas cuyo cupo se liberó: pagaron y quedaron sin turno`);

  if (pagosSinTurno.length)
    nota(`${pagosSinTurno.length} pagos sin migrar ($${pagosSinTurno.reduce((a, c) => a + Number(c.monto), 0).toLocaleString()}): su turno quedó afuera por colisión de cupo`);

  if (COMMIT) {
    for (let i = 0; i < pagos.length; i += 1000) {
      await prisma.pago.createMany({ data: pagos.slice(i, i + 1000), skipDuplicates: true });
    }
  }
  console.log(`Pagos            ${pagos.length.toLocaleString()}  (${duplicados.toLocaleString()} duplicados descartados)`);

  // ── 3. Ocupación histórica, antes de tirar los cupos vacíos ──
  const ocup = await q(`
    SELECT t.id_linea, t.fecha,
           SUM(t.estado NOT IN ('I','N')) ofrecidos,
           SUM(d.id IS NOT NULL) vendidos
    FROM turnos t LEFT JOIN datos_turno d ON d.id_turno = t.id
    GROUP BY t.id_linea, t.fecha`);

  const ocupacion = ocup
    .map((o) => ({
      plantaId: planta.id,
      lineaId: lineaMap.get(o.id_linea)!,
      fecha: new Date(`${o.fecha}T00:00:00${OFFSET}`),
      ofrecidos: Number(o.ofrecidos),
      vendidos: Number(o.vendidos),
    }))
    .filter((o) => o.lineaId);

  if (COMMIT) {
    for (let i = 0; i < ocupacion.length; i += 1000) {
      await prisma.ocupacionDiaria.createMany({ data: ocupacion.slice(i, i + 1000), skipDuplicates: true });
    }
  }
  console.log(`Ocupación        ${ocupacion.length.toLocaleString()} días×línea  (de ${(await q("SELECT COUNT(*) n FROM turnos"))[0].n.toLocaleString()} cupos que NO se copian)`);

  // ── 4. Bloqueos vigentes (estado I a futuro) ─────────────────
  const bloqueos = await q(`
    SELECT id_linea, fecha, hora FROM turnos
    WHERE estado IN ('I','N') AND fecha >= CURDATE()`);

  const excepciones = bloqueos
    .map((b) => ({
      plantaId: planta.id,
      lineaId: lineaMap.get(b.id_linea)!,
      inicio: new Date(`${b.fecha}T${b.hora}${OFFSET}`),
      tipo: TipoExcepcion.BLOQUEAR,
      cantidad: 1,
      motivo: "Migrado del sistema anterior (estado I)",
    }))
    .filter((e) => e.lineaId);

  if (COMMIT && excepciones.length) {
    await prisma.excepcionCupo.createMany({ data: excepciones, skipDuplicates: true });
  }
  console.log(`Bloqueos         ${excepciones.length}`);

  // ── 5. Feriados ──────────────────────────────────────────────
  const feriados = await q("SELECT fecha, descripcion FROM feriados");
  if (COMMIT && feriados.length) {
    await prisma.feriado.createMany({
      data: feriados.map((f) => ({
        plantaId: planta.id,
        fecha: new Date(`${f.fecha}T00:00:00${OFFSET}`),
        descripcion: f.descripcion || "",
      })),
      skipDuplicates: true,
    });
  }
  console.log(`Feriados         ${feriados.length}`);

  // ── Control: huérfanos que quedan afuera ─────────────────────
  const [{ n: huerfanos }] = await q(
    "SELECT COUNT(*) n FROM datos_turno d LEFT JOIN turnos t ON t.id=d.id_turno WHERE t.id IS NULL"
  );
  if (Number(huerfanos)) nota(`${huerfanos} datos_turno huérfanos: no hay turno al que colgarlos`);

  const [{ n: dobles }] = await q(
    "SELECT COUNT(*) n FROM (SELECT id_turno FROM datos_turno GROUP BY id_turno HAVING COUNT(*)>1) x"
  );
  if (Number(dobles)) nota(`${dobles} turnos con datos_turno duplicado: se toma el de menor id`);

  // ── Verificación de montos ───────────────────────────────────
  const [{ total: totalViejo }] = await q(
    "SELECT (SELECT COALESCE(SUM(monto),0) FROM (SELECT DISTINCT nro_op, monto FROM cobros WHERE nro_op NOT IN ('','0')) a) + (SELECT COALESCE(SUM(monto),0) FROM cobros WHERE nro_op IN ('','0')) total"
  );
  const totalNuevo = pagos.reduce((a, p) => a + p.monto, 0);
  console.log(`\nMontos: viejo (deduplicado) ${Number(totalViejo).toLocaleString()} · migrado ${totalNuevo.toLocaleString()}`);

  if (problemas.length) {
    console.log(`\n⚠  A revisar:`);
    problemas.forEach((p) => console.log(`   · ${p}`));
  }
  console.log(COMMIT ? "\n✅ Migrado\n" : "\n(simulacro: no se escribió nada — agregá --commit)\n");

  await my.end();
}

/** cobros.fecha es varchar: aparece como "dd-mm-YYYY HH:ii:ss" o "YYYY-mm-dd HH:ii:ss" */
function parseFecha(s: string | null): Date | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}${OFFSET}`);
  m = t.match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}:\d{2}:\d{2})/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}${OFFSET}`);
  return null;
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
