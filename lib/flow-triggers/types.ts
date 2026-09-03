/**
 * Fase 3 (Flow Builder, autorizado) — Triggers + Event Routing.
 *
 * Modelo tipado, puro, sin I/O: IncomingEvent → Trigger → FlowSelectionResult.
 * Esta capa NUNCA ejecuta un Flow -- solo decide CUÁL Flow debería activarse
 * para un evento entrante. Eso queda preparado para un futuro Flow Engine
 * (ver FlowSelectionResult), que esta fase deliberadamente no implementa.
 *
 * Separación de responsabilidades (impuesta por diseño, no solo documentada):
 * - IncomingEvent / TriggerType / TriggerConfig / RoutableTrigger / FlowSelectionResult
 *   viven acá (dominio puro).
 * - normalize-text.ts / match-trigger.ts / trigger-router.ts son funciones
 *   puras que operan SOLO sobre estos tipos, sin tocar Supabase.
 * - lib/flow/flow-store.ts es la ÚNICA capa que sabe de SQL/Supabase, y
 *   traduce filas reales a estos mismos tipos vía buildTriggerConfig()
 *   (abajo) antes de pasarlas al router.
 */

// ---------------------------------------------------------------------------
// IncomingEvent — deliberadamente desacoplado de WhatsApp/Meta. `channel`,
// `channelAccountId` y `contactId` son strings opacos: HOY channelAccountId
// suele ser un phone_number_id de Meta y contactId un número de teléfono,
// pero el Router nunca debe asumir eso -- WhatsApp (y otros canales futuros)
// pueden migrar a identificadores que no son números telefónicos.
// ---------------------------------------------------------------------------

/**
 * "conversation_started": primer turno reconocido de una conversación nueva.
 * "message": mensaje entrante normal dentro de una conversación (en curso o
 * recién detectada) -- `message.text` presente para mensajes de texto.
 * "custom_event": cualquier señal que no es un mensaje entrante crudo (ej.
 * "campaign_reply", "opted_in") -- identificada por `metadata.eventName`.
 */
export type IncomingEventType = "conversation_started" | "message" | "custom_event";

export interface IncomingEventMessage {
  text?: string;
  /** Tipo crudo del mensaje en el canal de origen (ej. "text", "image", "button") -- informativo, el matching de texto solo usa `text`. */
  type?: string;
}

export interface IncomingEvent {
  tenantId: string;
  /** Ej. "whatsapp" -- string deliberado, nunca un union cerrado: no acoplar el Router a un proveedor fijo. */
  channel: string;
  /** Identificador de LA CUENTA/canal del tenant que recibió el evento (ej. phone_number_id). Opaco. */
  channelAccountId: string;
  /** Identificador del remitente en ese canal (ej. teléfono HOY, pero tratado como string opaco). */
  contactId: string;
  eventType: IncomingEventType;
  /** ISO 8601. */
  timestamp: string;
  message?: IncomingEventMessage;
  /** `eventType === "custom_event"` usa `metadata.eventName` para identificar el evento. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// TriggerType — los 7 tipos soportados en esta fase.
// ---------------------------------------------------------------------------

export type TriggerType =
  | "conversation_started"
  | "user_message"
  | "keyword"
  | "message_contains"
  | "message_starts_with"
  | "event"
  | "manual";

export const TRIGGER_TYPES: readonly TriggerType[] = [
  "conversation_started",
  "user_message",
  "keyword",
  "message_contains",
  "message_starts_with",
  "event",
  "manual",
];

/**
 * "keyword" | "message_contains" | "message_starts_with" comparten la MISMA
 * forma de config ({keywords}) -- lo que cambia es la REGLA de comparación,
 * determinada por `type` (nunca un campo `matchRule` redundante dentro del
 * config): keyword = coincidencia EXACTA, message_contains = CONTAINS,
 * message_starts_with = STARTS WITH. La UI del Builder agrupa las tres bajo
 * un único selector "Keyword" con un desplegable "Regla" (Exact/Contains/
 * Starts with) que elige cuál de estos 3 `type` crear -- ver TriggerModal.tsx.
 */
export interface KeywordTriggerConfig {
  keywords: string[];
}

export interface EventTriggerConfig {
  /** Nombre del evento custom a matchear contra IncomingEvent.metadata.eventName. */
  eventName: string;
}

export type TriggerConfig =
  | { type: "conversation_started" }
  | { type: "user_message" }
  | ({ type: "keyword" } & KeywordTriggerConfig)
  | ({ type: "message_contains" } & KeywordTriggerConfig)
  | ({ type: "message_starts_with" } & KeywordTriggerConfig)
  | ({ type: "event" } & EventTriggerConfig)
  | { type: "manual" };

/**
 * Reconstruye un TriggerConfig tipado a partir de (type, config crudo tal
 * cual viene de la columna JSONB). Pura -- sin esto, flow-store.ts tendría
 * que "confiar" en la forma del JSON. Devuelve `null` si el config no tiene
 * la forma esperada para ese `type` (fila corrupta/desactualizada) -- el
 * caller (flow-store.ts) debe DESCARTAR esa fila del routing en vez de
 * romper el routing completo del tenant por una fila inválida.
 */
export function buildTriggerConfig(type: string, rawConfig: unknown): TriggerConfig | null {
  const cfg = (rawConfig ?? {}) as Record<string, unknown>;
  switch (type) {
    case "conversation_started":
      return { type: "conversation_started" };
    case "user_message":
      return { type: "user_message" };
    case "manual":
      return { type: "manual" };
    case "keyword":
    case "message_contains":
    case "message_starts_with": {
      const keywords = cfg.keywords;
      if (!Array.isArray(keywords) || keywords.length === 0) return null;
      if (!keywords.every((k) => typeof k === "string" && k.trim().length > 0)) return null;
      return { type, keywords } as TriggerConfig;
    }
    case "event": {
      const eventName = cfg.eventName;
      if (typeof eventName !== "string" || eventName.trim().length === 0) return null;
      return { type: "event", eventName };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// FlowTrigger — entidad completa (autoría: lo que ve/edita el Builder).
// ---------------------------------------------------------------------------

export interface FlowTrigger {
  id: string;
  tenantId: string;
  flowId: string;
  type: TriggerType;
  enabled: boolean;
  priority: number;
  config: TriggerConfig;
  createdAt: string;
  updatedAt: string;
}

/**
 * RoutableTrigger — lo mínimo que el Router necesita para decidir, YA
 * incluyendo el estado del Flow dueño (join hecho por flow-store.ts). El
 * Router NUNCA consulta Supabase por sí mismo -- recibe esto ya armado y
 * hace su propio filtrado determinista (ver trigger-router.ts), sin confiar
 * ciegamente en que el caller ya filtró todo.
 */
export interface RoutableTrigger {
  id: string;
  tenantId: string;
  flowId: string;
  type: TriggerType;
  config: TriggerConfig;
  priority: number;
  enabled: boolean;
  flowStatus: "draft" | "published" | "archived";
}

// ---------------------------------------------------------------------------
// FlowSelectionResult — lo único que el Router devuelve. NUNCA ejecuta nada.
// ---------------------------------------------------------------------------

export type FlowSelectionResult =
  | {
      matched: true;
      flowId: string;
      triggerId: string;
      triggerType: TriggerType;
      priority: number;
      reason: "matched";
    }
  | {
      matched: false;
      reason: "no_candidates" | "no_trigger_matched";
    };
