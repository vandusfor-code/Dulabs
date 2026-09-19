// DuLabs Business — Agent Compiler (Fase 1), Step 7 — Runtime Integration.
//
// Conecta el Agent Compiler con el Flow Engine EXISTENTE respetando la
// arquitectura: WhatsApp → Business Guardrail Gate (PRE-LLM) → Flow Engine → LLM.
//
//   - El Gate corre ANTES del orquestador. Si bloquea/transfiere, DuLabs ejecuta
//     la acción decidida (respuesta fija / transferencia + pausa) y el turno
//     TERMINA: 0 llamadas al LLM, 0 tools de catálogo. No hay un segundo motor:
//     el camino "pasa" delega en createExecutionOrchestrator (runtime real).
//   - La acción SIEMPRE la decide DuLabs (la regla del Gate), nunca el LLM.
//   - Fail-closed: tenant inválido, error del sink, o excepción del orquestador
//     bloquean sin efectos colaterales y sin ceder control extra al LLM.
//   - Multi-tenant: se exige ir.tenantId === incoming.tenantId; el orquestador
//     y el store ya aíslan por tenant_id.
//   - Idempotencia: el camino de Flow la garantiza el orquestador (event_id=wamid);
//     el camino del Gate usa un claim(tenant, wamid) inyectable.
//
// NO modifica lib/flow/*. Solo consume sus APIs/contratos.

import type { FlowEngineEvent } from "@/lib/flow/engine-types";
import type {
  ConversationKey,
  FlowOrchestratorStore,
  NormalizedFlowEvent,
  OrchestratorResult,
} from "@/lib/flow/flow-orchestrator";
import {
  evaluateGuardrailGate,
  type GateDecision,
  type GateRule,
  type SemanticClassifier,
} from "@/lib/agent-compiler/runtime/guardrail-gate";

/** Ejecuta la acción decidida por el Gate (respuesta fija / transferencia). */
export interface GateActionSink {
  sendMessage(input: { tenantId: string; conversation: ConversationKey; wamid: string; text: string }): Promise<void>;
  transferHuman(input: {
    tenantId: string;
    conversation: ConversationKey;
    wamid: string;
    text?: string;
    pauseHours: number;
  }): Promise<void>;
}

/** Idempotencia del camino del Gate: true = nuevo (procede), false = duplicado. */
export interface GateIdempotencyStore {
  claim(tenantId: string, wamid: string): Promise<boolean>;
}

export interface AgentTurnTrace {
  tenantId: string;
  wamid: string;
  flowId: string;
  commercialState?: string;
  gateRulesEvaluated: number;
  gateDecision: "pass" | "block" | "fixed_response" | "transfer_human" | "fail_closed" | "duplicate";
  matchedRuleId?: string;
  matchedBy?: "deterministic" | "semantic";
  orchestratorOutcome?: OrchestratorResult["outcome"];
  error?: string;
}

export interface AgentTurnObserver {
  onTrace(trace: AgentTurnTrace): void;
}

type BlockedDecision = Extract<GateDecision, { kind: "block" | "fixed_response" | "transfer_human" }>;

export type AgentTurnResult =
  | { kind: "duplicate"; trace: AgentTurnTrace }
  | { kind: "fail_closed"; reason: string; trace: AgentTurnTrace }
  | {
      kind: "guardrail_blocked";
      decision: BlockedDecision;
      /** Garantía de contrato: el Gate cortó ANTES del LLM/catálogo. */
      llmCalled: false;
      catalogCalled: false;
      trace: AgentTurnTrace;
    }
  | { kind: "flow"; orchestrator: OrchestratorResult; trace: AgentTurnTrace };

export interface AgentRuntimeDeps {
  /** Tenant del agente compilado (fuente de verdad del servidor, nunca del LLM). */
  tenantId: string;
  /** Reglas del Business Guardrail Gate (derivadas de la IR en publicación). */
  gateRules: GateRule[];
  /** Flow publicado que atiende a este tenant (dulabs_flows.id). */
  flowId: string;
  /** Orquestador REAL, construido con el mismo store. */
  orchestrator: { process(event: NormalizedFlowEvent): Promise<OrchestratorResult> };
  /** Solo para decidir start vs. continuación (igual que el bridge del webhook). */
  store: Pick<FlowOrchestratorStore, "getActiveExecution">;
  gateSink: GateActionSink;
  classifier?: SemanticClassifier;
  idempotency?: GateIdempotencyStore;
  observer?: AgentTurnObserver;
  now?: () => string;
}

export interface IncomingMessage {
  tenantId: string;
  conversation: ConversationKey;
  wamid: string;
  text: string;
  /** Estado comercial actual (autoridad del Runtime, nunca del LLM). */
  commercialState?: string;
  baseConocimiento?: string;
}

function emit(observer: AgentTurnObserver | undefined, trace: AgentTurnTrace): AgentTurnTrace {
  observer?.onTrace(trace);
  return trace;
}

export async function runAgentTurn(deps: AgentRuntimeDeps, incoming: IncomingMessage): Promise<AgentTurnResult> {
  const rules = deps.gateRules;
  const baseTrace: AgentTurnTrace = {
    tenantId: incoming.tenantId,
    wamid: incoming.wamid,
    flowId: deps.flowId,
    commercialState: incoming.commercialState,
    gateRulesEvaluated: rules.length,
    gateDecision: "pass",
  };

  // 1) Fail-closed multi-tenant (§21): el compilado debe ser del mismo tenant.
  if (deps.tenantId !== incoming.tenantId) {
    return {
      kind: "fail_closed",
      reason: "tenant_mismatch",
      trace: emit(deps.observer, { ...baseTrace, gateDecision: "fail_closed", error: "tenant_mismatch" }),
    };
  }

  // 1.5) Idempotencia GLOBAL por wamid (§19): un mismo evento no puede producir
  // doble respuesta / tool / transferencia / cambio de estado, ni por el
  // camino del Gate ni por el del Flow. Es el mismo happens-before que el
  // webhook real (dulabs_mensajes_log.wamid + procesado_at); el orquestador
  // mantiene además su propia deduplicación por ejecución.
  if (deps.idempotency && !(await deps.idempotency.claim(incoming.tenantId, incoming.wamid))) {
    return { kind: "duplicate", trace: emit(deps.observer, { ...baseTrace, gateDecision: "duplicate" }) };
  }

  // 2) Business Guardrail Gate (PRE-LLM).
  let decision: GateDecision;
  try {
    decision = await evaluateGuardrailGate({
      rules,
      context: { message: incoming.text, commercialState: incoming.commercialState },
      classifier: deps.classifier,
    });
  } catch (err) {
    // Un fallo evaluando el Gate no debe ceder control al LLM (§20).
    return {
      kind: "fail_closed",
      reason: "gate_evaluation_error",
      trace: emit(deps.observer, {
        ...baseTrace,
        gateDecision: "fail_closed",
        error: err instanceof Error ? err.message : String(err),
      }),
    };
  }

  if (decision.kind !== "pass") {
    try {
      if (decision.kind === "transfer_human") {
        // Mutuamente excluyente (§17): transferencia + pausa, sin respuesta IA.
        await deps.gateSink.transferHuman({
          tenantId: incoming.tenantId,
          conversation: incoming.conversation,
          wamid: incoming.wamid,
          text: decision.response,
          pauseHours: decision.pauseHours ?? 24,
        });
      } else if (decision.response) {
        // block con respuesta o fixed_response: DuLabs manda el texto fijo.
        await deps.gateSink.sendMessage({
          tenantId: incoming.tenantId,
          conversation: incoming.conversation,
          wamid: incoming.wamid,
          text: decision.response,
        });
      }
      // block SIN respuesta => bloqueo silencioso (nada que enviar).
    } catch (err) {
      // El envío falló: fail-closed, nunca continuar hacia el LLM (§20).
      return {
        kind: "fail_closed",
        reason: "gate_sink_error",
        trace: emit(deps.observer, {
          ...baseTrace,
          gateDecision: "fail_closed",
          matchedRuleId: decision.ruleId,
          matchedBy: decision.matchedBy,
          error: err instanceof Error ? err.message : String(err),
        }),
      };
    }

    return {
      kind: "guardrail_blocked",
      decision,
      llmCalled: false,
      catalogCalled: false,
      trace: emit(deps.observer, {
        ...baseTrace,
        gateDecision: decision.kind,
        matchedRuleId: decision.ruleId,
        matchedBy: decision.matchedBy,
      }),
    };
  }

  // 3) Gate PASS => Flow Engine (orquestador real). El estado es autoridad del
  // Runtime: se decide start vs. continuación según la ejecución activa, igual
  // que el bridge del webhook (nunca el LLM decide "estoy en X").
  const active = await deps.store.getActiveExecution(incoming.tenantId, incoming.conversation);
  const engineEvent: FlowEngineEvent = active
    ? { type: "text", text: incoming.text, eventId: incoming.wamid }
    : { type: "start", text: incoming.text, eventId: incoming.wamid };

  const event: NormalizedFlowEvent = {
    tenantId: incoming.tenantId,
    conversation: incoming.conversation,
    flowId: deps.flowId,
    eventId: incoming.wamid,
    eventType: "message",
    payload: { text: incoming.text },
    engineEvent,
    receivedAt: (deps.now ?? (() => new Date().toISOString()))(),
    baseConocimiento: incoming.baseConocimiento,
  };

  let orchestrator: OrchestratorResult;
  try {
    orchestrator = await deps.orchestrator.process(event);
  } catch (err) {
    // Excepción del store/orquestador: fail-closed (§20).
    return {
      kind: "fail_closed",
      reason: "orchestrator_error",
      trace: emit(deps.observer, {
        ...baseTrace,
        gateDecision: "fail_closed",
        error: err instanceof Error ? err.message : String(err),
      }),
    };
  }

  return {
    kind: "flow",
    orchestrator,
    trace: emit(deps.observer, { ...baseTrace, gateDecision: "pass", orchestratorOutcome: orchestrator.outcome }),
  };
}
