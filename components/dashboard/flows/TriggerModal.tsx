"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Field, inputClass } from "@/components/spa-panel/ui";
import { describeTriggerConfig } from "@/lib/flow-triggers/describe-trigger";
import type { FlowTrigger, TriggerConfig, TriggerType } from "@/lib/flow-triggers/types";

/**
 * Fase 3 (Flow Builder, autorizado) — la UI agrupa "keyword" /
 * "message_contains" / "message_starts_with" bajo UN solo tipo visible
 * ("Keyword") con un selector "Regla" (Exact/Contains/Starts with) que
 * decide cuál de los 3 TriggerType reales se crea -- son 3 tipos distintos
 * en el dominio/DB (lib/flow-triggers/types.ts), pero UNA sola experiencia
 * de configuración para la usuaria, tal como se pidió.
 */
type UiType = "conversation_started" | "user_message" | "keyword_group" | "event" | "manual";
type KeywordRule = Extract<TriggerType, "keyword" | "message_contains" | "message_starts_with">;

const UI_TYPE_ORDER: UiType[] = ["conversation_started", "user_message", "keyword_group", "event", "manual"];
const UI_TYPE_LABEL: Record<UiType, string> = {
  conversation_started: "Usuario inicia chat",
  user_message: "Cualquier mensaje",
  keyword_group: "Keyword",
  event: "Evento",
  manual: "Manual",
};

const RULE_ORDER: KeywordRule[] = ["keyword", "message_contains", "message_starts_with"];
const RULE_LABEL: Record<KeywordRule, string> = {
  keyword: "Exact",
  message_contains: "Contains",
  message_starts_with: "Starts with",
};

function uiTypeFor(type: TriggerType): UiType {
  if (type === "keyword" || type === "message_contains" || type === "message_starts_with") return "keyword_group";
  return type;
}

export interface TriggerModalSubmit {
  config: TriggerConfig;
  priority: number;
  enabled: boolean;
}

interface TriggerModalProps {
  open: boolean;
  /** null = crear un trigger nuevo; presente = editar (el Tipo/Regla quedan fijos, ver nota abajo). */
  trigger: FlowTrigger | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: TriggerModalSubmit) => void;
}

/**
 * Crear/editar un trigger -- reemplaza cualquier formulario improvisado.
 * Mismo patrón visual que CreateFlowModal.tsx (overlay + role="dialog",
 * Escape cierra). `type` es inmutable tras creación (mismo criterio que la
 * API, ver app/api/flows/[id]/triggers/[triggerId]/route.ts) -- cambiar de
 * tipo exige borrar y crear uno nuevo, así config nunca queda con una forma
 * inválida para un tipo que ya no es el suyo.
 */
export function TriggerModal({ open, trigger, saving, error, onClose, onSubmit }: TriggerModalProps) {
  const [uiType, setUiType] = useState<UiType>("conversation_started");
  const [rule, setRule] = useState<KeywordRule>("keyword");
  const [keywordsText, setKeywordsText] = useState("");
  const [eventName, setEventName] = useState("");
  const [priority, setPriority] = useState(0);
  const [enabled, setEnabled] = useState(true);

  // Reset/hidratación al abrir -- ajuste de estado durante el render (mismo
  // patrón que CreateFlowModal.tsx), nunca un efecto que llame setState.
  const [openAnterior, setOpenAnterior] = useState(open);
  if (open !== openAnterior) {
    setOpenAnterior(open);
    if (open) {
      if (trigger) {
        setUiType(uiTypeFor(trigger.type));
        setRule(trigger.type === "keyword" || trigger.type === "message_contains" || trigger.type === "message_starts_with" ? trigger.type : "keyword");
        setKeywordsText(
          trigger.config.type === "keyword" || trigger.config.type === "message_contains" || trigger.config.type === "message_starts_with"
            ? trigger.config.keywords.join(", ")
            : "",
        );
        setEventName(trigger.config.type === "event" ? trigger.config.eventName : "");
        setPriority(trigger.priority);
        setEnabled(trigger.enabled);
      } else {
        setUiType("conversation_started");
        setRule("keyword");
        setKeywordsText("");
        setEventName("");
        setPriority(0);
        setEnabled(true);
      }
    }
  }

  if (!open) return null;

  const esEdicion = trigger !== null;

  function buildConfig(): TriggerConfig | null {
    switch (uiType) {
      case "conversation_started":
        return { type: "conversation_started" };
      case "user_message":
        return { type: "user_message" };
      case "manual":
        return { type: "manual" };
      case "event": {
        const nombre = eventName.trim();
        return nombre ? { type: "event", eventName: nombre } : null;
      }
      case "keyword_group": {
        const keywords = keywordsText
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        return keywords.length > 0 ? { type: rule, keywords } : null;
      }
    }
  }

  const config = buildConfig();
  const resumen = config ? describeTriggerConfig(config) : null;

  function cerrar() {
    if (!saving) onClose();
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!config || saving) return;
    onSubmit({ config, priority, enabled });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cerrar();
        }
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={cerrar} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trigger-modal-title"
        className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-edge bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h2 id="trigger-modal-title" className="text-sm font-semibold text-fg">
            {esEdicion ? "Editar trigger" : "Agregar trigger"}
          </h2>
          <button
            type="button"
            onClick={cerrar}
            disabled={saving}
            className="rounded-lg p-1 text-mist hover:bg-ink-2 hover:text-fg disabled:opacity-60"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={enviar} className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
          <Field label="Tipo" hint={esEdicion ? "No se puede cambiar tras crear el trigger -- elimínalo y crea uno nuevo si necesitas otro tipo." : undefined}>
            <select className={inputClass} value={uiType} disabled={esEdicion} onChange={(e) => setUiType(e.target.value as UiType)}>
              {UI_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {UI_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>

          {uiType === "keyword_group" && (
            <>
              <Field label="Keyword(s) -- separadas por coma">
                <input
                  className={inputClass}
                  value={keywordsText}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  placeholder="hola, buenas, buenos días"
                />
              </Field>
              <Field label="Regla">
                <select className={inputClass} value={rule} onChange={(e) => setRule(e.target.value as KeywordRule)}>
                  {RULE_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {RULE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {uiType === "event" && (
            <Field label="Nombre del evento">
              <input className={inputClass} value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="campaign_reply" />
            </Field>
          )}

          <Field label="Prioridad" hint="Mayor número gana en caso de que varios triggers coincidan a la vez.">
            <input type="number" className={inputClass} value={priority} onChange={(e) => setPriority(Number(e.target.value) || 0)} />
          </Field>

          <label className="flex items-center gap-2 text-xs text-fg">
            <input type="checkbox" className="accent-lime" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Activo
          </label>

          {resumen && (
            <p className="rounded-[10px] border border-edge bg-ink px-3 py-2 text-xs text-mist">
              <span className="font-medium text-fg">Resumen: </span>
              {resumen}
            </p>
          )}

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-400">{error}</p>}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cerrar}
              disabled={saving}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-mist hover:bg-ink-2 hover:text-fg disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!config || saving}
              className="rounded-lg bg-lime px-3.5 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
