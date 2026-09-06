/**
 * AMORE Fase 1 (autorizado) — resiliencia de ai-generar-respuesta.
 *
 * Reproduce a nivel de integración del orchestrator real el incidente de
 * producción: act-buscar-disponibilidad-nylas consulta Nylas con éxito
 * (appointment.available verificado), pero el nodo "ai" que redacta la
 * respuesta falla (Claim Security rechaza una afirmación de reserva sin
 * evidencia, o un fallo técnico recuperable del executor). Antes del fix,
 * ese único fallo tumbaba el turno completo (engineError) sin ningún
 * reintento -- ver flow-orchestrator.ts: MAX_AI_DISPATCH_ATTEMPTS. Con el
 * fix, se reintenta la MISMA petición (mismo effectId, mismo contexto de
 * variables) hasta 2 veces en total antes de dejar que el turno siga su
 * camino de fallo normal.
 *
 * Verifica explícitamente que el reintento NUNCA vuelve a llamar la acción
 * de Nylas (buscar_disponibilidad_nylas/crear_cita_nylas) ni crea ninguna
 * reserva -- el retry vive enteramente dentro del bloque effect.kind==="ai"
 * de registerAndDispatchEffects, nunca reprocesa efectos de tipo "action".
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
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest, type EffectExecutor } from "@/lib/flow/executor-types";
import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";
import { engineStateToExecutionUpdate } from "@/lib/flow/flow-store-types";
import type { FlowEngineState } from "@/lib/flow/engine-types";

const TENANT = "tenant-amore-retry";
const CONV: ConversationKey = { phoneNumberId: "1282448611609227", telefonoCliente: "573148127388" };

const AGENDAMIENTO_EN_CURSO = {
  servicioId: "svc-dipping",
  servicioNombre: "Dipping",
  fechaISO: "2026-09-11",
  duracionMin: 120,
};

// Reproduce el fragmento relevante de amore-router.flow.ts: acción de
// disponibilidad (real, siempre success:true) -> mismo nodo IA compartido
// -- SIN rama aiFailure (igual que el flow real hoy), para probar el
// comportamiento EXACTO de producción antes/después del fix.
function flowDisponibilidadMinimo(): FlowDefinition {
  return {
    name: "AMORE disponibilidad mínimo (repro retry ai-generar-respuesta)",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "act-buscar-disponibilidad-nylas", type: "action", config: { actionType: "buscar_disponibilidad_nylas" } },
      { id: "ai-generar-respuesta", type: "ai", config: { instruction: "Presenta las opciones reales.", mode: "respond" } },
      { id: "q-turno-ia", type: "question", config: { text: "{{responseText}}", variableKey: "mensajeActual", required: false, validation: { kind: "text" } } },
    ],
    edges: [
      { id: "e1", source: "start", target: "act-buscar-disponibilidad-nylas" },
      { id: "e2", source: "act-buscar-disponibilidad-nylas", target: "ai-generar-respuesta", sourceHandle: "success" },
      { id: "e3", source: "ai-generar-respuesta", target: "q-turno-ia", sourceHandle: "success" },
    ],
    variables: [],
  };
}

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
  return { store: store as unknown as FlowOrchestratorStore, getRow: () => row };
}

// Acción real (siempre success:true, mismo contrato que
// buscarDisponibilidadNylasAction en internal-action-executor.ts): consulta
// "Nylas" y devuelve horarios reales + disponibilidadConsultada:true, que
// buildVerifiedActionEffectData traduce en evidencia appointment.available.
function buildAccionDisponibilidadExecutor(): { executor: EffectExecutor; callCount: () => number } {
  let calls = 0;
  const executor: EffectExecutor = {
    kind: "action",
    version: "test",
    capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: ["CRITICAL"] },
    async dispatch() {
      calls += 1;
      const data = {
        modo: "ai",
        instruccionIA:
          "Presenta con naturalidad las opciones REALES de datosIA (profesional + hora) para que la clienta elija.",
        datosIA: [{ profesional: "Cristal", hora: "15:00" }],
        agendamiento: { ...AGENDAMIENTO_EN_CURSO, opcionesOfrecidas: [{ especialistaId: "e1", especialistaNombre: "Cristal", horaTexto: "15:00" }] },
        disponibilidadConsultada: true,
      };
      return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
    },
  };
  return { executor, callCount: () => calls };
}

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

async function runTurno(flow: FlowDefinition, store: FlowOrchestratorStore, aiExecutor: EffectExecutor, accion: EffectExecutor, eventId = "wamid-1") {
  const orchestrator = createExecutionOrchestrator({
    store,
    engine: { createFlowEngineState, runFlowEngine },
    effectFramework: createTestEffectExecutorFramework({ executors: [accion, aiExecutor, sendMessageExecutor] }),
  });
  return orchestrator.process({
    tenantId: TENANT,
    conversation: CONV,
    flowId: "flow-1",
    eventId,
    eventType: "message",
    payload: { text: "Ok, me gustaría la cita para el día viernes" },
    engineEvent: { type: "start", text: "Ok, me gustaría la cita para el día viernes" },
    receivedAt: new Date().toISOString(),
  });
}

describe("AMORE Fase 1 — retry controlado de ai-generar-respuesta (Claim Security / fallo recuperable)", () => {
  it("1/11. Claim Security bloquea el intento 1 (afirmación de reserva sin evidencia); el reintento honesto pasa y el turno se completa", async () => {
    const flow = flowDisponibilidadMinimo();
    const { store, getRow } = buildInMemoryStore(flow);
    const { executor: accion } = buildAccionDisponibilidadExecutor();

    let calls = 0;
    const aiExecutor: EffectExecutor = {
      kind: "ai",
      version: "test",
      capabilities: { supportsIntegration: false, supportsAsync: true, operationClasses: [] },
      async dispatch() {
        calls += 1;
        // Intento 1: afirma una reserva ya hecha -- appointment.reserved NUNCA
        // fue verificado por esta acción (solo appointment.available), Claim
        // Security debe rechazarlo de verdad (validateTextClaimsAgainstVerified real).
        // Intento 2: redacción honesta (solo presenta opciones) -- debe pasar.
        const responseText =
          calls === 1
            ? "¡Listo! Tu cita quedó reservada y confirmada el viernes a las 3pm con Cristal 💗"
            : "Tengo disponible el viernes a las 3pm con Cristal, ¿te queda bien esa hora?";
        const data = { responseText, __textProvenance: "AI_GENERATED_TEXT" };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      },
    };

    const result = await runTurno(flow, store, aiExecutor, accion);

    assert.equal(calls, 2, "debe haber exactamente 2 intentos de IA (retry controlado)");
    assert.equal(result.engineError, undefined, "el reintento exitoso no debe dejar engineError");
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);

    const envio = result.effects.find((e) => e.type === "send_message" && e.nodeId === "ai-generar-respuesta");
    assert.ok(envio, "debe enviarse el mensaje honesto del reintento");
    if (envio && envio.type === "send_message") {
      assert.match(String(envio.content.text ?? ""), /disponible/i);
      assert.doesNotMatch(String(envio.content.text ?? ""), /confirmad|reservad/i);
    }

    // 8. mismos datosIA/contexto en ambos intentos.
    const agendamiento = getRow()?.variables.agendamiento as { servicioId?: string } | undefined;
    assert.equal(agendamiento?.servicioId, "svc-dipping");
  });

  it("2/3/4/5/6/7. bloqueo NO destruye AgendamientoEnCurso/servicio/fecha/datosIA/opcionesOfrecidas mientras el retry está en curso", async () => {
    const flow = flowDisponibilidadMinimo();
    const { store, getRow } = buildInMemoryStore(flow);
    const { executor: accion } = buildAccionDisponibilidadExecutor();

    const aiExecutor: EffectExecutor = {
      kind: "ai",
      version: "test",
      capabilities: { supportsIntegration: false, supportsAsync: true, operationClasses: [] },
      async dispatch(request: EffectDispatchRequest) {
        // Verifica que el contexto (variables) es EXACTAMENTE el mismo en
        // cada intento -- nunca se pierde ni se recalcula.
        const ctx = request.payload as Record<string, unknown>;
        assert.equal((ctx.agendamiento as { servicioId?: string } | undefined)?.servicioId, "svc-dipping");
        const responseText =
          request.attempt === 1
            ? "Tu cita ya quedó agendada y confirmada 💗"
            : "Tengo disponible el viernes a las 3pm con Cristal, ¿te sirve?";
        const data = { responseText, __textProvenance: "AI_GENERATED_TEXT" };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      },
    };

    const result = await runTurno(flow, store, aiExecutor, accion);
    assert.equal(result.engineError, undefined);

    const row = getRow();
    assert.ok(row, "la fila de ejecución debe existir");
    const agendamiento = row!.variables.agendamiento as Record<string, unknown> | undefined;
    assert.equal(agendamiento?.servicioId, "svc-dipping", "servicio debe permanecer");
    assert.equal(agendamiento?.fechaISO, "2026-09-11", "fecha debe permanecer");
    assert.ok(Array.isArray(row!.variables.datosIA) && (row!.variables.datosIA as unknown[]).length > 0, "datosIA debe permanecer");
    assert.ok(
      Array.isArray((agendamiento as { opcionesOfrecidas?: unknown[] })?.opcionesOfrecidas),
      "opcionesOfrecidas debe permanecer",
    );
  });

  it("9/10. el reintento de ai-generar-respuesta NUNCA vuelve a llamar buscar_disponibilidad_nylas ni crea ninguna reserva", async () => {
    const flow = flowDisponibilidadMinimo();
    const { store } = buildInMemoryStore(flow);
    const { executor: accion, callCount } = buildAccionDisponibilidadExecutor();

    let aiCalls = 0;
    const aiExecutor: EffectExecutor = {
      kind: "ai",
      version: "test",
      capabilities: { supportsIntegration: false, supportsAsync: true, operationClasses: [] },
      async dispatch() {
        aiCalls += 1;
        const responseText = aiCalls === 1 ? "Tu cita quedó confirmada 💗" : "Tengo disponible el viernes a las 3pm, ¿te sirve?";
        const data = { responseText, __textProvenance: "AI_GENERATED_TEXT" };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      },
    };

    await runTurno(flow, store, aiExecutor, accion);

    assert.equal(aiCalls, 2, "2 intentos de IA");
    assert.equal(callCount(), 1, "buscar_disponibilidad_nylas debe llamarse UNA sola vez, nunca por el retry de IA");
  });

  it("12. si ambos intentos de IA fallan, se agota el retry (2) sin persistir el turno roto -- el contexto de la ÚLTIMA fila guardada permanece intacto", async () => {
    const flow = flowDisponibilidadMinimo();
    const { store, getRow } = buildInMemoryStore(flow);
    const { executor: accion } = buildAccionDisponibilidadExecutor();

    let aiCalls = 0;
    const aiExecutor: EffectExecutor = {
      kind: "ai",
      version: "test",
      capabilities: { supportsIntegration: false, supportsAsync: true, operationClasses: [] },
      async dispatch() {
        aiCalls += 1;
        // Ambos intentos afirman una reserva sin evidencia -- ninguno pasa.
        const data = { responseText: "Tu cita ya quedó reservada y confirmada 💗", __textProvenance: "AI_GENERATED_TEXT" };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      },
    };

    const result = await runTurno(flow, store, aiExecutor, accion);

    assert.equal(aiCalls, 2, "se agotan los 2 intentos configurados (MAX_AI_DISPATCH_ATTEMPTS)");
    assert.ok(result.engineError, "tras agotar el retry, el turno sigue el camino de fallo normal (sin rama aiFailure, engineError)");
    // El mensaje genérico del engine ("effect_failed") es preexistente y no
    // depende de este fix -- el motivo real (unverified_external_claim:...)
    // queda en dulabs_flow_effects.result_payload_raw.error (ver
    // deriveDispatchResult), no en este engineError de alto nivel.
    assert.equal(result.engineError!.message, "effect_failed");

    // El contexto de agendamiento sigue en la ÚLTIMA fila realmente guardada
    // (la del paso de disponibilidad, anterior al fallo de IA) -- el
    // orchestrator NUNCA persiste el estado de una iteración con error.
    const row = getRow();
    const agendamiento = row!.variables.agendamiento as Record<string, unknown> | undefined;
    assert.equal(agendamiento?.servicioId, "svc-dipping", "el contexto no se pierde aunque el retry se agote");
  });
});
