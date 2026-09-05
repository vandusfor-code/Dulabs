"use client";

import { Search, Users } from "lucide-react";
import type { ConversacionResumen } from "@/lib/chats/tipos";
import { cn } from "@/components/spa-panel/ui";
import type { TabChats } from "./useChats";

const TABS: { id: TabChats; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "no_leidos", label: "No leídos" },
  { id: "clientes", label: "Clientes" },
  { id: "archivados", label: "Archivados" },
];

export const ESTADO_CHIP: Record<string, { label: string; className: string }> = {
  requiere_atencion: { label: "Requiere atención", className: "bg-warning text-warning-text" },
  manual: { label: "Atención manual", className: "bg-lime-soft text-lime-text" },
  automatico: { label: "Automático", className: "bg-success text-success-text" },
  archivada: { label: "Archivada", className: "bg-ink-2 text-mist" },
};

function tiempoRelativo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `${horas} h`;
  const dias = Math.floor(horas / 24);
  return `${dias} d`;
}

// Chats AMORE (autorizado) — columna izquierda del mockup: pestañas reales
// (no cosméticas, cada una es un filtro server-side distinto, ver
// GET /api/agenda/[token]/chats) + búsqueda real por nombre/teléfono.
export function ConversationList({
  conversaciones,
  tab,
  onTab,
  q,
  onQ,
  seleccionId,
  onSeleccionar,
  whatsappConectado,
}: {
  conversaciones: ConversacionResumen[] | null;
  tab: TabChats;
  onTab: (t: TabChats) => void;
  q: string;
  onQ: (v: string) => void;
  seleccionId: number | null;
  onSeleccionar: (id: number) => void;
  whatsappConectado: boolean;
}) {
  return (
    <div className="flex w-80 shrink-0 flex-col border-r border-edge bg-card">
      <div className="border-b border-edge p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-fg">Chats</h2>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
              whatsappConectado ? "bg-success text-success-text" : "bg-danger text-danger-text"
            )}
          >
            <span className={cn("size-1.5 rounded-full", whatsappConectado ? "bg-success-text" : "bg-danger-text")} />
            {whatsappConectado ? "Conectado" : "Desconectado"}
          </span>
        </div>
        {!whatsappConectado && (
          <a href="/admin/amore/whatsapp" className="mt-1.5 block text-xs font-medium text-lime-text hover:underline">
            Conectar WhatsApp →
          </a>
        )}
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
          <input
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Buscar por nombre o teléfono"
            className="w-full rounded-full border border-edge bg-ink py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-lime/50"
          />
        </div>
      </div>

      <div className="flex gap-1 border-b border-edge px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t.id ? "bg-lime text-lime-fg" : "text-mist hover:bg-ink-2"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversaciones === null ? (
          <p className="p-6 text-center text-sm text-mist">Cargando…</p>
        ) : conversaciones.length === 0 ? (
          <p className="p-6 text-center text-sm text-mist">Sin conversaciones aquí todavía.</p>
        ) : (
          conversaciones.map((c) => {
            const chip = ESTADO_CHIP[c.estado];
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSeleccionar(c.id)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-edge px-4 py-3 text-left transition-colors",
                  seleccionId === c.id ? "bg-lime-soft" : "hover:bg-ink-2"
                )}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lime-soft text-sm font-semibold text-lime-text">
                  {c.nombreVisible.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-fg">{c.nombreVisible}</p>
                    <span className="shrink-0 text-[11px] text-mist">{tiempoRelativo(c.ultimaActividad)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-mist">{c.ultimoMensaje ?? "Sin mensajes"}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {chip && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", chip.className)}>{chip.label}</span>}
                    {c.clienteId && <Users className="size-3 text-lime-text" />}
                  </div>
                </div>
                {c.noLeidos > 0 && (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-lime text-[10px] font-semibold text-lime-fg">
                    {c.noLeidos > 9 ? "9+" : c.noLeidos}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
