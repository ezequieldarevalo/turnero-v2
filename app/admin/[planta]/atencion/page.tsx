import { requerirPlanta } from "@/lib/sesionActual";
import { tiposDePlanta } from "@/lib/atencion";
import Marco from "../marco";
import Formulario from "./formulario";

export const dynamic = "force-dynamic";

export default async function Atencion({
  params,
}: {
  params: Promise<{ planta: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "turno.crear");
  const tipos = await tiposDePlanta(acceso.planta.id);

  return (
    <Marco acceso={acceso} activo="atencion">
      <h2 className="buscar__titulo">Atención sin turno previo</h2>
      <p className="buscar__ayuda">
        Para alguien que llega al mostrador sin haber reservado. No toma ningún cupo
        de la agenda: queda registrada con la hora de ahora.
      </p>

      <Formulario
        slug={slug}
        tipos={tipos}
        puedeCobrar={acceso.puede("turno.cobrar")}
      />
    </Marco>
  );
}
