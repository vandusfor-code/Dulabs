// DuLabs Business — Business Agent 2.0, FASE 3 — servicio de turno de la máquina de estados.
//
//   MESSAGE → (dedupe) → (pausa humana) → UNDERSTANDING (FASE 2) → STATE UPDATE (reducer) → STATE VALIDATION (schema)
//   → PERSIST (versión optimista) → NEXT STEP → RESPONSE PLAN [+ ActionRequest para FASE 4]
//
// Garantías:
//   - Alcance: la clave (tenant, número, cliente, agente) la aporta quien llama desde el canal verificado; el estado
//     cargado debe pertenecer EXACTAMENTE a esa clave. Nada del modelo puede cambiar tenant, agente ni permisos.
//   - Idempotencia: un eventId (wamid) ya aplicado es un no-op (no llama al modelo, no escribe).
//   - Concurrencia: escritura con versión esperada; si otro turno ganó, se recarga y se reprocesa sobre el estado ganador
//     (el entendimiento se recalcula porque depende de lo ya conocido). Tras N intentos, falla cerrado.
//   - Pausa humana: si una persona tiene la conversación, el agente no interpreta ni responde.
//   - Este servicio NO ejecuta acciones: devuelve la ActionRequest y el Action Engine (FASE 4) reporta el resultado
//     con applySystemEvent (ACTION_STARTED / ACTION_SUCCEEDED / ACTION_FAILED).

import { safeError, type BusinessAgentSafeError } from "@/lib/agent-compiler/contracts/errors";
import type { BusinessContextInput, UnderstandingInput } from "@/lib/agent-compiler/understanding/context";
import type { UnderstandingResult } from "@/lib/agent-compiler/understanding/engine";
import { foldText } from "@/lib/agent-compiler/understanding/slots";
import { slotDisplayValue } from "@/lib/agent-compiler/understanding/validate";
import { buildTemporalContext } from "@/lib/agent-compiler/understanding/temporal";
import { sha } from "@/lib/agent-compiler/conversation/actions";
import {
  HUMAN_CONTROLLED_STATUSES,
  initialConversationState,
  isSlotUsable,
  parseConversationState,
  type ActionRequest,
  type ConversationState,
  type ConversationStatus,
} from "@/lib/agent-compiler/conversation/model";
import type { AgentRequirements } from "@/lib/agent-compiler/conversation/requirements";
import { determineNextStep, type NextStep } from "@/lib/agent-compiler/conversation/next-step";
import { planResponse, type ResponsePlan } from "@/lib/agent-compiler/conversation/response-plan";
import { reduceConversation, type ConversationInputEvent, type DomainEvent } from "@/lib/agent-compiler/conversation/transitions";
import { conversationIdOf, type ConversationStateKey, type ConversationStateStore } from "@/lib/agent-compiler/conversation/store";

export const DEFAULT_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const MAX_TURN_ATTEMPTS = 3;

/** Traza mínima de cada transición. Sin valores del cliente; la conversación va con hash. */
export interface ConversationTransitionLog {
  tenantId: string;
  agentId: string;
  conversationRef: string;
  eventId: string;
  outcome: "processed" | "duplicate" | "human_control" | "rejected";
  previousState?: ConversationStatus;
  event?: DomainEvent | string;
  nextState?: ConversationStatus;
  stateVersion?: number;
  domainEvents?: string[];
  nextStep?: NextStep["kind"];
  errorCategory?: string;
  errorCode?: string;
  attempts?: number;
  at: string;
}

export interface HumanControlPort {
  /** true si una persona tiene la conversación (pausa humana vigente), con las reglas existentes del proyecto. */
  isActive(key: ConversationStateKey): Promise<boolean>;
}

export interface ConversationServiceDeps {
  store: ConversationStateStore;
  requirements: AgentRequirements;
  /** Contexto del negocio para el entendimiento (mismo tenant/agente que la clave). */
  business: BusinessContextInput;
  /** Entendimiento de FASE 2 ya ligado a su proveedor (understandMessage). */
  understand: (input: UnderstandingInput) => Promise<UnderstandingResult>;
  humanControl?: HumanControlPort;
  clock?: () => Date;
  idleTimeoutMs?: number;
  log?: (entry: ConversationTransitionLog) => void;
}

export interface ConversationTurnInput {
  key: ConversationStateKey;
  agentVersion: string | null;
  /** Id del mensaje del canal (wamid): clave de idempotencia del turno. */
  eventId: string;
  text: string;
  /** Momento del mensaje según el canal (ISO). Sin él, se usa el reloj del servidor. */
  sentAt?: string;
}

export interface TurnView {
  state: ConversationState;
  version: number;
  nextStep: NextStep;
  responsePlan: ResponsePlan;
  /** Solicitud para el Action Engine (FASE 4), si el siguiente paso es ejecutar algo. */
  actionRequest: ActionRequest | null;
}

export type ConversationTurnResult =
  | ({ outcome: "processed"; transition: NonNullable<ConversationState["lastTransition"]>; domainEvents: DomainEvent[] } & TurnView)
  | ({ outcome: "duplicate" } & TurnView)
  | ({ outcome: "human_control" } & TurnView)
  | { outcome: "rejected"; error: BusinessAgentSafeError };

const ADDITIVE_CUE = /\b(?:tambien|ademas|otro mas|otra mas)\b/;

function defaultLog(entry: ConversationTransitionLog): void {
  console.info("[business-agent.conversation]", JSON.stringify(entry));
}

function view(state: ConversationState, version: number, req: AgentRequirements): TurnView {
  const nextStep = determineNextStep(state, req);
  return {
    state,
    version,
    nextStep,
    responsePlan: planResponse(nextStep, state, req),
    actionRequest: nextStep.kind === "READY_FOR_ACTION" ? nextStep.request : nextStep.kind === "HANDOFF" ? nextStep.request : null,
  };
}

function knownSlotsForUnderstanding(state: ConversationState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, slot] of Object.entries(state.slots)) if (isSlotUsable(slot)) out[name] = slotDisplayValue(slot.value);
  return out;
}

function validKey(key: ConversationStateKey | undefined): key is ConversationStateKey {
  return Boolean(key && key.tenantId && key.phoneNumberId && key.telefonoCliente && key.agentId);
}

type Loaded = { state: ConversationState; version: number; exists: boolean } | { error: BusinessAgentSafeError };

async function loadOrInit(deps: ConversationServiceDeps, key: ConversationStateKey, agentVersion: string | null, now: string): Promise<Loaded> {
  const loaded = await deps.store.load(key);
  if (loaded.kind === "corrupted") return { error: safeError("INTERNAL_ERROR", `conversation_state_${loaded.issue === "scope_mismatch" || loaded.issue === "row_tenant_mismatch" ? "scope_mismatch" : "invalid"}`) };
  if (loaded.kind === "found") {
    const state = loaded.state;
    state.scope = { ...state.scope, agentVersion };
    return { state, version: loaded.version, exists: true };
  }
  const tz = buildTemporalContext(new Date(now), deps.business.businessTimezone).businessTimezone;
  const scope = { tenantId: key.tenantId, conversationId: conversationIdOf(key), contactId: key.telefonoCliente, agentId: key.agentId, agentVersion };
  return { state: initialConversationState(scope, now, tz), version: 0, exists: false };
}

async function persist(deps: ConversationServiceDeps, key: ConversationStateKey, state: ConversationState, loaded: { version: number; exists: boolean }) {
  // Validación final: el reducer nunca debería producir un estado inválido; si lo hace, NO se guarda.
  const parsed = parseConversationState(state);
  if (!parsed.ok) return { ok: false as const, fatal: parsed.issue };
  const w = loaded.exists ? await deps.store.save(key, state, loaded.version) : await deps.store.create(key, state);
  return w.ok ? { ok: true as const, version: w.version } : { ok: false as const, conflict: true };
}

/**
 * Procesa UN mensaje del cliente. Llamar desde el runtime después del Gate PRE-LLM (que sigue siendo la barrera
 * determinista de prohibiciones) y con la clave derivada del canal verificado.
 */
export async function processConversationTurn(deps: ConversationServiceDeps, input: ConversationTurnInput): Promise<ConversationTurnResult> {
  const log = deps.log ?? defaultLog;
  const clock = deps.clock ?? (() => new Date());
  const key = input.key;
  const base = { tenantId: key?.tenantId ?? "", agentId: key?.agentId ?? "", conversationRef: key ? sha(conversationIdOf(key), 16) : "", eventId: input.eventId };
  const reject = (error: BusinessAgentSafeError, extra: Partial<ConversationTransitionLog> = {}): ConversationTurnResult => {
    log({ ...base, outcome: "rejected", errorCategory: error.category, errorCode: error.code, at: clock().toISOString(), ...extra });
    return { outcome: "rejected", error };
  };

  if (!validKey(key) || !input.eventId) return reject(safeError("TENANT_ERROR", "conversation_scope_missing"));
  if (deps.business.tenantId !== key.tenantId || (deps.business.agentId && deps.business.agentId !== key.agentId)) {
    return reject(safeError("TENANT_ERROR", "conversation_business_context_mismatch"));
  }

  for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt++) {
    const nowDate = clock();
    const now = nowDate.toISOString();
    const sentAt = input.sentAt && !Number.isNaN(Date.parse(input.sentAt)) ? new Date(input.sentAt).toISOString() : now;
    const loaded = await loadOrInit(deps, key, input.agentVersion, now);
    if ("error" in loaded) return reject(loaded.error);
    let state = loaded.state;

    if (state.recentEventIds.includes(input.eventId)) {
      log({ ...base, outcome: "duplicate", previousState: state.status, stateVersion: loaded.version, at: now });
      return { outcome: "duplicate", ...view(state, loaded.version, deps.requirements) };
    }

    const events: ConversationInputEvent[] = [];
    const humanActive = deps.humanControl ? await deps.humanControl.isActive(key) : null;
    if (humanActive === true) {
      // Una persona tiene la conversación: no se interpreta (ni se gasta una llamada al modelo) ni se responde.
      if (state.status === "PAUSED" || state.status === "HANDED_OFF") {
        log({ ...base, outcome: "human_control", previousState: state.status, stateVersion: loaded.version, at: now });
        return { outcome: "human_control", ...view(state, loaded.version, deps.requirements) };
      }
      events.push({ type: "HUMAN_TOOK_OVER", eventId: input.eventId, at: sentAt });
    } else {
      if (humanActive === false && (state.status === "PAUSED" || state.status === "HANDED_OFF")) {
        events.push({ type: "RESUMED", eventId: `${input.eventId}:resumed`, at: sentAt });
      }
      const idle = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
      if (state.goal && state.lastMessageAt && Date.parse(sentAt) - Date.parse(state.lastMessageAt) > idle && !HUMAN_CONTROLLED_STATUSES.has(state.status)) {
        events.push({ type: "TIMEOUT", eventId: `${input.eventId}:timeout`, at: sentAt });
      }
    }

    // Eventos del sistema previos al mensaje (pausa, reanudación, vencimiento). Cada reducción queda en la traza.
    const steps: Array<{ previous: ConversationStatus; decisive: DomainEvent; next: ConversationStatus; domainEvents: DomainEvent[] }> = [];
    for (const ev of events) {
      const r = reduceConversation(state, ev, { requirements: deps.requirements, now });
      if (!r.ok) return reject(safeError("INTERNAL_ERROR", `conversation_${r.code}`));
      steps.push({ previous: state.status, decisive: r.decisive, next: r.state.status, domainEvents: r.domainEvents });
      state = r.state;
    }

    if (humanActive !== true && !HUMAN_CONTROLLED_STATUSES.has(state.status)) {
      const pending = state.pendingConfirmation;
      const understood = await deps.understand({
        scope: { tenantId: key.tenantId, conversationId: conversationIdOf(key), contactId: key.telefonoCliente, agentId: key.agentId, ...(input.agentVersion ? { flowVersionId: input.agentVersion } : {}) },
        message: { text: input.text },
        conversation: {
          tenantId: key.tenantId,
          conversationId: conversationIdOf(key),
          contactId: key.telefonoCliente,
          knownSlots: knownSlotsForUnderstanding(state),
          ...(pending && state.status === "AWAITING_CONFIRMATION"
            ? { pendingConfirmation: { ref: pending.id, summary: `${pending.action}: ${Object.entries(knownSlotsForUnderstanding(state)).map(([k, v]) => `${k}=${v}`).join(", ")}` } }
            : {}),
          ...(state.lastQuestion ? { lastAgentQuestion: `Se le pidió el dato: ${state.lastQuestion.slot}` } : {}),
        },
        business: deps.business,
      });
      const ev: ConversationInputEvent = understood.ok
        ? { type: "MESSAGE_UNDERSTOOD", eventId: input.eventId, at: sentAt, understanding: understood.understanding, cues: { additive: ADDITIVE_CUE.test(foldText(input.text)) } }
        : { type: "UNDERSTANDING_FAILED", eventId: input.eventId, at: sentAt, category: understood.error.category, code: understood.error.code };
      if (!understood.ok && (understood.error.category === "TENANT_ERROR" || understood.error.category === "VALIDATION_ERROR")) {
        return reject(understood.error);
      }
      const r = reduceConversation(state, ev, { requirements: deps.requirements, now });
      if (!r.ok) return reject(safeError("INTERNAL_ERROR", `conversation_${r.code}`));
      steps.push({ previous: state.status, decisive: r.decisive, next: r.state.status, domainEvents: r.domainEvents });
      state = r.state;
    }

    const last = steps.at(-1);
    if (!last) {
      log({ ...base, outcome: "human_control", previousState: state.status, stateVersion: loaded.version, at: now });
      return { outcome: "human_control", ...view(state, loaded.version, deps.requirements) };
    }

    const saved = await persist(deps, key, state, loaded);
    if (!saved.ok) {
      if ("fatal" in saved) return reject(safeError("INTERNAL_ERROR", "conversation_state_invalid_after_reduce"));
      continue; // Otro turno ganó la versión: recargar y reprocesar sobre el estado ganador.
    }
    const v = view(state, saved.version, deps.requirements);
    for (const step of steps) {
      log({
        ...base,
        outcome: humanActive === true ? "human_control" : "processed",
        previousState: step.previous,
        event: step.decisive,
        nextState: step.next,
        stateVersion: saved.version,
        domainEvents: step.domainEvents,
        nextStep: v.nextStep.kind,
        attempts: attempt,
        at: now,
      });
    }
    if (humanActive === true) return { outcome: "human_control", ...v };
    return { outcome: "processed", transition: state.lastTransition!, domainEvents: last.domainEvents, ...v };
  }
  return reject(safeError("INTERNAL_ERROR", "conversation_state_conflict"), { attempts: MAX_TURN_ATTEMPTS });
}

/**
 * Evento del SISTEMA (Action Engine, pausa/reanudación humana, vencimiento). Nunca proviene del mensaje del cliente ni
 * del modelo. Un evento no permitido desde el estado actual se rechaza sin modificar nada.
 */
export async function applySystemEvent(
  deps: Pick<ConversationServiceDeps, "store" | "requirements" | "clock" | "log">,
  key: ConversationStateKey,
  event: Exclude<ConversationInputEvent, { type: "MESSAGE_UNDERSTOOD" | "UNDERSTANDING_FAILED" }>,
): Promise<ConversationTurnResult> {
  const log = deps.log ?? defaultLog;
  const clock = deps.clock ?? (() => new Date());
  const base = { tenantId: key?.tenantId ?? "", agentId: key?.agentId ?? "", conversationRef: validKey(key) ? sha(conversationIdOf(key), 16) : "", eventId: event.eventId };
  const reject = (error: BusinessAgentSafeError): ConversationTurnResult => {
    log({ ...base, outcome: "rejected", event: event.type, errorCategory: error.category, errorCode: error.code, at: clock().toISOString() });
    return { outcome: "rejected", error };
  };
  if (!validKey(key) || !event.eventId) return reject(safeError("TENANT_ERROR", "conversation_scope_missing"));

  for (let attempt = 1; attempt <= MAX_TURN_ATTEMPTS; attempt++) {
    const now = clock().toISOString();
    const loaded = await deps.store.load(key);
    if (loaded.kind === "corrupted") return reject(safeError("INTERNAL_ERROR", "conversation_state_invalid"));
    if (loaded.kind === "not_found") return reject(safeError("VALIDATION_ERROR", "conversation_state_not_found"));
    if (loaded.state.recentEventIds.includes(event.eventId)) {
      log({ ...base, outcome: "duplicate", previousState: loaded.state.status, stateVersion: loaded.version, at: now });
      return { outcome: "duplicate", ...view(loaded.state, loaded.version, deps.requirements) };
    }
    const r = reduceConversation(loaded.state, event, { requirements: deps.requirements, now });
    if (!r.ok) return reject(safeError("VALIDATION_ERROR", `conversation_${r.code}`));
    const w = await deps.store.save(key, r.state, loaded.version);
    if (!w.ok) continue;
    const v = view(r.state, w.version, deps.requirements);
    log({ ...base, outcome: "processed", previousState: loaded.state.status, event: r.decisive, nextState: r.state.status, stateVersion: w.version, domainEvents: r.domainEvents, nextStep: v.nextStep.kind, attempts: attempt, at: now });
    return { outcome: "processed", transition: r.state.lastTransition!, domainEvents: r.domainEvents, ...v };
  }
  return reject(safeError("INTERNAL_ERROR", "conversation_state_conflict"));
}
