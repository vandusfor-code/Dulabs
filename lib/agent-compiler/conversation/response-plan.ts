// DuLabs Business — Business Agent 2.0, FASE 3 — plan de respuesta (sin lenguaje final).
//
// Traduce el siguiente paso a la INTENCIÓN de la respuesta y a los datos (ya validados) que puede usar quien redacte:
//   NEXT STEP → RESPONSE PLAN → (después) plantillas / LLM de redacción → MENSAJE
// Aquí no hay prompt ni texto: solo estructura. Los datos del resumen salen del estado (valores normalizados), nunca del
// modelo. Un plan NO_RESPONSE significa que el agente no debe escribir (una persona tiene la conversación).

import { isSlotUsable, type ConversationState, type GoalKind } from "@/lib/agent-compiler/conversation/model";
import type { AgentRequirements } from "@/lib/agent-compiler/conversation/requirements";
import type { NextStep } from "@/lib/agent-compiler/conversation/next-step";
import { slotDisplayValue } from "@/lib/agent-compiler/understanding/validate";

export const RESPONSE_INTENTS = [
  "ASK_FOR_SLOT",
  "CLARIFY_SLOT",
  "ASK_FOR_CHANGE",
  "CONFIRM_ACTION",
  "AWAIT_ACTION_RESULT",
  "ACTION_IN_PROGRESS",
  "HANDOFF_MESSAGE",
  "HANDOFF_UNAVAILABLE",
  "COMPLETION",
  "CANCELLATION_ACK",
  "CLARIFY_INTENT",
  "UNSUPPORTED",
  "ERROR_FALLBACK",
  "CONVERSATIONAL",
  "NO_RESPONSE",
] as const;
export type ResponseIntent = (typeof RESPONSE_INTENTS)[number];

export interface ResponsePlan {
  intent: ResponseIntent;
  slot?: string;
  reason?: "missing" | "ambiguous" | "invalid";
  candidates?: string[];
  /** Veces que ya se preguntó por este dato (para variar la pregunta u ofrecer una persona). */
  attempt?: number;
  action?: string;
  goal?: GoalKind | null;
  /** Datos vigentes para resumir/confirmar (valores normalizados del estado). */
  summary?: Record<string, string>;
  /** Intención conversacional del cliente (saludo, despedida, queja...) cuando no hay objetivo. */
  conversationalIntent?: string | null;
  offerHandoff?: boolean;
}

/** Después de este número de preguntas por el mismo dato sin éxito, el plan ofrece una persona (si existe). */
export const MAX_ATTEMPTS_BEFORE_OFFERING_HANDOFF = 3;

function summary(state: ConversationState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, slot] of Object.entries(state.slots)) if (isSlotUsable(slot)) out[name] = slotDisplayValue(slot.value);
  return out;
}

export function planResponse(step: NextStep, state: ConversationState, req: AgentRequirements): ResponsePlan {
  const goal = state.goal?.kind ?? null;
  switch (step.kind) {
    case "ASK_FOR_INFORMATION":
      return {
        intent: step.reason === "missing" ? "ASK_FOR_SLOT" : "CLARIFY_SLOT",
        slot: step.slot,
        reason: step.reason,
        ...(step.candidates ? { candidates: step.candidates } : {}),
        attempt: step.attempt,
        goal,
        summary: summary(state),
        offerHandoff: req.handoff.supported && step.attempt >= MAX_ATTEMPTS_BEFORE_OFFERING_HANDOFF,
      };
    case "ASK_FOR_CHANGE":
      return { intent: "ASK_FOR_CHANGE", goal, summary: summary(state) };
    case "WAIT_FOR_CONFIRMATION":
      return { intent: "CONFIRM_ACTION", action: step.action, goal, summary: summary(state) };
    case "READY_FOR_ACTION":
      return { intent: "AWAIT_ACTION_RESULT", action: step.request.action, goal };
    case "WAIT_FOR_ACTION":
      return { intent: "ACTION_IN_PROGRESS", goal };
    case "HANDOFF":
      return { intent: step.supported ? "HANDOFF_MESSAGE" : "HANDOFF_UNAVAILABLE", goal };
    case "WAIT_FOR_HUMAN":
      return { intent: "NO_RESPONSE" };
    case "COMPLETE":
      return { intent: "COMPLETION", goal: step.goal, summary: summary(state) };
    case "CANCEL":
      return { intent: "CANCELLATION_ACK", goal: step.goal };
    case "UNSUPPORTED":
      return { intent: "UNSUPPORTED", goal: step.goal, summary: summary(state), offerHandoff: step.handoffAvailable };
    case "CLARIFY_INTENT":
      return { intent: "CLARIFY_INTENT", offerHandoff: false };
    case "RESPOND":
      return { intent: "CONVERSATIONAL", conversationalIntent: step.intent };
    case "ERROR":
      return { intent: "ERROR_FALLBACK", offerHandoff: step.handoffAvailable };
  }
}
