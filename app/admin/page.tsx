import Link from "next/link";
import { redirect } from "next/navigation";
import { requerirSesion } from "@/lib/sesionActual";
import { salir } from "./ingresar/acciones";

export const metadata = { title: "Panel · Reviturnos" };

const ROLES: Record<string, string> = {
  SUPERADMIN: "Administración del servicio",
  DUENO: "Dueño",
  OPERADOR: "Operador",
};

export default async function Panel() {
  const sesion = await requerirSesion();

  // Con una sola planta, elegir no es una decisión: es un clic de más por día.
  if (sesion.plantas.length === 1) redirect(`/admin/${sesion.plantas[0].slug}`);

  return (
    <main className="panel">
      <header className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Reviturnos</h1>
          <p className="panel__usuario">{sesion.nombre}</p>
        </div>
        <div className="panel__acciones">
          {sesion.esSuperadmin && (
            <Link className="boton boton--suave" href="/admin/plantas">Plantas</Link>
          )}
          <form action={salir}>
            <button className="boton boton--suave" type="submit">Salir</button>
          </form>
        </div>
      </header>

      {sesion.plantas.length === 0 ? (
        <p className="panel__vacio">
          Tu cuenta todavía no tiene ninguna planta asignada. Pedile acceso a quien
          administra el servicio.
        </p>
      ) : (
        <>
          <h2 className="panel__subtitulo">Elegí una planta</h2>
          <ul className="plantas">
            {sesion.plantas.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/admin/${p.slug}`}
                  className="planta-tarjeta"
                  style={{ "--color": p.colorPrimario } as React.CSSProperties}
                >
                  <span className="planta-tarjeta__nombre">{p.nombre}</span>
                  <span className="planta-tarjeta__rol">{ROLES[p.rol] ?? p.rol}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
