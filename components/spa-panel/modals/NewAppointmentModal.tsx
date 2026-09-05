"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button, Field, inputClass, Modal } from "../ui";
import { normalizarTelefono } from "../format";

/**
 * Fase 6A (sistema de reservas de Daniela) — evolución del modal existente
 * (mismo Modal/Field/Button/estructura visual, sin rediseño) para crear
 * citas sobre el modelo ESTRUCTURADO: servicio real -> profesional
 * habilitado -> horarios REALES devueltos por backend -> datos del cliente.
 * El backend (reservarCitaPorServicio, vía POST /api/agenda/[token]) es
 * quien determina duración/fin/disponibilidad -- este componente nunca
 * calcula nada de eso, solo muestra lo que la API devuelve.
 */

type Servicio = { id: string; nombre: string; duracion_min: number; precio: number | null; activo: boolean; especialistaIds: number[] };
type EspecialistaOpcion = { id: number; nombre: string; activo: boolean };

function crearIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
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

  const [nombre, setNombre] = useState(nombreClienteInicial ?? "");
  const [telefono, setTelefono] = useState(telefonoClienteInicial ?? "");
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
    const firma = JSON.stringify([servicioId, especialistaId, fecha, hora, nombre, telefono, correo]);
    if (idempotencyRef.current?.firma !== firma) {
      idempotencyRef.current = { firma, clave: crearIdempotencyKey() };
    }
    return idempotencyRef.current.clave;
  }

  const guardar = async () => {
    if (!servicioId || !especialistaId || !hora || !nombre.trim()) {
      setError("Completa servicio, profesional, horario y el nombre de la clienta.");
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
        nombreCliente: nombre.trim(),
        telefonoCliente: normalizarTelefono(telefono),
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
              <>
                <Field label="Cliente">
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="María Camila" className={inputClass} />
                </Field>
                <Field label="WhatsApp (opcional)" hint="Si lo agregas, el bot reconoce a la clienta cuando escriba por esta cita.">
                  <input
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="3001234567"
                    inputMode="tel"
                    className={inputClass}
                  />
                </Field>
                <Field label="Correo (opcional)">
                  <input
                    value={correo}
                    onChange={(e) => setCorreo(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    inputMode="email"
                    className={inputClass}
                  />
                </Field>
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
        <Button onClick={guardar} loading={guardando} disabled={!hora || !nombre.trim()} className="flex-1">
          Crear cita
        </Button>
      </div>
    </Modal>
  );
}
