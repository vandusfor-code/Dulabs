// DuLabs Business — Business Agent 2.0, FASE 9 — diagnóstico para soporte.
//
// Con la referencia que vio el cliente ("Ref. K7M2Q9XA") o desde el panel, soporte localiza el incidente SIN entrar a la
// base: tenant (el de la sesión), versión publicada, motor, operación (código BA-*), correlación, dependencia, hora y
// causa, más un mensaje humano que dice qué pasó y quién lo resuelve. Nunca trazas de pila, secretos ni textos del cliente.

import type { Incident } from "@/lib/agent-compiler/runtime/production/operations";
import type { BaErrorClass } from "@/lib/agent-compiler/runtime/production/error-taxonomy";

const DEPENDENCY_LABEL: Readonly<Record<string, string>> = {
  gemini: "el servicio de inteligencia artificial",
  nylas_calendar: "el calendario conectado",
  whatsapp: "WhatsApp",
  inventory: "el inventario",
};

const REASON_MESSAGE: Readonly<Record<string, string>> = {
  CIRCUIT_OPEN: "se pausaron las llamadas por fallas repetidas; se reanudan solas en unos minutos",
  CONVERSATION_WRITE_LIMIT: "la conversación superó el límite de operaciones por hora (protección contra bucles)",
  CONTACT_RATE_LIMITED: "un contacto envió demasiados mensajes seguidos (protección contra bucles o abuso)",
  TENANT_RATE_LIMITED: "el negocio recibió más mensajes por minuto de los que el agente atiende",
  TENANT_AI_RATE_LIMITED: "se alcanzó el límite de consultas a la IA por minuto; se respondió sin IA",
  LOOP_DETECTED: "el agente iba a repetir la misma respuesta; se ofreció una persona y se detuvo la repetición",
  OUTCOME_UNKNOWN: "no se pudo confirmar si la operación se hizo; se verifica antes de repetirla",
  CALENDAR_NOT_CONNECTED: "el calendario no está conectado",
};

const CLASS_MESSAGE: Readonly<Record<BaErrorClass, string>> = {
  USER: "Dato del cliente que no se pudo usar (se resolvió conversando).",
  CONFIG: "Falta o está mal una configuración del negocio.",
  AI: "El servicio de inteligencia artificial no respondió como se esperaba; el agente respondió sin IA.",
  INTEGRATION: "Un sistema externo no respondió.",
  SYSTEM: "Protección o regla interna del agente.",
  UNKNOWN: "No se pudo confirmar el resultado de una operación.",
};

const CLASS_OWNER: Readonly<Record<BaErrorClass, string>> = {
  USER: "Nadie: es parte de la conversación.",
  CONFIG: "El negocio (desde la configuración del agente).",
  AI: "DuLabs (se recupera solo; si persiste, soporte).",
  INTEGRATION: "Si persiste: el negocio revisa la conexión; si no, se recupera solo.",
  SYSTEM: "Soporte de DuLabs, si se repite.",
  UNKNOWN: "Una persona del equipo del negocio confirma con el cliente.",
};

export interface IncidentDiagnosis {
  ref: string;
  code: string;
  class: BaErrorClass;
  /** Qué pasó, en lenguaje humano. */
  message: string;
  /** Quién lo resuelve. */
  owner: string;
  agentId: string | null;
  publishedVersion: string | null;
  engine: string | null;
  dependency: string | null;
  correlationId: string;
  cause: string | null;
  occurredAt: string;
}

export function diagnoseIncident(i: Incident): IncidentDiagnosis {
  const reason = i.code.split("-").slice(2).join("-");
  const dep = i.dependency ? DEPENDENCY_LABEL[i.dependency] ?? i.dependency : null;
  const specific = REASON_MESSAGE[reason];
  const base = CLASS_MESSAGE[i.errorClass] ?? CLASS_MESSAGE.UNKNOWN;
  const message = specific ? `${base.replace(/\.$/, "")}: ${specific}${dep ? ` (${dep})` : ""}.` : `${base.replace(/\.$/, "")}${dep ? ` (${dep})` : ""}.`;
  return {
    ref: i.ref,
    code: i.code,
    class: i.errorClass,
    message,
    owner: CLASS_OWNER[i.errorClass] ?? CLASS_OWNER.UNKNOWN,
    agentId: i.agentId,
    publishedVersion: i.publishedVersion,
    engine: i.engine,
    dependency: i.dependency,
    correlationId: i.correlationId,
    cause: i.cause,
    occurredAt: i.occurredAt,
  };
}

/** La referencia se dicta: se normaliza (mayúsculas, sin espacios ni guiones) y se valida el alfabeto. */
export function normalizeSupportRef(raw: string | null | undefined): string | null {
  const v = (raw ?? "").toUpperCase().replace(/[\s-]/g, "").replace(/^REF\.?/, "");
  return /^[A-Z0-9]{6,12}$/.test(v) ? v : null;
}
