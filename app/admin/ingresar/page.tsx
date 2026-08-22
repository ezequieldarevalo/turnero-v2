import { redirect } from "next/navigation";
import { sesionActual } from "@/lib/sesionActual";
import Formulario from "./formulario";

export const metadata = { title: "Ingresar · Reviturnos" };

export default async function Ingresar({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  if (await sesionActual()) redirect("/admin");
  const { volver } = await searchParams;

  return (
    <main className="ingresar">
      <div className="ingresar__caja">
        <h1 className="ingresar__marca">Reviturnos</h1>
        <p className="ingresar__bajada">Panel de administración</p>
        <Formulario volver={volver} />
      </div>
    </main>
  );
}
