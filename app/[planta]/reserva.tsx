"use client";

import { useMemo, useState, useTransition } from "react";
import Cargando from "@/app/cargando";
import Calendario from "./calendario";
import { obtenerDisponibilidad, reservar, type DiaSerializado } from "./acciones";

interface Tipo { id: number; nombre: string; precio: number }
interface Props {
  slug: string;
  nombrePlanta: string;
  direccion: string;
  tipos: Tipo[];
  avisos: { texto: string; destacado: boolean }[];
  combustibles: string[];
  requierePago: boolean;
  horasParaPagar: number;
  mediosEfectivo: boolean;
}

/** Patentes argentinas: ABC123 y AB123CD para autos; A123BCD y 123ABC para motos. */
const PATENTE_AUTO = /^([A-Z]{3}\d{3}|[A-Z]{2}\d{3}[A-Z]{2})$/;
const PATENTE_MOTO = /^([A-Z]\d{3}[A-Z]{3}|\d{3}[A-Z]{3})$/;

const fechaLarga = (f: string) =>
  new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${f}T12:00:00Z`))
    .replace(/^\w/, (c) => c.toUpperCase());

const pesos = (n: number) => "$" + n.toLocaleString("es-AR");

type Paso = 1 | 2 | 3 | 4;

export default function Reserva(p: Props) {
  const [paso, setPaso] = useState<Paso>(1);
  const [pendiente, arrancar] = useTransition();

  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [dias, setDias] = useState<DiaSerializado[]>([]);
  const [fecha, setFecha] = useState<string | null>(null);
  const [cupo, setCupo] = useState<DiaSerializado["horarios"][0] | null>(null);

  const [f, setF] = useState({
    nombre: "", dominio: "", anio: "", email: "", telefono: "",
    combustible: p.combustibles[0],
  });
  const [acepta, setAcepta] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<{ ok: boolean; motivo?: string; detalle?: string } | null>(null);

  const esMoto = tipo?.nombre.toUpperCase().includes("MOTO");
  const fechasDisponibles = useMemo(() => new Set(dias.map((d) => d.fecha)), [dias]);
  const horariosDelDia = dias.find((d) => d.fecha === fecha)?.horarios ?? [];

  function elegirTipo(t: Tipo) {
    arrancar(async () => {
      const d = await obtenerDisponibilidad(p.slug, t.id);
      setTipo(t);
      setDias(d);
      setFecha(d[0]?.fecha ?? null);
      setCupo(null);
      setPaso(2);
    });
  }

  function volverA(n: Paso) {
    if (n === 1) { setCupo(null); setFecha(null); }
    setPaso(n);
  }

  function validarDatos() {
    const e: Record<string, string> = {};
    if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñ\s]{3,100}$/.test(f.nombre.trim())) e.nombre = "Ingresá nombre y apellido";
    const dom = f.dominio.toUpperCase().replace(/[\s-]/g, "");
    if (!(esMoto ? PATENTE_MOTO : PATENTE_AUTO).test(dom))
      e.dominio = esMoto ? "Formato: A123BCD o 123ABC" : "Formato: ABC123 o AB123CD";
    if (!/^\d{4}$/.test(f.anio)) e.anio = "Cuatro dígitos";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) e.email = "Correo no válido";
    if (!/^\d{8,16}$/.test(f.telefono.replace(/\D/g, ""))) e.telefono = "Entre 8 y 16 dígitos";
    setErrores(e);
    return Object.keys(e).length === 0;
  }

  function validarConsentimiento() {
    if (acepta) { setErrores({}); return true; }
    setErrores({ acepta: "Necesitamos tu consentimiento para reservar" });
    return false;
  }

  function irAPagar() {
    if (!validarDatos()) return;
    setPaso(4);
  }

  /** El servidor nombra los campos como los recibe; el formulario, como los pinta. */
  const campoDeServidor = (campo: string) =>
    ({ titularNombre: "nombre", titularEmail: "email", titularTelefono: "telefono" }[campo] ?? campo);

  function confirmar() {
    if (!validarConsentimiento() || !tipo || !cupo) return;
    arrancar(async () => {
      const r = await reservar({
        slug: p.slug, tipoVehiculoId: tipo.id, lineaId: cupo.lineaId,
        inicioIso: cupo.iso, duracionMin: cupo.duracionMin, ...f, acepta,
      });
      if (r.ok && r.urlPago) {
        // Al pago. El cupo ya quedó tomado y con vencimiento.
        window.location.href = r.urlPago;
        return;
      }
      if (!r.ok && r.motivo === "DATOS_INVALIDOS" && r.campo) {
        // El servidor encontró algo que el navegador dejó pasar. En vez de
        // mandar a la pantalla de error, se marca el campo y se vuelve al paso
        // de datos: la persona corrige y sigue, sin perder lo que escribió.
        setErrores({ [campoDeServidor(r.campo)]: r.detalle ?? "Dato no válido" });
        setPaso(3);
        return;
      }
      setResultado(r.ok ? { ok: true } : { ok: false, motivo: r.motivo, detalle: r.detalle });
    });
  }

  async function reintentar() {
    setResultado(null);
    if (!tipo) return setPaso(1);
    const d = await obtenerDisponibilidad(p.slug, tipo.id);
    setDias(d);
    setFecha(d[0]?.fecha ?? null);
    setCupo(null);
    setPaso(2);
  }

  // ── Resultado ──────────────────────────────────────────────
  if (resultado?.ok) {
    return (
      <div className="mensaje mensaje--exito">
        <h2>Tu turno quedó reservado</h2>
        <p><strong>{fechaLarga(fecha!)} a las {cupo!.hhmm} hs</strong> · {p.nombrePlanta}</p>
        <p className="mensaje__detalle">{p.direccion}</p>
        <p style={{ marginTop: 14 }}>
          {p.requierePago
            ? `Te enviamos un correo a ${f.email} con el enlace para pagar. Tenés ${p.horasParaPagar} horas para hacerlo, o el turno se cancela automáticamente.`
            : `Te enviamos un correo a ${f.email} con los detalles.`}
        </p>
      </div>
    );
  }

  if (resultado && !resultado.ok) {
    const textos: Record<string, string> = {
      CUPO_TOMADO: "Alguien tomó ese horario mientras completabas los datos. Elegí otro, por favor.",
      TURNO_PENDIENTE: "Ese dominio ya tiene un turno pendiente. Revisá tu correo.",
      SIN_CONSENTIMIENTO: "Necesitamos tu consentimiento para reservar.",
      DATOS_INVALIDOS: "Revisá los datos ingresados.",
      PAGO_NO_DISPONIBLE: "No pudimos iniciar el pago en este momento. Probá de nuevo en unos minutos.",
    };
    return (
      <div className="mensaje mensaje--error">
        <h2>No pudimos reservar el turno</h2>
        <p>{resultado.detalle ?? textos[resultado.motivo!] ?? "Intentá de nuevo en unos minutos."}</p>
        <div className="acciones">
          <button className="boton" onClick={reintentar}>Elegir otro horario</button>
        </div>
      </div>
    );
  }

  return (
    <>
      {paso === 1 && p.avisos.length > 0 && (
        <div className="aviso">
          <div className="aviso__titulo">IMPORTANTE</div>
          {p.avisos.map((a, i) => (
            <p key={i} className={a.destacado ? "destacado" : undefined}>{a.texto}</p>
          ))}
        </div>
      )}

      {/* ── 1 ── */}
      <Paso
        n={1}
        titulo="Tipo de vehículo"
        estado={paso === 1 ? "activo" : "hecho"}
        alModificar={paso > 1 ? () => volverA(1) : undefined}
        resumen={tipo ? `${tipo.nombre} · ${pesos(tipo.precio)}` : undefined}
      >
        <div className="opciones opciones--bloque">
          {p.tipos.map((t) => (
            <button
              key={t.id}
              className={`opcion${tipo?.id === t.id ? " opcion--activa" : ""}`}
              onClick={() => elegirTipo(t)}
              disabled={pendiente}
            >
              <span className="opcion__nombre">{t.nombre}</span>
              <span className="opcion__precio">{pesos(t.precio)}</span>
            </button>
          ))}
        </div>
        {pendiente && paso === 1 && <Cargando texto="Buscando turnos disponibles…" />}
      </Paso>

      {/* ── 2 ── */}
      {paso >= 2 && (
        <Paso
          n={2}
          titulo="Fecha y hora"
          estado={paso === 2 ? "activo" : "hecho"}
          alModificar={paso > 2 ? () => volverA(2) : undefined}
          resumen={cupo && fecha ? `${fechaLarga(fecha)} a las ${cupo.hhmm} hs` : undefined}
        >
          {dias.length === 0 ? (
            <p className="vacio">
              No hay turnos disponibles para {tipo?.nombre.toLowerCase() ?? "ese vehículo"} en
              este momento. Probá con otro tipo de vehículo o volvé a intentar más tarde:
              los turnos que no se pagan se liberan solos.
            </p>
          ) : (
            <>
              <div className="selector">
                <Calendario
                  fechasDisponibles={fechasDisponibles}
                  seleccionada={fecha}
                  alSeleccionar={(nueva) => { setFecha(nueva); setCupo(null); }}
                />

                <div className="selector__horas">
                  <h3 className="selector__subtitulo">
                    {fecha ? `Horarios del ${fechaLarga(fecha).toLowerCase()}` : "Elegí un día"}
                  </h3>
                  {fecha && (
                    <div className="horarios">
                      {horariosDelDia.map((h) => (
                        <button
                          key={h.iso}
                          className={`hora${cupo?.iso === h.iso ? " hora--activa" : ""}`}
                          onClick={() => setCupo(h)}
                        >
                          {h.hhmm}
                        </button>
                      ))}
                    </div>
                  )}
                  {fecha && horariosDelDia.length === 0 && (
                    <p className="vacio">Ese día ya no tiene cupos.</p>
                  )}
                </div>
              </div>

              <div className="acciones">
                <button className="boton" disabled={!cupo} onClick={() => setPaso(3)}>
                  Continuar
                </button>
              </div>
            </>
          )}
        </Paso>
      )}

      {/* ── 3 ── */}
      {paso >= 3 && (
        <Paso
          n={3}
          titulo="Tus datos"
          estado={paso === 3 ? "activo" : "hecho"}
          alModificar={paso > 3 ? () => setPaso(3) : undefined}
          resumen={`${f.nombre} · ${f.dominio} · ${f.email}`}
        >
          <div className="formulario">
            <Campo etiqueta="Nombre y apellido" valor={f.nombre} error={errores.nombre}
                   autoComplete="name" alCambiar={(v) => setF({ ...f, nombre: v })} />
            <Campo etiqueta="Dominio" ayuda="sin guiones ni espacios" valor={f.dominio}
                   error={errores.dominio} alCambiar={(v) => setF({ ...f, dominio: v.toUpperCase() })} />
            <Campo etiqueta="Año del vehículo" valor={f.anio} error={errores.anio} modo="numeric"
                   alCambiar={(v) => setF({ ...f, anio: v.replace(/\D/g, "").slice(0, 4) })} />
            <Campo etiqueta="Correo electrónico" valor={f.email} error={errores.email}
                   tipo="email" autoComplete="email" alCambiar={(v) => setF({ ...f, email: v })} />
            <Campo etiqueta="Teléfono" valor={f.telefono} error={errores.telefono} modo="tel"
                   tipo="tel" autoComplete="tel" alCambiar={(v) => setF({ ...f, telefono: v })} />

            <div className="campo campo--ancho">
              <label>Combustible</label>
              <div className="opciones">
                {p.combustibles.map((c) => (
                  <button key={c} className={`opcion opcion--chico${f.combustible === c ? " opcion--activa" : ""}`}
                          onClick={() => setF({ ...f, combustible: c })}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="acciones">
            <button className="boton" onClick={irAPagar}>Continuar</button>
          </div>
        </Paso>
      )}

      {/* ── 4 ── */}
      {paso >= 4 && tipo && cupo && fecha && (
        <Paso n={4} titulo={p.requierePago ? "Pago" : "Confirmación"} estado="activo">
          <dl className="resumen">
            <div><dt>Vehículo</dt><dd>{tipo.nombre} · {f.dominio}</dd></div>
            <div><dt>Turno</dt><dd>{fechaLarga(fecha)} a las {cupo.hhmm} hs</dd></div>
            <div><dt>A nombre de</dt><dd>{f.nombre}</dd></div>
            <div><dt>Correo</dt><dd>{f.email}</dd></div>
          </dl>

          {p.requierePago && (
            <>
              <div className="pago">
                <div className="pago__medio">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/img/mercadopago.png" alt="Mercado Pago" width={148} height={48} />
                  <p>
                    Vas a pagar con <strong>Mercado Pago</strong>. Al continuar te llevamos
                    a su sitio para completar el pago con tarjeta{" "}
                    {(p.mediosEfectivo ? "o en efectivo" : "")}.
                  </p>
                </div>
                <div className="pago__total">
                  <span>Total</span>
                  <strong>{pesos(tipo.precio)}</strong>
                </div>
              </div>
              <p className="pago__nota">
                Tu turno queda reservado {p.horasParaPagar} horas mientras completás el pago.
                Si no lo hacés, se libera automáticamente.
              </p>
            </>
          )}

          <label className={`consentimiento${errores.acepta ? " consentimiento--error" : ""}`}>
            <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
            <span>
              Acepto la <a href={`/${p.slug}/privacidad`} target="_blank" rel="noreferrer">política de privacidad</a> y
              el tratamiento de mis datos personales, incluida su transferencia a servidores ubicados
              fuera de la Argentina.
            </span>
          </label>
          {errores.acepta && <p className="campo__error">{errores.acepta}</p>}

          <div className="acciones">
            <button className="boton" onClick={confirmar} disabled={pendiente}>
              {pendiente
                ? "Generando el pago…"
                : p.requierePago ? "Ir a pagar" : "Confirmar turno"}
            </button>
          </div>
        </Paso>
      )}
    </>
  );
}

function Paso({ n, titulo, estado, alModificar, resumen, children }: {
  n: number; titulo: string; estado: "activo" | "hecho";
  alModificar?: () => void; resumen?: string; children: React.ReactNode;
}) {
  const cerrado = estado === "hecho";
  return (
    <section className={`paso${cerrado ? " paso--cerrado" : ""}`}>
      <div className="paso__cabecera">
        <span className={`paso__numero${cerrado ? " paso__numero--hecho" : ""}`} aria-hidden>
          {cerrado ? "✓" : n}
        </span>
        <h2 className="paso__titulo">{titulo}</h2>
        {alModificar && (
          <button type="button" className="paso__modificar" onClick={alModificar}>
            Modificar
          </button>
        )}
      </div>

      <div className="paso__cuerpo">
        {cerrado ? <p className="paso__resumen">{resumen}</p> : children}
      </div>
    </section>
  );
}

function Campo({ etiqueta, ayuda, valor, error, tipo = "text", modo, autoComplete, alCambiar }: {
  etiqueta: string; ayuda?: string; valor: string; error?: string;
  tipo?: string; modo?: "numeric" | "tel"; autoComplete?: string;
  alCambiar: (v: string) => void;
}) {
  return (
    <div className="campo">
      <label>
        {etiqueta}
        {ayuda && <span className="campo__ayuda"> ({ayuda})</span>}
      </label>
      <input
        type={tipo}
        inputMode={modo}
        autoComplete={autoComplete}
        value={valor}
        aria-invalid={!!error}
        onChange={(e) => alCambiar(e.target.value)}
      />
      {error && <p className="campo__error">{error}</p>}
    </div>
  );
}
