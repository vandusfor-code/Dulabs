/**
 * Fase 3 (Event Routing, autorizado) — decide si UN trigger coincide con UN
 * evento entrante. Pura: no sabe de prioridad, no sabe de otros triggers, no
 * sabe de tenant/enabled/flowStatus (eso lo filtra trigger-router.ts ANTES
 * de llamar acá) -- esta función responde exactamente UNA pregunta: "¿este
 * trigger, tal cual está configurado, coincide con este evento?".
 */

import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import type { IncomingEvent, RoutableTrigger } from "@/lib/flow-triggers/types";

function messageText(event: IncomingEvent): string | null {
  const text = event.message?.text;
  return typeof text === "string" && text.length > 0 ? text : null;
}

/**
 * true si el evento coincide con la configuración de este trigger. "manual"
 * NUNCA coincide con un evento entrante -- por diseño (ver TriggerType en
 * types.ts): un trigger manual solo se activa por invocación explícita
 * (fuera de alcance de esta fase), nunca por el Router automático.
 */
export function matchTrigger(trigger: RoutableTrigger, event: IncomingEvent): boolean {
  switch (trigger.config.type) {
    case "manual":
      return false;

    case "conversation_started":
      return event.eventType === "conversation_started";

    case "user_message":
      // Catch-all: cualquier mensaje entrante, sin mirar el contenido.
      return event.eventType === "message";

    case "keyword": {
      const text = messageText(event);
      if (text === null) return false;
      const normalized = normalizeText(text);
      return trigger.config.keywords.some((kw) => normalizeText(kw) === normalized);
    }

    case "message_contains": {
      const text = messageText(event);
      if (text === null) return false;
      const normalized = normalizeText(text);
      return trigger.config.keywords.some((kw) => normalized.includes(normalizeText(kw)));
    }

    case "message_starts_with": {
      const text = messageText(event);
      if (text === null) return false;
      const normalized = normalizeText(text);
      return trigger.config.keywords.some((kw) => normalized.startsWith(normalizeText(kw)));
    }

    case "event":
      return event.eventType === "custom_event" && event.metadata?.eventName === trigger.config.eventName;
  }
}
