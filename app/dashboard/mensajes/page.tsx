"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";

type Conversacion = {
  phone_number_id: string;
  telefono_cliente: string;
  nombre_negocio: string;
  ultimo_mensaje: string;
  ultima_direccion: "entrante" | "saliente";
  ultima_fecha: string;
  pausado: boolean;
};

type MensajeHilo = {
  direccion: "entrante" | "saliente";
  contenido: string;
  created_at: string;
};

function horaCorta(fecha: string): string {
  return new Date(fecha).toLocaleString("es-CO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function IconoChat() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      className="h-12 w-12 text-mist/40"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 10h.01M12 10h.01M16 10h.01M21 12a9 9 0 11-9-9 9 9 0 019 9z"
      />
    </svg>
  );
}

export default function MensajesPage() {
  const { session, negocios } = useDashboard();
  const [conversaciones, setConversaciones] = useState<Conversacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [seleccionada, setSeleccionada] = useState<Conversacion | null>(null);
  const [hilo, setHilo] = useState<MensajeHilo[] | null>(null);

  const cargarConversaciones = useCallback(() => {
    if (!session) return;
    fetch("/api/dashboard/conversaciones", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setConversaciones(data.conversaciones ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session]);

  useEffect(() => {
    cargarConversaciones();
  }, [cargarConversaciones]);

  useEffect(() => {
    if (!session || !seleccionada) return;
    const params = new URLSearchParams({
      telefono_cliente: seleccionada.telefono_cliente,
      phone_number_id: seleccionada.phone_number_id,
    });
    fetch(`/api/dashboard/mensajes?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((data) => setHilo(data.mensajes ?? []))
      .catch(() => setHilo([]));
  }, [session, seleccionada]);

  const conversacionesFiltradas =
    conversaciones?.filter((c) =>
      formatearTelefono(c.telefono_cliente).includes(busqueda) ||
      c.telefono_cliente.includes(busqueda) ||
      c.nombre_negocio.toLowerCase().includes(busqueda.toLowerCase())
    ) ?? [];

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] w-full max-w-6xl gap-5">
      {/* --- Columna 1: lista de conversaciones --- */}
      <div className="flex w-72 shrink-0 flex-col rounded-2xl border border-edge/60 bg-card">
        <div className="border-b border-edge/60 p-4">
          <h1 className="text-sm font-semibold text-white">Mensajes</h1>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar…"
            className="mt-3 w-full rounded-lg border border-edge bg-ink-2 px-3 py-2 text-xs text-white outline-none focus:border-lime/50"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {error && <p className="p-4 text-xs text-red-300">{error}</p>}
          {!error && conversaciones === null && (
            <p className="p-4 text-xs text-mist">Cargando…</p>
          )}
          {conversaciones !== null && conversacionesFiltradas.length === 0 && (
            <p className="p-4 text-xs leading-relaxed text-mist">
              Todavía no tienes chats.
            </p>
          )}
          {conversacionesFiltradas.map((c) => (
            <button
              key={`${c.phone_number_id}:${c.telefono_cliente}`}
              onClick={() => {
                setSeleccionada(c);
                setHilo(null);
              }}
              className={`flex w-full flex-col gap-1 border-b border-edge/40 px-4 py-3 text-left transition-colors duration-150 ${
                seleccionada?.telefono_cliente === c.telefono_cliente &&
                seleccionada?.phone_number_id === c.phone_number_id
                  ? "bg-lime/10"
                  : "hover:bg-ink-2"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white">
                  {formatearTelefono(c.telefono_cliente)}
                </span>
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    c.pausado ? "bg-mist/60" : "bg-lime"
                  }`}
                  title={c.pausado ? "Pausado (humano interviniendo)" : "IA activa"}
                />
              </div>
              <p className="truncate text-xs text-mist">{c.ultimo_mensaje}</p>
              <span className="text-[10px] text-mist/60">{horaCorta(c.ultima_fecha)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* --- Columna 2: hilo de la conversación --- */}
      <div className="flex min-w-0 flex-1 flex-col rounded-2xl border border-edge/60 bg-card">
        {!seleccionada ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <IconoChat />
            {conversaciones !== null && conversaciones.length === 0 ? (
              (negocios?.length ?? 0) === 0 ? (
                <>
                  <p className="text-sm font-semibold text-white">Conecta tu número de WhatsApp</p>
                  <p className="max-w-xs text-xs leading-relaxed text-mist">
                    Necesitas un número conectado para empezar a recibir y responder mensajes aquí.
                  </p>
                  <Link
                    href="/dashboard/conexion"
                    className="mt-2 rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-ink transition-colors duration-200 hover:bg-lime-hover"
                  >
                    Conectar número →
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-white">Todavía no hablaste con nadie</p>
                  <p className="max-w-xs text-xs leading-relaxed text-mist">
                    Los chats van a aparecer aquí en cuanto tus clientes te escriban por WhatsApp.
                  </p>
                </>
              )
            ) : (
              <p className="text-sm text-mist">Selecciona una conversación para ver el historial.</p>
            )}
          </div>
        ) : (
          <>
            <div className="border-b border-edge/60 p-4">
              <p className="text-sm font-semibold text-white">
                {formatearTelefono(seleccionada.telefono_cliente)}
              </p>
              <p className="text-xs text-mist">{seleccionada.nombre_negocio}</p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {hilo === null && <p className="text-xs text-mist">Cargando…</p>}
              {hilo?.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.direccion === "saliente" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.direccion === "saliente"
                        ? "bg-lime/15 text-white"
                        : "bg-ink-2 text-white/90"
                    }`}
                  >
                    <p>{m.contenido}</p>
                    <p className="mt-1 text-[10px] text-mist/60">{horaCorta(m.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* --- Columna 3: datos del cliente --- */}
      <div className="flex w-64 shrink-0 flex-col rounded-2xl border border-edge/60 bg-card p-5">
        {!seleccionada ? (
          <p className="text-xs text-mist">Sin conversación seleccionada.</p>
        ) : (
          <>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-mist">
              Cliente
            </h2>
            <dl className="mt-4 flex flex-col gap-4">
              <div>
                <dt className="text-[11px] text-mist">Teléfono</dt>
                <dd className="mt-1 text-sm font-medium text-white">
                  {formatearTelefono(seleccionada.telefono_cliente)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-mist">Negocio</dt>
                <dd className="mt-1 text-sm font-medium text-white">
                  {seleccionada.nombre_negocio}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-mist">Estado</dt>
                <dd className="mt-1.5">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                      seleccionada.pausado
                        ? "bg-white/10 text-white"
                        : "bg-lime/10 text-lime"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        seleccionada.pausado ? "bg-mist/60" : "bg-lime"
                      }`}
                    />
                    {seleccionada.pausado ? "Humano interviniendo" : "IA activa"}
                  </span>
                </dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </div>
  );
}
