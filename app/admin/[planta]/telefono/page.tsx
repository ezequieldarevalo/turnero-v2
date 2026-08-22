import { requerirPlanta } from "@/lib/sesionActual";
import { tiposDePlanta } from "@/lib/atencion";
import Marco from "../marco";
import Formulario from "./formulario";

export const dynamic = "force-dynamic";

export default async function Telefono({
  params,
}: {
  params: Promise<{ planta: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "turno.crear");
  const tipos = await tiposDePlanta(acceso.planta.id);
  const horas = Math.round(acceso.planta.minutosExpiracionConfirmacion / 60);

  return (
    <Marco acceso={acceso} activo="telefono">
      <h2 className="buscar__titulo">Turno por teléfono</h2>
      <p className="buscar__ayuda">
        Reserva un cupo futuro y le manda un correo al titular para que lo acepte.
        El turno vale recién cuando esa persona confirma: la política de privacidad
        la tiene que aceptar quien saca el turno, no quien lo carga. Si no confirma
        en {horas} horas, el horario vuelve a la agenda solo.
      </p>

      <Formulario slug={slug} tipos={tipos} />
    </Marco>
  );
}
