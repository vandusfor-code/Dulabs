// DuLabs Business — Business Agent 2.0, FASE 1 — contrato de errores.
//
// Taxonomía ÚNICA de errores del Business Agent (runtime, acciones, activación). Traduce las
// clasificaciones que ya existen en el Flow Engine (EFFECT_RESULT_CLASSIFICATIONS + códigos de
// error de cada executor) a 8 categorías estables, sin reemplazar esas clasificaciones: el
// orquestador sigue decidiendo reintentos con las suyas; esto es la capa que leen el runtime, la
// observabilidad y las respuestas al cliente.
//
// Regla: el detalle real del error (mensaje interno, stack, respuesta del proveedor) se registra
// internamente; hacia afuera solo viaja { category, code, message } con un mensaje seguro.

import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";

export const BUSINESS_AGENT_ERROR_CATEGORIES = [
  "USER_ERROR",
  "BUSINESS_RULE_ERROR",
  "VALIDATION_ERROR",
  "AUTHORIZATION_ERROR",
  "TENANT_ERROR",
  "EXTERNAL_SERVICE_ERROR",
  "AI_OUTPUT_ERROR",
  "INTERNAL_ERROR",
] as const;

export type BusinessAgentErrorCategory = (typeof BUSINESS_AGENT_ERROR_CATEGORIES)[number];

/** Error de negocio listo para cruzar una frontera (API, traza, metadata de efecto). Nunca lleva detalle interno. */
export interface BusinessAgentSafeError {
  category: BusinessAgentErrorCategory;
  code: string;
  message: string;
}

/** Mensajes seguros por categoría (sin datos internos). El runtime conversacional usa sus propios textos fijos. */
export const SAFE_ERROR_MESSAGES: Record<BusinessAgentErrorCategory, string> = {
  USER_ERROR: "Los datos recibidos no son válidos.",
  BUSINESS_RULE_ERROR: "La operación no cumple las reglas del negocio.",
  VALIDATION_ERROR: "La solicitud no tiene el formato esperado.",
  AUTHORIZATION_ERROR: "No tienes permiso para esta operación.",
  TENANT_ERROR: "El recurso no existe.",
  EXTERNAL_SERVICE_ERROR: "Un servicio externo no respondió correctamente. Intenta de nuevo en unos minutos.",
  AI_OUTPUT_ERROR: "No se pudo interpretar la respuesta del asistente.",
  INTERNAL_ERROR: "Ocurrió un error inesperado.",
};

export function safeError(category: BusinessAgentErrorCategory, code: string): BusinessAgentSafeError {
  return { category, code, message: SAFE_ERROR_MESSAGES[category] };
}

/** Motivos de las acciones de agenda/catálogo que son decisión del cliente (dato mal dado). */
const USER_ERROR_CODES = new Set([
  "datos_incompletos",
  "datos_invalidos",
  "fecha_invalida",
  "hora_invalida",
  "seleccion_invalida",
  "missing_appointment_params",
]);

/** Motivos que son una REGLA del negocio o del calendario (el backend dijo que no). */
const BUSINESS_RULE_CODES = new Set([
  "ocupado",
  "fecha_pasada",
  "muy_pronto",
  "muy_cerca",
  "fuera_de_horario",
  "cerrado",
  "sin_horario",
  "no_permitido",
  "mismo_horario",
  "sin_citas",
  "cita_no_encontrada",
]);

/** Motivos que dependen de un proveedor externo (calendario, WhatsApp, LLM). */
const EXTERNAL_CODES = new Set(["error_tecnico", "proveedor_no_disponible", "calendario_no_conectado", "calendario_distinto", "en_progreso"]);

/** Errores del contrato de salida de la IA (JSON, schema, evidencia fabricada, afirmaciones sin respaldo). */
const AI_OUTPUT_CODE_PREFIXES = ["empty_output", "malformed_json", "schema_", "fabricated_", "unverified_external_claim", "prohibited_argument", "ai_config_missing_for_proposal", "action_contract_"];

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => value.startsWith(p));
}

/**
 * Categoriza el fallo de un efecto del Flow Engine (resultado de un executor). `kind` distingue IA de acción:
 * un VALIDATION_ERROR de la IA es salida inválida del modelo; el de una acción es un input inválido.
 */
export function categorizeEffectFailure(input: {
  kind: "ai" | "action" | "send_message";
  classification?: string;
  error?: string;
}): BusinessAgentErrorCategory {
  const error = (input.error ?? "").toLowerCase();
  const c = input.classification;

  if (error.includes("tenant")) return "TENANT_ERROR";
  if (error === "action_contract_invalid_arguments") return "VALIDATION_ERROR";

  if (c === EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED) {
    if (input.kind === "ai" && startsWithAny(error, AI_OUTPUT_CODE_PREFIXES)) return "AI_OUTPUT_ERROR";
    return "AUTHORIZATION_ERROR";
  }
  if (c === EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR) {
    return input.kind === "ai" ? "AI_OUTPUT_ERROR" : "VALIDATION_ERROR";
  }
  if (
    c === EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT ||
    c === EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT ||
    c === EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE ||
    c === EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS ||
    c === EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR
  ) {
    return "EXTERNAL_SERVICE_ERROR";
  }
  if (USER_ERROR_CODES.has(error)) return "USER_ERROR";
  if (BUSINESS_RULE_CODES.has(error)) return "BUSINESS_RULE_ERROR";
  if (EXTERNAL_CODES.has(error)) return "EXTERNAL_SERVICE_ERROR";
  if (input.kind === "ai" && startsWithAny(error, AI_OUTPUT_CODE_PREFIXES)) return "AI_OUTPUT_ERROR";
  return "INTERNAL_ERROR";
}

/** Motivos de fail-closed de la frontera del runtime (atender-business-agent / agent-runtime). */
export function categorizeRuntimeFailure(reason: string | undefined): BusinessAgentErrorCategory {
  switch (reason) {
    case "tenant_mismatch":
    case "tenant_unresolved":
    case "tenant_missing":
      return "TENANT_ERROR";
    case "gate_sink_error":
      return "EXTERNAL_SERVICE_ERROR";
    default:
      return "INTERNAL_ERROR";
  }
}
