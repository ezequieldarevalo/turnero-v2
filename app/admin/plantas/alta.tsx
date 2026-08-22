"use client";

import { useState, useTransition } from "react";
import Aro from "@/app/aro";
import { crear } from "./acciones";
import { normalizarSlug } from "@/lib/plantas";

const MOTIVOS: Record<string, string> = {
  SLUG_TOMADO: "Ya hay una planta con esa dirección.",
  SIN_LINEAS: "Agregá al menos una línea: sin líneas la planta no ofrece ningún turno.",
};

export interface Categoria {
  id: number;
  nombre: string;
  codigo: string;
}

interface LineaForm {
  categoriaId: number;
  numero: string;
}

export default function Alta({ categorias }: { categorias: Categoria[] }) {
  const [pendiente, arrancar] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [tocoSlug, setTocoSlug] = useState(false);
  const [direccion, setDireccion] = useState("");
  const [marca, setMarca] = useState("");
  const [color, setColor] = useState("#74acdf");
  const [colorAviso, setColorAviso] = useState("#d68227");
  const [emailRemitente, setEmailRemitente] = useState("");
  const [emailNombre, setEmailNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [jurisdiccion, setJurisdiccion] = useState("Mendoza");

  // La primera línea viene puesta: una planta sin líneas no ofrece nada, y
  // arrancar con la lista vacía invita a guardar y descubrirlo después.
  const [lineas, setLineas] = useState<LineaForm[]>([
    { categoriaId: categorias[0]?.id ?? 0, numero: "1" },
  ]);

  // El slug se propone del nombre, pero deja de seguirlo apenas se lo toca:
  // pisarle lo que escribió a mano sería peor que no proponer nada.
  const cambiarNombre = (v: string) => {
    setNombre(v);
    if (!tocoSlug) setSlug(normalizarSlug(v));
    if (!emailNombre) setEmailNombre(v);
  };

  // Lo que se está por crear, en palabras.
  const validas = lineas.filter((l) => l.numero.trim());
  const porCategoria = new Map<string, number>();
  for (const l of validas) {
    const nombre = categorias.find((c) => c.id === l.categoriaId)?.nombre ?? "?";
    porCategoria.set(nombre, (porCategoria.get(nombre) ?? 0) + 1);
  }
  const resumenLineas = validas.length
    ? `${validas.length} ${validas.length === 1 ? "puesto" : "puestos"}: ` +
      [...porCategoria.entries()].map(([c, n]) => `${n} de ${c.toLowerCase()}`).join(" y ") +
      `. Hasta ${validas.length} ${validas.length === 1 ? "vehículo" : "vehículos"} a la vez.`
    : null;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    arrancar(async () => {
      const r = await crear({
        slug, nombre, direccion, marcaValor: marca || nombre,
        colorPrimario: color, colorAdvertencia: colorAviso,
        emailRemitente, emailNombre: emailNombre || nombre,
        whatsappContacto: whatsapp, jurisdiccion,
        timezone: "America/Argentina/Mendoza",
        lineas: lineas.filter((l) => l.numero.trim()),
      });
      // Si sale bien, la acción redirige a la planta nueva.
      if (!r.ok) setError(MOTIVOS[r.motivo] ?? r.detalle ?? "No se pudo crear la planta.");
    });
  }

  if (!abierto) {
    return (
      <div className="ops__botones" style={{ marginTop: 24 }}>
        <button className="boton" onClick={() => setAbierto(true)}>Dar de alta una planta</button>
      </div>
    );
  }

  return (
    <form className="ops__panel" onSubmit={enviar} style={{ marginTop: 24 }}>
      <h4>Planta nueva</h4>
      {error && <p className="ops__error" role="alert">{error}</p>}

      <div className="formulario">
        <div className="campo campo--ancho">
          <label htmlFor="nombre">Nombre</label>
          <input id="nombre" value={nombre} required autoFocus
                 onChange={(e) => cambiarNombre(e.target.value)}
                 placeholder="Revitotal San Martín" />
        </div>

        <div className="campo">
          <label htmlFor="slug">
            Dirección web <span className="campo__ayuda">(no se puede cambiar después)</span>
          </label>
          <input id="slug" value={slug} required
                 onChange={(e) => { setTocoSlug(true); setSlug(normalizarSlug(e.target.value)); }} />
          <p className="campo__ayuda">turnos.reviturnos.com.ar/<strong>{slug || "…"}</strong></p>
        </div>

        <div className="campo">
          <label htmlFor="jur">Jurisdicción</label>
          <input id="jur" value={jurisdiccion} onChange={(e) => setJurisdiccion(e.target.value)} />
        </div>

        <div className="campo campo--ancho">
          <label htmlFor="dir">Dirección</label>
          <input id="dir" value={direccion} required onChange={(e) => setDireccion(e.target.value)} />
        </div>

        <div className="campo">
          <label htmlFor="marca">
            Marca <span className="campo__ayuda">(el texto de la cabecera)</span>
          </label>
          <input id="marca" value={marca} onChange={(e) => setMarca(e.target.value)} placeholder={nombre} />
        </div>

        <div className="campo">
          <label htmlFor="wa">WhatsApp <span className="campo__ayuda">(opcional)</span></label>
          <input id="wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
        </div>

        <div className="campo">
          <label htmlFor="c1">Color principal</label>
          <input id="c1" type="color" className="campo__color" value={color}
                 onChange={(e) => setColor(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="c2">Color de advertencia</label>
          <input id="c2" type="color" className="campo__color" value={colorAviso}
                 onChange={(e) => setColorAviso(e.target.value)} />
        </div>

        <div className="campo">
          <label htmlFor="rem">
            Correo remitente <span className="campo__ayuda">(desde el que salen los avisos)</span>
          </label>
          <input id="rem" type="email" value={emailRemitente} required
                 onChange={(e) => setEmailRemitente(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="remn">Nombre del remitente</label>
          <input id="remn" value={emailNombre} onChange={(e) => setEmailNombre(e.target.value)}
                 placeholder={nombre} />
        </div>
      </div>

      <h4 style={{ marginTop: 18 }}>Líneas de atención</h4>
      <p className="campo__ayuda">
        Una línea es un <strong>puesto donde entra un vehículo a que lo revisen</strong>.
        Cargá una por cada puesto que tenga la planta: con tres líneas, a las 9:00 pueden
        estar revisando tres vehículos a la vez, y los cupos del día se multiplican por tres.
      </p>
      <p className="campo__ayuda">
        El <strong>número</strong> distingue puestos de la misma categoría: "Livianos 1" y
        "Livianos 2" son dos puestos que hacen lo mismo. La <strong>categoría</strong> define
        qué vehículos entran a ese puesto. Las tres plantas de hoy tienen tres líneas:
        Livianos&nbsp;1, Livianos&nbsp;2 y Motos&nbsp;1.
      </p>
      <ul className="lineas-form">
        {lineas.map((l, i) => (
          <li key={i}>
            <select className="campo__select" value={l.categoriaId}
                    onChange={(e) => setLineas((xs) => xs.map((x, j) =>
                      j === i ? { ...x, categoriaId: Number(e.target.value) } : x))}>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <input className="celda celda--corta" value={l.numero} placeholder="Nº"
                   onChange={(e) => setLineas((xs) => xs.map((x, j) =>
                     j === i ? { ...x, numero: e.target.value } : x))} />
            {lineas.length > 1 && (
              <button type="button" className="banda__borrar"
                      onClick={() => setLineas((xs) => xs.filter((_, j) => j !== i))}
                      aria-label="Quitar esta línea">×</button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="boton boton--suave boton--chico"
              onClick={() => setLineas((xs) => [
                ...xs,
                { categoriaId: categorias[0]?.id ?? 0, numero: String(xs.length + 1) },
              ])}>
        Agregar otra línea
      </button>

      {/* Un resumen en palabras de lo que se está por crear. La lista de
          selectores no dice cuántos vehículos entran a la vez, que es lo único
          que importa entender. */}
      {resumenLineas && (
        <p className="alta__resumen">{resumenLineas}</p>
      )}

      <div className="ops__botones">
        <button className="boton" type="submit" disabled={pendiente}>
          {pendiente ? <><Aro />Creando…</> : "Crear la planta"}
        </button>
        <button type="button" className="boton boton--suave" onClick={() => setAbierto(false)}>
          Volver
        </button>
      </div>
      <p className="campo__ayuda">
        Después vas a tener que cargarle horarios, precios y las credenciales de cobro
        y de correo. La lista de lo que falta aparece acá mismo hasta completarla.
      </p>
    </form>
  );
}
