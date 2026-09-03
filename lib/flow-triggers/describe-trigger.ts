/**
 * Fase 3 (Flow Builder, autorizado) — texto legible de un trigger, pura.
 * Un solo lugar para esta traducción -- la usan tanto el resumen del nodo
 * Inicio en el canvas como el panel de propiedades (TriggersSection).
 */

import type { TriggerConfig } from "@/lib/flow-triggers/types";

export function describeTriggerConfig(config: TriggerConfig): string {
  switch (config.type) {
    case "conversation_started":
      return "Usuario inicia chat";
    case "user_message":
      return "Cualquier mensaje";
    case "keyword":
      return `Keyword: ${config.keywords.join(", ")}`;
    case "message_contains":
      return `Contiene: ${config.keywords.join(", ")}`;
    case "message_starts_with":
      return `Empieza con: ${config.keywords.join(", ")}`;
    case "event":
      return `Evento: ${config.eventName}`;
    case "manual":
      return "Manual";
  }
}
