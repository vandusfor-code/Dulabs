// DuLabs Business — Business Agent 2.0, FASE 6 — SIMULACIÓN: vista previa y "Prueba tu agente" con el borrador.
//
// Corre las MISMAS piezas que producción, con el artefacto compilado del borrador (sin publicar):
//   Gate PRE-LLM (reglas del Spec del borrador) → entendimiento → state machine → Action Engine → renderer
// y con aislamiento total:
//   - el Action Engine recibe simulation=true del SERVIDOR: ninguna escritura (reservar, cancelar, transferir…) llega
//     al handler; devuelve SUCCEEDED `simulated` y el renderer lo dice como simulación;
//   - el handler de lecturas está envuelto: si le llegara una acción con efecto, la rechaza (defensa en profundidad);
//   - estado conversacional y registro de ejecuciones EN MEMORIA (nada toca la base ni WhatsApp);
//   - una transferencia del Gate se describe, no se ejecuta (no se pausa ningún chat real).

import type { EffectDispatchRequest, EffectDispatchResult } from "@/lib/flow/executor-types";
import { getActionContract } from "@/lib/agent-compiler/contracts/action-contracts";
import { evaluateGuardrailGate, type GateRule, type SemanticClassifier } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { artifactRequirements, businessContextFromArtifact, type CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import { createActionEngine, type ActionHandler } from "@/lib/agent-compiler/actions/engine";
import { getActionDefinition } from "@/lib/agent-compiler/actions/registry";
import type { ActionExecutionStore } from "@/lib/agent-compiler/actions/store";
import { parseConversationState, type ConversationState } from "@/lib/agent-compiler/conversation/model";
import type { ConversationStateKey, ConversationStateStore } from "@/lib/agent-compiler/conversation/store";
import { conversationIdOf } from "@/lib/agent-compiler/conversation/store";
import { createConversationRuntime } from "@/lib/agent-compiler/runtime/production/conversation-runtime";
import { simulatedActionText } from "@/lib/agent-compiler/conversation/renderer";
import type { UnderstandingInput } from "@/lib/agent-compiler/understanding/context";
import type { UnderstandingResult } from "@/lib/agent-compiler/understanding/engine";
import { catalogPortForArtifact, type ServiceTableReader } from "@/lib/agent-compiler/conversation/entities";
import type { BusinessAgentTurnTrace } from "@/lib/agent-compiler/runtime/production/turn-trace";

export const SIMULATION_PHONE_NUMBER_ID = "simulacion";
export const SIMULATION_CONTACT = "0000000000";

export function simulationKey(artifact: CompiledAgentArtifact): ConversationStateKey {
  return { tenantId: artifact.tenantId, phoneNumberId: SIMULATION_PHONE_NUMBER_ID, telefonoCliente: SIMULATION_CONTACT, agentId: artifact.agentId };
}

export interface SimulationDeps {
  understand(input: UnderstandingInput): Promise<UnderstandingResult>;
  /** FASE 7 — false = no hay proveedor de IA configurado: la vista previa y las pruebas lo dicen en vez de fingir. */
  available?: boolean;
  /** Clasificador semántico del Gate (en producción, Gemini). Opcional: sin él se evalúan las reglas deterministas. */
  classifier?: SemanticClassifier;
  /** Lecturas reales del negocio (conocimiento, catálogo, cotización, disponibilidad). Sin él, las lecturas fallan. */
  readHandler?: ActionHandler;
  /** FASE 7 — servicios reales del negocio (solo lectura) para resolver "corte" igual que en producción. */
  readServices?: ServiceTableReader;
  /** FASE 7 — traza del turno simulado (marcada simulation=true). */
  trace?: (trace: BusinessAgentTurnTrace) => void;
  now?(): Date;
}

export interface SimulationAction {
  action: string;
  status: string;
  simulated: boolean;
}

export interface SimulationTurnResult {
  replies: string[];
  state: ConversationState | null;
  actions: SimulationAction[];
  gate: { decision: "pass" | "block" | "fixed_response" | "transfer_human"; ruleId?: string };
}

export type SimulationTurnOutcome = { ok: true; result: SimulationTurnResult } | { ok: false; code: "STATE_INVALID" | "UNDERSTANDING_UNAVAILABLE" };

/** Solo lecturas: cualquier acción con efecto que llegara aquí se rechaza (el motor ya no las envía en simulación). */
export function readOnlyHandler(inner: ActionHandler | undefined, seen: EffectDispatchRequest[] = []): ActionHandler {
  return async (request, signal): Promise<EffectDispatchResult> => {
    seen.push(request);
    const action = (request.action as { actionType?: string }).actionType ?? "";
    const def = getActionDefinition(action);
    const contract = getActionContract(action);
    const readOnly = action === "listar_citas_cliente" ? false : Boolean(def ? !def.mutation : contract && contract.sideEffects.startsWith("read"));
    if (!readOnly) return { success: false, classification: "SECURITY_REJECTED", error: "simulation_side_effect_blocked" };
    if (!inner) return { success: false, classification: "NON_RETRYABLE", error: "simulation_read_unavailable" };
    return inner(request, signal);
  };
}

/** Registro de ejecuciones efímero (la simulación nunca escribe en dulabs_ba_action_executions). */
function ephemeralExecutionStore(): ActionExecutionStore {
  let n = 0;
  return {
    async claim() {
      n += 1;
      return { kind: "claimed", executionId: `sim-${n}`, attempt: 1 };
    },
    async complete() {
      return true;
    },
    async acquireLock() {
      return true;
    },
    async releaseLock() {},
  };
}

/** Estado conversacional efímero, sembrado con el estado que devolvió el turno anterior. */
function ephemeralStateStore(seed: ConversationState | null): ConversationStateStore & { current(): ConversationState | null } {
  let state = seed ? structuredClone(seed) : null;
  let version = state ? 1 : 0;
  return {
    async load() {
      return state ? { kind: "found" as const, state: structuredClone(state), version } : { kind: "not_found" as const };
    },
    async create(_key, s) {
      if (state) return { ok: false as const, reason: "already_exists" as const };
      state = structuredClone(s);
      version = 1;
      return { ok: true as const, version };
    },
    async save(_key, s, expected) {
      if (expected !== version) return { ok: false as const, reason: "version_conflict" as const };
      state = structuredClone(s);
      version += 1;
      return { ok: true as const, version };
    },
    current: () => (state ? structuredClone(state) : null),
  };
}

/** El estado que vuelve del navegador se verifica: forma estricta y MISMO tenant/agente/conversación simulada. */
export function verifySimulationState(raw: unknown, artifact: CompiledAgentArtifact): ConversationState | null | "invalid" {
  if (raw === null || raw === undefined) return null;
  const parsed = parseConversationState(raw);
  if (!parsed.ok) return "invalid";
  const key = simulationKey(artifact);
  const s = parsed.state;
  if (s.scope.tenantId !== key.tenantId || s.scope.agentId !== key.agentId || s.scope.conversationId !== conversationIdOf(key) || s.scope.contactId !== key.telefonoCliente) return "invalid";
  return s;
}

export async function runSimulationTurn(
  deps: SimulationDeps,
  input: { artifact: CompiledAgentArtifact; gateRules: GateRule[]; state: unknown; text: string; turnId: string },
): Promise<SimulationTurnOutcome> {
  const seed = verifySimulationState(input.state, input.artifact);
  if (seed === "invalid") return { ok: false, code: "STATE_INVALID" };

  // 1. Gate PRE-LLM con las reglas del borrador (mismas que servirá producción).
  const gate = await evaluateGuardrailGate({ rules: input.gateRules, context: { message: input.text }, classifier: deps.classifier });
  if (gate.kind !== "pass") {
    const replies: string[] = [];
    if (gate.response) replies.push(gate.response);
    if (gate.kind === "transfer_human") replies.push(simulatedActionText("transferir_soporte"));
    return { ok: true, result: { replies, state: seed, actions: [], gate: { decision: gate.kind, ruleId: gate.ruleId } } };
  }

  // 2. Runtime conversacional en modo simulación.
  const key = simulationKey(input.artifact);
  const store = ephemeralStateStore(seed);
  const replies: string[] = [];
  const runtime = createConversationRuntime({
    service: {
      store,
      requirements: { ...artifactRequirements(input.artifact), simulation: true },
      business: businessContextFromArtifact(input.artifact),
      understand: deps.understand,
      catalog: catalogPortForArtifact(input.artifact, deps.readServices),
      businessHours: input.artifact.booking?.businessHours ?? null,
      clock: deps.now,
      log: () => {},
    },
    engine: createActionEngine({ store: ephemeralExecutionStore(), handler: readOnlyHandler(deps.readHandler), clock: deps.now, log: () => {} }),
    artifact: input.artifact,
    simulation: true,
    ...(deps.trace ? { trace: deps.trace } : {}),
    send: async (text) => void replies.push(text),
  });
  const out = await runtime.handle({ key, agentVersion: input.artifact.version.ref, wamid: input.turnId, text: input.text, sentAt: (deps.now?.() ?? new Date()).toISOString() });
  if (out.outcome === "rejected" && out.errorCode?.startsWith("understanding")) return { ok: false, code: "UNDERSTANDING_UNAVAILABLE" };
  return {
    ok: true,
    result: {
      replies,
      state: store.current(),
      actions: out.actions.map((a) => ({ action: a.action, status: a.status, simulated: a.simulated === true })),
      gate: { decision: "pass" },
    },
  };
}
