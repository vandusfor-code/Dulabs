// DuLabs Business — Business Agent 2.0, FASE 4/5 — runtime conversacional (state machine + Action Engine), configurado
// ÚNICAMENTE por el artefacto publicado del Universal Business Model (FASE 5).
//
//   (Gate PRE-LLM ya pasó) → pausa humana → dedupe → Understanding → State Machine → Action Engine → ActionResult
//   → State update → Response Plan → Renderer → WhatsApp
//
// Solo lo usa un Business Agent cuyo tenant está habilitado explícitamente (ver isStateMachineRuntimeEnabled). Para
// todos los demás, el camino del grafo compilado (Flow Engine) sigue exactamente igual.
//
// Garantías de este orquestador (además de las de cada pieza):
//   - Antes de interpretar el mensaje, se resuelve cualquier acción pendiente de un turno anterior (worker caído,
//     reintento): el motor devuelve el resultado ya guardado o el desenlace desconocido; nunca re-ejecuta una escritura.
//   - ACTION_STARTED se registra en el estado DESPUÉS del claim y ANTES de cualquier efecto.
//   - Máximo de acciones por turno acotado (sin bucles).
//   - Solo se envía texto que produce el renderer; nada se envía con una persona a cargo.

import type { CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import {
  applySystemEvent,
  loadTurnView,
  processConversationTurn,
  type ConversationServiceDeps,
  type TurnView,
} from "@/lib/agent-compiler/conversation/service";
import type { ConversationStateKey } from "@/lib/agent-compiler/conversation/store";
import { renderResponse } from "@/lib/agent-compiler/conversation/renderer";
import type { ActionEngine } from "@/lib/agent-compiler/actions/engine";
import { stateCategoryFor, type ActionResult } from "@/lib/agent-compiler/actions/result";
import { stateSnapshot } from "@/lib/agent-compiler/conversation/service";
import { defaultTurnTraceSink, shortHash, understandingTrace, type BusinessAgentTurnTrace, type TurnActionTrace } from "@/lib/agent-compiler/runtime/production/turn-trace";

export const MAX_ACTIONS_PER_TURN = 3;
export const STATE_MACHINE_TENANTS_ENV = "BUSINESS_AGENT_STATE_MACHINE_TENANTS";

/**
 * Activación explícita por tenant (lista separada por comas de UUIDs). Vacía = nadie: el comportamiento de producción no
 * cambia hasta que se habilite un negocio concreto. No existe comodín.
 */
export function isStateMachineRuntimeEnabled(tenantId: string, env: Record<string, string | undefined> = process.env): boolean {
  const raw = env[STATE_MACHINE_TENANTS_ENV] ?? "";
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^[0-9a-f-]{36}$/.test(t))
    .includes(tenantId.toLowerCase());
}

export interface ConversationRuntimeDeps {
  service: ConversationServiceDeps;
  engine: ActionEngine;
  /**
   * Artefacto publicado (FASE 5): lo único que configura este runtime. `service.requirements` y `service.business`
   * deben derivarse de ÉL (artifactRequirements / businessContextFromArtifact); createConversationRuntime lo verifica.
   */
  artifact: CompiledAgentArtifact;
  send(text: string): Promise<void>;
  maxActionsPerTurn?: number;
  /** FASE 6 — vista previa / pruebas: el motor no ejecuta ninguna escritura (ver ActionExecutionContext.simulation). */
  simulation?: boolean;
  /** FASE 7 — traza reconstruible del turno (por defecto, una línea JSON en el log). */
  trace?: (trace: BusinessAgentTurnTrace) => void;
  /** FASE 7 — reloj monotónico para las latencias (inyectable en tests). */
  monotonic?: () => number;
}

export interface ConversationTurnInput {
  key: ConversationStateKey;
  agentVersion: string | null;
  wamid: string;
  text: string;
  sentAt?: string;
}

export interface ConversationRuntimeOutcome {
  outcome: "processed" | "duplicate" | "human_control" | "rejected";
  status?: string;
  sent: boolean;
  actions: Array<{ action: string; status: string; errorCode: string | null; replayed: boolean; simulated?: boolean }>;
  errorCode?: string;
  /** FASE 7 — la traza del turno (la misma que se registra). */
  trace?: BusinessAgentTurnTrace;
}

export function createConversationRuntime(deps: ConversationRuntimeDeps) {
  const maxActions = deps.maxActionsPerTurn ?? MAX_ACTIONS_PER_TURN;
  // Una sola fuente: requisitos y contexto de entendimiento del MISMO artefacto (misma huella, mismo tenant y agente).
  if (deps.service.requirements.artifactRef !== deps.artifact.executionFingerprint || deps.service.business.tenantId !== deps.artifact.tenantId || deps.service.business.agentId !== deps.artifact.agentId) {
    throw new Error("conversation_runtime_artifact_mismatch");
  }
  // Los requisitos de una simulación marcan cada solicitud; los de producción nunca.
  if ((deps.service.requirements.simulation === true) !== (deps.simulation === true)) throw new Error("conversation_runtime_simulation_mismatch");

  const mono = deps.monotonic ?? (() => performance.now());
  const sink = deps.trace ?? defaultTurnTraceSink;

  /** Ejecuta la acción pendiente de la vista y aplica su resultado al estado. Devuelve la vista nueva. */
  async function drive(key: ConversationStateKey, agentVersion: string | null, view: TurnView, userMessage: string, results: ActionResult[], traces: TurnActionTrace[]): Promise<TurnView | null> {
    const request = view.actionRequest ?? view.state.pendingAction;
    if (!request) return null;
    const result = await deps.engine.execute(
      request,
      {
        tenantId: key.tenantId,
        agentId: key.agentId,
        agentVersion,
        conversation: { phoneNumberId: key.phoneNumberId, telefonoCliente: key.telefonoCliente },
        artifact: deps.artifact,
        state: view.state,
        userMessage,
        ...(deps.simulation ? { simulation: true } : {}),
      },
      {
        beforeExecute: async (executionId, attempt) => {
          const started = await applySystemEvent(deps.service, key, { type: "ACTION_STARTED", eventId: `${request.id}:started:${attempt}`, at: new Date().toISOString(), actionId: request.id });
          return started.outcome === "processed" || started.outcome === "duplicate";
        },
      },
    );
    results.push(result);
    traces.push({
      action: result.action,
      purpose: request.purpose,
      requestRef: shortHash(request.id),
      status: result.status,
      errorCode: result.error?.code ?? null,
      reason: result.error?.reason ?? null,
      simulated: result.simulated === true,
      replayed: result.replayed,
      durationMs: result.durationMs,
    });
    // Otra ejecución está en curso (otro worker): no se toca el estado; ese worker aplicará el resultado.
    if (result.status === "IN_PROGRESS") return null;
    const eventId = `${request.id}:result:${result.executionId ?? "rejected"}:${result.attempt}`;
    const applied =
      result.status === "SUCCEEDED"
        ? await applySystemEvent(deps.service, key, { type: "ACTION_SUCCEEDED", eventId, at: new Date().toISOString(), actionId: request.id })
        : await applySystemEvent(deps.service, key, { type: "ACTION_FAILED", eventId, at: new Date().toISOString(), actionId: request.id, category: stateCategoryFor(result.error!, { replayed: result.replayed }), invalidSlots: result.invalidSlots, ambiguous: result.error!.ambiguous });
    if (applied.outcome === "processed" || applied.outcome === "duplicate") return applied;
    // La solicitud ya no era la vigente (p. ej. STALE): se relee el estado actual.
    return loadTurnView(deps.service, key);
  }

  async function handle(input: ConversationTurnInput): Promise<ConversationRuntimeOutcome> {
    const t0 = mono();
    const results: ActionResult[] = [];
    const actionTraces: TurnActionTrace[] = [];
    let understandingMs = 0;
    let actionsMs = 0;
    const summary = () => results.map((r) => ({ action: r.action, status: r.status, errorCode: r.error?.code ?? null, replayed: r.replayed, ...(r.simulated ? { simulated: true } : {}) }));
    const service = {
      ...deps.service,
      understand: async (u: Parameters<typeof deps.service.understand>[0]) => {
        const s0 = mono();
        try {
          return await deps.service.understand(u);
        } finally {
          understandingMs += mono() - s0;
        }
      },
    };
    const emit = (outcome: ConversationRuntimeOutcome, extra: { understanding?: BusinessAgentTurnTrace["understanding"]; before?: BusinessAgentTurnTrace["stateBefore"]; after?: BusinessAgentTurnTrace["stateAfter"]; planIntent?: string | null; text?: string | null; responseMs?: number; stateMs?: number }): ConversationRuntimeOutcome => {
      const total = mono() - t0;
      const trace: BusinessAgentTurnTrace = {
        event: "business_agent.turn",
        messageId: input.wamid,
        tenantId: input.key.tenantId,
        agentId: input.key.agentId,
        publishedVersion: input.agentVersion ?? deps.artifact.version.ref,
        artifactFingerprint: deps.artifact.executionFingerprint,
        simulation: deps.simulation === true,
        outcome: outcome.outcome,
        understanding: extra.understanding ?? null,
        stateBefore: extra.before ?? null,
        stateAfter: extra.after ?? null,
        actions: actionTraces,
        response: { planIntent: extra.planIntent ?? null, sent: outcome.sent, chars: extra.text?.length ?? 0, textHash: extra.text ? shortHash(extra.text, 16) : null },
        latencyMs: {
          understanding: Math.round(understandingMs),
          state: Math.round(Math.max(0, extra.stateMs ?? 0)),
          actions: Math.round(actionsMs),
          response: Math.round(extra.responseMs ?? 0),
          total: Math.round(total),
        },
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
        at: new Date().toISOString(),
      };
      try {
        sink(trace);
      } catch {
        // La observabilidad nunca rompe el turno.
      }
      return { ...outcome, trace };
    };

    // 0. Acción pendiente de un turno anterior (reintento / worker caído): se resuelve primero.
    const a0 = mono();
    const before = await loadTurnView(deps.service, input.key);
    if (before?.state.pendingAction && (before.state.status === "READY_FOR_ACTION" || before.state.status === "EXECUTING")) {
      await drive(input.key, input.agentVersion, before, input.text, results, actionTraces);
    }
    actionsMs += mono() - a0;

    // 1. Mensaje → entendimiento → (entidades del negocio) → estado.
    const p0 = mono();
    const turn = await processConversationTurn(service, { key: input.key, agentVersion: input.agentVersion, eventId: input.wamid, text: input.text, sentAt: input.sentAt });
    const stateMs = mono() - p0 - understandingMs;
    if (turn.outcome === "rejected") return emit({ outcome: "rejected", sent: false, actions: summary(), errorCode: turn.error.code }, { stateMs, before: before ? stateSnapshot(before.state, before.version) : null });
    if (turn.outcome === "duplicate") return emit({ outcome: "duplicate", status: turn.state.status, sent: false, actions: summary() }, { stateMs, after: stateSnapshot(turn.state, turn.version) });
    const understood = turn.outcome === "processed" ? turn.understanding : undefined;
    const understandingFailed = understood?.ok === false;

    // 2. Acciones que el backend decidió (acotadas por turno). Si el mensaje NO se pudo interpretar, no se ejecuta
    //    NADA en este turno: el estado se conservó y la respuesta lo dice.
    let current: TurnView = turn;
    const a1 = mono();
    for (let i = 0; i < maxActions && current.actionRequest && !understandingFailed; i++) {
      const next = await drive(input.key, input.agentVersion, current, input.text, results, actionTraces);
      if (!next) break;
      current = next;
    }
    actionsMs += mono() - a1;
    const base = {
      stateMs,
      understanding: understandingTrace(understood),
      before: turn.outcome === "processed" ? (turn.stateBefore ?? null) : null,
      after: stateSnapshot(current.state, current.version),
      planIntent: current.responsePlan.intent,
    };

    if (turn.outcome === "human_control" && current.responsePlan.intent === "NO_RESPONSE") {
      return emit({ outcome: "human_control", status: current.state.status, sent: false, actions: summary() }, base);
    }

    // 3. Plan → texto (determinista; hechos solo del backend) → WhatsApp.
    const r0 = mono();
    const text = renderResponse({
      plan: current.responsePlan,
      state: current.state,
      actions: results,
      businessName: deps.artifact.identity.name,
      questions: deps.artifact.questions,
      handoffMessage: deps.artifact.handoff.message,
      noAnswerMessage: deps.artifact.knowledge.noAnswerMessage,
      offerHandoff: deps.artifact.policies.offerHandoff,
      handoffAvailable: deps.artifact.requirements.handoff.supported,
      ...(understandingFailed ? { understandingFailed: true } : {}),
      ...(deps.simulation ? { simulation: true } : {}),
    });
    let sent = false;
    if (text) {
      await deps.send(text);
      sent = true;
    }
    return emit(
      { outcome: turn.outcome === "human_control" ? "human_control" : "processed", status: current.state.status, sent, actions: summary(), ...(understandingFailed && understood && !understood.ok ? { errorCode: understood.code } : {}) },
      { ...base, text, responseMs: mono() - r0 },
    );
  }

  return { handle };
}

export type ConversationRuntime = ReturnType<typeof createConversationRuntime>;
