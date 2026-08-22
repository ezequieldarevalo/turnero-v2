/**
 * El aro girando, para meter dentro de un botón que está trabajando.
 *
 * Los botones ya cambiaban el texto a "Guardando…", pero un texto quieto no
 * transmite que algo está pasando: el aro es lo que distingue "está trabajando"
 * de "se colgó".
 */
export default function Aro() {
  return <span className="cargando__aro" aria-hidden="true" />;
}
