-- Restricciones que Prisma no expresa nativamente.
-- Se aplican con una migración de SQL plano:
--   npx prisma migrate dev --create-only --name constraints
--   (pegar este contenido en el .sql generado)

-- ─────────────────────────────────────────────────────────────
-- 1. Horarios: dos bandas del mismo día, línea y mes no pueden solaparse.
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- OJO con los NULL: un EXCLUDE nunca considera conflictivas dos filas si alguna
-- comparación involucra NULL. Como `lineaId` y `mes` son NULL en el caso normal
-- ("aplica a todas las líneas / todos los meses"), un EXCLUDE que los compare
-- directamente NO SE DISPARA NUNCA. Por eso van dentro de COALESCE: en los datos
-- el NULL conserva su significado, y en la comparación se tratan como iguales.
ALTER TABLE horarios
  ADD CONSTRAINT horarios_sin_solapamiento
  EXCLUDE USING gist (
    "plantaId"              WITH =,
    (COALESCE("lineaId", 0)) WITH =,
    (COALESCE("mes", 0))     WITH =,
    "diaSemana"             WITH =,
    int4range("desde", "hasta") WITH &&
  );

-- Nota: que una banda de marzo (mes = 3) se superponga con la general (mes NULL)
-- NO es un conflicto — es el mecanismo de override, "lo más específico gana".
-- El constraint solo impide que se pisen dos bandas del MISMO nivel de
-- especificidad, que es lo único que sí es un error.

ALTER TABLE horarios
  ADD CONSTRAINT horarios_rango_valido
  CHECK ("desde" >= 0 AND "hasta" <= 1440 AND "desde" < "hasta");

ALTER TABLE horarios
  ADD CONSTRAINT horarios_dia_valido
  CHECK ("diaSemana" BETWEEN 0 AND 6);

ALTER TABLE horarios
  ADD CONSTRAINT horarios_mes_valido
  CHECK ("mes" IS NULL OR "mes" BETWEEN 1 AND 12);

-- ─────────────────────────────────────────────────────────────
-- 2. Turnos: un unique completo sobre (lineaId, inicio) bloquearía reusar el
--    cupo de un turno cancelado. Va PARCIAL, sobre los estados que ocupan.
--    Por eso el @@unique NO está declarado en schema.prisma: si estuviera,
--    `prisma db push` recrearía el completo y pisaría este.
-- ─────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "turnos_lineaId_inicio_key";

-- La lista de estados tiene que ser EXACTAMENTE la misma que ESTADOS_OCUPANTES
-- en lib/disponibilidad.ts. Si el motor esconde un cupo que el índice no
-- protege, dos personas pueden quedarse con el mismo horario; si protege uno
-- que el motor sigue ofreciendo, la reserva falla con un error inexplicable.
-- verify.ts compara las dos listas para que no puedan separarse en silencio.
--
-- Se recrea en vez de usar IF NOT EXISTS: si no, cambiar la lista de estados
-- no tendría efecto sobre una base que ya tiene el índice viejo — que es
-- justamente lo que pasó al agregar PENDIENTE_CONFIRMACION.
DROP INDEX IF EXISTS turnos_cupo_ocupado;

CREATE UNIQUE INDEX turnos_cupo_ocupado
  ON turnos ("lineaId", "inicio")
  WHERE estado IN ('PENDIENTE_CONFIRMACION', 'PENDIENTE_PAGO', 'CONFIRMADO', 'COMPLETADO');

-- Con esto, tomar un cupo es:
--   INSERT INTO turnos (...) VALUES (...) ON CONFLICT DO NOTHING RETURNING id;
-- Si vuelve fila, ganaste. Si no, alguien llegó primero. Atómico, sin locks.
-- Y al cancelar, el cupo queda libre automáticamente.

-- ─────────────────────────────────────────────────────────────
-- 3. Coherencia de catálogo: no ofrecer un tipo de vehículo sin línea
--    de su categoría. No se puede expresar como constraint declarativa
--    (involucra tres tablas), va como validación en la aplicación.
--    Esta vista sirve para auditarlo.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW tipos_sin_linea AS
SELECT
  p.slug        AS planta,
  tv.nombre     AS tipo_vehiculo,
  cv.nombre     AS categoria
FROM planta_tipo_vehiculo ptv
JOIN plantas p             ON p.id  = ptv."plantaId"
JOIN tipos_vehiculo tv     ON tv.id = ptv."tipoVehiculoId"
JOIN categorias_vehiculo cv ON cv.id = tv."categoriaId"
WHERE ptv.activo
  AND NOT EXISTS (
    SELECT 1 FROM lineas l
    WHERE l."plantaId" = ptv."plantaId"
      AND l."categoriaId" = tv."categoriaId"
      AND l.activa
  );
