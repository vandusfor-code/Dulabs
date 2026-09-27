// DuLabs Business — Business Agent 2.0, FASE 4 — runtime conversacional (state machine + Action Engine).
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

import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { WELL_KNOWN_FIELDS } from "@/lib/customer-data";
import { CUSTOMER_FIELD_TO_UNIVERSAL_SLOT } from "@/lib/agent-compiler/understanding/slots";
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
import type { FlowDefinition } from "@/lib/flow/types";

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

/** Configuración estática que el compilador embebió en el flow publicado, por acción (primer nodo con ese actionType). */
export function businessConfigFromFlow(flow: FlowDefinition | undefined): (action: string) => Record<string, unknown> | null {
  const byAction = new Map<string, Record<string, unknown>>();
  for (const node of flow?.nodes ?? []) {
    if (node.type !== "action") continue;
    const config = node.config as unknown as Record<string, unknown> & { actionType?: string };
    if (typeof config.actionType === "string" && !byAction.has(config.actionType)) byAction.set(config.actionType, config);
  }
  return (action) => byAction.get(action) ?? null;
}

/** Preguntas configuradas por el negocio para cada dato del cliente (Spec), por nombre de slot. */
export function questionsFromSpec(spec: Pick<BusinessAgentSpec, "customerData">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of spec.customerData?.fields ?? []) {
    if (!f.enabled) continue;
    const q = f.question?.trim() || WELL_KNOWN_FIELDS[f.key]?.question;
    if (q) out[CUSTOMER_FIELD_TO_UNIVERSAL_SLOT[f.key] ?? f.key] = q;
  }
  return out;
}

export interface ConversationRuntimeDeps {
  service: ConversationServiceDeps;
  engine: ActionEngine;
  spec: Pick<BusinessAgentSpec, "capabilities" | "scheduling" | "identity" | "handoff" | "customerData">;
  businessConfig(action: string): Record<string, unknown> | null;
  send(text: string): Promise<void>;
  maxActionsPerTurn?: number;
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
  actions: Array<{ action: string; status: string; errorCode: string | null; replayed: boolean }>;
  errorCode?: string;
}

export function createConversationRuntime(deps: ConversationRuntimeDeps) {
  const maxActions = deps.maxActionsPerTurn ?? MAX_ACTIONS_PER_TURN;

  /** Ejecuta la acción pendiente de la vista y aplica su resultado al estado. Devuelve la vista nueva. */
  async function drive(key: ConversationStateKey, agentVersion: string | null, view: TurnView, userMessage: string, results: ActionResult[]): Promise<TurnView | null> {
    const request = view.actionRequest ?? view.state.pendingAction;
    if (!request) return null;
    const result = await deps.engine.execute(
      request,
      {
        tenantId: key.tenantId,
        agentId: key.agentId,
        agentVersion,
        conversation: { phoneNumberId: key.phoneNumberId, telefonoCliente: key.telefonoCliente },
        spec: deps.spec,
        requirements: deps.service.requirements,
        state: view.state,
        businessConfig: deps.businessConfig,
        userMessage,
      },
      {
        beforeExecute: async (executionId, attempt) => {
          const started = await applySystemEvent(deps.service, key, { type: "ACTION_STARTED", eventId: `${request.id}:started:${attempt}`, at: new Date().toISOString(), actionId: request.id });
          return started.outcome === "processed" || started.outcome === "duplicate";
        },
      },
    );
    results.push(result);
    // Otra ejecución está en curso (otro worker): no se toca el estado; ese worker aplicará el resultado.
    if (result.status === "IN_PROGRESS") return null;
    const eventId = `${request.id}:result:${result.executionId ?? "rejected"}:${result.attempt}`;
    const applied =
      result.status === "SUCCEEDED"
        ? await applySystemEvent(deps.service, key, { type: "ACTION_SUCCEEDED", eventId, at: new Date().toISOString(), actionId: request.id })
        : await applySystemEvent(deps.service, key, { type: "ACTION_FAILED", eventId, at: new Date().toISOString(), actionId: request.id, category: stateCategoryFor(result.error!), invalidSlots: result.invalidSlots, ambiguous: result.error!.ambiguous });
    if (applied.outcome === "processed" || applied.outcome === "duplicate") return applied;
    // La solicitud ya no era la vigente (p. ej. STALE): se relee el estado actual.
    return loadTurnView(deps.service, key);
  }

  async function handle(input: ConversationTurnInput): Promise<ConversationRuntimeOutcome> {
    const results: ActionResult[] = [];
    const summary = () => results.map((r) => ({ action: r.action, status: r.status, errorCode: r.error?.code ?? null, replayed: r.replayed }));

    // 0. Acción pendiente de un turno anterior (reintento / worker caído): se resuelve primero.
    const before = await loadTurnView(deps.service, input.key);
    if (before?.state.pendingAction && (before.state.status === "READY_FOR_ACTION" || before.state.status === "EXECUTING")) {
      await drive(input.key, input.agentVersion, before, input.text, results);
    }

    // 1. Mensaje → entendimiento → estado.
    const turn = await processConversationTurn(deps.service, { key: input.key, agentVersion: input.agentVersion, eventId: input.wamid, text: input.text, sentAt: input.sentAt });
    if (turn.outcome === "rejected") return { outcome: "rejected", sent: false, actions: summary(), errorCode: turn.error.code };
    if (turn.outcome === "duplicate") return { outcome: "duplicate", status: turn.state.status, sent: false, actions: summary() };

    // 2. Acciones que el backend decidió (acotadas por turno).
    let current: TurnView = turn;
    for (let i = 0; i < maxActions && current.actionRequest; i++) {
      const next = await drive(input.key, input.agentVersion, current, input.text, results);
      if (!next) break;
      current = next;
    }

    if (turn.outcome === "human_control" && current.responsePlan.intent === "NO_RESPONSE") {
      return { outcome: "human_control", status: current.state.status, sent: false, actions: summary() };
    }

    // 3. Plan → texto (determinista) → WhatsApp.
    const text = renderResponse({
      plan: current.responsePlan,
      state: current.state,
      actions: results,
      businessName: deps.spec.identity.businessName,
      questions: questionsFromSpec(deps.spec),
    });
    let sent = false;
    if (text) {
      await deps.send(text);
      sent = true;
    }
    return { outcome: turn.outcome === "human_control" ? "human_control" : "processed", status: current.state.status, sent, actions: summary() };
  }

  return { handle };
}

export type ConversationRuntime = ReturnType<typeof createConversationRuntime>;
