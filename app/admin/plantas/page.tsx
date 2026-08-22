import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requerirSesion } from "@/lib/sesionActual";
import { faltantes } from "@/lib/plantas";
import { salir } from "../ingresar/acciones";
import Alta from "./alta";
import Fila from "./fila";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plantas · Reviturnos" };

export default async function Plantas() {
  const sesion = await requerirSesion("/admin/plantas");
  if (!sesion.esSuperadmin) redirect("/admin");

  const [plantas, categorias] = await Promise.all([
    prisma.planta.findMany({
      orderBy: [{ activa: "desc" }, { nombre: "asc" }],
      include: { _count: { select: { turnos: true, usuarios: true, lineas: true } } },
    }),
    prisma.categoriaVehiculo.findMany({ orderBy: { id: "asc" } }),
  ]);

  const filas = await Promise.all(
    plantas.map(async (p) => ({
      slug: p.slug,
      nombre: p.nombre,
      direccion: p.direccion,
      color: p.colorPrimario,
      activa: p.activa,
      turnos: p._count.turnos,
      usuarios: p._count.usuarios,
      lineas: p._count.lineas,
      falta: p.activa ? await faltantes(p.id, p.slug) : [],
    }))
  );

  return (
    <main className="panel">
      <header className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Plantas</h1>
          <p className="panel__usuario">{sesion.nombre} · administración del servicio</p>
        </div>
        <div className="panel__acciones">
          <Link className="boton boton--suave" href="/admin">Volver al panel</Link>
          <form action={salir}>
            <button className="boton boton--suave" type="submit">Salir</button>
          </form>
        </div>
      </header>

      <ul className="plantas-lista">
        {filas.map((f) => <li key={f.slug}><Fila planta={f} /></li>)}
      </ul>

      <Alta categorias={categorias.map((c) => ({ id: c.id, nombre: c.nombre, codigo: c.codigo }))} />
    </main>
  );
}
