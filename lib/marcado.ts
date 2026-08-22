/**
 * Un subconjunto mínimo de Markdown, para el texto de la política de privacidad.
 *
 * Se convierte a nodos de React, **no a HTML**. La política la carga el
 * administrador del servicio y hoy es de confianza, pero renderizar texto
 * guardado en base con `dangerouslySetInnerHTML` es exactamente el mecanismo
 * por el que una política de privacidad termina ejecutando JavaScript ajeno.
 * Costaba lo mismo hacerlo bien.
 *
 * Reconoce: encabezados (##, ###), párrafos, listas con guiones, citas (>),
 * separadores (---), **negrita** y [enlaces](url). Cualquier otra cosa se
 * muestra como texto, que es el peor caso aceptable para un documento legal.
 */
import { createElement, Fragment, type ReactNode } from "react";

/** **negrita** y [texto](url) dentro de una línea. */
function enLinea(texto: string, clave: string): ReactNode[] {
  const nodos: ReactNode[] = [];
  const patron = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = patron.exec(texto)) !== null) {
    if (m.index > ultimo) nodos.push(texto.slice(ultimo, m.index));
    if (m[1] !== undefined) {
      nodos.push(createElement("strong", { key: `${clave}-b${i}` }, m[1]));
    } else {
      // Solo enlaces internos o http(s). Un `javascript:` en el texto de la
      // política sería un problema de otra escala.
      const url = m[3];
      const seguro = /^(https?:\/\/|\/|mailto:)/i.test(url) ? url : "#";
      nodos.push(
        createElement("a", {
          key: `${clave}-a${i}`,
          href: seguro,
          ...(seguro.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {}),
        }, m[2])
      );
    }
    ultimo = m.index + m[0].length;
    i++;
  }
  if (ultimo < texto.length) nodos.push(texto.slice(ultimo));
  return nodos;
}

export function marcado(texto: string): ReactNode {
  const lineas = texto.replace(/\r\n/g, "\n").split("\n");
  const bloques: ReactNode[] = [];
  let parrafo: string[] = [];
  let lista: string[] = [];
  let cita: string[] = [];
  let n = 0;

  const cerrarParrafo = () => {
    if (!parrafo.length) return;
    bloques.push(createElement("p", { key: `p${n++}` }, enLinea(parrafo.join(" "), `p${n}`)));
    parrafo = [];
  };
  const cerrarLista = () => {
    if (!lista.length) return;
    bloques.push(
      createElement("ul", { key: `u${n++}` },
        lista.map((x, j) => createElement("li", { key: j }, enLinea(x, `u${n}-${j}`))))
    );
    lista = [];
  };
  const cerrarCita = () => {
    if (!cita.length) return;
    bloques.push(
      createElement("blockquote", { key: `q${n++}` },
        cita.map((x, j) => createElement("p", { key: j }, enLinea(x, `q${n}-${j}`))))
    );
    cita = [];
  };
  const cerrarTodo = () => { cerrarParrafo(); cerrarLista(); cerrarCita(); };

  for (const cruda of lineas) {
    const linea = cruda.trim();

    if (!linea) { cerrarTodo(); continue; }

    if (/^---+$/.test(linea)) {
      cerrarTodo();
      bloques.push(createElement("hr", { key: `h${n++}` }));
      continue;
    }

    const enc = /^(#{1,4})\s+(.*)$/.exec(linea);
    if (enc) {
      cerrarTodo();
      const nivel = Math.min(enc[1].length + 1, 6); // ## → h3: el h1 es el título de la página
      bloques.push(createElement(`h${nivel}`, { key: `t${n++}` }, enLinea(enc[2], `t${n}`)));
      continue;
    }

    if (linea.startsWith("- ")) { cerrarParrafo(); cerrarCita(); lista.push(linea.slice(2)); continue; }
    if (linea.startsWith("> ")) { cerrarParrafo(); cerrarLista(); cita.push(linea.slice(2)); continue; }

    cerrarLista(); cerrarCita();
    parrafo.push(linea);
  }
  cerrarTodo();

  return createElement(Fragment, null, ...bloques);
}
