import Link from "next/link";

const PARTES = [
  { id: "general", texto: "General", ruta: "" },
  { id: "lineas", texto: "Líneas", ruta: "/lineas" },
  { id: "horarios", texto: "Horarios", ruta: "/horarios" },
  { id: "precios", texto: "Precios", ruta: "/precios" },
  { id: "feriados", texto: "Días cerrados", ruta: "/feriados" },
] as const;

export default function Subnav({ slug, activo }: { slug: string; activo: string }) {
  return (
    <nav className="subnav" aria-label="Configuración">
      {PARTES.map((p) => (
        <Link
          key={p.id}
          href={`/admin/${slug}/configuracion${p.ruta}`}
          className={`subnav__item${activo === p.id ? " subnav__item--activo" : ""}`}
          aria-current={activo === p.id ? "page" : undefined}
        >
          {p.texto}
        </Link>
      ))}
    </nav>
  );
}
