# Turnero — capa de datos

Primer entregable: el modelo multi-tenant y el seed con los valores reales de las tres plantas.
Todavía no hay aplicación; esto es lo que valida que el diseño aguanta los datos que existen.

## Puesta en marcha

```bash
npm install
cp .env.example .env          # y poné tu DATABASE_URL
npm run db:push               # crea las tablas
psql "$DATABASE_URL" -f prisma/sql/001_constraints.sql
npm run db:seed
npm run db:verify             # comprueba que el modelo reproduce el sistema viejo
npm run db:studio             # para mirar los datos
```

`db:verify` no es un test suite: es la prueba de que el diseño aguanta los datos reales.
Comprueba que la capacidad por línea coincide con la del sistema actual (47 cupos por día
hábil en Las Heras y Maipú, 36 en Godoy Cruz), que dos bandas del mismo día no pueden
solaparse, que dos turnos no pueden tomar el mismo cupo, que al cancelar el cupo se libera
solo, y que ningún tipo de vehículo queda ofrecido sin línea que lo atienda.

Ya encontró un error real: la primera versión del `EXCLUDE` comparaba `lineaId` y `mes`
directamente, y como en el caso normal son `NULL`, **el constraint no se disparaba nunca**.
Están dentro de `COALESCE` por eso.

En producción se usa `db:migrate` en vez de `db:push`, y el SQL de `001_constraints.sql`
va dentro de una migración creada con `prisma migrate dev --create-only`.

## Decisiones que conviene entender antes de tocar nada

**Los horarios se guardan en minutos desde medianoche.** `480` es 08:00, `950` es 15:50.
Es aritmética trivial para generar los slots y permite usar `int4range` en la restricción
de no solapamiento. `hasta` es **exclusivo**.

**N franjas por día son N filas.** No hay campo `franja` ni numeración: la banda queda
identificada por su `desde`/`hasta`, y el orden sale solo. Agregar una banda en el medio
no obliga a renumerar nada.

**Lo más específico gana.** Un horario con `mes = 3` manda sobre el de `mes = null` en marzo;
uno con `lineaId` puesto manda sobre el que aplica a todas las líneas. Un día sin fila
está cerrado — así desaparecen las tablas `francos`, `fds` y `lunes` del sistema viejo.

**Los cupos no se materializan.** El sistema viejo pre-generaba una fila por cupo libre:
278.000 filas para 22.000 reservas. Acá `turnos` guarda solo reservas reales y la
disponibilidad se calcula al vuelo desde `horarios` + `feriados` + `excepciones_cupo`.
Efecto lateral: cambiar un horario tiene efecto inmediato, sin regenerar nada.

**La concurrencia se resuelve con un índice, no con locks.** Tomar un cupo es
`INSERT ... ON CONFLICT DO NOTHING` contra el índice único parcial `turnos_cupo_ocupado`.
Si vuelve fila, ganaste. Al cancelar, el cupo se libera solo porque el índice es parcial
sobre los estados que ocupan.

**El catálogo de vehículos es global, la oferta es por planta.** Las categorías las define
la reglamentación, no cada cliente. `planta_tipo_vehiculo` es donde cada planta arma su
subconjunto y pone su precio. `nombreDisplay` es el override por planta — ahí es donde
Las Heras y Maipú muestran "AUTOMOVIL" en vez de "AUTO PARTICULAR".

**El nombre de la línea no se guarda.** Se compone de `categoria` + `numero`: "Livianos 1".
Si cambiás la categoría, el nombre visible se corrige solo.

## Lo que el seed refleja del sistema viejo

| | Las Heras | Maipú | Godoy Cruz |
|---|---|---|---|
| Horario hábil | 08:00–15:50 | 08:00–15:50 | 08:00–17:00 |
| Sábado | 08:00–12:50 | 08:00–12:50 | 08:00–13:00 |
| Slots por hora | 6 (cada 10 min) | 6 | 4 (cada 15 min) |
| Filtra línea por vehículo | no | no | sí |
| Pago en efectivo | sí | sí | no |
| Reprogramación online | no (WhatsApp) | no (WhatsApp) | sí |

El `15:50` de Revitotal es el famoso recorte de la última hora, que en el sistema viejo
era una de las tres funciones de generación hardcodeadas por nombre de planta.

## Pendiente

- Crear el superadmin (las 2-6 cuentas viejas no se migran).
- Cargar las credenciales de MercadoPago por planta, cifradas.
- Verificar con Godoy Cruz si esperaba tener la banda vespertina de 17 a 21 que tenía
  configurada y nunca se generó.
