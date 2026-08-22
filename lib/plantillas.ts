/**
 * Plantillas de correo.
 *
 * HTML deliberadamente simple: tablas y estilos en línea. Los clientes de
 * correo —sobre todo Outlook— no soportan flex, grid ni hojas de estilo.
 */

export interface DatosTurnoCorreo {
  plantaNombre: string;
  plantaDireccion: string;
  colorPrimario: string;
  colorAdvertencia?: string;
  tipoVehiculo: string;
  dominio: string;
  titularNombre: string;
  cuando: string;
  codigo: string;
  urlTurno: string;
  urlPago?: string | null;
  precio?: number;
  horasParaPagar?: number;
  avisoTarifa?: string | null;
  whatsapp?: string | null;
}

const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

function envolver(color: string, titulo: string, cuerpo: string) {
  return `<!doctype html>
<html lang="es-AR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#16181d;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
  <tr><td style="background:${color};padding:20px 28px;">
    <div style="color:#ffffff;font-size:19px;font-weight:bold;">${titulo}</div>
  </td></tr>
  <tr><td style="padding:28px;font-size:15px;line-height:1.6;">${cuerpo}</td></tr>
  <tr><td style="padding:18px 28px;background:#f7f8fa;font-size:12px;color:#6b7280;">
    Este correo se envió automáticamente. No respondas a esta dirección.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function detalles(d: DatosTurnoCorreo) {
  const fila = (k: string, v: string) =>
    `<tr>
       <td style="padding:6px 0;color:#6b7280;font-size:13px;width:130px;">${k}</td>
       <td style="padding:6px 0;font-weight:bold;">${v}</td>
     </tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
            style="margin:18px 0;padding:16px;background:#f7f8fa;border-radius:6px;">
    ${fila("Fecha y hora", d.cuando)}
    ${fila("Vehículo", `${d.tipoVehiculo} · ${d.dominio}`)}
    ${fila("A nombre de", d.titularNombre)}
    ${fila("Planta", d.plantaNombre)}
    ${fila("Dirección", d.plantaDireccion)}
    ${fila("Código", d.codigo)}
  </table>`;
}

function boton(color: string, url: string, texto: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
    <tr><td style="background:${color};border-radius:6px;">
      <a href="${url}" style="display:inline-block;padding:14px 30px;color:#ffffff;
         text-decoration:none;font-weight:bold;font-size:15px;">${texto}</a>
    </td></tr></table>`;
}

/** Turno reservado, esperando el pago. Lleva el link real al checkout. */
export function turnoReservado(d: DatosTurnoCorreo) {
  const cuerpo = `
    <p>Hola ${d.titularNombre},</p>
    <p>Reservaste un turno para la revisión técnica de tu vehículo.</p>
    ${detalles(d)}
    <p style="font-weight:bold;color:#b80000;">
      El turno todavía no está confirmado: falta el pago${d.precio ? ` de ${pesos(d.precio)}` : ""}.
    </p>
    ${d.urlPago ? boton(d.colorPrimario, d.urlPago, "Pagar el turno") : ""}
    <p style="font-size:14px;color:#6b7280;">
      Tenés ${d.horasParaPagar ?? 2} horas para completarlo. Pasado ese plazo el turno
      se libera automáticamente y el horario queda disponible para otra persona.
    </p>
    ${d.avisoTarifa ? `<p style="font-size:14px;">${d.avisoTarifa}</p>` : ""}
    <p style="font-size:14px;">
      Podés ver el estado de tu turno en cualquier momento
      <a href="${d.urlTurno}" style="color:${d.colorPrimario};">en este enlace</a>.
    </p>`;
  return {
    asunto: `Reservaste tu turno · ${d.plantaNombre}`,
    html: envolver(d.colorPrimario, "Turno reservado", cuerpo),
  };
}

/** Pago acreditado. */
export function turnoConfirmado(d: DatosTurnoCorreo) {
  const cuerpo = `
    <p>Hola ${d.titularNombre},</p>
    <p><strong>Tu turno está confirmado.</strong> Recibimos el pago correctamente.</p>
    ${detalles(d)}
    ${d.avisoTarifa ? `<p style="font-size:14px;">${d.avisoTarifa}</p>` : ""}
    <p style="font-size:14px;">
      Podés reprogramar o cancelar desde
      <a href="${d.urlTurno}" style="color:${d.colorPrimario};">el enlace de tu turno</a>.
      ${d.whatsapp ? `Y si necesitás algo más, escribinos por WhatsApp al ${d.whatsapp}.` : ""}
    </p>
    <p style="font-size:14px;color:#6b7280;">Te esperamos. Llegá unos minutos antes.</p>`;
  return {
    asunto: `Turno confirmado · ${d.plantaNombre}`,
    html: envolver(d.colorPrimario, "Turno confirmado", cuerpo),
  };
}

/** Turno cancelado por el cliente. */
export function turnoCancelado(d: DatosTurnoCorreo) {
  const cuerpo = `
    <p>Hola ${d.titularNombre},</p>
    <p>Cancelaste tu turno. El horario quedó disponible para otra persona.</p>
    ${detalles(d)}
    <p style="font-size:14px;">
      Si lo cancelaste por error, podés sacar uno nuevo cuando quieras desde nuestro sitio.
    </p>`;
  return {
    asunto: `Turno cancelado · ${d.plantaNombre}`,
    html: envolver(d.colorPrimario, "Turno cancelado", cuerpo),
  };
}

/**
 * Turno cargado por teléfono, esperando que el titular lo acepte.
 *
 * El botón no es un trámite: es donde la persona acepta la política de
 * privacidad con su propio click. Un operador tildando esa casilla en nombre
 * de otro no sería consentimiento.
 */
export function turnoPorConfirmar(d: DatosTurnoCorreo & { urlConfirmar: string; horasParaConfirmar: number }) {
  const cuerpo = `
    <p>Hola ${d.titularNombre},</p>
    <p>Te reservamos un turno para la revisión técnica de tu vehículo, según lo
       que hablamos por teléfono.</p>
    ${detalles(d)}
    <p style="font-weight:bold;">
      El turno todavía no está confirmado: hace falta que lo aceptes vos.
    </p>
    ${boton(d.colorPrimario, d.urlConfirmar, "Confirmar mi turno")}
    <p style="font-size:14px;color:#6b7280;">
      Tenés ${d.horasParaConfirmar} horas para hacerlo. Pasado ese plazo el horario
      se libera automáticamente${d.precio ? `. Después vas a poder abonar los ${pesos(d.precio)}` : ""}.
    </p>
    <p style="font-size:14px;">
      Si no pediste este turno, ignorá este correo: sin tu confirmación no queda nada a tu nombre.
    </p>`;
  return {
    asunto: `Confirmá tu turno · ${d.plantaNombre}`,
    html: envolver(d.colorPrimario, "Confirmá tu turno", cuerpo),
  };
}

/**
 * Venció el plazo de pago y el cupo se liberó.
 *
 * Se avisa por una razón concreta: sin este correo la persona cree que tiene
 * turno y se entera el día que llega a la planta. El sistema viejo liberaba el
 * cupo en silencio.
 */
export function turnoVencido(d: DatosTurnoCorreo & { sinConfirmar?: boolean }) {
  const cuerpo = `
    <p>Hola ${d.titularNombre},</p>
    <p>${d.sinConfirmar
        ? "Se venció el plazo para confirmar el turno que te habíamos reservado, así que el horario quedó disponible para otra persona."
        : "Se venció el plazo para pagar tu turno, así que el horario quedó disponible para otra persona."}</p>
    ${detalles(d)}
    <p style="font-size:14px;">
      Si todavía necesitás la revisión técnica, podés sacar un turno nuevo
      cuando quieras${d.sinConfirmar ? "" : `. Esta vez tenés ${d.horasParaPagar ?? 2} horas para abonarlo`}.
    </p>
    ${d.urlTurno ? boton(d.colorPrimario, d.urlTurno.replace(/\/turno\/.*$/, ""), "Sacar otro turno") : ""}`;
  return {
    asunto: d.sinConfirmar
      ? `Se liberó tu turno sin confirmar · ${d.plantaNombre}`
      : `Se liberó tu turno por falta de pago · ${d.plantaNombre}`,
    html: envolver(d.colorAdvertencia ?? d.colorPrimario, "Turno liberado", cuerpo),
  };
}

/** Turno movido a otra fecha. */
export function turnoReprogramado(d: DatosTurnoCorreo) {
  const cuerpo = `
    <p>Hola ${d.titularNombre},</p>
    <p><strong>Cambiaste la fecha de tu turno.</strong> Esta es la nueva:</p>
    ${detalles(d)}
    <p style="font-size:14px;">
      Tu pago sigue siendo válido: no hace falta que abones de nuevo.
    </p>
    <p style="font-size:14px;">
      Podés ver tu turno en cualquier momento
      <a href="${d.urlTurno}" style="color:${d.colorPrimario};">en este enlace</a>.
    </p>`;
  return {
    asunto: `Turno reprogramado · ${d.plantaNombre}`,
    html: envolver(d.colorPrimario, "Nueva fecha de tu turno", cuerpo),
  };
}
