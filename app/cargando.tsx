/**
 * Indicador de carga.
 *
 * Un texto solo no alcanza: mientras no se mueve nada, la pantalla parece
 * trabada. La animación es lo que dice "está pasando algo", y por eso el
 * spinner y el texto van juntos.
 *
 * Se respeta `prefers-reduced-motion`: quien pidió no ver animaciones ve un
 * punto que late en vez de un aro girando, no una pantalla quieta.
 */
export default function Cargando({
  texto = "Cargando…",
  chico = false,
}: {
  texto?: string;
  chico?: boolean;
}) {
  return (
    <p className={`cargando${chico ? " cargando--chico" : ""}`} role="status" aria-live="polite">
      <span className="cargando__aro" aria-hidden="true" />
      {texto}
    </p>
  );
}
