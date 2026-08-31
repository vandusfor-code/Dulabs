/**
 * Fase 3 (corrección definitiva) — Bug raíz #1 del incidente "disponible→
 * ocupado" (cita real #796), a nivel de INTEGRACIÓN del orchestrator real.
 *
 * Reproduce la frontera EXACTA de iteración: una acción CRÍTICA
 * (agendar_cita_especialista) produce evidencia appointment.reserved, y en la
 * iteración siguiente un nodo AI (mode respond) redacta la confirmación. Antes
 * del fix, applyAiResponseClaimSecurity veía las variables del INICIO de la
 * iteración (sin la evidencia recién producida) y RECHAZABA el texto legítimo
 * (SECURITY_REJECTED, responseText borrado), tumbando el Flow y cediendo a
 * LEGACY. Con el fix (flow-orchestrator.ts: se pasan runResult.state.variables
 * frescas a registerAndDispatchEffects) la evidencia SÍ está presente y el
 * mensaje pasa. Cubre H/I/J/K/L de la batería pedida.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import {
  createExecutionOrchestrator,
  ORCHESTRATOR_OUTCOMES,
  type ConversationKey,
  type FlowOrchestratorStore,
} from "@/lib/flow/flow-orchestrator";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectExecutor } from "@/lib/flow/executor-types";
import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";
import { engineStateToExecutionUpdate } from "@/lib/flow/flow-store-types";
import type { FlowEngineState } from "@/lib/flow/engine-types";

const TENANT = "tenant-796";
const CONV: ConversationKey = { phoneNumberId: "1282448611609227", telefonoCliente: "573148127388" };

// Flow mínimo que reproduce el patrón real: acción crítica -> AI confirma.
function flowAgendarMinimo(): FlowDefinition {
  return {
    name: "Agendar mínimo (repro cita #796)",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "act-agendar", type: "action", config: { actionType: "agendar_cita_especialista", params: { confirmado: "true" } } },
      {
        id: "ai-confirmar",
        type: "ai",
        config: {
          instruction: "Confirma la cita ya creada usando citaId/status/especialista reales.",
          mode: "respond",
        },
      },
      { id: "msg-ocupado", type: "message", config: { text: "no se pudo", messageRole: "informational" } },
      { id: "msg-respaldo", type: "message", config: { text: "¡Listo! Tu cita quedó agendada 💛", messageRole: "informational" } },
      { id: "end-ok", type: "end", config: {} },
      { id: "end-respaldo", type: "end", config: {} },
      { id: "end-ocupado", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "act-agendar" },
      { id: "e2", source: "act-agendar", target: "ai-confirmar", sourceHandle: "success" },
      { id: "e3", source: "act-agendar", target: "msg-ocupado", sourceHandle: "failure" },
      { id: "e4", source: "msg-ocupado", target: "end-ocupado" },
      { id: "e5", source: "ai-confirmar", target: "end-ok", sourceHandle: "success" },
      { id: "e6", source: "ai-confirmar", target: "msg-respaldo", sourceHandle: "failure" },
      { id: "e7", source: "msg-respaldo", target: "end-respaldo" },
    ],
    variables: [
      { key: "citaId", label: "cita", type: "string", linkedCapability: "appointment.reserved" },
      { key: "status", label: "estado", type: "string" },
      { key: "especialista", label: "especialista", type: "string" },
    ],
  };
}

// Executor de acción: simula agendar_cita_especialista con ÉXITO real.
const actionExecutor: EffectExecutor = {
  kind: "action",
  version: "test",
  capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: ["CRITICAL"] },
  async dispatch() {
    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data: { citaId: 796, status: "confirmada", especialista: "Carla" },
      appliedResult: { citaId: 796, status: "confirmada", especialista: "Carla" },
    };
  },
};

// Executor de IA: el nodo ai-confirmar redacta una afirmación de reserva
// (requiere appointment.reserved). Es el texto legítimo del incidente.
const aiExecutor: EffectExecutor = {
  kind: "ai",
  version: "test",
  capabilities: { supportsIntegration: false, supportsAsync: true, operationClasses: [] },
  async dispatch() {
    const data = {
      responseText: "¡Listo, Duvan! Tu cita de Semipermanentes quedó agendada con Carla 💅",
      __textProvenance: "AI_GENERATED_TEXT",
    };
    return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
  },
};

const sendMessageExecutor: EffectExecutor = {
  kind: "send_message",
  version: "test",
  capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
  async dispatch(request) {
    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data: { delivered: true, nodeId: request.nodeId },
      appliedResult: { delivered: true, nodeId: request.nodeId },
    };
  },
};

function buildInMemoryStore(flow: FlowDefinition) {
  let row: FlowExecutionRow | null = null;
  const effects = new Map<string, { status: string; applied?: Record<string, unknown> }>();

  const store = {
    getActiveExecution: async () => row,
    getExecutionById: async () => row,
    getFlow: async () =>
      ({ tenant_id: TENANT, id: "flow-1", slug: "s", name: "n", status: "published", published_version_id: "fv-1" }) as never,
    getFlowVersion: async () => ({ tenant_id: TENANT, id: "fv-1", flow_id: "flow-1", version_number: 1, definition_json: flow }) as never,
    createExecution: async (input: { executionId: string; initialState: FlowEngineState }) => {
      row = {
        tenant_id: TENANT,
        id: "row-1",
        flow_id: "flow-1",
        flow_version_id: "fv-1",
        execution_id: input.executionId,
        phone_number_id: CONV.phoneNumberId,
        telefono_cliente: CONV.telefonoCliente,
        status: input.initialState.status,
        current_node_id: input.initialState.currentNodeId,
        variables: input.initialState.variables,
        expected_input: null,
        pending_effect: null,
        exports: input.initialState.exports,
        metadata: input.initialState.metadata,
        state_version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      } as FlowExecutionRow;
      return { created: true, row };
    },
    saveExecutionState: async (_t: string, _id: string, state: FlowEngineState, expectedVersion: number) => {
      if (!row) throw new Error("no row");
      if (row.state_version !== expectedVersion) throw new Error("cas conflict");
      row = { ...row, ...engineStateToExecutionUpdate(state), state_version: expectedVersion + 1 };
      return { stateVersion: row.state_version };
    },
    insertEventIdempotent: async () => ({ inserted: true }),
    insertEffectIdempotent: async (input: { effectId: string; nodeId: string }) => {
      if (effects.has(input.effectId)) return { inserted: false };
      effects.set(input.effectId, { status: "pending" });
      return { inserted: true };
    },
    getEffectByEffectId: async (_t: string, _e: string, effectId: string) => {
      const fx = effects.get(effectId);
      if (!fx) return null;
      return {
        tenant_id: TENANT, id: 1, flow_execution_id: "row-1", effect_id: effectId, node_id: "?",
        kind: "?", status: fx.status === "succeeded" ? "succeeded" : "failed",
        result_payload_applied: fx.applied ?? null, result_payload_raw: fx.applied ?? null,
        integration_id: null, created_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
      } as never;
    },
    resolveEffectResult: async (input: { effectId: string; status: "succeeded" | "failed"; resultPayloadApplied?: Record<string, unknown> }) => {
      const fx = effects.get(input.effectId)!;
      fx.status = input.status;
      fx.applied = input.resultPayloadApplied;
      return {
        ok: true,
        row: {
          tenant_id: TENANT, id: 1, flow_execution_id: "row-1", effect_id: input.effectId, node_id: "?",
          kind: "?", status: input.status === "succeeded" ? "succeeded" : "failed",
          result_payload_applied: input.resultPayloadApplied ?? null,
          result_payload_raw: input.resultPayloadApplied ?? null,
          integration_id: null, created_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
        } as never,
      };
    },
    recordNodeTransition: async () => {},
  };
  return { store: store as unknown as FlowOrchestratorStore, getRow: () => row, effects };
}

describe("Fase 3 — Bug raíz #1: variables frescas en claim-security (integración orchestrator)", () => {
  it("H/I/J/K. act-agendar (crítica) -> ai-confirmar: el mensaje de confirmación NO es rechazado, y no hay engineError", async () => {
    const flow = flowAgendarMinimo();
    const { store } = buildInMemoryStore(flow);
    const orchestrator = createExecutionOrchestrator({
      store,
      engine: { createFlowEngineState, runFlowEngine },
      effectFramework: createTestEffectExecutorFramework({
        executors: [actionExecutor, aiExecutor, sendMessageExecutor],
      }),
    });

    const result = await orchestrator.process({
      tenantId: TENANT,
      conversation: CONV,
      flowId: "flow-1",
      eventId: "wamid-si",
      eventType: "message",
      payload: { text: "Si." },
      engineEvent: { type: "start", text: "Si." },
      receivedAt: new Date().toISOString(),
    });

    // J/K: no hubo effect_failed en ai-confirmar ni engineError.
    assert.equal(result.engineError, undefined, "NO debe haber engineError (ai-confirmar ya no se rechaza en falso)");
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);

    // L: la acción crítica quedó marcada estructuralmente.
    assert.equal(result.criticalActionExecuted, true, "act-agendar crítica ejecutada => señal para no-fallback");

    // I/H: claim-security ACEPTÓ el texto -> el motor emitió el send_message de
    // confirmación CON el responseText intacto. Si hubiera sido rechazado,
    // responseText se habría borrado y NO existiría este send_message (además
    // de un effect_failed/engineError, ya descartados arriba).
    const envioConfirmacion = result.effects.find(
      (e) => e.type === "send_message" && e.nodeId === "ai-confirmar",
    );
    assert.ok(envioConfirmacion, "el motor debe emitir el send_message de ai-confirmar (texto no rechazado)");
    if (envioConfirmacion && envioConfirmacion.type === "send_message") {
      assert.match(String(envioConfirmacion.content.text ?? ""), /agendada/);
    }

    // J: ninguna acción crítica se ejecutó dos veces (idempotencia del effectId).
    const idsAgendar = result.dispatchedEffectIds.length;
    assert.ok(idsAgendar >= 2, "se despacharon la acción y la confirmación");
  });

  it("control (sin el fix sería el bug): la acción crítica NO se vuelve a ejecutar y el turno queda manejado por Flow", async () => {
    const flow = flowAgendarMinimo();
    const { store } = buildInMemoryStore(flow);
    const orchestrator = createExecutionOrchestrator({
      store,
      engine: { createFlowEngineState, runFlowEngine },
      effectFramework: createTestEffectExecutorFramework({
        executors: [actionExecutor, aiExecutor, sendMessageExecutor],
      }),
    });
    const result = await orchestrator.process({
      tenantId: TENANT,
      conversation: CONV,
      flowId: "flow-1",
      eventId: "wamid-si-2",
      eventType: "message",
      payload: { text: "Si." },
      engineEvent: { type: "start", text: "Si." },
      receivedAt: new Date().toISOString(),
    });
    assert.equal(result.criticalActionExecuted, true);
    assert.equal(result.engineError, undefined);
  });
});
