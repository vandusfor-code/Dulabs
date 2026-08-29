/**
 * Sanitización de payloads para observabilidad (Fase 4.0.1).
 * Reutiliza detect-embedded-secrets — no duplica patrones de valor.
 */

import {
  isSensitiveKeyName,
  looksLikeEmbeddedSecret,
} from "@/lib/flow/detect-embedded-secrets";

const REDACTED = "[REDACTED]";
const VARIABLE_PLACEHOLDER = /^\{\{[a-zA-Z0-9_.]+\}\}$/;

function isPlaceholderValue(value: unknown): boolean {
  return typeof value === "string" && VARIABLE_PLACEHOLDER.test(value.trim());
}

function sanitizeString(value: string, keyHint?: string): string {
  return looksLikeEmbeddedSecret(value, keyHint) ? REDACTED : value;
}

/**
 * Clona y redacta recursivamente objetos/arrays/strings.
 * No muta el payload original.
 */
export function sanitizePayloadForObservability(payload: unknown): unknown {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload === "string") {
    return sanitizeString(payload);
  }

  if (typeof payload === "number" || typeof payload === "boolean") {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizePayloadForObservability(item));
  }

  if (typeof payload === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (isSensitiveKeyName(key)) {
        if (isPlaceholderValue(value)) {
          out[key] = value;
        } else if (typeof value === "string" && !looksLikeEmbeddedSecret(value, key)) {
          out[key] = value;
        } else {
          out[key] = REDACTED;
        }
      } else {
        out[key] = sanitizePayloadForObservability(value);
      }
    }
    return out;
  }

  return payload;
}

/** Alias tipado para payloads de eventos (entrada object). */
export function sanitizeEventPayloadForObservability(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizePayloadForObservability(payload) as Record<string, unknown>;
}
