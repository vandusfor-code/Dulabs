"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MessagesSquare, Search, Filter } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";
import { Pill } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";

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

function horaCorta(fecha: string, t: (es: string, en: string) => string): string {
  return new Date(fecha).toLocaleString(t("es-CO", "en-US"), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MensajesPage() {
  const { session, negocios } = useDashboard();
  const { t } = useI18n();
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
    conversaciones?.filter(
      (c) =>
        formatearTelefono(c.telefono_cliente).includes(busqueda) ||
        c.telefono_cliente.includes(busqueda) ||
        c.nombre_negocio.toLowerCase().includes(busqueda.toLowerCase())
    ) ?? [];

  const abiertos = conversaciones?.filter((c) => !c.pausado).length ?? 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Lista */}
      <div className="flex w-full shrink-0 flex-col border-r border-edge md:w-80 lg:w-96">
        <div className="border-b border-edge p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-fg">{t("Mensajes", "Messages")}</h1>
            <div className="flex items-center gap-2">
              <Pill tone="success">
                <span className="size-1.5 rounded-full bg-lime" /> {abiertos} {t("activos", "active")}
              </Pill>
              <button className="flex size-8 items-center justify-center rounded-lg border border-edge text-mist hover:text-fg">
                <Filter className="size-4" />
              </button>
            </div>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t("Buscar mensajes…", "Search messages…")}
              className="h-9 w-full rounded-lg border border-edge bg-card pl-9 pr-3 text-sm text-fg outline-none placeholder:text-mist focus:border-lime/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && <p className="p-4 text-xs text-red-400">{error}</p>}
          {!error && conversaciones === null && <p className="p-4 text-xs text-mist">{t("Cargando…", "Loading…")}</p>}
          {conversaciones !== null && conversacionesFiltradas.length === 0 && (
            <p className="p-4 text-xs leading-relaxed text-mist">{t("Todavía no tienes chats.", "You don't have any chats yet.")}</p>
          )}
          {conversacionesFiltradas.map((c) => (
            <button
              key={`${c.phone_number_id}:${c.telefono_cliente}`}
              onClick={() => {
                setSeleccionada(c);
                setHilo(null);
              }}
              className={`flex w-full gap-3 border-b border-edge/60 px-4 py-3.5 text-left transition-colors ${
                seleccionada?.telefono_cliente === c.telefono_cliente &&
                seleccionada?.phone_number_id === c.phone_number_id
                  ? "bg-ink"
                  : "hover:bg-ink/60"
              }`}
            >
              <div className="relative">
                <div className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-ink to-card text-xs font-semibold text-fg">
                  {c.telefono_cliente.slice(-2)}
                </div>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-ink-2 ${
                    c.pausado ? "bg-mist/50" : "bg-lime"
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-fg">
                    {formatearTelefono(c.telefono_cliente)}
                  </span>
                  <span className="shrink-0 text-[11px] text-mist">{horaCorta(c.ultima_fecha, t)}</span>
                </div>
                <p className="mt-0.5 truncate text-sm text-mist">{c.ultimo_mensaje}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-mist/70">
                  {c.nombre_negocio}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Hilo */}
      <div className="hidden min-w-0 flex-1 flex-col md:flex">
        {!seleccionada ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <MessagesSquare className="size-12 text-mist/40" strokeWidth={1.2} />
            {conversaciones !== null && conversaciones.length === 0 ? (
              (negocios?.length ?? 0) === 0 ? (
                <>
                  <p className="text-sm font-semibold text-fg">{t("Conecta tu número de WhatsApp", "Connect your WhatsApp number")}</p>
                  <p className="max-w-xs text-xs leading-relaxed text-mist">
                    {t("Necesitas un número conectado para empezar a recibir y responder mensajes aquí.", "You need a connected number to start receiving and replying to messages here.")}
                  </p>
                  <Link
                    href="/dashboard/conexion"
                    className="mt-2 rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg transition-colors duration-200 hover:bg-lime-hover"
                  >
                    {t("Conectar número →", "Connect a number →")}
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-fg">{t("Todavía no hablaste con nadie", "You haven't talked to anyone yet")}</p>
                  <p className="max-w-xs text-xs leading-relaxed text-mist">
                    {t("Los chats van a aparecer aquí en cuanto tus clientes te escriban por WhatsApp.", "Chats will show up here as soon as your customers message you on WhatsApp.")}
                  </p>
                </>
              )
            ) : (
              <p className="text-sm text-mist">{t("Selecciona una conversación para ver el historial.", "Select a conversation to see the history.")}</p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-edge px-5 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-fg">
                    {formatearTelefono(seleccionada.telefono_cliente)}
                  </span>
                  <Pill tone={seleccionada.pausado ? "neutral" : "success"}>
                    {seleccionada.pausado ? t("Pausado", "Paused") : t("IA activa", "AI active")}
                  </Pill>
                </div>
                <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                  {seleccionada.nombre_negocio}
                </p>
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto bg-ink/40 p-5">
              {hilo === null && <p className="text-xs text-mist">{t("Cargando…", "Loading…")}</p>}
              {hilo?.map((m, i) => (
                <div key={i} className={`flex ${m.direccion === "saliente" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.direccion === "saliente"
                        ? "rounded-br-sm bg-lime text-lime-fg"
                        : "rounded-bl-sm border border-edge bg-card text-fg"
                    }`}
                  >
                    <p>{m.contenido}</p>
                    <p
                      className={`mt-1 text-[10px] ${
                        m.direccion === "saliente" ? "text-lime-fg/70" : "text-mist"
                      }`}
                    >
                      {horaCorta(m.created_at, t)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Panel cliente */}
      <div className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-edge xl:flex">
        {!seleccionada ? (
          <p className="p-5 text-xs text-mist">{t("Sin conversación seleccionada.", "No conversation selected.")}</p>
        ) : (
          <>
            <div className="flex flex-col items-center border-b border-edge p-6 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-lime/30 to-card text-lg font-semibold text-fg">
                {seleccionada.telefono_cliente.slice(-2)}
              </div>
              <p className="mt-3 font-semibold text-fg">{formatearTelefono(seleccionada.telefono_cliente)}</p>
              <p className="mt-1 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                {seleccionada.nombre_negocio}
              </p>
            </div>
            <div className="p-5">
              <p className="mb-3 font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Estado", "Status")}</p>
              <div className="flex items-center gap-2.5 rounded-lg border border-edge bg-card px-3 py-2.5">
                <span className={`size-2 rounded-full ${seleccionada.pausado ? "bg-mist/50" : "bg-lime"}`} />
                <span className="text-sm text-fg">
                  {seleccionada.pausado ? t("Humano interviniendo", "Human taking over") : t("IA respondiendo", "AI replying")}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
