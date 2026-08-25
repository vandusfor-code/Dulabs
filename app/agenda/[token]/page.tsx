"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Calendar, Check, X, Plus, Loader2, Clock, CalendarClock, Pencil } from "lucide-react";

type Cita = {
  id: number;
  nombre_cliente: string;
  telefono_cliente: string | null;
  servicio: string;
  inicio: string;
  fin: string;
  estado: "pendiente" | "confirmada" | "rechazada" | "cancelada" | "propuesta";
  origen: string;
};

type Datos = {
  negocio: string;
  especialista: { nombre: string; servicio: string; duracion_min: number };
  citas: Cita[];
};

function formatearHora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", hour12: true });
}
function formatearFechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
}
function esHoy(iso: string) {
  const d = new Date(iso);
  const hoy = new Date();
  return d.toDateString() === hoy.toDateString();
}

// El bot reconoce a una clienta por el número tal como llega de WhatsApp:
// indicativo de país + número, solo dígitos (ej. "573001234567"). Si
// Daniela escribe el celular "a la colombiana" (10 dígitos, empieza en 3),
// le agregamos el 57 -- así no depende de que ella lo escriba en el formato
// exacto para que el vínculo funcione.
function normalizarTelefono(valor: string): string | undefined {
  const digitos = valor.replace(/\D/g, "");
  if (!digitos) return undefined;
  if (digitos.length === 10 && digitos.startsWith("3")) return `57${digitos}`;
  return digitos;
}

// Agenda de una especialista, sin login: el token de la URL es la única
// autenticación. Pensada primero para celular -- una sola columna, botones
// grandes, nada que dependa de hover.
export default function AgendaEspecialistaPage() {
  const { token } = useParams<{ token: string }>();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [procesandoId, setProcesandoId] = useState<number | null>(null);
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [reagendando, setReagendando] = useState<Cita | null>(null);
  const [editando, setEditando] = useState<Cita | null>(null);

  // Recarga imperativa, para usar después de confirmar/rechazar/crear (no
  // desde el efecto de montaje -- ver más abajo).
  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/agenda/${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar tu agenda");
      setDatos(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando tu agenda");
    }
  }, [token]);

  // La carga inicial va inline (no llama a `cargar`) para que la regla de
  // hooks no confunda un fetch-al-montar con un setState síncrono en el
  // cuerpo del efecto -- mismo patrón que el resto del dashboard.
  useEffect(() => {
    if (!token) return;
    fetch(`/api/agenda/${token}`)
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error ?? "No se pudo cargar tu agenda");
        setDatos(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error cargando tu agenda"));
  }, [token]);

  const responder = useCallback(
    async (citaId: number, accion: "confirmar" | "rechazar" | "cancelar") => {
      setProcesandoId(citaId);
      try {
        const res = await fetch(`/api/agenda/${token}/citas/${citaId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "No se pudo actualizar");
        await cargar();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al actualizar la cita");
      } finally {
        setProcesandoId(null);
      }
    },
    [token, cargar]
  );

  const cancelar = useCallback(
    (c: Cita) => {
      if (window.confirm(`¿Cancelar la cita de ${c.nombre_cliente}? Se le avisará por WhatsApp.`)) {
        responder(c.id, "cancelar");
      }
    },
    [responder]
  );

  if (error && !datos) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink px-6 text-center">
        <p className="text-sm text-mist">{error}</p>
      </main>
    );
  }
  if (!datos) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink">
        <Loader2 className="size-6 animate-spin text-mist" />
      </main>
    );
  }

  const pendientes = datos.citas.filter((c) => c.estado === "pendiente");
  const confirmadas = datos.citas.filter((c) => c.estado === "confirmada");
  const propuestas = datos.citas.filter((c) => c.estado === "propuesta");

  return (
    <main className="min-h-screen bg-ink pb-28">
      <header className="sticky top-0 z-10 border-b border-edge bg-ink/95 px-5 pb-4 pt-6 backdrop-blur">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-lime-text">{datos.negocio}</p>
        <h1 className="mt-0.5 text-xl font-semibold text-fg">
          Hola, {datos.especialista.nombre} 👋
        </h1>
        <p className="mt-0.5 text-xs text-mist">{datos.especialista.servicio}</p>
      </header>

      <div className="px-5 pt-5">
        {pendientes.length > 0 && (
          <section className="mb-7">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-fg">Por confirmar</h2>
              <span className="flex size-5 items-center justify-center rounded-full bg-lime text-[11px] font-bold text-lime-fg">
                {pendientes.length}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {pendientes.map((c) => (
                <div key={c.id} className="rounded-2xl border border-lime/30 bg-lime/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-fg">{c.nombre_cliente}</p>
                      <p className="mt-0.5 text-xs text-mist">{c.servicio}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium text-fg">{esHoy(c.inicio) ? "Hoy" : formatearFechaCorta(c.inicio)}</p>
                      <p className="text-xs text-mist">{formatearHora(c.inicio)}</p>
                    </div>
                  </div>
                  <div className="mt-3.5 flex flex-col gap-2">
                    <button
                      onClick={() => responder(c.id, "confirmar")}
                      disabled={procesandoId === c.id}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-lime py-3 text-sm font-semibold text-lime-fg transition-opacity active:opacity-70 disabled:opacity-50"
                    >
                      {procesandoId === c.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      Confirmar
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setReagendando(c)}
                        disabled={procesandoId === c.id}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-edge py-2.5 text-xs font-medium text-fg transition-colors active:bg-card disabled:opacity-50"
                      >
                        <CalendarClock className="size-3.5" /> Reagendar
                      </button>
                      <button
                        onClick={() => responder(c.id, "rechazar")}
                        disabled={procesandoId === c.id}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-edge px-4 py-2.5 text-xs font-medium text-mist transition-colors active:bg-card disabled:opacity-50"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {propuestas.length > 0 && (
          <section className="mb-7">
            <h2 className="mb-3 text-sm font-semibold text-fg">Esperando respuesta de la clienta</h2>
            <div className="flex flex-col gap-2.5">
              {propuestas.map((c) => (
                <div key={c.id} className="rounded-xl border border-edge bg-card p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-fg">{c.nombre_cliente}</p>
                      <p className="mt-0.5 text-xs text-mist">{c.servicio}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium text-fg">{esHoy(c.inicio) ? "Hoy" : formatearFechaCorta(c.inicio)}</p>
                      <p className="text-xs text-mist">{formatearHora(c.inicio)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-mist">Le propusiste este horario, aún no responde.</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Tu agenda</h2>
            <button
              onClick={() => setMostrarNueva(true)}
              className="flex items-center gap-1 rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-fg active:bg-card"
            >
              <Plus className="size-3.5" /> Nueva cita
            </button>
          </div>

          {confirmadas.length === 0 ? (
            <div className="rounded-2xl border border-edge bg-card p-6 text-center">
              <Calendar className="mx-auto size-6 text-mist" />
              <p className="mt-2 text-sm text-mist">No tienes citas confirmadas próximamente.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {confirmadas.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-xl border border-edge bg-card p-3.5">
                  <div className="flex w-14 shrink-0 flex-col items-center border-r border-edge pr-3 text-center">
                    <span className="text-[10px] uppercase tracking-wide text-mist">
                      {esHoy(c.inicio) ? "Hoy" : formatearFechaCorta(c.inicio).split(" ")[0]}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-fg">
                      <Clock className="size-3 text-mist" />
                      {formatearHora(c.inicio)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{c.nombre_cliente}</p>
                    <p className="text-xs text-mist">{c.servicio}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="rounded-full bg-lime/15 px-2.5 py-1 text-[11px] font-semibold text-lime-text">
                      Confirmada
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setEditando(c)}
                        disabled={procesandoId === c.id}
                        className="flex items-center gap-1 rounded-full border border-edge px-2.5 py-1 text-[11px] font-medium text-fg active:bg-ink disabled:opacity-50"
                      >
                        <Pencil className="size-3" /> Editar
                      </button>
                      <button
                        onClick={() => cancelar(c)}
                        disabled={procesandoId === c.id}
                        className="flex items-center gap-1 rounded-full border border-edge px-2.5 py-1 text-[11px] font-medium text-mist active:bg-ink disabled:opacity-50"
                      >
                        <X className="size-3" /> Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {error && <p className="mt-4 text-center text-xs text-red-400">{error}</p>}
      </div>

      {mostrarNueva && (
        <NuevaCitaModal
          token={token}
          duracionDefecto={datos.especialista.duracion_min}
          servicioDefecto={datos.especialista.servicio}
          onClose={() => setMostrarNueva(false)}
          onCreada={() => {
            setMostrarNueva(false);
            cargar();
          }}
        />
      )}

      {reagendando && (
        <ReagendarModal
          token={token}
          cita={reagendando}
          duracionDefecto={datos.especialista.duracion_min}
          onClose={() => setReagendando(null)}
          onPropuesto={() => {
            setReagendando(null);
            cargar();
          }}
        />
      )}

      {editando && (
        <EditarModal
          token={token}
          cita={editando}
          onClose={() => setEditando(null)}
          onEditada={() => {
            setEditando(null);
            cargar();
          }}
        />
      )}
    </main>
  );
}

function NuevaCitaModal({
  token,
  duracionDefecto,
  servicioDefecto,
  onClose,
  onCreada,
}: {
  token: string;
  duracionDefecto: number;
  servicioDefecto: string;
  onClose: () => void;
  onCreada: () => void;
}) {
  // Si el link agrupa varias especialidades, "servicioDefecto" es el rótulo
  // genérico ("Todos los servicios"), no un servicio real -- en ese caso el
  // campo arranca vacío para que lo escriba, en vez de dejarlo con un valor
  // que no serviría para encontrar el recurso correcto.
  const servicioEsGenerico = servicioDefecto === "Todos los servicios";
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [servicio, setServicio] = useState(servicioEsGenerico ? "" : servicioDefecto);
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [hora, setHora] = useState("");
  const [duracion, setDuracion] = useState(String(duracionDefecto));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    if (!nombre.trim() || !hora || !servicio.trim()) {
      setError("Falta el nombre, el servicio o la hora.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const inicio = new Date(`${fecha}T${hora}:00`);
      const res = await fetch(`/api/agenda/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre_cliente: nombre.trim(),
          telefono_cliente: normalizarTelefono(telefono),
          servicio: servicio.trim(),
          inicio: inicio.toISOString(),
          duracion_min: Number(duracion) || duracionDefecto,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear la cita");
      onCreada();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creando la cita");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl border-t border-edge bg-ink p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-edge" />
        <h2 className="text-base font-semibold text-fg">Nueva cita</h2>
        <p className="mt-0.5 text-xs text-mist">Queda confirmada directamente en tu agenda.</p>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-mist">Nombre</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="María Camila"
              className="w-full rounded-xl border border-edge bg-card px-3.5 py-3 text-sm text-fg outline-none focus:border-lime/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-mist">WhatsApp (opcional)</label>
            <input
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="3001234567"
              inputMode="tel"
              className="w-full rounded-xl border border-edge bg-card px-3.5 py-3 text-sm text-fg outline-none focus:border-lime/50"
            />
            <p className="mt-1 text-[11px] text-mist">Si lo agregas, el bot reconoce a la clienta cuando te escriba por esta cita.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-mist">Servicio</label>
            <input
              value={servicio}
              onChange={(e) => setServicio(e.target.value)}
              placeholder="Ej. semipermanente en manos"
              className="w-full rounded-xl border border-edge bg-card px-3.5 py-3 text-sm text-fg outline-none focus:border-lime/50"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-mist">Fecha</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-xl border border-edge bg-card px-3.5 py-3 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-mist">Hora</label>
              <input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="w-full rounded-xl border border-edge bg-card px-3.5 py-3 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-mist">Duración (minutos)</label>
            <input
              type="number"
              min={5}
              step={5}
              value={duracion}
              onChange={(e) => setDuracion(e.target.value)}
              className="w-full rounded-xl border border-edge bg-card px-3.5 py-3 text-sm text-fg outline-none focus:border-lime/50"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={guardar}
            disabled={guardando}
            className="mt-1 flex items-center justify-center gap-1.5 rounded-xl bg-lime py-3.5 text-sm font-semibold text-lime-fg disabled:opacity-50"
          >
            {guardando && <Loader2 className="size-4 animate-spin" />}
            Guardar cita
          </button>
        </div>
      </div>
    </div>
  );
}

function ReagendarModal({
  token,
  cita,
  duracionDefecto,
  onClose,
  onPropuesto,
}: {
  token: string;
  cita: Cita;
  duracionDefecto: number;
  onClose: () => void;
  onPropuesto: () => void;
}) {
  const actual = new Date(cita.inicio);
  const [fecha, setFecha] = useState(() => actual.toISOString().slice(0, 10));
  const [hora, setHora] = useState(() => actual.toTimeString().slice(0, 5));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proponer = async () => {
    if (!hora) {
      setError("Falta la hora.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const nuevoInicio = new Date(`${fecha}T${hora}:00`);
      const res = await fetch(`/api/agenda/${token}/citas/${cita.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "reagendar", nuevo_inicio: nuevoInicio.toISOString(), duracion_min: duracionDefecto }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo proponer el horario");
      onPropuesto();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error proponiendo el horario");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl border-t border-edge bg-ink p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-edge" />
        <h2 className="text-base font-semibold text-fg">Proponer otro horario</h2>
        <p className="mt-0.5 text-xs text-mist">
          Para {cita.nombre_cliente} · {cita.servicio}. Le avisamos por WhatsApp y queda a la espera de que confirme.
        </p>

        <div className="mt-4 flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-mist">Fecha</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full rounded-xl border border-edge bg-card px-3.5 py-3 text-sm text-fg outline-none focus:border-lime/50"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-mist">Hora</label>
            <input
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              className="w-full rounded-xl border border-edge bg-card px-3.5 py-3 text-sm text-fg outline-none focus:border-lime/50"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <button
          onClick={proponer}
          disabled={guardando}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-lime py-3.5 text-sm font-semibold text-lime-fg disabled:opacity-50"
        >
          {guardando && <Loader2 className="size-4 animate-spin" />}
          Enviar propuesta
        </button>
      </div>
    </div>
  );
}

function EditarModal({
  token,
  cita,
  onClose,
  onEditada,
}: {
  token: string;
  cita: Cita;
  onClose: () => void;
  onEditada: () => void;
}) {
  const actual = new Date(cita.inicio);
  const [servicio, setServicio] = useState(cita.servicio);
  const [fecha, setFecha] = useState(() => actual.toISOString().slice(0, 10));
  const [hora, setHora] = useState(() => actual.toTimeString().slice(0, 5));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    if (!hora || !servicio.trim()) {
      setError("Falta la hora o el servicio.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const nuevoInicio = new Date(`${fecha}T${hora}:00`);
      const res = await fetch(`/api/agenda/${token}/citas/${cita.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "editar", nuevo_inicio: nuevoInicio.toISOString(), servicio: servicio.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo editar la cita");
      onEditada();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error editando la cita");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl border-t border-edge bg-ink p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-edge" />
        <h2 className="text-base font-semibold text-fg">Editar cita</h2>
        <p className="mt-0.5 text-xs text-mist">
          {cita.nombre_cliente}. Le avisamos por WhatsApp del cambio, no necesita confirmar de nuevo.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-mist">Servicio</label>
            <input
              value={servicio}
              onChange={(e) => setServicio(e.target.value)}
              className="w-full rounded-xl border border-edge bg-card px-3.5 py-3 text-sm text-fg outline-none focus:border-lime/50"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-mist">Fecha</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-xl border border-edge bg-card px-3.5 py-3 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-mist">Hora</label>
              <input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="w-full rounded-xl border border-edge bg-card px-3.5 py-3 text-sm text-fg outline-none focus:border-lime/50"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={guardar}
            disabled={guardando}
            className="mt-1 flex items-center justify-center gap-1.5 rounded-xl bg-lime py-3.5 text-sm font-semibold text-lime-fg disabled:opacity-50"
          >
            {guardando && <Loader2 className="size-4 animate-spin" />}
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  );
}
