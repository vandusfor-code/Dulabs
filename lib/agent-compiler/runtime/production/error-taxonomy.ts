// DuLabs Business — Business Agent 2.0, FASE 8 — taxonomía de errores BA-* (estable, para soporte y observabilidad).
//
// Cada error del Business Agent se clasifica en UNA clase que dice QUIÉN lo resuelve:
//
//   USER         el cliente puede corregirlo conversando (horario ocupado, dato inválido, cita inexistente)
//   CONFIG       el negocio debe cambiar su configuración (capacidad apagada, calendario sin conectar, zona no soportada)
//   AI           el proveedor de IA no entendió / no respondió / respondió fuera de contrato
//   INTEGRATION  un sistema externo falló (calendario, inventario, WhatsApp, base) — transitorio o no
//   SYSTEM       invariantes del propio sistema (alcance, estado, idempotencia, artefacto corrupto)
//   UNKNOWN      no se sabe si el efecto ocurrió (timeout de una escritura) → se VERIFICA antes de reintentar
//
// Código: `BA-<CLASE>-<MOTIVO>` (p. ej. BA-INTEGRATION-PROVIDER_ERROR). Nunca lleva datos del cliente.

import type { ActionError } from "@/lib/agent-compiler/actions/result";

export const BA_ERROR_CLASSES = ["USER", "CONFIG", "AI", "INTEGRATION", "SYSTEM", "UNKNOWN"] as const;
export type BaErrorClass = (typeof BA_ERROR_CLASSES)[number];

export interface BaError {
  code: string;
  class: BaErrorClass;
  /** Reintentar automáticamente es seguro (lecturas / fallos antes de cualquier efecto). */
  retryable: boolean;
}

const code = (cls: BaErrorClass, reason: string): string => `BA-${cls}-${reason.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 60)}`;
const make = (cls: BaErrorClass, reason: string, retryable = false): BaError => ({ code: code(cls, reason), class: cls, retryable });

const USER_REASONS = new Set([
  "SLOT_TAKEN",
  "OUTSIDE_BUSINESS_HOURS",
  "TOO_SOON",
  "BUSINESS_CLOSED",
  "DATE_IN_PAST",
  "DATE_INVALID",
  "TIME_INVALID",
  "NO_AVAILABILITY",
  "NO_AVAILABILITY_IN_RANGE",
  "DATE_TOO_FAR",
  "SERVICE_NOT_OFFERED",
  "CUSTOMER_DATA_INCOMPLETE",
  "CUSTOMER_DATA_INVALID",
  "NO_APPOINTMENTS",
  "APPOINTMENT_NOT_FOUND",
  "APPOINTMENT_SELECTION_REQUIRED",
  "SAME_SCHEDULE",
  "NOTHING_TO_QUOTE",
  "NOTHING_TO_LOOK_UP",
  "REMINDER_TIME_INVALID",
  "NO_APPOINTMENT_TO_REMIND",
  "NO_VALID_CONFIRMATION",
]);

const CONFIG_REASONS = new Set([
  "CAPABILITY_DISABLED",
  "SCHEDULING_PROVIDER_MISMATCH",
  "AGENT_CONFIGURATION_MISSING",
  "AGENT_CONFIGURATION_INVALID",
  "TIMEZONE_NOT_SUPPORTED",
  "CALENDAR_NOT_CONNECTED",
  "CALENDAR_CHANGED",
  "BUSINESS_HOURS_NOT_CONFIGURED",
  "POLICY_NOT_ALLOWED",
  "PROVIDER_NOT_CONFIGURED",
  "NATIVE_PORT_NOT_CONFIGURED",
  "PROVIDER_AUTH_ERROR",
]);

/** Resultado de una acción del Action Engine → error BA-*. */
export function classifyActionError(e: ActionError): BaError {
  if (e.ambiguous || e.reason === "OUTCOME_UNKNOWN") return make("UNKNOWN", e.reason);
  if (USER_REASONS.has(e.reason)) return make("USER", e.reason);
  if (CONFIG_REASONS.has(e.reason)) return make("CONFIG", e.reason);
  switch (e.code) {
    case "RATE_LIMITED":
    case "TIMEOUT":
    case "EXTERNAL_ERROR":
      return make("INTEGRATION", e.reason, e.retryable);
    case "CONFLICT":
      return make(e.reason === "BOOKING_IN_PROGRESS" || e.reason === "EXECUTION_IN_PROGRESS" ? "INTEGRATION" : "SYSTEM", e.reason, e.retryable);
    case "INVALID_ARGUMENTS":
    case "BUSINESS_RULE_VIOLATION":
    case "NOT_FOUND":
      return make("USER", e.reason);
    case "UNAUTHORIZED":
      return make("CONFIG", e.reason);
    default:
      return make("SYSTEM", e.reason, e.retryable);
  }
}

/** Código del entendimiento / del turno (safeError.code) → error BA-*. */
export function classifyTurnError(errorCode: string): BaError {
  if (errorCode.startsWith("understanding_")) return make("AI", errorCode.replace(/^understanding_/, ""), errorCode.includes("timeout") || errorCode.includes("unavailable"));
  if (errorCode === "catalog_unavailable") return make("INTEGRATION", errorCode, true);
  if (errorCode.startsWith("business_model_artifact_")) return make(errorCode.includes("store_unavailable") ? "INTEGRATION" : "CONFIG", errorCode.replace(/^business_model_artifact_/, "artifact_"));
  if (errorCode.startsWith("conversation_") || errorCode.includes("scope") || errorCode.includes("tenant")) return make("SYSTEM", errorCode);
  return make("UNKNOWN", errorCode || "unmapped");
}
