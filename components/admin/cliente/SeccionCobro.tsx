"use client";

import { useCallback, useEffect, useState } from "react";
import { Pill } from "@/components/dashboard/shell/ui";
import { hoyBogota } from "@/lib/cobros/fechas";
import { formatearMontoCop } from "@/lib/cobros/plantilla";
import { formatearTelefono } from "@/lib/format";
import { Boton, Seccion, fechaLarga } from "./AdminClienteUI";

// Cobros manuales (Panel de Operaciones): para los clientes que pagan FUERA de Wompi. Muestra cuándo les toca pagar, si el bot está suspendido por falta de pago y deja registrar el
// pago (que mueve la fecha un mes y reactiva el bot), editar a quién se le avisa y levantar la suspensión. La lógica vive en el servidor (ver ../../../app/api/dashboard/admin/clientes/[idTenant]/cobro).

type Ciclo = {
  fechaCobro: string;
  montoCop: number;
  estado: "pendiente" | "enviado" | "fallido" | "pagado" | "omitido";
  intentos: number;
  suspendidoAt: string | null;
  recordatorioEnviadoAt: string | null;
  ultimoError: string | null;
  pagadoAt: string | null;
  registradoPor: string | null;
  nota: string | null;
};
type Suscripcion = { plan: string; precioCop: number; fechaProximoCobro: string; diaCobro: number | null; telefonoCobro: string | null; nombreCobro: string | null; suspendidaPorPagoAt: string | null };
type MotivoNoAplica = "sin_suscripcion" | "cortesia" | "wompi" | "no_activa";
type Datos =
  | { migracionPendiente: true; modo: string }
  | { migracionPendiente?: false; modo: string; aplica: boolean; motivoNoAplica: MotivoNoAplica | null; suscripcion: Suscripcion | null; ciclos: Ciclo[] };

const NO_APLICA: Record<MotivoNoAplica, string> = {
  sin_suscripcion: "Este cliente no tiene suscripción.",
  cortesia: "Este cliente está en cortesía: no se le cobra, así que no hay nada que registrar.",
  wompi: "Este cliente paga con tarjeta por Wompi: el cobro y su registro son automáticos.",
  no_activa: "La suscripción no está activa (vencida, cancelada o con pago pendiente), así que este cobro manual no aplica.",
};

const ETIQUETA_CICLO: Record<Ciclo["estado"], { texto: string; tono: "neutral" | "success" | "warning" | "danger" }> = {
  pagado: { texto: "Pagado", tono: "success" },
  enviado: { texto: "Recordatorio enviado", tono: "warning" },
  fallido: { texto: "Falló el aviso", tono: "danger" },
  pendiente: { texto: "Pendiente", tono: "neutral" },
  omitido: { texto: "Omitido", tono: "neutral" },
};

const fechaCorta = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const dinero = (monto: number) => `$${formatearMontoCop(monto)}`;
const CAMPO = "mt-1.5 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-lime/50";
const ETIQUETA = "font-mono text-[10.5px] uppercase tracking-widest text-mist";

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className={ETIQUETA}>{etiqueta}</dt>
      <dd className="mt-1 text-sm text-fg">{children}</dd>
    </div>
  );
}

export function SeccionCobro({ idTenant, accessToken, hoy, onCambio }: { idTenant: string; accessToken: string; /** Solo para pruebas: «hoy» en Colombia (AAAA-MM-DD). */ hoy?: string; onCambio?: () => void }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [panel, setPanel] = useState<"ninguno" | "pago" | "editar">("ninguno");
  const [guardando, setGuardando] = useState(false);
  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");
  const [telefono, setTelefono] = useState("");
  const [nombre, setNombre] = useState("");
  const [dia, setDia] = useState("");
  const [fecha, setFecha] = useState("");

  const url = `/api/dashboard/admin/clientes/${idTenant}/cobro`;
  const pedir = useCallback(async (): Promise<Datos> => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "No se pudo cargar el cobro");
    return json as Datos;
  }, [url, accessToken]);

  useEffect(() => {
    let cancelado = false;
    pedir().then(
      (d) => !cancelado && setDatos(d),
      (err) => !cancelado && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      cancelado = true;
    };
  }, [pedir]);

  async function recargar() {
    try {
      setDatos(await pedir());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function enviar(cuerpo: Record<string, unknown>, exito: (respuesta: Record<string, unknown>) => string) {
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "La acción falló");
      setMensaje(exito(json));
      setPanel("ninguno");
      await recargar();
      onCambio?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  if (!datos) return <Seccion titulo="Cobro manual">{error ? <p className="text-sm text-red-400">{error}</p> : <p className="text-sm text-mist">Cargando…</p>}</Seccion>;

  if (datos.migracionPendiente) {
    return (
      <Seccion titulo="Cobro manual">
        <p className="text-sm text-amber-400">Falta correr la migración de cobros manuales (20261213000000_dulabs_cobros_manuales.sql) en Supabase.</p>
      </Seccion>
    );
  }
  if (!datos.aplica || !datos.suscripcion) {
    return (
      <Seccion titulo="Cobro manual">
        <p className="text-sm text-mist">{NO_APLICA[datos.motivoNoAplica ?? "sin_suscripcion"]}</p>
      </Seccion>
    );
  }

  const s = datos.suscripcion;
  const hoyReal = hoy ?? hoyBogota();
  const suspendido = Boolean(s.suspendidaPorPagoAt);
  const vencido = s.fechaProximoCobro <= hoyReal;

  function abrirPago() {
    setMonto(String(s.precioCop));
    setNota("");
    setError(null);
    setMensaje(null);
    setPanel("pago");
  }
  function abrirEditar() {
    setTelefono(s.telefonoCobro ?? "");
    setNombre(s.nombreCobro ?? "");
    setDia(s.diaCobro === null ? "" : String(s.diaCobro));
    setFecha(s.fechaProximoCobro);
    setError(null);
    setMensaje(null);
    setPanel("editar");
  }
  function confirmarPago() {
    const importe = Number(monto);
    void enviar(
      { accion: "registrar_pago", fecha_cobro: s.fechaProximoCobro, ...(Number.isFinite(importe) && importe !== s.precioCop ? { monto_cop: importe } : {}), nota: nota.trim() || null },
      (r) => `Pago registrado. Próximo cobro: ${fechaCorta(String(r.proximoCobro ?? ""))}.${r.reactivado ? " El bot vuelve a responder." : ""}`,
    );
  }
  function guardarCambios() {
    const cambios: Record<string, unknown> = {};
    if (telefono.trim() !== (s.telefonoCobro ?? "")) cambios.telefono_cobro = telefono.trim() === "" ? null : telefono.trim();
    if (nombre.trim() !== (s.nombreCobro ?? "")) cambios.nombre_cobro = nombre.trim() === "" ? null : nombre.trim();
    const diaNuevo = dia.trim() === "" ? null : Number(dia);
    if (diaNuevo !== s.diaCobro) cambios.dia_cobro = diaNuevo;
    if (fecha !== s.fechaProximoCobro) cambios.fecha_proximo_cobro = fecha;
    void enviar({ accion: "configurar", ...cambios }, () => "Datos de cobro guardados.");
  }

  return (
    <Seccion
      titulo="Cobro manual"
      accion={
        suspendido ? (
          <Pill tone="danger">Bot suspendido por falta de pago</Pill>
        ) : vencido ? (
          <Pill tone="warning">Venció el {fechaCorta(s.fechaProximoCobro)}</Pill>
        ) : (
          <Pill tone="success">Al día hasta el {fechaCorta(s.fechaProximoCobro)}</Pill>
        )
      }
    >
      <p className="mb-3 text-xs text-mist">
        Para clientes que pagan por transferencia u otro medio fuera de Wompi. El día de pago, si no está registrado el pago, se suspende el bot y se manda el recordatorio por WhatsApp desde el número de
        Dulabs.
      </p>

      {datos.modo !== "activo" && (
        <p className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-400">
          Los recordatorios automáticos están en SIMULACIÓN: hoy no se manda ningún mensaje ni se suspende ningún bot. Para encenderlos, pon COBROS_MANUALES_MODO=activo en Vercel y vuelve a desplegar.
        </p>
      )}
      {mensaje && <p className="mb-3 rounded-lg border border-lime/40 bg-lime/10 p-3 text-xs text-lime-text">{mensaje}</p>}
      {error && <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">{error}</p>}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
        <Dato etiqueta="Próximo cobro">{fechaCorta(s.fechaProximoCobro)}</Dato>
        <Dato etiqueta="Mensualidad">{dinero(s.precioCop)}</Dato>
        <Dato etiqueta="Día de cobro">{s.diaCobro === null ? "El de la fecha" : `Día ${s.diaCobro} de cada mes`}</Dato>
        <Dato etiqueta="Se le avisa al WhatsApp">
          {s.telefonoCobro ? formatearTelefono(s.telefonoCobro) : <span className="text-red-400">Falta: sin teléfono no se avisa ni se suspende</span>}
        </Dato>
        <Dato etiqueta="Saludo">{s.nombreCobro ? `Hola, ${s.nombreCobro}` : "El nombre del negocio"}</Dato>
        {suspendido && <Dato etiqueta="Suspendido desde">{fechaLarga(s.suspendidaPorPagoAt)}</Dato>}
      </dl>

      {panel === "pago" && (
        <div className="mt-4 rounded-lg border border-lime/30 bg-lime/5 p-4">
          <p className="text-sm text-fg">
            Registrar el pago del cobro del <strong>{fechaCorta(s.fechaProximoCobro)}</strong>. Mueve el próximo cobro un mes{suspendido ? " y el bot vuelve a responder" : ""}.
          </p>
          <label className="mt-3 block">
            <span className={ETIQUETA}>Monto recibido (COP)</span>
            <input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="numeric" className={CAMPO} />
          </label>
          <label className="mt-3 block">
            <span className={ETIQUETA}>Nota (opcional)</span>
            <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Ej. transferencia Bancolombia" className={CAMPO} />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={confirmarPago} disabled={guardando || !(Number(monto) > 0)} className="rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
              {guardando ? "Registrando…" : "Confirmar pago"}
            </button>
            <button onClick={() => setPanel("ninguno")} disabled={guardando} className="rounded-lg px-4 py-2 text-xs font-medium text-mist hover:bg-ink disabled:opacity-50">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {panel === "editar" && (
        <div className="mt-4 rounded-lg border border-edge bg-ink/40 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className={ETIQUETA}>WhatsApp de quien paga</span>
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" placeholder="573001234567" className={CAMPO} />
              <span className="mt-1 block text-[11px] text-mist">No pongas el número del bot del cliente: ahí lo leería su propio bot.</span>
            </label>
            <label className="block">
              <span className={ETIQUETA}>Nombre en el saludo</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} placeholder="Ej. AMORE" className={CAMPO} />
            </label>
            <label className="block">
              <span className={ETIQUETA}>Día de cobro (1-31)</span>
              <input value={dia} onChange={(e) => setDia(e.target.value)} inputMode="numeric" placeholder="Ej. 30" className={CAMPO} />
            </label>
            <label className="block">
              <span className={ETIQUETA}>Próxima fecha de cobro</span>
              <input value={fecha} onChange={(e) => setFecha(e.target.value)} type="date" className={CAMPO} />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={guardarCambios} disabled={guardando} className="rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button onClick={() => setPanel("ninguno")} disabled={guardando} className="rounded-lg px-4 py-2 text-xs font-medium text-mist hover:bg-ink disabled:opacity-50">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {panel === "ninguno" && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Boton onClick={abrirPago}>Registrar pago</Boton>
          <Boton onClick={abrirEditar}>Editar datos de cobro</Boton>
          {suspendido && (
            <Boton
              variante="peligro"
              onClick={() => confirm("¿Levantar la suspensión SIN registrar un pago? El bot vuelve a responder y este ciclo no se vuelve a avisar.") && void enviar({ accion: "levantar_suspension" }, () => "Suspensión levantada: el bot vuelve a responder.")}
            >
              Levantar suspensión
            </Boton>
          )}
        </div>
      )}

      {datos.ciclos.length > 0 && (
        <div className="mt-5">
          <p className={ETIQUETA}>Últimos ciclos</p>
          <ul className="mt-2 divide-y divide-edge text-sm">
            {datos.ciclos.map((c) => (
              <li key={c.fechaCobro} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-fg">Cobro del {fechaCorta(c.fechaCobro)}</span>
                <span className="flex items-center gap-2 text-xs text-mist">
                  {c.estado === "pagado" && (
                    <span>
                      {dinero(c.montoCop)}
                      {c.registradoPor ? ` · ${c.registradoPor}` : ""}
                      {c.nota ? ` · ${c.nota}` : ""}
                    </span>
                  )}
                  {c.estado === "enviado" && c.recordatorioEnviadoAt && <span>{fechaLarga(c.recordatorioEnviadoAt)}</span>}
                  {c.estado === "fallido" && <span className="text-red-400">{c.ultimoError ?? "Error"} ({c.intentos} intento{c.intentos === 1 ? "" : "s"})</span>}
                  <Pill tone={ETIQUETA_CICLO[c.estado].tono}>{ETIQUETA_CICLO[c.estado].texto}</Pill>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Seccion>
  );
}
