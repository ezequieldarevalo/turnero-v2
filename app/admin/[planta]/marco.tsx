import Link from "next/link";
import type { Acceso } from "@/lib/sesionActual";
import { salir } from "../ingresar/acciones";

/**
 * Cabecera y menú del panel de una planta.
 *
 * El menú se arma con los permisos: una pestaña que el usuario no puede usar no
 * se muestra apagada, no se muestra. Un operador no necesita saber que existe
 * una pantalla de configuración a la que no va a poder entrar.
 *
 * `listo` marca las que ya están construidas. Las demás no se muestran: un menú
 * que ofrece pestañas que devuelven 404 es peor que un menú corto — el que lo
 * usa no sabe si está roto o si le falta permiso.
 */
const SECCIONES = [
  { id: "agenda", texto: "Agenda", ruta: "", permiso: "agenda.ver", listo: true },
  { id: "buscar", texto: "Buscar", ruta: "/buscar", permiso: "turno.buscar", listo: true },
  { id: "atencion", texto: "Sin turno previo", ruta: "/atencion", permiso: "turno.crear", listo: true },
  { id: "telefono", texto: "Por teléfono", ruta: "/telefono", permiso: "turno.crear", listo: true },
  { id: "pagos", texto: "Pagos a revisar", ruta: "/pagos", permiso: "pagos.revisar", listo: true },
  { id: "reportes", texto: "Reportes", ruta: "/reportes", permiso: "reportes.ver", listo: true },
  { id: "usuarios", texto: "Usuarios", ruta: "/usuarios", permiso: "usuarios.gestionar", listo: true },
  { id: "config", texto: "Configuración", ruta: "/configuracion", permiso: "config.ver", listo: true },
] as const;

export default function Marco({
  acceso, activo, children,
}: {
  acceso: Acceso;
  activo: string;
  children: React.ReactNode;
}) {
  const { planta, sesion, rol, puede } = acceso;
  const visibles = SECCIONES.filter((s) => s.listo && puede(s.permiso));

  return (
    <div className="admin" style={{ "--color": planta.colorPrimario } as React.CSSProperties}>
      <header className="admin__barra">
        <div className="admin__identidad">
          <span className="admin__planta">{planta.nombre}</span>
          <span className="admin__usuario">
            {sesion.nombre} · {rol === "SUPERADMIN" ? "servicio" : rol.toLowerCase()}
          </span>
        </div>
        <div className="admin__acciones">
          {sesion.esSuperadmin && (
            <Link className="boton boton--suave boton--chico" href="/admin/plantas">Plantas</Link>
          )}
          {sesion.plantas.length > 1 && (
            <Link className="boton boton--suave boton--chico" href="/admin">Cambiar de planta</Link>
          )}
          <form action={salir}>
            <button className="boton boton--suave boton--chico" type="submit">Salir</button>
          </form>
        </div>
      </header>

      {visibles.length > 1 && (
      <nav className="admin__menu" aria-label="Secciones">
        {visibles.map((s) => (
          <Link
            key={s.id}
            href={`/admin/${planta.slug}${s.ruta}`}
            className={`admin__pestana${activo === s.id ? " admin__pestana--activa" : ""}`}
            aria-current={activo === s.id ? "page" : undefined}
          >
            {s.texto}
          </Link>
        ))}
      </nav>
      )}

      <main className="admin__cuerpo">{children}</main>
    </div>
  );
}
