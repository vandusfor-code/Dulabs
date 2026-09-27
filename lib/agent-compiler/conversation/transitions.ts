// DuLabs Business — Business Agent 2.0, FASE 3 — eventos, tabla de transiciones y reducer (puro, determinista).
//
//   estado + evento validado → (reducer) → estado nuevo + transición registrada
//
// El LLM no puede producir una transición: solo aporta un StructuredUnderstanding YA validado (FASE 2) dentro del evento
// MESSAGE_UNDERSTOOD. Los eventos del sistema (acciones, pausa humana, reanudación, inactividad) solo los emite el
// backend por la API tipada del servicio; un evento del sistema que no está permitido desde el estado actual se RECHAZA
// (INVALID_TRANSITION) sin tocar el estado.

import { createHash } from "node:crypto";
import {
  GOAL_TERMINAL_STATUSES,
  HUMAN_CONTROLLED_STATUSES,
  MAX_RECENT_EVENT_IDS,
  isSlotUsable,
  type ConversationState,
  type ConversationStatus,
  type GoalKind,
  type SlotRecord,
} from "@/lib/agent-compiler/conversation/model";
import { goalForIntent, TRANSACTIONAL_GOALS, type AgentRequirements } from "@/lib/agent-compiler/conversation/requirements";
import { buildActionRequest } from "@/lib/agent-compiler/conversation/actions";
import { evaluateGoal, type EvaluationContext } from "@/lib/agent-compiler/conversation/next-step";
import type { StructuredUnderstanding, UnderstoodSlot } from "@/lib/agent-compiler/understanding/contract";
import type { UnderstandingIntent } from "@/lib/agent-compiler/understanding/taxonomy";
import type { NormalizedSlotValue } from "@/lib/agent-compiler/understanding/slots";
import { slotDisplayValue } from "@/lib/agent-compiler/understanding/validate";

// ---------------------------------------------------------------------------
// Eventos de entrada (lo único que puede cambiar el estado)
// ---------------------------------------------------------------------------

export type ConversationInputEvent =
  | {
      type: "MESSAGE_UNDERSTOOD";
      eventId: string;
      /** Momento del mensaje según el canal (ordena mensajes fuera de orden). */
      at: string;
      understanding: StructuredUnderstanding;
      /** Señales deterministas del texto (no del modelo): "también/además" = información adicional. */
      cues: { additive: boolean };
    }
  | { type: "UNDERSTANDING_FAILED"; eventId: string; at: string; category: string; code: string }
  | { type: "ACTION_STARTED"; eventId: string; at: string; actionId: string }
  | { type: "ACTION_SUCCEEDED"; eventId: string; at: string; actionId: string; proposedSlots?: Record<string, NormalizedSlotValue> }
  | { type: "ACTION_FAILED"; eventId: string; at: string; actionId: string; category: string; invalidSlots?: string[]; ambiguous?: boolean }
  | { type: "HUMAN_TOOK_OVER"; eventId: string; at: string }
  | { type: "RESUMED"; eventId: string; at: string }
  | { type: "TIMEOUT"; eventId: string; at: string };

export const SYSTEM_EVENT_TYPES = ["ACTION_STARTED", "ACTION_SUCCEEDED", "ACTION_FAILED", "HUMAN_TOOK_OVER", "RESUMED", "TIMEOUT"] as const;

/**
 * Vocabulario de eventos de dominio (lo que ocurrió en el turno). El "evento decisivo" de cada turno es la clave de
 * la tabla de transiciones y queda en `lastTransition`. Los demás quedan en la traza de observabilidad.
 */
export const DOMAIN_EVENTS = [
  "MESSAGE_RECEIVED",
  "GOAL_STARTED",
  "SLOT_UPDATED",
  "SLOT_CORRECTED",
  "ADDITIONAL_INFORMATION",
  "AMBIGUITY_DETECTED",
  "STALE_MESSAGE",
  "CONFIRMATION_RECEIVED",
  "CONFIRMATION_IGNORED",
  "REJECTION_RECEIVED",
  "GOAL_ABANDONED",
  "HANDOFF_REQUESTED",
  "ACTION_REQUESTED",
  "ACTION_STARTED",
  "ACTION_SUCCEEDED",
  "ACTION_FAILED",
  "HUMAN_TOOK_OVER",
  "RESUMED",
  "TIMEOUT",
  "UNDERSTANDING_FAILED",
] as const;
export type DomainEvent = (typeof DOMAIN_EVENTS)[number];

// ---------------------------------------------------------------------------
// Tabla de transiciones (fuente única de verdad de lo permitido)
// ---------------------------------------------------------------------------

type Target = ConversationStatus | "EVALUATE" | "SAME";

export interface TransitionRule {
  from: readonly ConversationStatus[];
  event: DomainEvent;
  to: readonly Target[];
  sideEffects: readonly string[];
}

const ALL: readonly ConversationStatus[] = ["NEW", "COLLECTING_INFORMATION", "AWAITING_CONFIRMATION", "READY_FOR_ACTION", "EXECUTING", "COMPLETED", "CANCELLED", "HANDOFF_PENDING", "HANDED_OFF", "PAUSED", "ERROR"];
const AGENT_CONTROLLED = ALL.filter((s) => !HUMAN_CONTROLLED_STATUSES.has(s));
const CONVERSING: readonly ConversationStatus[] = ["NEW", "COLLECTING_INFORMATION", "AWAITING_CONFIRMATION", "READY_FOR_ACTION", "COMPLETED", "CANCELLED", "ERROR"];
const GOAL_OPEN: readonly ConversationStatus[] = ["COLLECTING_INFORMATION", "AWAITING_CONFIRMATION", "READY_FOR_ACTION", "ERROR"];
const EVALUATED: readonly Target[] = ["NEW", "COLLECTING_INFORMATION", "AWAITING_CONFIRMATION", "READY_FOR_ACTION", "ERROR"];

export const TRANSITIONS: readonly TransitionRule[] = [
  { from: CONVERSING, event: "MESSAGE_RECEIVED", to: [...EVALUATED, "SAME"], sideEffects: [] },
  // Con una persona a cargo o una acción en curso, el mensaje solo se registra (no cambia datos ni estado).
  { from: ["HANDOFF_PENDING", "HANDED_OFF", "PAUSED", "EXECUTING"], event: "MESSAGE_RECEIVED", to: ["SAME"], sideEffects: ["record_only"] },
  { from: CONVERSING, event: "GOAL_STARTED", to: EVALUATED, sideEffects: ["reset_goal_slots_if_previous_goal_finished"] },
  { from: CONVERSING, event: "SLOT_UPDATED", to: EVALUATED, sideEffects: ["record_slot"] },
  { from: CONVERSING, event: "SLOT_CORRECTED", to: EVALUATED, sideEffects: ["record_slot", "keep_previous_value", "invalidate_stale_proposal"] },
  { from: CONVERSING, event: "ADDITIONAL_INFORMATION", to: EVALUATED, sideEffects: ["append_additional_value"] },
  { from: CONVERSING, event: "AMBIGUITY_DETECTED", to: EVALUATED, sideEffects: ["mark_slot_ambiguous"] },
  { from: CONVERSING, event: "CONFIRMATION_IGNORED", to: [...EVALUATED, "SAME"], sideEffects: [] },
  { from: ["AWAITING_CONFIRMATION"], event: "CONFIRMATION_RECEIVED", to: ["READY_FOR_ACTION", "COLLECTING_INFORMATION", "ERROR"], sideEffects: ["revalidate_requirements", "confirm_slots", "emit_action_request"] },
  { from: ["AWAITING_CONFIRMATION"], event: "REJECTION_RECEIVED", to: ["COLLECTING_INFORMATION", "AWAITING_CONFIRMATION"], sideEffects: ["drop_proposal"] },
  { from: GOAL_OPEN, event: "GOAL_ABANDONED", to: ["CANCELLED"], sideEffects: ["drop_proposal", "drop_pending_action"] },
  { from: AGENT_CONTROLLED, event: "HANDOFF_REQUESTED", to: ["HANDOFF_PENDING", ...EVALUATED], sideEffects: ["emit_handoff_request", "remember_resume_status"] },
  { from: ["READY_FOR_ACTION", "EXECUTING", "HANDOFF_PENDING", "HANDED_OFF", "PAUSED"], event: "ACTION_STARTED", to: ["EXECUTING", "SAME"], sideEffects: ["lock_pending_action"] },
  { from: ["READY_FOR_ACTION", "EXECUTING", "HANDOFF_PENDING", "HANDED_OFF", "PAUSED"], event: "ACTION_SUCCEEDED", to: ["COMPLETED", "HANDED_OFF", "SAME", ...EVALUATED], sideEffects: ["record_action_result", "release_pending_action"] },
  { from: ["READY_FOR_ACTION", "EXECUTING", "HANDOFF_PENDING", "HANDED_OFF", "PAUSED"], event: "ACTION_FAILED", to: ["ERROR", "SAME", ...EVALUATED], sideEffects: ["record_action_result", "mark_rejected_slots_invalid"] },
  { from: ALL, event: "HUMAN_TOOK_OVER", to: ["PAUSED", "HANDED_OFF", "SAME"], sideEffects: ["remember_resume_status"] },
  { from: ["HANDED_OFF", "PAUSED"], event: "RESUMED", to: [...EVALUATED, "EXECUTING"], sideEffects: ["drop_proposal"] },
  { from: AGENT_CONTROLLED, event: "TIMEOUT", to: ["NEW", "EXECUTING"], sideEffects: ["reset_goal_slots"] },
  { from: ALL, event: "UNDERSTANDING_FAILED", to: ["SAME", "ERROR"], sideEffects: [] },
];

export function isTransitionAllowed(from: ConversationStatus, event: DomainEvent, to: ConversationStatus): boolean {
  return TRANSITIONS.some(
    (r) => r.event === event && r.from.includes(from) && (r.to.includes(to) || (r.to.includes("SAME") && to === from) || (r.to.includes("EVALUATE") && EVALUATED.includes(to))),
  );
}

// ---------------------------------------------------------------------------
// Resultado del reducer
// ---------------------------------------------------------------------------

export type ReduceResult =
  | { ok: true; state: ConversationState; decisive: DomainEvent; domainEvents: DomainEvent[] }
  | { ok: false; code: "invalid_transition" | "duplicate_event" | "action_mismatch"; detail: string };

export interface ReduceContext {
  requirements: AgentRequirements;
  /** Reloj del servidor (ISO). */
  now: string;
}

const MAX_FAILURES_BEFORE_ERROR = 3;
/** Categoría con la que queda registrada una escritura de desenlace desconocido. */
export const OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN";
const MAX_ADDITIONAL = 5;

/** Marca de CORRECCIÓN que el contexto aporta: el cliente responde a una propuesta o a la pregunta por ese dato. */
function contextImpliesCorrection(state: ConversationState, slot: string): boolean {
  return state.status === "AWAITING_CONFIRMATION" || state.proposalRejected || state.lastQuestion?.slot === slot;
}

function goalId(eventId: string, kind: GoalKind): string {
  return createHash("sha256").update(`${eventId}|${kind}`).digest("hex").slice(0, 24);
}

function pushEventId(state: ConversationState, eventId: string): void {
  state.recentEventIds = [...state.recentEventIds, eventId].slice(-MAX_RECENT_EVENT_IDS);
}

function resetGoal(state: ConversationState, req: AgentRequirements): void {
  const customer = new Set(req.customerSlots);
  for (const [name, slot] of Object.entries(state.slots)) {
    if (slot.scope === "goal" && !customer.has(name)) delete state.slots[name];
  }
  state.goal = null;
  state.pendingConfirmation = null;
  state.pendingAction = null;
  state.lastLookup = null;
  state.lastQuestion = null;
  state.proposalRejected = false;
}

function display(v: NormalizedSlotValue): string {
  return slotDisplayValue(v);
}

/** Aplica los slots del entendimiento con el ciclo de vida KNOWN / CORRECTED / AMBIGUOUS / INVALID. */
function applySlots(state: ConversationState, u: StructuredUnderstanding, ev: Extract<ConversationInputEvent, { type: "MESSAGE_UNDERSTOOD" }>, req: AgentRequirements, now: string, events: Set<DomainEvent>, contextState: ConversationState): boolean {
  let changed = false;
  const customer = new Set(req.customerSlots);
  for (const [name, us] of Object.entries(u.slots) as Array<[string, UnderstoodSlot]>) {
    const existing = state.slots[name];
    // Mensaje fuera de orden: no pisa un valor aportado por un mensaje posterior.
    if (existing && ev.at < existing.observedAt) {
      events.add("STALE_MESSAGE");
      continue;
    }
    const base = { source: "CURRENT_MESSAGE" as const, scope: customer.has(name) ? ("customer" as const) : ("goal" as const), observedAt: ev.at, updatedAt: now, turn: state.turn, ...(us.normalizedBy ? { normalizedBy: us.normalizedBy } : {}) };
    const usable = isSlotUsable(existing);
    const explicitCorrection = us.change === "corrected";
    // Un valor de ACTION_RESULT o BUSINESS_DATA nunca le gana a lo que dice el cliente.
    const userOwns = usable && existing!.source === "CURRENT_MESSAGE";

    if (us.status !== "resolved" || !us.value) {
      if (userOwns && !explicitCorrection) {
        events.add("AMBIGUITY_DETECTED");
        continue;
      }
      const status = us.status === "invalid" ? ("INVALID" as const) : ("AMBIGUOUS" as const);
      state.slots[name] = { ...base, status, value: null, ...(us.candidates ? { candidates: us.candidates.slice(0, 10) } : {}), ...(us.reason ? { reason: us.reason.slice(0, 60) } : {}) };
      events.add("AMBIGUITY_DETECTED");
      changed = true;
      continue;
    }

    const value = us.value;
    if (!usable || !userOwns) {
      state.slots[name] = { ...base, status: "KNOWN", value, ...(existing?.value && usable ? { previous: { value: existing.value, source: existing.source, observedAt: existing.observedAt } } : {}) };
      events.add("SLOT_UPDATED");
      changed = true;
      continue;
    }
    if (display(existing!.value!) === display(value)) {
      // Repite lo conocido: no es corrección ni cambio.
      continue;
    }
    if (explicitCorrection || (us.change === "conflict" && !ev.cues.additive && contextImpliesCorrection(contextState, name))) {
      state.slots[name] = { ...base, status: "CORRECTED", value, previous: { value: existing!.value!, source: existing!.source, observedAt: existing!.observedAt } };
      events.add("SLOT_CORRECTED");
      changed = true;
      continue;
    }
    if (ev.cues.additive) {
      const additional = [...(existing!.additional ?? []), value].slice(-MAX_ADDITIONAL);
      state.slots[name] = { ...existing!, additional, updatedAt: now };
      events.add("ADDITIONAL_INFORMATION");
      continue;
    }
    // Valor distinto sin corrección explícita ni contexto: NO se reemplaza en silencio; se pide aclarar.
    const slot: SlotRecord = { ...existing!, status: "AMBIGUOUS", candidates: [display(existing!.value!), display(value)], reason: "conflicting_values", updatedAt: now };
    state.slots[name] = slot;
    events.add("AMBIGUITY_DETECTED");
    changed = true;
  }
  return changed;
}

/**
 * La hora debe ser coherente con la franja que el MISMO cliente pidió ("después de las 4" + "a las 4:30"). Si no lo es,
 * no se elige por él: el slot queda AMBIGUOUS con ambas lecturas (p. ej. 04:30 / 16:30) y se le pregunta.
 */
function reconcileTimeWithRange(state: ConversationState, now: string, events: Set<DomainEvent>): void {
  const t = state.slots.time;
  const r = state.slots.time_range;
  if (!isSlotUsable(t) || !isSlotUsable(r) || t.value.kind !== "time" || r.value.kind !== "time_range") return;
  if (t.turn !== state.turn && r.turn !== state.turn) return;
  const { from, to } = r.value;
  if (!from && !to) return;
  const inside = (hhmm: string) => (!from || hhmm >= from) && (!to || hhmm <= to);
  if (inside(t.value.time)) return;
  const h = Number(t.value.time.slice(0, 2));
  const alt = h >= 1 && h <= 11 ? `${String(h + 12).padStart(2, "0")}${t.value.time.slice(2)}` : h >= 13 ? `${String(h - 12).padStart(2, "0")}${t.value.time.slice(2)}` : null;
  state.slots.time = { ...t, status: "AMBIGUOUS", candidates: alt ? [t.value.time, alt] : [t.value.time], reason: "outside_requested_range", updatedAt: now };
  events.add("AMBIGUITY_DETECTED");
}

const DECISIVE_PRIORITY: readonly DomainEvent[] = [
  "HANDOFF_REQUESTED",
  "GOAL_ABANDONED",
  "CONFIRMATION_RECEIVED",
  "REJECTION_RECEIVED",
  "SLOT_CORRECTED",
  "GOAL_STARTED",
  "SLOT_UPDATED",
  "AMBIGUITY_DETECTED",
  "ADDITIONAL_INFORMATION",
  "CONFIRMATION_IGNORED",
  "MESSAGE_RECEIVED",
];

function finish(state: ConversationState, from: ConversationStatus, events: Set<DomainEvent>, now: string): ReduceResult {
  const decisive = DECISIVE_PRIORITY.find((e) => events.has(e)) ?? [...events][0] ?? "MESSAGE_RECEIVED";
  if (!isTransitionAllowed(from, decisive, state.status)) {
    return { ok: false, code: "invalid_transition", detail: `${from}+${decisive}->${state.status}` };
  }
  state.lastTransition = { from, event: decisive, to: state.status, at: now, turn: state.turn };
  state.updatedAt = now;
  return { ok: true, state, decisive, domainEvents: [...events] };
}

function applyEvaluation(state: ConversationState, req: AgentRequirements, ctx: EvaluationContext, events: Set<DomainEvent>): void {
  const r = evaluateGoal(state, req, ctx);
  const previousAction = state.pendingAction?.id;
  state.status = r.status;
  state.pendingConfirmation = r.pendingConfirmation;
  state.pendingAction = r.pendingAction;
  if (r.pendingAction && r.pendingAction.id !== previousAction) events.add("ACTION_REQUESTED");
  if (r.problem) {
    const same = state.lastQuestion?.slot === r.problem.slot && state.lastQuestion.reason === r.problem.reason;
    state.lastQuestion = { slot: r.problem.slot, reason: r.problem.reason, turn: state.turn, count: same ? state.lastQuestion!.count + 1 : 1 };
  } else {
    state.lastQuestion = null;
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reduceMessage(prev: ConversationState, ev: Extract<ConversationInputEvent, { type: "MESSAGE_UNDERSTOOD" }>, ctx: ReduceContext): ReduceResult {
  const req = ctx.requirements;
  const s: ConversationState = structuredClone(prev);
  const events = new Set<DomainEvent>(["MESSAGE_RECEIVED"]);
  const from = prev.status;
  const u = ev.understanding;

  s.turn += 1;
  pushEventId(s, ev.eventId);
  if (!s.lastMessageAt || ev.at > s.lastMessageAt) s.lastMessageAt = ev.at;
  s.consecutiveFailures = 0;
  s.currentIntent = { intent: u.intent.primary.intent, band: u.intent.primary.band };
  s.secondaryIntents = u.intent.secondary.map((i) => i.intent);

  // Una persona tiene la conversación: el mensaje queda registrado, sin transición (FASE 3 prepara la coexistencia).
  if (HUMAN_CONTROLLED_STATUSES.has(from)) return finish(s, from, events, ctx.now);

  const intents: UnderstandingIntent[] = [u.intent.primary.intent, ...u.intent.secondary.map((i) => i.intent)];
  const turnIntents = new Set(intents);

  // Durante la ejecución de una acción no se cambian datos (la acción ya está en curso); solo se honra el handoff.
  if (from === "EXECUTING" && !u.signals.handoff.requested) return finish(s, from, events, ctx.now);
  // Tras una escritura de desenlace desconocido, la conversación espera a una persona: no se re-propone nada.
  if (from === "ERROR" && prev.lastActionResult?.category === OUTCOME_UNKNOWN && !u.signals.handoff.requested) return finish(s, from, events, ctx.now);

  // 1. Handoff: gana sobre todo lo demás. Los datos del mensaje igual se conservan (le sirven a la persona).
  if (u.signals.handoff.requested) {
    applySlots(s, u, ev, req, ctx.now, events, prev);
    events.add("HANDOFF_REQUESTED");
    s.handoff = { status: "requested", requestedAt: ctx.now, supported: req.handoff.supported };
    if (req.handoff.supported && req.handoff.action) {
      const built = buildActionRequest({ state: s, requirements: req, action: req.handoff.action, purpose: "handoff", requiresConfirmation: false, confirmationId: null, now: ctx.now });
      s.resumeStatus = from;
      s.status = "HANDOFF_PENDING";
      s.pendingConfirmation = null;
      // Una acción que YA se está ejecutando no se descarta: su resultado se registrará al llegar.
      if (from !== "EXECUTING" && built.ok) {
        s.pendingAction = built.request;
        events.add("ACTION_REQUESTED");
      }
      return finish(s, from, events, ctx.now);
    }
    // Sin handoff configurado: el siguiente paso lo informa; la conversación sigue su curso.
    applyEvaluation(s, req, { now: ctx.now, confirmedId: null, turnIntents, sideQuestion: null }, events);
    return finish(s, from, events, ctx.now);
  }

  // 2. Un objetivo terminado no condiciona el siguiente: se reinicia (los datos de la persona se conservan).
  if (GOAL_TERMINAL_STATUSES.has(from)) {
    resetGoal(s, req);
    s.status = "NEW";
  }

  // 3. Cancelar: con un objetivo abierto (no ejecutado) = abandonarlo; sin objetivo = cancelar algo existente.
  const wantsCancel = turnIntents.has("CANCELLATION");
  if (wantsCancel && s.goal && GOAL_OPEN.includes(s.status) && s.goal.kind !== "cancellation") {
    events.add("GOAL_ABANDONED");
    s.status = "CANCELLED";
    s.pendingConfirmation = null;
    s.pendingAction = null;
    s.lastQuestion = null;
    return finish(s, from, events, ctx.now);
  }

  // 4. Objetivo: se inicia si no hay; uno transaccional desplaza a uno informativo; otra pregunta informativa se
  //    responde al lado del objetivo en curso (sin perderlo).
  let sideQuestion: EvaluationContext["sideQuestion"] = null;
  const candidateGoals = intents.map((i) => goalForIntent(i, req)).filter((g): g is GoalKind => g !== null);
  // Con varias intenciones, el objetivo transaccional manda y la pregunta informativa se responde al lado.
  const primaryGoal = candidateGoals.find((g) => TRANSACTIONAL_GOALS.has(g)) ?? candidateGoals[0] ?? null;
  const informative = candidateGoals.find((g) => g === "quote" || g === "information");
  if (primaryGoal && informative && primaryGoal !== informative) sideQuestion = informative;
  if (primaryGoal) {
    if (!s.goal) {
      s.goal = { id: goalId(ev.eventId, primaryGoal), kind: primaryGoal, intent: intents.find((i) => goalForIntent(i, req) === primaryGoal) ?? intents[0]!, startedAt: ctx.now, startedTurn: s.turn };
      s.proposalRejected = false;
      events.add("GOAL_STARTED");
    } else if (s.goal.kind !== primaryGoal) {
      if (TRANSACTIONAL_GOALS.has(primaryGoal) && !TRANSACTIONAL_GOALS.has(s.goal.kind)) {
        s.goal = { id: goalId(ev.eventId, primaryGoal), kind: primaryGoal, intent: u.intent.primary.intent, startedAt: ctx.now, startedTurn: s.turn };
        s.pendingConfirmation = null;
        s.pendingAction = null;
        events.add("GOAL_STARTED");
      } else if (primaryGoal === "information" || primaryGoal === "quote") {
        sideQuestion = primaryGoal;
      }
    }
  }

  // 5. Datos del mensaje.
  const changed = applySlots(s, u, ev, req, ctx.now, events, prev);
  reconcileTimeWithRange(s, ctx.now, events);
  if (changed) s.proposalRejected = false;

  // 6. Confirmación / rechazo: solo valen contra una propuesta pendiente y compatible.
  let confirmedId: string | null = null;
  const conf = u.signals.confirmation;
  if (conf && from === "AWAITING_CONFIRMATION" && prev.pendingConfirmation) {
    if (conf.kind === "affirm" && conf.pendingRef === prev.pendingConfirmation.id && !changed) {
      confirmedId = prev.pendingConfirmation.id;
      events.add("CONFIRMATION_RECEIVED");
    } else if (conf.kind === "deny") {
      events.add("REJECTION_RECEIVED");
      s.pendingConfirmation = null;
      if (!changed) s.proposalRejected = true;
    } else {
      events.add("CONFIRMATION_IGNORED");
    }
  } else if (conf) {
    events.add("CONFIRMATION_IGNORED");
  }

  applyEvaluation(s, req, { now: ctx.now, confirmedId, turnIntents, sideQuestion }, events);
  if (confirmedId && s.status === "READY_FOR_ACTION" && s.goal) {
    const g = req.goals[s.goal.kind];
    for (const r of g.required) {
      for (const name of r.anyOf) {
        const slot = s.slots[name];
        if (isSlotUsable(slot)) s.slots[name] = { ...slot, status: "CONFIRMED", confirmedAt: ctx.now };
      }
    }
  }
  return finish(s, from, events, ctx.now);
}

function systemEvent(prev: ConversationState, ev: Exclude<ConversationInputEvent, { type: "MESSAGE_UNDERSTOOD" }>, ctx: ReduceContext): ReduceResult {
  const req = ctx.requirements;
  const s: ConversationState = structuredClone(prev);
  const from = prev.status;
  const events = new Set<DomainEvent>();
  pushEventId(s, ev.eventId);
  const reject = (detail: string, code: "invalid_transition" | "action_mismatch" = "invalid_transition"): ReduceResult => ({ ok: false, code, detail: `${from}+${ev.type}: ${detail}` });
  const baseCtx: EvaluationContext = { now: ctx.now, confirmedId: null, turnIntents: new Set(), sideQuestion: null };

  switch (ev.type) {
    case "UNDERSTANDING_FAILED": {
      events.add("UNDERSTANDING_FAILED");
      s.consecutiveFailures += 1;
      if (s.consecutiveFailures >= MAX_FAILURES_BEFORE_ERROR && !HUMAN_CONTROLLED_STATUSES.has(from) && from !== "EXECUTING") s.status = "ERROR";
      return finish(s, from, events, ctx.now);
    }
    case "ACTION_STARTED": {
      if (!prev.pendingAction || prev.pendingAction.id !== ev.actionId) return reject("no_matching_pending_action", "action_mismatch");
      events.add("ACTION_STARTED");
      // Re-registrar el inicio de la MISMA acción (reintento tras un worker caído) es idempotente: no cambia nada.
      if (prev.pendingAction.status === "executing") return finish(s, from, events, ctx.now);
      s.pendingAction = { ...prev.pendingAction, status: "executing" };
      if (from === "READY_FOR_ACTION") s.status = "EXECUTING";
      return finish(s, from, events, ctx.now);
    }
    case "ACTION_SUCCEEDED": {
      if (!prev.pendingAction || prev.pendingAction.id !== ev.actionId) return reject("no_matching_pending_action", "action_mismatch");
      events.add("ACTION_SUCCEEDED");
      const action = prev.pendingAction;
      s.pendingAction = null;
      s.lastActionResult = { actionId: action.id, action: action.action, outcome: "succeeded", category: null, at: ctx.now };
      if (action.purpose === "handoff") {
        s.handoff = { ...s.handoff, status: "active" };
        s.status = "HANDED_OFF";
        return finish(s, from, events, ctx.now);
      }
      if (HUMAN_CONTROLLED_STATUSES.has(from)) return finish(s, from, events, ctx.now);
      if (action.purpose === "fulfill") {
        s.status = "COMPLETED";
        s.lastQuestion = null;
        return finish(s, from, events, ctx.now);
      }
      // lookup: sus resultados solo completan datos que faltan; nunca pisan lo que dijo el cliente.
      s.lastLookup = { action: action.action, argsHash: lookupHash(prev, req, action.action, ctx.now), outcome: "succeeded" };
      for (const [name, value] of Object.entries(ev.proposedSlots ?? {})) {
        if (s.slots[name] || !/^[a-z][a-z0-9_]{0,39}$/.test(name)) continue;
        s.slots[name] = { status: "KNOWN", value, source: "ACTION_RESULT", scope: "goal", observedAt: ev.at, updatedAt: ctx.now, turn: s.turn };
        events.add("SLOT_UPDATED");
      }
      applyEvaluation(s, req, baseCtx, events);
      return finish(s, from, events, ctx.now);
    }
    case "ACTION_FAILED": {
      if (!prev.pendingAction || prev.pendingAction.id !== ev.actionId) return reject("no_matching_pending_action", "action_mismatch");
      events.add("ACTION_FAILED");
      const action = prev.pendingAction;
      s.pendingAction = null;
      s.pendingConfirmation = null;
      s.lastActionResult = { actionId: action.id, action: action.action, outcome: "failed", category: ev.category.slice(0, 40), at: ctx.now };
      if (HUMAN_CONTROLLED_STATUSES.has(from)) return finish(s, from, events, ctx.now);
      // Escritura con desenlace DESCONOCIDO (timeout / worker caído): pudo haber ocurrido. Nunca se vuelve a proponer
      // automáticamente (sería una posible doble reserva): ERROR hasta que una persona lo revise.
      if (ev.ambiguous && action.purpose !== "lookup") {
        s.status = "ERROR";
        s.lastActionResult = { ...s.lastActionResult!, category: OUTCOME_UNKNOWN };
        return finish(s, from, events, ctx.now);
      }
      const markInvalid = () => {
        let marked = 0;
        for (const name of ev.invalidSlots ?? []) {
          const slot = s.slots[name];
          if (slot) {
            s.slots[name] = { ...slot, status: "INVALID", reason: "rejected_by_backend", updatedAt: ctx.now };
            marked++;
          }
        }
        return marked;
      };
      if (action.purpose === "lookup") {
        s.lastLookup = { action: action.action, argsHash: lookupHash(prev, req, action.action, ctx.now), outcome: "failed" };
        markInvalid();
        applyEvaluation(s, req, baseCtx, events);
        return finish(s, from, events, ctx.now);
      }
      const recoverable = ev.category === "BUSINESS_RULE_ERROR" || ev.category === "USER_ERROR" || ev.category === "VALIDATION_ERROR";
      // Solo es recuperable conversando si el backend señaló un dato que el cliente puede cambiar; si no (calendario
      // desconectado, política, configuración), repetir la propuesta fallaría igual: ERROR (y se ofrece una persona).
      if (!recoverable || markInvalid() === 0) {
        s.status = "ERROR";
        return finish(s, from, events, ctx.now);
      }
      applyEvaluation(s, req, baseCtx, events);
      return finish(s, from, events, ctx.now);
    }
    case "HUMAN_TOOK_OVER": {
      events.add("HUMAN_TOOK_OVER");
      if (from === "HANDED_OFF" || from === "PAUSED") return finish(s, from, events, ctx.now);
      if (from === "HANDOFF_PENDING") {
        s.status = "HANDED_OFF";
        s.handoff = { ...s.handoff, status: "active" };
        if (s.pendingAction?.purpose === "handoff" && s.pendingAction.status === "requested") s.pendingAction = null;
        return finish(s, from, events, ctx.now);
      }
      s.resumeStatus = from;
      s.status = "PAUSED";
      return finish(s, from, events, ctx.now);
    }
    case "RESUMED": {
      if (from !== "HANDED_OFF" && from !== "PAUSED") return reject("not_paused");
      events.add("RESUMED");
      s.handoff = { status: "none", requestedAt: null, supported: req.handoff.supported };
      s.resumeStatus = null;
      if (s.pendingAction?.purpose === "handoff") s.pendingAction = null;
      if (s.pendingAction?.status === "executing") {
        s.status = "EXECUTING";
        return finish(s, from, events, ctx.now);
      }
      // La persona pudo cambiar cosas: una propuesta vieja no se da por confirmada; se vuelve a evaluar.
      s.pendingConfirmation = null;
      s.pendingAction = null;
      applyEvaluation(s, req, baseCtx, events);
      return finish(s, from, events, ctx.now);
    }
    case "TIMEOUT": {
      if (HUMAN_CONTROLLED_STATUSES.has(from)) return reject("human_controlled");
      events.add("TIMEOUT");
      if (from === "EXECUTING") return finish(s, from, events, ctx.now);
      resetGoal(s, req);
      s.status = "NEW";
      return finish(s, from, events, ctx.now);
    }
  }
}

function lookupHash(state: ConversationState, req: AgentRequirements, action: string, now: string): string {
  const built = buildActionRequest({ state, requirements: req, action, purpose: "lookup", requiresConfirmation: false, confirmationId: null, now });
  return built.ok ? built.argsHash : "";
}

export function reduceConversation(state: ConversationState, event: ConversationInputEvent, ctx: ReduceContext): ReduceResult {
  if (state.recentEventIds.includes(event.eventId)) return { ok: false, code: "duplicate_event", detail: event.type };
  return event.type === "MESSAGE_UNDERSTOOD" ? reduceMessage(state, event, ctx) : systemEvent(state, event, ctx);
}
