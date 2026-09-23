"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { Button, Field, inputClass, Modal } from "../ui";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";

/**
 * Servicio PRESENCIAL -- la clienta llegó al salón sin cita y la administradora registra lo que se le hizo:
 * servicio del catálogo (o escrito a mano), valor cobrado (editable), quién lo hizo, nombre de la clienta y, si quiere,
 * su WhatsApp (y guardarla como clienta). El backend (POST /api/agenda/[token]/servicios-presenciales, ver
 * lib/servicio-presencial.ts) valida todo contra los datos reales y lo deja como una cita COMPLETADA, así el ingreso
 * aparece en Contabilidad. No toca la agenda ni el calendario, y no envía mensajes.
 */

type Servicio = { id: string; nombre: string; precio: number | null; activo: boolean; especialistaIds: number[] };
type Especialista = { id: number; nombre: string; activo: boolean };
type ClienteEncontrado = { id: number; nombre: string; telefono: string };
type Registro = { servicio: string; precio: number | null; profesional: string; nombreCliente: string; clienteGuardado: boolean };

function crearIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

/** Fecha y hora actuales del salón (Colombia, UTC-5 fijo), para los campos por defecto. */
function ahoraEnSalon(): { fecha: string; hora: string } {
  const iso = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  return { fecha: iso.slice(0, 10), hora: iso.slice(11, 16) };
}

const soloDigitos = (v: string) => v.replace(/\D/g, "");

export function ServicioPresencialModal({ token, onClose, onRegistrado }: { token: string; onClose: () => void; onRegistrado?: () => void }) {
  const [servicios, setServicios] = useState<Servicio[] | null>(null);
  const [especialistas, setEspecialistas] = useState<Especialista[]>([]);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [modoServicio, setModoServicio] = useState<"catalogo" | "manual">("catalogo");
  const [busquedaServicio, setBusquedaServicio] = useState("");
  const [servicioId, setServicioId] = useState("");
  const [servicioNombre, setServicioNombre] = useState("");
  const [valor, setValor] = useState("");
  const [especialistaId, setEspecialistaId] = useState("");

  const [nombreCliente, setNombreCliente] = useState("");
  const [telefono, setTelefono] = useState("");
  const [clienteRegistrado, setClienteRegistrado] = useState(false);
  const [guardarCliente, setGuardarCliente] = useState(true);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [resultadosCliente, setResultadosCliente] = useState<ClienteEncontrado[] | null>(null);

  const [{ fecha, hora }, setMomento] = useState(ahoraEnSalon);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registro, setRegistro] = useState<Registro | null>(null);
  const idempotencyRef = useRef<{ firma: string; clave: string } | null>(null);

  useEffect(() => {
    Promise.all([fetch(`/api/agenda/${token}/servicios`).then((r) => r.json()), fetch(`/api/agenda/${token}/especialistas`).then((r) => r.json())])
      .then(([s, e]) => {
        setServicios(((s.servicios ?? []) as Servicio[]).filter((x) => x.activo));
        setEspecialistas(((e.especialistas ?? []) as Especialista[]).filter((x) => x.activo !== false));
      })
      .catch(() => setErrorCarga("No se pudo cargar el catálogo. Revisa tu conexión e intenta de nuevo."));
  }, [token]);

  const servicio = servicios?.find((s) => s.id === servicioId) ?? null;
  const serviciosFiltrados = useMemo(() => {
    const q = busquedaServicio.trim().toLowerCase();
    const lista = servicios ?? [];
    return q ? lista.filter((s) => s.nombre.toLowerCase().includes(q)) : lista;
  }, [servicios, busquedaServicio]);

  // Primero las profesionales que hacen ese servicio (según el catálogo), después el resto: quien lo hizo en persona
  // puede no estar asignada formalmente.
  const especialistasOrdenadas = useMemo(() => {
    if (!servicio) return especialistas;
    const habilitadas = new Set(servicio.especialistaIds ?? []);
    return [...especialistas].sort((a, b) => Number(habilitadas.has(b.id)) - Number(habilitadas.has(a.id)));
  }, [especialistas, servicio]);

  function elegirServicio(s: Servicio) {
    setServicioId(s.id);
    setValor(s.precio && s.precio > 0 ? String(s.precio) : "");
    const habilitadas = s.especialistaIds ?? [];
    if (!especialistaId && habilitadas.length === 1) setEspecialistaId(String(habilitadas[0]));
  }

  async function buscarCliente() {
    const q = busquedaCliente.trim();
    if (!q) return;
    setBuscandoCliente(true);
    try {
      const res = await fetch(`/api/agenda/${token}/clientes?q=${encodeURIComponent(q)}`);
      const body = await res.json();
      setResultadosCliente(res.ok ? (body.clientes ?? []) : []);
    } catch {
      setResultadosCliente([]);
    } finally {
      setBuscandoCliente(false);
    }
  }

  function elegirCliente(c: ClienteEncontrado) {
    setNombreCliente(c.nombre);
    setTelefono(c.telefono);
    setClienteRegistrado(true);
    setResultadosCliente(null);
    setBusquedaCliente("");
  }

  const valorNumero = soloDigitos(valor) ? Number(soloDigitos(valor)) : null;
  const servicioListo = modoServicio === "catalogo" ? !!servicioId : servicioNombre.trim().length > 0;
  const puedeRegistrar = servicioListo && valorNumero !== null && !!especialistaId && nombreCliente.trim().length > 0 && !!fecha && !!hora;

  function obtenerIdempotencyKey(cuerpo: unknown): string {
    const firma = JSON.stringify(cuerpo);
    if (idempotencyRef.current?.firma !== firma) idempotencyRef.current = { firma, clave: crearIdempotencyKey() };
    return idempotencyRef.current.clave;
  }

  async function registrar() {
    if (!puedeRegistrar || enviando) return;
    const cuerpo = {
      ...(modoServicio === "catalogo" ? { servicioId } : { servicioNombre: servicioNombre.trim() }),
      precio: valorNumero,
      especialistaId: Number(especialistaId),
      nombreCliente: nombreCliente.trim(),
      telefonoCliente: telefono.trim() || undefined,
      guardarCliente: !!telefono.trim() && !clienteRegistrado && guardarCliente,
      realizadoEn: `${fecha}T${hora}:00-05:00`,
    };
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/agenda/${token}/servicios-presenciales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cuerpo, idempotencyKey: obtenerIdempotencyKey(cuerpo) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo registrar el servicio");
      setRegistro(body.registro);
      onRegistrado?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el servicio");
    } finally {
      setEnviando(false);
    }
  }

  function registrarOtro() {
    setRegistro(null);
    setServicioId("");
    setServicioNombre("");
    setBusquedaServicio("");
    setValor("");
    setNombreCliente("");
    setTelefono("");
    setClienteRegistrado(false);
    setGuardarCliente(true);
    setMomento(ahoraEnSalon());
    idempotencyRef.current = null;
  }

  if (registro) {
    return (
      <Modal onClose={onClose}>
        <div className="flex flex-col items-center py-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-success text-success-text">
            <Check className="size-6" />
          </div>
          <p className="mt-3 text-sm font-semibold text-fg">Servicio registrado</p>
          <p className="mt-1 text-sm text-fg">
            {registro.servicio}
            {registro.precio !== null ? ` · ${formatearPrecioCop(registro.precio)}` : ""}
          </p>
          <p className="text-xs text-mist">
            {registro.nombreCliente} · con {registro.profesional}
          </p>
          {registro.clienteGuardado && <p className="mt-1 text-xs text-mist">Clienta guardada con su WhatsApp.</p>}
          <p className="mt-2 text-[11px] text-mist">Ya aparece en Contabilidad como servicio completado.</p>
        </div>
        <div className="mt-4 flex gap-2.5">
          <Button variant="secondary" onClick={registrarOtro} className="flex-1">
            Registrar otro
          </Button>
          <Button onClick={onClose} className="flex-1">
            Listo
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-base font-semibold text-fg">Servicio presencial</h2>
      <p className="mt-0.5 text-xs text-mist">Para una clienta que vino sin cita. Queda como servicio completado.</p>

      <div className="mt-4 flex max-h-[65vh] flex-col gap-3.5 overflow-y-auto pr-0.5">
        {errorCarga && <p className="text-xs text-danger-text">{errorCarga}</p>}

        {/* --- Servicio --- */}
        <div className="flex rounded-xl border border-edge bg-ink p-1">
          {(["catalogo", "manual"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModoServicio(m)}
              className={`flex-1 rounded-lg py-2 text-sm font-medium ${modoServicio === m ? "bg-lime text-lime-fg" : "text-mist"}`}
            >
              {m === "catalogo" ? "Del catálogo" : "Escribirlo"}
            </button>
          ))}
        </div>

        {modoServicio === "catalogo" ? (
          servicio ? (
            <div className="flex items-center justify-between rounded-xl border border-edge bg-ink px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{servicio.nombre}</p>
                <p className="text-xs text-mist">{servicio.precio ? `Precio de lista ${formatearPrecioCop(servicio.precio)}` : "Sin precio en el catálogo"}</p>
              </div>
              <button type="button" onClick={() => setServicioId("")} className="shrink-0 text-xs font-medium text-lime-text">
                Cambiar
              </button>
            </div>
          ) : servicios === null && !errorCarga ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-mist" />
            </div>
          ) : (
            <Field label="Servicio">
              <input value={busquedaServicio} onChange={(e) => setBusquedaServicio(e.target.value)} placeholder="Buscar servicio (ej. dipping)" className={inputClass} />
              <div className="mt-1.5 flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-xl border border-edge p-1">
                {serviciosFiltrados.length === 0 ? (
                  <p className="p-2 text-xs text-mist">No hay servicios con ese nombre. Usa “Escribirlo”.</p>
                ) : (
                  serviciosFiltrados.map((s) => (
                    <button key={s.id} type="button" onClick={() => elegirServicio(s)} className="flex items-center justify-between rounded-lg p-2 text-left hover:bg-ink-2">
                      <span className="text-sm text-fg">{s.nombre}</span>
                      <span className="shrink-0 text-xs text-mist">{s.precio ? formatearPrecioCop(s.precio) : "—"}</span>
                    </button>
                  ))
                )}
              </div>
            </Field>
          )
        ) : (
          <Field label="¿Qué servicio fue?">
            <input value={servicioNombre} onChange={(e) => setServicioNombre(e.target.value)} placeholder="Ej. Diseño con piedras" maxLength={120} className={inputClass} />
          </Field>
        )}

        <Field label="Valor cobrado" hint={modoServicio === "catalogo" && servicio?.precio ? "Puedes cambiarlo si cobraste otro valor." : undefined}>
          <input
            value={valor ? formatearPrecioCop(Number(soloDigitos(valor))) : ""}
            onChange={(e) => setValor(soloDigitos(e.target.value))}
            placeholder="$0"
            inputMode="numeric"
            className={inputClass}
          />
        </Field>

        <Field label="¿Quién lo hizo?">
          <select value={especialistaId} onChange={(e) => setEspecialistaId(e.target.value)} className={inputClass}>
            <option value="">Selecciona la profesional</option>
            {especialistasOrdenadas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </Field>

        {/* --- Clienta --- */}
        <div className="flex flex-col gap-2 rounded-xl border border-edge p-3">
          <p className="text-xs font-semibold text-fg">Clienta</p>
          {clienteRegistrado ? (
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{nombreCliente}</p>
                <p className="truncate text-xs text-mist">{telefono}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setClienteRegistrado(false);
                  setNombreCliente("");
                  setTelefono("");
                }}
                className="shrink-0 text-mist"
                aria-label="Quitar clienta"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  value={busquedaCliente}
                  onChange={(e) => setBusquedaCliente(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && buscarCliente()}
                  placeholder="¿Ya es clienta? Busca por nombre o WhatsApp"
                  className={inputClass}
                />
                <Button onClick={buscarCliente} loading={buscandoCliente} size="sm" aria-label="Buscar clienta">
                  <Search className="size-4" />
                </Button>
              </div>
              {resultadosCliente && resultadosCliente.length === 0 && <p className="text-xs text-mist">No la encontramos. Escribe sus datos abajo.</p>}
              {resultadosCliente && resultadosCliente.length > 0 && (
                <div className="flex flex-col gap-0.5 rounded-xl border border-edge p-1">
                  {resultadosCliente.map((c) => (
                    <button key={c.id} type="button" onClick={() => elegirCliente(c)} className="rounded-lg p-2 text-left hover:bg-ink-2">
                      <p className="text-sm font-medium text-fg">{c.nombre}</p>
                      <p className="text-xs text-mist">{c.telefono}</p>
                    </button>
                  ))}
                </div>
              )}
              <Field label="Nombre">
                <input value={nombreCliente} onChange={(e) => setNombreCliente(e.target.value)} placeholder="Nombre de la clienta" maxLength={120} className={inputClass} />
              </Field>
              <Field label="WhatsApp (opcional)">
                <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="3001234567" inputMode="tel" className={inputClass} />
              </Field>
              {telefono.trim() && (
                <label className="flex items-center gap-2 text-xs text-fg">
                  <input type="checkbox" checked={guardarCliente} onChange={(e) => setGuardarCliente(e.target.checked)} className="size-4 accent-lime" />
                  Guardarla como clienta
                </label>
              )}
            </>
          )}
        </div>

        <div className="flex gap-3">
          <Field label="Fecha">
            <input type="date" value={fecha} onChange={(e) => setMomento((m) => ({ ...m, fecha: e.target.value }))} className={inputClass} />
          </Field>
          <Field label="Hora">
            <input type="time" value={hora} onChange={(e) => setMomento((m) => ({ ...m, hora: e.target.value }))} className={inputClass} />
          </Field>
        </div>

        {error && <p className="text-xs text-danger-text">{error}</p>}
      </div>

      <div className="mt-4 flex gap-2.5">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          Cancelar
        </Button>
        <Button onClick={registrar} loading={enviando} disabled={!puedeRegistrar} className="flex-1">
          Registrar servicio
        </Button>
      </div>
    </Modal>
  );
}
