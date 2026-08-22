import { requerirPlanta } from "@/lib/sesionActual";
import { usuariosDe } from "@/lib/gestionUsuarios";
import Marco from "../marco";
import Lista from "./lista";

export const dynamic = "force-dynamic";

export default async function Usuarios({
  params,
}: {
  params: Promise<{ planta: string }>;
}) {
  const { planta: slug } = await params;
  const acceso = await requerirPlanta(slug, "usuarios.gestionar");

  const usuarios = await usuariosDe(acceso.planta.id);

  return (
    <Marco acceso={acceso} activo="usuarios">
      <h2 className="buscar__titulo">Quién puede entrar</h2>
      <p className="buscar__ayuda">
        Un <strong>operador</strong> atiende: ve la agenda, busca turnos, cobra y
        reprograma. Un <strong>dueño</strong> suma la configuración, los precios, los
        reportes y esta misma pantalla. Si la persona ya trabaja en otra planta, usa la
        misma cuenta y la misma contraseña.
      </p>

      <Lista slug={slug} usuarios={usuarios} yo={acceso.sesion.usuarioId} />
    </Marco>
  );
}
