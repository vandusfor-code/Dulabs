"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/lib/dashboard-session";

type MensajeLog = {
  phone_number_id: string;
  telefono_cliente: string;
  direccion: "entrante" | "saliente";
  contenido: string;
  created_at: string;
  nombre_negocio: string;
};

export default function MensajesPage() {
  const { session } = useDashboard();
  const [mensajes, setMensajes] = useState<MensajeLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/mensajes", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setMensajes(data.mensajes ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">Mensajes</h1>
      <p className="mt-2 text-sm text-mist">
        Actividad reciente de tus conversaciones (últimos 100 mensajes).
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </p>
      )}

      {!error && mensajes === null && (
        <p className="mt-6 text-sm text-mist">Cargando…</p>
      )}

      {mensajes !== null && mensajes.length === 0 && (
        <p className="mt-6 rounded-xl border border-edge/60 bg-card p-5 text-sm leading-relaxed text-mist">
          Todavía no hay mensajes registrados. En cuanto un cliente escriba,
          aparecerá aquí.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {mensajes?.map((m, i) => (
          <div
            key={i}
            className="flex items-start gap-4 rounded-xl border border-edge/60 bg-card p-4"
          >
            <span
              className={`mt-1 shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                m.direccion === "entrante"
                  ? "bg-white/10 text-white"
                  : "bg-lime/10 text-lime"
              }`}
            >
              {m.direccion === "entrante" ? "Cliente" : "IA"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-mist">
                  {m.nombre_negocio} · +{m.telefono_cliente}
                </p>
                <p className="text-xs text-mist/70">
                  {new Date(m.created_at).toLocaleString("es-CO", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <p className="mt-1.5 truncate text-sm text-white/90">{m.contenido}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
