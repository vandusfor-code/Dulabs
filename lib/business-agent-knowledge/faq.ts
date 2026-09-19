/**
 * R4 — FAQ estructurada del Business Agent. Validación + normalización PURAS
 * (sin I/O). Los routes (app/api/business-agent/knowledge/faqs/*) son
 * adaptadores delgados sobre esto; el servidor es la autoridad (nunca el
 * frontend).
 */
import { KNOWLEDGE_LIMITS } from "@/lib/business-agent-knowledge/limits";

export interface BusinessAgentFaq {
  id: string;
  question: string;
  answer: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fila cruda de dulabs_ba_faqs (sin la columna generada fts). */
export interface FaqRow {
  id: string;
  id_tenant?: string;
  question: string;
  answer: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function rowToFaq(r: FaqRow): BusinessAgentFaq {
  return { id: r.id, question: r.question, answer: r.answer, active: r.active, createdAt: r.created_at, updatedAt: r.updated_at };
}

export interface NormalizedFaqInput {
  question: string;
  answer: string;
  active: boolean;
}

export type FaqValidation = { ok: true; value: NormalizedFaqInput } | { ok: false; error: string };

// Sin literales de control en el código: se construye el patrón en runtime.
const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, "g");

function limpiar(v: string): string {
  return v.replace(CONTROL, "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Valida y normaliza el body de crear/editar una FAQ. La pregunta es de una línea; la respuesta puede tener saltos. */
export function validateFaqInput(input: unknown): FaqValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "El cuerpo debe ser un objeto JSON." };
  }
  const o = input as Record<string, unknown>;
  if (typeof o.question !== "string" || typeof o.answer !== "string") {
    return { ok: false, error: "Faltan la pregunta y la respuesta (texto)." };
  }
  if (o.active !== undefined && typeof o.active !== "boolean") {
    return { ok: false, error: "'active' debe ser verdadero o falso." };
  }
  const question = limpiar(o.question).replace(/\s*\n\s*/g, " ");
  const answer = limpiar(o.answer);
  if (question.length < KNOWLEDGE_LIMITS.faqQuestionMin) {
    return { ok: false, error: `La pregunta necesita al menos ${KNOWLEDGE_LIMITS.faqQuestionMin} caracteres.` };
  }
  if (question.length > KNOWLEDGE_LIMITS.faqQuestionMax) {
    return { ok: false, error: `La pregunta supera el máximo de ${KNOWLEDGE_LIMITS.faqQuestionMax} caracteres.` };
  }
  if (!answer) return { ok: false, error: "La respuesta no puede estar vacía." };
  if (answer.length > KNOWLEDGE_LIMITS.faqAnswerMax) {
    return { ok: false, error: `La respuesta supera el máximo de ${KNOWLEDGE_LIMITS.faqAnswerMax} caracteres.` };
  }
  return { ok: true, value: { question, answer, active: o.active === undefined ? true : (o.active as boolean) } };
}
