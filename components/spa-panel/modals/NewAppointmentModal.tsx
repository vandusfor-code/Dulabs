"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { Button, Field, inputClass, Modal } from "../ui";
import { normalizarTelefono } from "../format";

/**
 * Fase 6A (sistema de reservas de Daniela) — evolución del modal existente
 * (mismo Modal/Field/Button/estructura visual, sin rediseño) para crear
 * citas sobre el modelo ESTRUCTURADO: servicio real -> profesional
 * habilitado -> horarios REALES devueltos por backend -> datos del cliente.
 * El backend (POST /api/agenda/[token]) es quien determina duración/fin/
 * disponibilidad -- este componente nunca calcula nada de eso, solo muestra
 * lo que la API devuelve.
 *
 * NUEVA FASE (autorizado, items 5-8 del pedido) — el cliente ya NO se
 * escribe a mano: se busca por WhatsApp/nombre (reutiliza GET
 * /api/agenda/[token]/clientes?q=, el MISMO endpoint que ya usa la pantalla
 * de Clientes) o se crea uno nuevo (POST al mismo recurso) sin salir de este
 * modal -- nunca pide de nuevo datos que ya existen. Genérico por diseño:
 * cualquier tenant se beneficia (ya no solo AMORE), el endpoint de clientes
 * ya era tenant-genérico desde la Fase 4.
 */

type Servicio = { id: string; nombre: string; duracion_min: number; precio: number | null; activo: boolean; especialistaIds: number[] };
type EspecialistaOpcion = { id: number; nombre: string; activo: boolean };
type ClienteSeleccionado = { nombre: string; telefono: string };
type ClienteEncontrado = { id: number; nombre: string; telefono: string; cumpleDia: number | null; cumpleMes: number | null };

function crearIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

function formatearCumpleCorto(dia: number | null, mes: number | null): string | null {
  if (!dia || !mes) return null;
  return `${dia}/${mes}`;
}

export function NewAppointmentModal({
  token,
  fechaInicial,
  nombreClienteInicial,
  telefonoClienteInicial,
  onClose,
  onCrear,
}: {
  token: string;
  fechaInicial?: Date;
  /** Chats AMORE (autorizado) — precarga los datos del cliente cuando el modal se abre desde una conversación real. Opcional y aditivo: cualquier caller existente (el "+" de Daniela/AMORE) sigue arrancando con campos vacíos, exactamente como antes. */
  nombreClienteInicial?: string;
  telefonoClienteInicial?: string;
  onClose: () => void;
  onCrear: (body: {
    servicioId: string;
    especialistaId: number;
    fecha: string;
    hora: string;
    nombreCliente: string;
    telefonoCliente?: string;
    correoCliente?: string;
    idempotencyKey: string;
  }) => Promise<unknown>;
}) {
  const [servicios, setServicios] = useState<Servicio[] | null>(null);
  const [especialistas, setEspecialistas] = useState<EspecialistaOpcion[]>([]);
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true);

  const [servicioId, setServicioId] = useState("");
  const [especialistaId, setEspecialistaId] = useState<number | "">("");
  const [fecha, setFecha] = useState(() => (fechaInicial ?? new Date()).toISOString().slice(0, 10));
  const [hora, setHora] = useState("");
  const [horarios, setHorarios] = useState<string[] | null>(null);

  // --- Cliente: buscar o crear (nunca texto libre) -----------------------
  const [clienteSeleccionado, setClienteSeleccionado] = useState<ClienteSeleccionado | null>(
    nombreClienteInicial && telefonoClienteInicial ? { nombre: nombreClienteInicial, telefono: telefonoClienteInicial } : null
  );
  const [modoCliente, setModoCliente] = useState<"buscar" | "crear">("buscar");
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [resultadosBusqueda, setResultadosBusqueda] = useState<ClienteEncontrado[] | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [nuevoCumpleDia, setNuevoCumpleDia] = useState("");
  const [nuevoCumpleMes, setNuevoCumpleMes] = useState("");
  const [creandoCliente, setCreandoCliente] = useState(false);
  const [errorCliente, setErrorCliente] = useState<string | null>(null);

  const [correo, setCorreo] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [creada, setCreada] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyRef = useRef<{ firma: string; clave: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/agenda/${token}/servicios`).then((r) => r.json()),
      fetch(`/api/agenda/${token}/especialistas`).then((r) => r.json()),
    ])
      .then(([sBody, eBody]) => {
        setServicios((sBody.servicios ?? []).filter((s: Servicio) => s.activo));
        setEspecialistas(eBody.especialistas ?? []);
      })
      .catch(() => setError("No se pudo cargar el catálogo de servicios"))
      .finally(() => setCargandoCatalogo(false));
  }, [token]);

  async function buscarCliente() {
    const q = busquedaCliente.trim();
    if (!q) return;
    setBuscandoCliente(true);
    setErrorCliente(null);
    try {
      const res = await fetch(`/api/agenda/${token}/clientes?q=${encodeURIComponent(q)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo buscar el cliente");
      setResultadosBusqueda(body.clientes ?? []);
    } catch (err) {
      setErrorCliente(err instanceof Error ? err.message : "No se pudo buscar el cliente");
    } finally {
      setBuscandoCliente(false);
    }
  }

  async function crearCliente() {
    if (!nuevoNombre.trim()) {
      setErrorCliente("El nombre es obligatorio");
      return;
    }
    if (!nuevoTelefono.trim()) {
      setErrorCliente("El WhatsApp es obligatorio");
      return;
    }
    setCreandoCliente(true);
    setErrorCliente(null);
    try {
      const res = await fetch(`/api/agenda/${token}/clientes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nuevoNombre.trim(),
          telefono: nuevoTelefono.trim(),
          cumpleDia: nuevoCumpleDia.trim() ? Number(nuevoCumpleDia) : null,
          cumpleMes: nuevoCumpleMes.trim() ? Number(nuevoCumpleMes) : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "No se pudo crear el cliente");
      setClienteSeleccionado({ nombre: body.cliente.nombre, telefono: body.cliente.telefono });
    } catch (err) {
      setErrorCliente(err instanceof Error ? err.message : "Error creando el cliente");
    } finally {
      setCreandoCliente(false);
    }
  }

  const especialistasHabilitados = (servId: string): EspecialistaOpcion[] => {
    const servicio = servicios?.find((s) => s.id === servId);
    if (!servicio) return [];
    return especialistas.filter((e) => e.activo && servicio.especialistaIds.includes(e.id));
  };
  const especialistasDelServicio = useMemo(
    () => especialistasHabilitados(servicioId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [servicios, servicioId, especialistas]
  );

  // Cambiar una selección resetea TODO lo que dependía de ella -- una
  // elección de un paso anterior nunca debe sobrevivir a un cambio (Fase 6A,
  // Paso 9 del pedido). Se resuelve en los propios manejadores de evento, no
  // en un efecto reactivo, para no disparar setState sincrónico dentro de un
  // useEffect (regla react-hooks/set-state-in-effect).
  const elegirServicio = (id: string) => {
    setServicioId(id);
    const habilitados = especialistasHabilitados(id);
    setEspecialistaId(habilitados.length === 1 ? habilitados[0]!.id : "");
    setHorarios(null);
    setHora("");
  };

  const elegirEspecialista = (valor: string) => {
    setEspecialistaId(valor ? Number(valor) : "");
    setHorarios(null);
    setHora("");
  };

  const elegirFecha = (valor: string) => {
    setFecha(valor);
    setHorarios(null);
    setHora("");
  };

  useEffect(() => {
    if (!servicioId || !especialistaId || !fecha) return;
    let cancelado = false;
    const qs = new URLSearchParams({ servicioId, fecha, especialistaId: String(especialistaId) });
    fetch(`/api/agenda/${token}/disponibilidad?${qs.toString()}`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelado) setHorarios(body.especialistas?.[0]?.horarios ?? []);
      })
      .catch(() => {
        if (!cancelado) setHorarios([]);
      });
    return () => {
      cancelado = true;
    };
  }, [token, servicioId, especialistaId, fecha]);

  function obtenerIdempotencyKey(): string {
    const firma = JSON.stringify([servicioId, especialistaId, fecha, hora, clienteSeleccionado, correo]);
    if (idempotencyRef.current?.firma !== firma) {
      idempotencyRef.current = { firma, clave: crearIdempotencyKey() };
    }
    return idempotencyRef.current.clave;
  }

  const guardar = async () => {
    if (!servicioId || !especialistaId || !hora || !clienteSeleccionado) {
      setError("Completa el cliente, servicio, profesional y horario.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await onCrear({
        servicioId,
        especialistaId: Number(especialistaId),
        fecha,
        hora,
        nombreCliente: clienteSeleccionado.nombre,
        telefonoCliente: normalizarTelefono(clienteSeleccionado.telefono),
        correoCliente: correo.trim() || undefined,
        idempotencyKey: obtenerIdempotencyKey(),
      });
      setCreada(true);
      setTimeout(onClose, 1100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creando la cita");
    } finally {
      setGuardando(false);
    }
  };

  if (creada) {
    return (
      <Modal onClose={onClose}>
        <div className="flex flex-col items-center py-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-success text-success-text">
            <Check className="size-6" />
          </div>
          <p className="mt-3 text-sm font-medium text-fg">Cita creada correctamente.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-base font-semibold text-fg">Nueva cita</h2>
      <p className="mt-0.5 text-xs text-mist">Queda confirmada directamente en tu agenda.</p>

      <div className="mt-4 flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-0.5">
        {!clienteSeleccionado ? (
          <>
            <div className="flex rounded-xl border border-edge bg-ink p-1">
              {(["buscar", "crear"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModoCliente(m)}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium ${modoCliente === m ? "bg-lime text-lime-fg" : "text-mist"}`}
                >
                  {m === "buscar" ? "Buscar cliente" : "+ Crear nuevo cliente"}
                </button>
              ))}
            </div>

            {modoCliente === "buscar" ? (
              <>
                <div className="flex gap-2">
                  <input
                    value={busquedaCliente}
                    onChange={(e) => setBusquedaCliente(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && buscarCliente()}
                    placeholder="Buscar por WhatsApp o nombre"
                    className={inputClass}
                  />
                  <Button onClick={buscarCliente} loading={buscandoCliente} size="sm">
                    <Search className="size-4" />
                  </Button>
                </div>
                {resultadosBusqueda && resultadosBusqueda.length === 0 && (
                  <p className="text-xs text-mist">No encontramos ningún cliente. Puedes crear uno nuevo arriba.</p>
                )}
                {resultadosBusqueda && resultadosBusqueda.length > 0 && (
                  <div className="flex flex-col gap-1 rounded-xl border border-edge p-1.5">
                    {resultadosBusqueda.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setClienteSeleccionado({ nombre: c.nombre, telefono: c.telefono })}
                        className="rounded-lg p-2 text-left hover:bg-ink-2"
                      >
                        <p className="text-sm font-medium text-fg">{c.nombre}</p>
                        <p className="text-xs text-mist">
                          {c.telefono}
                          {formatearCumpleCorto(c.cumpleDia, c.cumpleMes) ? ` · 🎂 ${formatearCumpleCorto(c.cumpleDia, c.cumpleMes)}` : ""}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-2.5">
                <Field label="Nombre">
                  <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="María Camila" className={inputClass} />
                </Field>
                <Field label="WhatsApp" hint="Solo dígitos, con indicativo de país.">
                  <input value={nuevoTelefono} onChange={(e) => setNuevoTelefono(e.target.value)} placeholder="3001234567" inputMode="tel" className={inputClass} />
                </Field>
                <div className="flex gap-3">
                  <Field label="Día de cumpleaños (opcional)">
                    <input type="number" min={1} max={31} value={nuevoCumpleDia} onChange={(e) => setNuevoCumpleDia(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Mes (opcional)">
                    <input type="number" min={1} max={12} value={nuevoCumpleMes} onChange={(e) => setNuevoCumpleMes(e.target.value)} className={inputClass} />
                  </Field>
                </div>
                <Button onClick={crearCliente} loading={creandoCliente}>
                  Guardar cliente
                </Button>
              </div>
            )}
            {errorCliente && <p className="text-xs text-danger-text">{errorCliente}</p>}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-xl border border-edge bg-ink px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{clienteSeleccionado.nombre}</p>
                <p className="truncate text-xs text-mist">{clienteSeleccionado.telefono}</p>
              </div>
              <button type="button" onClick={() => setClienteSeleccionado(null)} className="shrink-0 text-xs font-medium text-lime-text hover:underline">
                Cambiar
              </button>
            </div>

            {cargandoCatalogo ? (
              <div className="flex justify-center py-6">
                <Loader2 className="size-5 animate-spin text-mist" />
              </div>
            ) : servicios && servicios.length === 0 ? (
              <p className="text-xs text-danger-text">
                Todavía no tienes servicios activos creados. Crea uno primero en la sección Servicios.
              </p>
            ) : (
              <>
                <Field label="Servicio">
                  <select value={servicioId} onChange={(e) => elegirServicio(e.target.value)} className={inputClass}>
                    <option value="">Selecciona un servicio</option>
                    {servicios?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre} ({s.duracion_min} min)
                      </option>
                    ))}
                  </select>
                </Field>

                {servicioId && (
                  <Field label="Profesional">
                    {especialistasDelServicio.length === 0 ? (
                      <p className="text-xs text-danger-text">Ningún profesional activo está habilitado para este servicio.</p>
                    ) : (
                      <select value={especialistaId} onChange={(e) => elegirEspecialista(e.target.value)} className={inputClass}>
                        <option value="">Selecciona un profesional</option>
                        {especialistasDelServicio.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.nombre}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}

                {especialistaId && (
                  <Field label="Fecha">
                    <input type="date" value={fecha} onChange={(e) => elegirFecha(e.target.value)} className={inputClass} />
                  </Field>
                )}

                {especialistaId && fecha && (
                  <Field label="Horario disponible">
                    {horarios === null ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="size-4 animate-spin text-mist" />
                      </div>
                    ) : horarios.length === 0 ? (
                      <p className="text-xs text-mist">No hay horarios disponibles ese día. Elige otra fecha.</p>
                    ) : (
                      <div className="grid grid-cols-4 gap-1.5">
                        {horarios.map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => setHora(h)}
                            className={`rounded-lg border px-2 py-1.5 text-center text-xs font-medium transition-colors ${
                              hora === h ? "border-lime bg-lime-soft text-lime-text" : "border-edge bg-card text-fg hover:border-lime/50"
                            }`}
                          >
                            {h}
                          </button>
                        ))}
                      </div>
                    )}
                  </Field>
                )}

                {hora && (
                  <Field label="Correo (opcional)">
                    <input
                      value={correo}
                      onChange={(e) => setCorreo(e.target.value)}
                      placeholder="correo@ejemplo.com"
                      inputMode="email"
                      className={inputClass}
                    />
                  </Field>
                )}
              </>
            )}
          </>
        )}

        {error && <p className="text-xs text-danger-text">{error}</p>}
      </div>

      <div className="mt-4 flex gap-2.5">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          Cancelar
        </Button>
        <Button onClick={guardar} loading={guardando} disabled={!hora || !clienteSeleccionado} className="flex-1">
          Crear cita
        </Button>
      </div>
    </Modal>
  );
}
