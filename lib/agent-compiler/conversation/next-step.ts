// DuLabs Business — Business Agent 2.0, FASE 3 — evaluación del objetivo y siguiente paso (deterministas, puros).
//
// evaluateGoal: dado el estado (ya con los slots del turno aplicados) y los requisitos del negocio, decide el estado
//   resultante: qué falta, si hay que proponer y esperar confirmación, o si se puede emitir una solicitud de acción.
// determineNextStep: traduce el estado a UN siguiente paso. No produce lenguaje: eso es el response planner.

import { isSlotUsable, type ActionRequest, type ConversationState, type ConversationStatus, type GoalKind } from "@/lib/agent-compiler/conversation/model";
import type { AgentRequirements, GoalRequirement, RequiredSlot } from "@/lib/agent-compiler/conversation/requirements";
import { buildActionRequest, sha } from "@/lib/agent-compiler/conversation/actions";
import type { UnderstandingIntent } from "@/lib/agent-compiler/understanding/taxonomy";

/** `detail` = motivo del backend (p. ej. "service_not_offered", "service_suggestion") para que la respuesta lo explique. */
export type SlotProblem = { slot: string; reason: "missing" | "ambiguous" | "invalid"; candidates?: string[]; detail?: string };

/** Primer requisito sin valor usable, en el orden que definió la configuración. */
export function firstSlotProblem(state: ConversationState, required: readonly RequiredSlot[]): SlotProblem | null {
  for (const r of required) {
    if (r.anyOf.some((s) => isSlotUsable(state.slots[s]))) continue;
    for (const name of r.anyOf) {
      const s = state.slots[name];
      // FASE 7: los motivos del catálogo (servicio inexistente / sugerencia / varios) viajan para explicarlos.
      const detail = s?.reason?.startsWith("service_") || s?.reason === "selection_required" ? { detail: s.reason } : {};
      if (s?.status === "AMBIGUOUS") return { slot: name, reason: "ambiguous", ...(s.candidates ? { candidates: s.candidates } : {}), ...detail };
      if (s?.status === "INVALID") return { slot: name, reason: "invalid", ...(s.candidates && s.reason?.startsWith("service_") ? { candidates: s.candidates } : {}), ...detail };
    }
    return { slot: r.ask, reason: "missing" };
  }
  return null;
}

/**
 * Datos que el objetivo exige EN ESTE estado: los obligatorios + los condicionales que el backend puso en juego
 * (FASE 8: p. ej. "¿cuál de tus citas?" tras listar varias).
 */
export function goalSlots(g: GoalRequirement, state: ConversationState): readonly RequiredSlot[] {
  const extra = (g.conditional ?? []).filter((s) => state.slots[s] && !g.required.some((r) => r.anyOf.includes(s)));
  return extra.length === 0 ? g.required : [...g.required, ...extra.map((s) => ({ key: s, anyOf: [s], ask: s }))];
}

/** Slots obligatorios sin valor usable (MISSING derivado; nunca se guarda). */
export function missingSlots(state: ConversationState, req: AgentRequirements): string[] {
  const g = state.goal ? req.goals[state.goal.kind] : null;
  if (!g) return [];
  return g.required.filter((r) => !r.anyOf.some((s) => state.slots[s])).map((r) => r.ask);
}

export interface EvaluationContext {
  now: string;
  /** Confirmación válida recibida en este turno (id de la propuesta). */
  confirmedId: string | null;
  /** Intents del turno (para disparar una consulta pedida explícitamente, p. ej. disponibilidad). */
  turnIntents: ReadonlySet<UnderstandingIntent>;
  /** Pregunta informativa mientras hay otro objetivo en curso: se responde con una consulta y se sigue. */
  sideQuestion: "information" | "quote" | "product" | null;
}

export type EvaluationResult =
  | { status: ConversationStatus; pendingConfirmation: ConversationState["pendingConfirmation"]; pendingAction: ActionRequest | null; problem: SlotProblem | null; error?: undefined }
  | { status: "ERROR"; pendingConfirmation: null; pendingAction: null; problem: null; error: string };

function lookupRequest(state: ConversationState, req: AgentRequirements, g: GoalRequirement, problem: SlotProblem, ctx: EvaluationContext): ActionRequest | null {
  const lk = g.lookup;
  if (!lk || problem.reason !== "missing" || problem.slot !== lk.whenMissing) return null;
  if (!lk.requires.every((s) => isSlotUsable(state.slots[s]))) return null;
  const hinted = lk.hintSlots.some((s) => isSlotUsable(state.slots[s])) || lk.triggerIntents.some((i) => ctx.turnIntents.has(i));
  if (!hinted) return null;
  const built = buildActionRequest({ state, requirements: req, action: lk.action, purpose: "lookup", requiresConfirmation: false, confirmationId: null, now: ctx.now });
  if (!built.ok) return null;
  // La misma consulta con los mismos datos no se repite: se pregunta al cliente con lo que ya se ofreció.
  if (state.lastLookup && state.lastLookup.action === lk.action && state.lastLookup.argsHash === built.argsHash) return null;
  return built.request;
}

function sideRequest(state: ConversationState, req: AgentRequirements, ctx: EvaluationContext): ActionRequest | null {
  const productAction = req.goals.product.supported && isSlotUsable(state.slots.product) ? req.goals.product.action : null;
  const action =
    ctx.sideQuestion === "quote" && req.quoteAction && (isSlotUsable(state.slots.product) || isSlotUsable(state.slots.service))
      ? req.quoteAction
      : ctx.sideQuestion === "product" && productAction
        ? productAction
        : req.informationAction;
  if (!ctx.sideQuestion || !action) return null;
  const built = buildActionRequest({ state, requirements: req, action, purpose: "lookup", requiresConfirmation: false, confirmationId: null, now: ctx.now });
  if (!built.ok || (state.lastLookup?.action === action && state.lastLookup.argsHash === built.argsHash)) return null;
  return built.request;
}

const collecting = (problem: SlotProblem | null, pendingAction: ActionRequest | null = null): EvaluationResult => ({
  status: pendingAction ? "READY_FOR_ACTION" : "COLLECTING_INFORMATION",
  pendingConfirmation: null,
  pendingAction,
  problem,
});

/**
 * Decide el estado a partir del objetivo y los datos. Reglas (en orden):
 *   1. sin objetivo → NEW
 *   2. objetivo no soportado por la configuración → COLLECTING (el siguiente paso lo informa; los datos se conservan)
 *   3. pregunta informativa lateral → consulta (READY_FOR_ACTION, purpose lookup) y luego se sigue con el objetivo
 *   4. falta / es ambiguo / es inválido un dato obligatorio → COLLECTING (o consulta de disponibilidad si aplica)
 *   5. propuesta rechazada sin cambios → COLLECTING (preguntar qué cambiar; nunca re-proponer lo mismo)
 *   6. datos completos y la acción requiere confirmación → AWAITING_CONFIRMATION (o READY si se confirmó ESA propuesta)
 *   7. datos completos sin confirmación requerida → READY_FOR_ACTION
 */
export function evaluateGoal(state: ConversationState, req: AgentRequirements, ctx: EvaluationContext): EvaluationResult {
  if (!state.goal) {
    const side = sideRequest(state, req, ctx);
    return side ? { status: "READY_FOR_ACTION", pendingConfirmation: null, pendingAction: side, problem: null } : { status: "NEW", pendingConfirmation: null, pendingAction: null, problem: null };
  }
  const g = req.goals[state.goal.kind];
  if (!g.supported || !g.action) return collecting(null);

  const side = sideRequest(state, req, ctx);
  if (side) return collecting(null, side);

  const problem = firstSlotProblem(state, goalSlots(g, state));
  if (problem) return collecting(problem, lookupRequest(state, req, g, problem, ctx));
  if (state.proposalRejected) return collecting(null);

  if (!g.requiresConfirmation) {
    const built = buildActionRequest({ state, requirements: req, action: g.action, purpose: "fulfill", requiresConfirmation: false, confirmationId: null, now: ctx.now });
    if (!built.ok) return { status: "ERROR", pendingConfirmation: null, pendingAction: null, problem: null, error: built.code };
    return { status: "READY_FOR_ACTION", pendingConfirmation: null, pendingAction: built.request, problem: null };
  }

  const draft = buildActionRequest({ state, requirements: req, action: g.action, purpose: "fulfill", requiresConfirmation: true, confirmationId: null, now: ctx.now });
  if (!draft.ok) return { status: "ERROR", pendingConfirmation: null, pendingAction: null, problem: null, error: draft.code };
  const proposalId = sha(`${state.goal.id}|${draft.argsHash}`);

  // Solo se ejecuta lo que el cliente confirmó: la MISMA propuesta (mismos datos) que se le presentó.
  if (ctx.confirmedId && ctx.confirmedId === proposalId && state.pendingConfirmation?.id === proposalId) {
    const confirmed = buildActionRequest({ state, requirements: req, action: g.action, purpose: "fulfill", requiresConfirmation: true, confirmationId: proposalId, now: ctx.now });
    if (!confirmed.ok) return { status: "ERROR", pendingConfirmation: null, pendingAction: null, problem: null, error: confirmed.code };
    return { status: "READY_FOR_ACTION", pendingConfirmation: null, pendingAction: confirmed.request, problem: null };
  }
  const pendingConfirmation =
    state.pendingConfirmation?.id === proposalId
      ? state.pendingConfirmation
      : { id: proposalId, action: g.action, argsHash: draft.argsHash, requestedAt: ctx.now };
  return { status: "AWAITING_CONFIRMATION", pendingConfirmation, pendingAction: null, problem: null };
}

// ---------------------------------------------------------------------------
// Siguiente paso
// ---------------------------------------------------------------------------

export type NextStep =
  | { kind: "ASK_FOR_INFORMATION"; slot: string; reason: "missing" | "ambiguous" | "invalid"; candidates?: string[]; detail?: string; attempt: number }
  | { kind: "ASK_FOR_CHANGE" }
  | { kind: "WAIT_FOR_CONFIRMATION"; confirmationId: string; action: string }
  | { kind: "READY_FOR_ACTION"; request: ActionRequest }
  | { kind: "WAIT_FOR_ACTION"; actionId: string }
  | { kind: "HANDOFF"; supported: boolean; request: ActionRequest | null }
  | { kind: "WAIT_FOR_HUMAN" }
  | { kind: "COMPLETE"; goal: GoalKind | null }
  | { kind: "CANCEL"; goal: GoalKind | null }
  | { kind: "UNSUPPORTED"; goal: GoalKind; reason: string; handoffAvailable: boolean }
  | { kind: "CLARIFY_INTENT" }
  | { kind: "RESPOND"; intent: string | null }
  | { kind: "ERROR"; handoffAvailable: boolean };

export function determineNextStep(state: ConversationState, req: AgentRequirements): NextStep {
  switch (state.status) {
    case "PAUSED":
    case "HANDED_OFF":
      return { kind: "WAIT_FOR_HUMAN" };
    case "HANDOFF_PENDING":
      return { kind: "HANDOFF", supported: req.handoff.supported, request: state.pendingAction?.purpose === "handoff" ? state.pendingAction : null };
    case "EXECUTING":
      return { kind: "WAIT_FOR_ACTION", actionId: state.pendingAction?.id ?? "" };
    case "READY_FOR_ACTION":
      return state.pendingAction ? { kind: "READY_FOR_ACTION", request: state.pendingAction } : { kind: "ERROR", handoffAvailable: req.handoff.supported };
    case "AWAITING_CONFIRMATION":
      return state.pendingConfirmation
        ? { kind: "WAIT_FOR_CONFIRMATION", confirmationId: state.pendingConfirmation.id, action: state.pendingConfirmation.action }
        : { kind: "ERROR", handoffAvailable: req.handoff.supported };
    case "COMPLETED":
      return { kind: "COMPLETE", goal: state.goal?.kind ?? null };
    case "CANCELLED":
      return { kind: "CANCEL", goal: state.goal?.kind ?? null };
    case "ERROR":
      return { kind: "ERROR", handoffAvailable: req.handoff.supported };
    case "NEW":
      if (state.handoff.status === "requested" && !req.handoff.supported) return { kind: "HANDOFF", supported: false, request: null };
      return state.currentIntent?.intent === "UNKNOWN" ? { kind: "CLARIFY_INTENT" } : { kind: "RESPOND", intent: state.currentIntent?.intent ?? null };
    case "COLLECTING_INFORMATION": {
      if (state.handoff.status === "requested" && !req.handoff.supported) return { kind: "HANDOFF", supported: false, request: null };
      const g = state.goal ? req.goals[state.goal.kind] : null;
      if (!g) return { kind: "RESPOND", intent: state.currentIntent?.intent ?? null };
      if (!g.supported) return { kind: "UNSUPPORTED", goal: g.goal, reason: g.unsupportedReason ?? "no_runtime_action", handoffAvailable: req.handoff.supported };
      const problem = firstSlotProblem(state, goalSlots(g, state));
      if (problem) {
        const attempt = state.lastQuestion?.slot === problem.slot ? state.lastQuestion.count : 1;
        return { kind: "ASK_FOR_INFORMATION", slot: problem.slot, reason: problem.reason, ...(problem.candidates ? { candidates: problem.candidates } : {}), ...(problem.detail ? { detail: problem.detail } : {}), attempt };
      }
      if (state.proposalRejected) return { kind: "ASK_FOR_CHANGE" };
      if (state.currentIntent?.intent === "UNKNOWN") return { kind: "CLARIFY_INTENT" };
      return { kind: "ERROR", handoffAvailable: req.handoff.supported };
    }
  }
}
