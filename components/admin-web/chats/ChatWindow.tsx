"use client";

import { useEffect, useRef, useState } from "react";
import {
  Phone,
  MoreVertical,
  CalendarPlus,
  History,
  BookOpen,
  CheckCheck,
  Check,
  AlertCircle,
  Mic,
  Send,
  Trash2,
  Loader2,
  MessageCircle,
  Archive,
  ArchiveRestore,
  UserCog,
  Bot,
} from "lucide-react";
import type { MensajeChat } from "@/lib/chats/tipos";
import { cn, Dropdown, DropdownItem } from "@/components/spa-panel/ui";
import { AudioPlayer } from "./AudioPlayer";
import { EmojiPicker } from "./EmojiPicker";
import { useGrabadorAudio } from "./useGrabadorAudio";
import { ESTADO_CHIP } from "./ConversationList";
import type { ConversacionDetalle } from "./useConversacion";

function formatearHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

// Chats AMORE (autorizado) — columna central: header real (nombre/teléfono/
// estado real de la conversación) + hilo de mensajes (burbujas blancas para
// la clienta, rosa/blush de marca para AMORE, ver --color-lime en
// .amore-scope) + composer real (emoji/mic/texto/enviar). Enter envía,
// Shift+Enter hace salto de línea; nunca se manda un mensaje vacío.
export function ChatWindow({
  conversacion,
  mensajes,
  enviando,
  error,
  onEnviarTexto,
  onEnviarAudio,
  onCambiarEstado,
  onEnviarCatalogo,
  onAgendarCita,
  onVerCitas,
}: {
  conversacion: ConversacionDetalle;
  mensajes: MensajeChat[] | null;
  enviando: boolean;
  error: string | null;
  onEnviarTexto: (texto: string) => Promise<void>;
  onEnviarAudio: (audioBase64: string, mimeType: string) => Promise<void>;
  onCambiarEstado: (accion: "marcar_leido" | "archivar" | "desarchivar" | "manual" | "reactivar_asistente") => Promise<void>;
  onEnviarCatalogo: () => Promise<void>;
  onAgendarCita: () => void;
  onVerCitas: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [enviandoCatalogo, setEnviandoCatalogo] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const finRef = useRef<HTMLDivElement>(null);

  const grabador = useGrabadorAudio((audioBase64, mimeType) => {
    onEnviarAudio(audioBase64, mimeType).catch(() => {});
  });

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [mensajes?.length]);

  const enviar = async () => {
    const valor = texto.trim();
    if (!valor || enviando) return;
    setTexto("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    try {
      await onEnviarTexto(valor);
    } catch {
      // el error real ya queda visible arriba del composer (prop `error`)
    }
  };

  const chip = ESTADO_CHIP[conversacion.estado];

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ink">
      <div className="flex items-center justify-between gap-3 border-b border-edge bg-card px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lime-soft text-sm font-semibold text-lime-text">
            {conversacion.nombreVisible.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">{conversacion.nombreVisible}</p>
            <p className="flex items-center gap-1 text-xs text-mist">
              <Phone className="size-3" /> {conversacion.telefono}
            </p>
          </div>
          {chip && <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium", chip.className)}>{chip.label}</span>}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onVerCitas}
            title="Ver citas"
            className="flex size-9 items-center justify-center rounded-full text-mist hover:bg-ink-2 hover:text-fg"
          >
            <History className="size-[18px]" />
          </button>
          <Dropdown
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className="flex size-9 items-center justify-center rounded-full text-mist hover:bg-ink-2 hover:text-fg"
              >
                <MoreVertical className="size-[18px]" />
              </button>
            )}
          >
            {(close) => (
              <>
                <DropdownItem
                  icon={CalendarPlus}
                  onClick={() => {
                    close();
                    onAgendarCita();
                  }}
                >
                  Agendar cita
                </DropdownItem>
                <DropdownItem
                  icon={BookOpen}
                  onClick={async () => {
                    close();
                    setEnviandoCatalogo(true);
                    try {
                      await onEnviarCatalogo();
                    } finally {
                      setEnviandoCatalogo(false);
                    }
                  }}
                >
                  {enviandoCatalogo ? "Enviando catálogo…" : "Enviar catálogo"}
                </DropdownItem>
                <DropdownItem
                  icon={Check}
                  onClick={() => {
                    close();
                    onCambiarEstado("marcar_leido");
                  }}
                >
                  Marcar como leído
                </DropdownItem>
                {conversacion.estado === "manual" ? (
                  <DropdownItem
                    icon={Bot}
                    onClick={() => {
                      close();
                      onCambiarEstado("reactivar_asistente");
                    }}
                  >
                    Reactivar asistente
                  </DropdownItem>
                ) : (
                  <DropdownItem
                    icon={UserCog}
                    onClick={() => {
                      close();
                      onCambiarEstado("manual");
                    }}
                  >
                    Atención manual
                  </DropdownItem>
                )}
                {conversacion.estado === "archivada" ? (
                  <DropdownItem
                    icon={ArchiveRestore}
                    onClick={() => {
                      close();
                      onCambiarEstado("desarchivar");
                    }}
                  >
                    Desarchivar
                  </DropdownItem>
                ) : (
                  <DropdownItem
                    icon={Archive}
                    onClick={() => {
                      close();
                      onCambiarEstado("archivar");
                    }}
                  >
                    Archivar
                  </DropdownItem>
                )}
              </>
            )}
          </Dropdown>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5" style={{ backgroundImage: "radial-gradient(var(--color-edge) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
        {mensajes === null ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-mist" />
          </div>
        ) : mensajes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageCircle className="size-8 text-mist" />
            <p className="text-sm text-mist">Todavía no hay mensajes en esta conversación.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {mensajes.map((m) => {
              const saliente = m.direccion === "saliente";
              return (
                <div key={m.id} className={cn("flex", saliente ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[70%] rounded-2xl px-3.5 py-2.5 shadow-sm",
                      saliente ? "bg-lime text-lime-fg" : "border border-edge bg-card text-fg"
                    )}
                  >
                    {m.tipo === "audio" && m.mediaUrl ? (
                      <AudioPlayer src={m.mediaUrl} duracionSeg={m.duracionSeg} variante={saliente ? "saliente" : "entrante"} />
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-sm">{m.texto}</p>
                    )}
                    <div className={cn("mt-1 flex items-center justify-end gap-1", saliente ? "text-white/70" : "text-mist")}>
                      <span className="text-[10px]">{formatearHora(m.enviadoEn)}</span>
                      {saliente &&
                        (m.estado === "error" ? (
                          <AlertCircle className="size-3 text-danger" />
                        ) : m.estado === "leido" || m.estado === "entregado" ? (
                          <CheckCheck className="size-3" />
                        ) : (
                          <Check className="size-3" />
                        ))}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={finRef} />
          </div>
        )}
      </div>

      {error && <p className="border-t border-edge bg-danger px-5 py-2 text-xs text-danger-text">{error}</p>}
      {grabador.error && <p className="border-t border-edge bg-danger px-5 py-2 text-xs text-danger-text">{grabador.error}</p>}

      <div className="border-t border-edge bg-card p-3">
        {grabador.grabando ? (
          <div className="flex items-center gap-3 rounded-2xl bg-ink-2 px-4 py-2.5">
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger-text" />
            <p className="flex-1 text-sm text-fg">
              Grabando… {Math.floor(grabador.segundos / 60)}:{(grabador.segundos % 60).toString().padStart(2, "0")}
            </p>
            <button type="button" onClick={grabador.cancelar} className="flex size-9 items-center justify-center rounded-full text-mist hover:bg-ink">
              <Trash2 className="size-[18px]" />
            </button>
            <button
              type="button"
              onClick={grabador.detener}
              className="flex size-9 items-center justify-center rounded-full bg-lime text-lime-fg hover:bg-lime-hover"
            >
              <Send className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <EmojiPicker onSeleccionar={(e) => setTexto((t) => t + e)} />
            <textarea
              ref={textareaRef}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              rows={1}
              placeholder="Escribe un mensaje…"
              className="max-h-[120px] flex-1 resize-none rounded-2xl border border-edge bg-ink px-3.5 py-2.5 text-sm text-fg outline-none focus:border-lime/50"
            />
            {texto.trim() ? (
              <button
                type="button"
                onClick={enviar}
                disabled={enviando}
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime text-lime-fg transition-colors hover:bg-lime-hover disabled:opacity-50"
              >
                {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            ) : (
              <button
                type="button"
                onClick={grabador.iniciar}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-mist hover:bg-ink-2 hover:text-fg"
              >
                <Mic className="size-[18px]" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
