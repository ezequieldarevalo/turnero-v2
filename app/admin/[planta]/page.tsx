import Link from "next/link";
import { requerirPlanta } from "@/lib/sesionActual";
import { agendaDelDia } from "@/lib/agenda";
import { hoyLocal, fechaLarga } from "@/lib/fechas";
import { faltantes } from "@/lib/plantas";
import Pendientes from "./pendientes";
import Tabla, { COLUMNAS_VALIDAS, type Columna } from "./tabla";
import Navegador from "./navegador";
import Imprimir from "./imprimir";
import Marco from "./marco";

export const dynamic = "force-dynamic";

const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

export default async function Agenda({
  params, searchParams,
}: {
  params: Promise<{ planta: string }>;
  searchParams: Promise<{ dia?: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "agenda.ver");
  const { planta } = acceso;

  const hoy = hoyLocal(planta.timezone);
  const pedida = (await searchParams).dia;
  // Una fecha inventada en la URL no debe romper la pantalla: se cae a hoy.
  const fecha = pedida && /^\d{4}-\d{2}-\d{2}$/.test(pedida) ? pedida : hoy;

  const agenda = await agendaDelDia(planta, fecha);

  // Lo que le falta a la planta para poder vender un turno. En una que ya
  // funciona la lista viene vacía y no se muestra nada.
  const falta = acceso.puede("config.ver") ? await faltantes(planta.id, slug) : [];

  // Las columnas vienen de la base; se filtran contra las conocidas para que un
  // valor mal cargado no rompa la tabla ni deje de mostrar el resto.
  const columnas = ((planta.columnasAgenda as string[]) ?? [])
    .filter((c): c is Columna => (COLUMNAS_VALIDAS as readonly string[]).includes(c));

  // Los cuatro días con turnos más próximos al que se está mirando, los de
  // antes y los de después, para poder saltar sin adivinar.
  const antes = agenda.conTurnos.filter((f) => f < fecha).slice(-2);
  const despues = agenda.conTurnos.filter((f) => f > fecha).slice(0, 2);
  const cercanos = [...antes, ...despues].map((f) => ({
    fecha: f,
    texto: f === hoy ? "Hoy" : fechaLarga(f, planta.timezone),
  }));

  return (
    <Marco acceso={acceso} activo="agenda">
      {falta.length > 0 && <Pendientes falta={falta} />}

      <div className="agenda__cabecera">
        <div>
          <h2 className="agenda__fecha">
            {fecha === hoy ? "Hoy" : fechaLarga(fecha, planta.timezone)}
          </h2>
          {fecha === hoy && (
            <p className="agenda__subfecha">{fechaLarga(fecha, planta.timezone)}</p>
          )}
        </div>
        <div className="agenda__controles">
          <Navegador
            slug={slug}
            fecha={fecha}
            hoy={hoy}
            conTurnos={agenda.conTurnos}
          />
          {agenda.filas.length > 0 && <Imprimir etiqueta="Imprimir la planilla" />}
        </div>
      </div>

      {/* Encabezado de la hoja impresa: solo se ve en papel. La planilla vieja
          repetía la fecha en cada renglón porque no tenía dónde ponerla. */}
      <div className="solo-impresion">
        <h1>{planta.nombre}</h1>
        <p>
          Turnos del {fechaLarga(fecha, planta.timezone).toLowerCase()} ·{" "}
          {agenda.total.turnos} {agenda.total.turnos === 1 ? "turno" : "turnos"} ·{" "}
          {pesos(agenda.total.cobrado)} cobrado
          {agenda.total.impagos > 0 && ` · ${agenda.total.impagos} sin pagar`}
        </p>
      </div>

      <div className="resumen">
        <div className="resumen__dato">
          <span className="resumen__numero">{agenda.total.turnos}</span>
          <span className="resumen__etiqueta">{agenda.total.turnos === 1 ? "turno" : "turnos"}</span>
        </div>
        <div className="resumen__dato">
          <span className="resumen__numero">{pesos(agenda.total.cobrado)}</span>
          <span className="resumen__etiqueta">cobrado</span>
        </div>
        {agenda.total.impagos > 0 && (
          <div className="resumen__dato resumen__dato--alerta">
            <span className="resumen__numero">{agenda.total.impagos}</span>
            <span className="resumen__etiqueta">sin pagar</span>
          </div>
        )}
      </div>

      <Tabla
        filas={agenda.filas}
        columnas={columnas}
        slug={slug}
        timezone={planta.timezone}
        cerca={cercanos}
      />

      {fecha !== hoy && (
        <p className="agenda__volver">
          <Link className="enlace" href={`/admin/${slug}`}>Volver a hoy</Link>
        </p>
      )}
    </Marco>
  );
}

