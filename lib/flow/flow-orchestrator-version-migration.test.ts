/**
 * Fix #1 (autorizado, diagnóstico forense AMORE 2026-09-07) — una ejecución
 * activa queda anclada al flow_version_id con el que fue creada
 * (dulabs_flow_executions.flow_version_id "fijado al crear, nunca migra
 * automáticamente"). Si mientras la ejecución sigue activa se publica una
 * versión nueva del Flow, esa ejecución seguía corriendo la versión VIEJA
 * indefinidamente -- confirmado con evidencia real de producción: la rama
 * aiFailure publicada como v10 nunca llegó a aplicarse porque la ejecución
 * real seguía anclada a v9.
 *
 * Estos tests verifican, contra el ExecutionOrchestrator real (sin mocks de
 * la lógica de versionado, solo del Store/executors), que:
 * - Caso A: si la versión de la ejecución coincide con la publicada, el
 *   comportamiento es IDÉNTICO al de siempre (misma fila, sin cierre).
 * - Caso B: si no coincide, la ejecución vieja se cierra, se crea una
 *   ejecución nueva sobre la versión publicada actual, el `variables` real
 *   (incluido AgendamientoEnCurso) se conserva, solo se envía UNA
 *   respuesta, y el mismo wamid reenviado no vuelve a procesarse.
 * - Caso C: una ejecución vieja SIN AgendamientoEnCurso migra igual, sin
 *   errores.
 * - Caso D: el contexto acumulado a través de VARIOS turnos previos no se
 *   pierde al migrar.
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
import type { FlowExecutionRow, FlowVersionRow } from "@/lib/flow/flow-store-types";
import { engineStateToExecutionUpdate } from "@/lib/flow/flow-store-types";
import type { FlowEngineState } from "@/lib/flow/engine-types";

const TENANT = "tenant-migracion";
const CONV: ConversationKey = { phoneNumberId: "whatsapp-qr:tenant-migracion", telefonoCliente: "573148127388" };
const FLOW_ID = "flow-1";

/** Grafo mínimo: start -> act-resolver -> q-turno -> (loop) act-resolver. */
function testFlow(): FlowDefinition {
  return {
    name: "Test flow versionado",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "act-resolver", type: "action", config: { actionType: "resolver_escenario" } },
      { id: "q-turno", type: "question", config: { text: "{{respuestaTexto}}", variableKey: "mensajeActual", required: false, validation: { kind: "text" } } },
    ],
    edges: [
      { id: "e1", source: "start", target: "act-resolver" },
      { id: "e2", source: "act-resolver", target: "q-turno", sourceHandle: "success" },
      { id: "e3", source: "q-turno", target: "act-resolver" },
    ],
    variables: [],
  };
}

/**
 * Grafo con reserva (Caso H): igual al mínimo, pero con una condición
 * sobre `modo` que decide si pasa por act-crear-cita -- para poder probar
 * que la migración, por sí sola, nunca dispara esa acción.
 */
function testFlowConReserva(): FlowDefinition {
  return {
    name: "Test flow con reserva (Caso H)",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "act-resolver", type: "action", config: { actionType: "resolver_escenario" } },
      { id: "cond-reservar", type: "condition", config: { rules: [{ field: "modo", operator: "equals", value: "reservar" }], match: "all" } },
      { id: "act-crear-cita", type: "action", config: { actionType: "crear_cita_nylas" } },
      { id: "q-turno", type: "question", config: { text: "{{respuestaTexto}}", variableKey: "mensajeActual", required: false, validation: { kind: "text" } } },
    ],
    edges: [
      { id: "e1", source: "start", target: "act-resolver" },
      { id: "e2", source: "act-resolver", target: "cond-reservar", sourceHandle: "success" },
      { id: "e3", source: "cond-reservar", target: "act-crear-cita", sourceHandle: "true" },
      { id: "e4", source: "cond-reservar", target: "q-turno", sourceHandle: "false" },
      { id: "e5", source: "act-crear-cita", target: "q-turno", sourceHandle: "success" },
      { id: "e6", source: "q-turno", target: "act-resolver" },
    ],
    variables: [],
  };
}

function buildStore(flowFactory: () => FlowDefinition = testFlow): {
  store: FlowOrchestratorStore;
  getRow: () => FlowExecutionRow | null;
  getClosedRow: (id: string) => FlowExecutionRow | undefined;
  setPublishedVersion: (versionId: string) => void;
  addVersion: (versionId: string) => void;
} {
  let row: FlowExecutionRow | null = null;
  let publishedVersionId = "v-old";
  const versions = new Map<string, FlowVersionRow>();
  versions.set("v-old", { tenant_id: TENANT, id: "v-old", flow_id: FLOW_ID, version_number: 1, definition_json: flowFactory() } as never);
  const closedRows = new Map<string, FlowExecutionRow>();
  const events = new Set<string>();
  const effects = new Map<string, { status: string; applied?: Record<string, unknown> }>();

  const store: FlowOrchestratorStore = {
    getActiveExecution: async () => (row && row.status !== "failed" && row.status !== "completed" ? row : null),
    getExecutionById: async () => row,
    getFlow: async () => ({ tenant_id: TENANT, id: FLOW_ID, slug: "s", name: "n", status: "published", published_version_id: publishedVersionId }) as never,
    getFlowVersion: async (_t: string, versionId: string) => versions.get(versionId) ?? null,
    createExecution: async (input: { executionId: string; initialState: FlowEngineState }) => {
      row = {
        tenant_id: TENANT,
        id: `row-${input.executionId}`,
        flow_id: FLOW_ID,
        flow_version_id: input.initialState.flowVersionId!,
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
    saveExecutionState: async (_t: string, id: string, state: FlowEngineState, expectedVersion: number) => {
      if (!row || row.id !== id) throw new Error("no row");
      if (row.state_version !== expectedVersion) throw new Error("cas conflict");
      row = { ...row, ...engineStateToExecutionUpdate(state), state_version: expectedVersion + 1 };
      if (row.status === "failed") closedRows.set(row.id, row);
      return { stateVersion: row.state_version };
    },
    insertEventIdempotent: async (input: { eventId: string; flowExecutionId: string }) => {
      const key = `${input.flowExecutionId}:${input.eventId}`;
      if (events.has(key)) return { inserted: false, row: null };
      events.add(key);
      return { inserted: true, row: null };
    },
    insertEffectIdempotent: async (input: { effectId: string; nodeId: string }) => {
      if (effects.has(input.effectId)) return { inserted: false, row: null };
      effects.set(input.effectId, { status: "pending" });
      return { inserted: true, row: null };
    },
    getEffectByEffectId: async (_t: string, _e: string, effectId: string) => {
      const fx = effects.get(effectId);
      if (!fx) return null;
      return {
        tenant_id: TENANT, id: 1, flow_execution_id: row?.id ?? "?", effect_id: effectId, node_id: "?",
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
        alreadyResolved: false,
        row: {
          tenant_id: TENANT, id: 1, flow_execution_id: row?.id ?? "?", effect_id: input.effectId, node_id: "?",
          kind: "?", status: input.status === "succeeded" ? "succeeded" : "failed",
          result_payload_applied: input.resultPayloadApplied ?? null,
          result_payload_raw: input.resultPayloadApplied ?? null,
          integration_id: null, created_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
        } as never,
      };
    },
    recordNodeTransition: async () => {},
  };

  return {
    store,
    getRow: () => row,
    getClosedRow: (id: string) => closedRows.get(id),
    setPublishedVersion: (versionId: string) => {
      publishedVersionId = versionId;
    },
    addVersion: (versionId: string) => {
      versions.set(versionId, { tenant_id: TENANT, id: versionId, flow_id: FLOW_ID, version_number: 2, definition_json: flowFactory() } as never);
    },
  };
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

/** Resolver simulado: acumula `agendamiento.paso` en cada turno y ecoa el mensaje actual recibido, para probar qué contexto ve realmente. */
function buildResolverExecutor(): { executor: EffectExecutor; callCount: () => number } {
  let calls = 0;
  const executor: EffectExecutor = {
    kind: "action",
    version: "test",
    capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
    async dispatch(request: EffectDispatchRequest) {
      calls += 1;
      const agendamientoPrevio = (request.payload.agendamiento as { paso?: number; servicioId?: string } | undefined) ?? undefined;
      const mensajeActual = (request.payload.mensajeActual as string | undefined) ?? "(sin mensajeActual)";
      const nuevoPaso = (agendamientoPrevio?.paso ?? 0) + 1;
      const data = {
        agendamiento: { servicioId: agendamientoPrevio?.servicioId ?? "dipping", paso: nuevoPaso },
        respuestaTexto: `paso=${nuevoPaso} previo=${agendamientoPrevio?.paso ?? "ninguno"} mensaje=${mensajeActual}`,
      };
      return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
    },
  };
  return { executor, callCount: () => calls };
}

function buildOrchestrator(store: FlowOrchestratorStore, ...executors: EffectExecutor[]) {
  return createExecutionOrchestrator({
    store,
    engine: { createFlowEngineState, runFlowEngine },
    effectFramework: createTestEffectExecutorFramework({ executors: [...executors, sendMessageExecutor] }),
  });
}

/**
 * Executor combinado de "action" para Casos H/F -- el registry real
 * (executor-registry.ts) resuelve UN SOLO executor por `kind`, así que
 * "resolver_escenario" y "crear_cita_nylas" (ambos kind:"action" en el
 * grafo real) tienen que despacharse desde AQUÍ según
 * request.action?.actionType, igual que un registry real distinguiría por
 * tipo de acción -- nunca dos executors separados con el mismo kind.
 * Si agendamiento.completado ya es true, el resolver simulado NUNCA pide
 * reservar de nuevo (mismo criterio que se espera de resolver.ts real: una
 * reserva ya hecha no vuelve a confirmarse).
 */
function buildResolverConReservaExecutor(): { executor: EffectExecutor; crearCitaCallCount: () => number } {
  let crearCitaCalls = 0;
  const executor: EffectExecutor = {
    kind: "action",
    version: "test",
    capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: ["CRITICAL"] },
    async dispatch(request: EffectDispatchRequest) {
      if (request.action?.actionType === "crear_cita_nylas") {
        crearCitaCalls += 1;
        const data = { citaId: `cita-${crearCitaCalls}` };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      }
      const agendamientoPrevio = (request.payload.agendamiento as { completado?: boolean; paso?: number } | undefined) ?? undefined;
      const yaCompletado = agendamientoPrevio?.completado === true;
      const data = {
        modo: yaCompletado ? "no_reservar" : "reservar",
        agendamiento: { ...agendamientoPrevio, paso: (agendamientoPrevio?.paso ?? 0) + 1 },
        respuestaTexto: yaCompletado ? "Esa cita ya está confirmada 💗" : "Vamos a reservar",
      };
      return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
    },
  };
  return { executor, crearCitaCallCount: () => crearCitaCalls };
}

function turnoEvent(texto: string, eventId: string, tipo: "start" | "text" = "text") {
  return {
    tenantId: TENANT,
    conversation: CONV,
    flowId: FLOW_ID,
    eventId,
    eventType: "message",
    payload: { text: texto },
    engineEvent: tipo === "start" ? ({ type: "start", text: texto } as const) : ({ type: "text", text: texto } as const),
    receivedAt: new Date().toISOString(),
  };
}

function buttonEvent(buttonId: string, eventId: string) {
  return {
    tenantId: TENANT,
    conversation: CONV,
    flowId: FLOW_ID,
    eventId,
    eventType: "button",
    payload: { buttonId },
    engineEvent: { type: "button", id: buttonId } as const,
    receivedAt: new Date().toISOString(),
  };
}

/**
 * Store con ejecuciones reales indexadas por id (Map), para probar
 * concurrencia genuina (Casos E/F, Ajuste 3) -- a diferencia de buildStore()
 * (una sola fila "actual" a la vez, suficiente para los casos secuenciales
 * de arriba), este SÍ modela que una fila vieja cerrada y una fila nueva
 * activa pueden coexistir simultáneamente, y reproduce la MISMA restricción
 * real que ya usa createExecution en producción (isActiveConversationConflict,
 * lib/flow/flow-store.ts): solo puede existir UNA ejecución activa a la vez
 * por conversación -- un segundo intento de crear otra mientras ya hay una
 * activa se rechaza con {created:false, existing}, igual que el conflicto
 * real de Postgres.
 */
function buildConcurrentStore(flowFactory: () => FlowDefinition = testFlow): {
  store: FlowOrchestratorStore;
  rows: Map<string, FlowExecutionRow>;
  setPublishedVersion: (versionId: string) => void;
  addVersion: (versionId: string) => void;
} {
  const rows = new Map<string, FlowExecutionRow>();
  let publishedVersionId = "v-old";
  const versions = new Map<string, FlowVersionRow>();
  versions.set("v-old", { tenant_id: TENANT, id: "v-old", flow_id: FLOW_ID, version_number: 1, definition_json: flowFactory() } as never);
  const events = new Set<string>();
  const effects = new Map<string, { status: string; applied?: Record<string, unknown> }>();
  let seq = 0;

  const activaNoTerminal = () =>
    [...rows.values()].find((r) => r.status !== "failed" && r.status !== "completed" && r.status !== "transferred");

  const store: FlowOrchestratorStore = {
    getActiveExecution: async () => activaNoTerminal() ?? null,
    getExecutionById: async (_t: string, id: string) => rows.get(id) ?? null,
    getFlow: async () => ({ tenant_id: TENANT, id: FLOW_ID, slug: "s", name: "n", status: "published", published_version_id: publishedVersionId }) as never,
    getFlowVersion: async (_t: string, versionId: string) => versions.get(versionId) ?? null,
    createExecution: async (input: { executionId: string; initialState: FlowEngineState }) => {
      // Delay deliberado -- fuerza que dos createExecution concurrentes
      // realmente se entrelacen (igual que el setTimeout de
      // insertEventIdempotent en el test 23 "adversarial" de
      // flow-orchestrator.test.ts), en vez de resolverse en el mismo tick.
      await new Promise((r) => setTimeout(r, 3));
      const yaActiva = activaNoTerminal();
      if (yaActiva) {
        // Mismo conflicto real que isActiveConversationConflict: ya existe
        // una ejecución activa para esta conversación -- se adopta esa,
        // nunca se crea una segunda.
        return { created: false, reason: "active_execution_exists", existing: yaActiva };
      }
      seq += 1;
      const row: FlowExecutionRow = {
        tenant_id: TENANT,
        id: `row-${seq}-${input.executionId}`,
        flow_id: FLOW_ID,
        flow_version_id: input.initialState.flowVersionId!,
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
      rows.set(row.id, row);
      return { created: true, row };
    },
    saveExecutionState: async (_t: string, id: string, state: FlowEngineState, expectedVersion: number) => {
      const current = rows.get(id);
      if (!current) throw new Error("no row");
      if (current.state_version !== expectedVersion) throw new Error("cas conflict");
      const updated = { ...current, ...engineStateToExecutionUpdate(state), state_version: expectedVersion + 1 };
      rows.set(id, updated);
      return { stateVersion: updated.state_version };
    },
    insertEventIdempotent: async (input: { eventId: string; flowExecutionId: string }) => {
      const key = `${input.flowExecutionId}:${input.eventId}`;
      if (events.has(key)) return { inserted: false, row: null };
      events.add(key);
      return { inserted: true, row: null };
    },
    insertEffectIdempotent: async (input: { effectId: string; nodeId: string }) => {
      if (effects.has(input.effectId)) return { inserted: false, row: null };
      effects.set(input.effectId, { status: "pending" });
      return { inserted: true, row: null };
    },
    getEffectByEffectId: async (_t: string, _e: string, effectId: string) => {
      const fx = effects.get(effectId);
      if (!fx) return null;
      return {
        tenant_id: TENANT, id: 1, flow_execution_id: "?", effect_id: effectId, node_id: "?",
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
        alreadyResolved: false,
        row: {
          tenant_id: TENANT, id: 1, flow_execution_id: "?", effect_id: input.effectId, node_id: "?",
          kind: "?", status: input.status === "succeeded" ? "succeeded" : "failed",
          result_payload_applied: input.resultPayloadApplied ?? null,
          result_payload_raw: input.resultPayloadApplied ?? null,
          integration_id: null, created_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
        } as never,
      };
    },
    recordNodeTransition: async () => {},
  };

  return {
    store,
    rows,
    setPublishedVersion: (versionId: string) => {
      publishedVersionId = versionId;
    },
    addVersion: (versionId: string) => {
      versions.set(versionId, { tenant_id: TENANT, id: versionId, flow_id: FLOW_ID, version_number: 2, definition_json: flowFactory() } as never);
    },
  };
}

describe("Fix #1 — migración de ejecuciones ancladas a un Flow viejo", () => {
  it("Caso A: execution.flow_version_id === published — comportamiento intacto (misma fila, sin cierre)", async () => {
    const s = buildStore();
    const { executor: resolver } = buildResolverExecutor();
    const orch = buildOrchestrator(s.store, resolver);

    const r1 = await orch.process(turnoEvent("inicia", "wamid-1", "start"));
    assert.equal(r1.engineError, undefined);
    const rowIdDespuesDeTurno1 = s.getRow()!.id;

    // Sin publicar nada nuevo -- la versión publicada sigue siendo v-old.
    const r2 = await orch.process(turnoEvent("sigue", "wamid-2"));
    assert.equal(r2.engineError, undefined);
    assert.equal(s.getRow()!.id, rowIdDespuesDeTurno1, "debe seguir siendo la MISMA fila, sin migración");
    assert.equal(s.getRow()!.flow_version_id, "v-old");
  });

  it("Caso B: execution.flow_version_id !== published — cierra la vieja, crea una nueva, conserva variables/AgendamientoEnCurso, UNA sola respuesta, mismo wamid no se reprocesa", async () => {
    const s = buildStore();
    const { executor: resolver } = buildResolverExecutor();
    const orch = buildOrchestrator(s.store, resolver);

    const r1 = await orch.process(turnoEvent("inicia", "wamid-1", "start"));
    assert.equal(r1.engineError, undefined);
    const rowVieja = s.getRow()!;
    assert.equal(rowVieja.flow_version_id, "v-old");
    assert.equal((rowVieja.variables.agendamiento as { paso?: number }).paso, 1);

    // Se publica v-new MIENTRAS la ejecución sigue activa (waiting_input).
    s.addVersion("v-new");
    s.setPublishedVersion("v-new");

    const r2 = await orch.process(turnoEvent("Si de acuerdo", "wamid-2"));
    assert.equal(r2.engineError, undefined, "no debe fallar");
    assert.equal(r2.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);

    const rowNueva = s.getRow()!;
    assert.notEqual(rowNueva.id, rowVieja.id, "debe ser una ejecución NUEVA (fila distinta)");
    assert.equal(rowNueva.flow_version_id, "v-new", "debe correr sobre la versión publicada actual");

    // La vieja quedó cerrada (failed), nunca borrada.
    const vieja = s.getClosedRow(rowVieja.id);
    assert.equal(vieja?.status, "failed");

    // AgendamientoEnCurso/variables se conservan -- el resolver de la
    // ejecución NUEVA vio paso=1 (el de la vieja), no arrancó en 0.
    assert.equal((rowNueva.variables.agendamiento as { servicioId?: string }).servicioId, "dipping");
    assert.equal((rowNueva.variables.agendamiento as { paso?: number }).paso, 2, "debe partir del paso=1 heredado, no reiniciar");

    // Procesó el mensaje ACTUAL ("Si de acuerdo"), no el mensaje viejo.
    const msg = r2.effects.find((e) => e.type === "send_message");
    assert.ok(msg && msg.type === "send_message");
    assert.match(String(msg!.content.text), /previo=1/);
    assert.match(String(msg!.content.text), /mensaje=Si de acuerdo/);

    // UNA sola respuesta para este turno.
    assert.equal(r2.effects.filter((e) => e.type === "send_message").length, 1);

    // El mismo wamid reenviado (reentrega real de WhatsApp) NO se
    // reprocesa -- ahora está indexado contra la ejecución NUEVA.
    const r3 = await orch.process(turnoEvent("Si de acuerdo", "wamid-2"));
    assert.equal(r3.outcome, ORCHESTRATOR_OUTCOMES.DUPLICATE_EVENT);
    assert.equal(s.getRow()!.id, rowNueva.id, "no debe crear una TERCERA ejecución");
  });

  it("Caso C: ejecución vieja SIN AgendamientoEnCurso migra igual, sin errores", async () => {
    const s = buildStore();
    const { executor: resolver } = buildResolverExecutor();
    const orch = buildOrchestrator(s.store, resolver);

    // Ejecución vieja creada directamente en el store, sin pasar por un
    // turno real -- variables vacías, como una conversación recién
    // arrancada que nunca llegó a un agendamiento.
    await s.store.createExecution({
      tenantId: TENANT,
      flowId: FLOW_ID,
      flowVersionId: "v-old",
      executionId: "exec-sin-agendamiento",
      phoneNumberId: CONV.phoneNumberId,
      telefonoCliente: CONV.telefonoCliente,
      initialState: createFlowEngineState(testFlow(), { flowId: FLOW_ID, flowVersionId: "v-old", executionId: "exec-sin-agendamiento" }),
    });
    // Queda en waiting_input real (como si ya hubiera respondido un q-turno).
    const rowInicial = s.getRow()!;
    await s.store.saveExecutionState(
      TENANT,
      rowInicial.id,
      { ...createFlowEngineState(testFlow(), { flowId: FLOW_ID, flowVersionId: "v-old", executionId: "exec-sin-agendamiento" }), status: "waiting_input", currentNodeId: "q-turno", expectedInput: "text" },
      rowInicial.state_version,
    );

    s.addVersion("v-new");
    s.setPublishedVersion("v-new");

    const r = await orch.process(turnoEvent("hola de nuevo", "wamid-c1"));
    assert.equal(r.engineError, undefined);
    assert.equal(r.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(s.getRow()!.flow_version_id, "v-new");
    assert.equal((s.getRow()!.variables.agendamiento as { paso?: number } | undefined)?.paso, 1, "arranca en paso 1, sin AgendamientoEnCurso previo real");
  });

  it("Caso D: contexto acumulado tras VARIOS turnos no se pierde al migrar", async () => {
    const s = buildStore();
    const { executor: resolver } = buildResolverExecutor();
    const orch = buildOrchestrator(s.store, resolver);

    await orch.process(turnoEvent("t1", "wamid-d1", "start"));
    await orch.process(turnoEvent("t2", "wamid-d2"));
    await orch.process(turnoEvent("t3", "wamid-d3"));
    const rowTrasVariosTurnos = s.getRow()!;
    assert.equal((rowTrasVariosTurnos.variables.agendamiento as { paso?: number }).paso, 3, "3 turnos reales ya acumulados");

    s.addVersion("v-new");
    s.setPublishedVersion("v-new");

    const r = await orch.process(turnoEvent("t4 (tras publicar v-new)", "wamid-d4"));
    assert.equal(r.engineError, undefined);
    assert.equal(s.getRow()!.flow_version_id, "v-new");
    assert.equal((s.getRow()!.variables.agendamiento as { paso?: number }).paso, 4, "sigue acumulando desde el paso 3, no reinicia en 0");
  });

  it("Caso I: evento tipo button dispara la migración -- mensajeActual toma el id del botón, no el mensaje viejo", async () => {
    const s = buildStore();
    const { executor: resolver } = buildResolverExecutor();
    const orch = buildOrchestrator(s.store, resolver);

    await orch.process(turnoEvent("inicia", "wamid-1", "start"));
    const rowVieja = s.getRow()!;

    s.addVersion("v-new");
    s.setPublishedVersion("v-new");

    const r = await orch.process(buttonEvent("btn_confirmar", "wamid-boton-1"));
    assert.equal(r.engineError, undefined);

    const rowNueva = s.getRow()!;
    assert.notEqual(rowNueva.id, rowVieja.id, "debe migrar igual que con start/text");
    assert.equal(rowNueva.flow_version_id, "v-new");

    const msg = r.effects.find((e) => e.type === "send_message");
    assert.ok(msg && msg.type === "send_message");
    assert.match(String(msg!.content.text), /mensaje=btn_confirmar/, "mensajeActual debe ser el id del botón que disparó la migración, nunca el mensaje viejo");
  });
});

describe("Ajuste de seguridad 1 — nunca migrar una ejecución con un efecto externo en vuelo (waiting_effect)", () => {
  it("Caso G: ejecución waiting_effect con un efecto real despachado -- NO migra, NO cierra, NO crea una ejecución nueva, el efecto sigue asociado a la fila original", async () => {
    const s = buildStore();
    const { executor: resolver } = buildResolverExecutor();
    const orch = buildOrchestrator(s.store, resolver);

    await s.store.createExecution({
      tenantId: TENANT,
      flowId: FLOW_ID,
      flowVersionId: "v-old",
      executionId: "exec-efecto-en-vuelo",
      phoneNumberId: CONV.phoneNumberId,
      telefonoCliente: CONV.telefonoCliente,
      initialState: createFlowEngineState(testFlow(), { flowId: FLOW_ID, flowVersionId: "v-old", executionId: "exec-efecto-en-vuelo" }),
    });
    const rowInicial = s.getRow()!;
    // Simula un efecto externo REAL ya despachado (ej. crear_cita_nylas a
    // mitad de camino, esperando la respuesta de Nylas) -- status real
    // "waiting_effect" con un pendingEffect real, ningún estado inventado.
    const pendingEffect = { effectId: "efecto-en-vuelo-1", nodeId: "act-resolver", kind: "action" as const };
    await s.store.saveExecutionState(
      TENANT,
      rowInicial.id,
      {
        ...createFlowEngineState(testFlow(), { flowId: FLOW_ID, flowVersionId: "v-old", executionId: "exec-efecto-en-vuelo" }),
        status: "waiting_effect",
        currentNodeId: "act-resolver",
        pendingEffect,
      },
      rowInicial.state_version,
    );
    const rowConEfectoEnVuelo = s.getRow()!;
    assert.equal(rowConEfectoEnVuelo.status, "waiting_effect");

    // Se publica v-new MIENTRAS el efecto sigue en vuelo.
    s.addVersion("v-new");
    s.setPublishedVersion("v-new");

    // Llega un mensaje nuevo del cliente justo en ese momento.
    await orch.process(turnoEvent("mensaje mientras el efecto sigue en vuelo", "wamid-g1"));

    // NUNCA se migró: sigue siendo la MISMA fila, en la MISMA versión vieja,
    // sin cerrar, con el efecto todavía asociado.
    const rowFinal = s.getRow()!;
    assert.equal(rowFinal.id, rowConEfectoEnVuelo.id, "no debe crearse ninguna ejecución nueva");
    assert.equal(rowFinal.flow_version_id, "v-old", "no debe migrar a v-new mientras hay un efecto en vuelo");
    assert.equal(rowFinal.status, "waiting_effect", "sigue esperando el efecto -- nunca se cerró");
    assert.deepEqual(rowFinal.pending_effect, pendingEffect, "el efecto en vuelo sigue asociado a su ejecución original, intacto");
    assert.equal(s.getClosedRow(rowConEfectoEnVuelo.id), undefined, "nunca se marcó failed");
  });
});

describe("Ajuste de seguridad 3D — una reserva ya completada no se repite por la migración", () => {
  it("Caso H: agendamiento.completado=true se conserva y la migración por sí sola nunca despacha crear_cita_nylas", async () => {
    const s = buildStore(testFlowConReserva);
    const { executor: resolver, crearCitaCallCount } = buildResolverConReservaExecutor();
    const orch = buildOrchestrator(s.store, resolver);

    // Ejecución vieja creada directamente con una reserva YA completada
    // (equivalente a que crear_cita_nylas ya se ejecutó con éxito en un
    // turno anterior real) -- nunca se llama a la acción de reserva acá,
    // solo se siembra el estado que dejaría esa reserva ya hecha.
    await s.store.createExecution({
      tenantId: TENANT,
      flowId: FLOW_ID,
      flowVersionId: "v-old",
      executionId: "exec-reserva-completada",
      phoneNumberId: CONV.phoneNumberId,
      telefonoCliente: CONV.telefonoCliente,
      initialState: createFlowEngineState(testFlowConReserva(), { flowId: FLOW_ID, flowVersionId: "v-old", executionId: "exec-reserva-completada" }),
    });
    const rowInicial = s.getRow()!;
    await s.store.saveExecutionState(
      TENANT,
      rowInicial.id,
      {
        ...createFlowEngineState(testFlowConReserva(), { flowId: FLOW_ID, flowVersionId: "v-old", executionId: "exec-reserva-completada" }),
        status: "waiting_input",
        currentNodeId: "q-turno",
        expectedInput: "text",
        variables: { agendamiento: { completado: true, citaId: "cita-real-796", paso: 1 } },
      },
      rowInicial.state_version,
    );

    // Se publica v-new -- dispara la migración con el próximo mensaje.
    s.addVersion("v-new");
    s.setPublishedVersion("v-new");

    const r = await orch.process(turnoEvent("gracias!", "wamid-h1"));
    assert.equal(r.engineError, undefined);

    const rowNueva = s.getRow()!;
    assert.equal(rowNueva.flow_version_id, "v-new", "debe migrar normalmente");
    assert.equal(
      (rowNueva.variables.agendamiento as { completado?: boolean; citaId?: string }).completado,
      true,
      "el estado de reserva ya completada se conserva",
    );
    assert.equal((rowNueva.variables.agendamiento as { citaId?: string }).citaId, "cita-real-796");

    // La migración en sí (cerrar la vieja + crear la nueva + copiar
    // variables) NUNCA despacha ninguna acción de reserva -- solo el propio
    // resolver (ya con completado=true, real y sin cambios de este fix)
    // decide no pedirla de nuevo.
    assert.equal(crearCitaCallCount(), 0, "crear_cita_nylas nunca debe volver a ejecutarse por causa de la migración");
  });
});

describe("Ajuste de seguridad 3A/3B — concurrencia real durante la migración (Promise.all)", () => {
  it("Caso E: dos process() simultáneos (wamid DISTINTOS) sobre la misma ejecución vieja obsoleta -- termina existiendo UNA sola ejecución nueva válida", async () => {
    const s = buildConcurrentStore();
    const { executor: resolver } = buildResolverExecutor();
    const orch = buildOrchestrator(s.store, resolver);

    await orch.process(turnoEvent("inicia", "wamid-1", "start"));
    const rowViejaId = [...s.rows.values()].find((r) => r.status !== "failed")!.id;

    s.addVersion("v-new");
    s.setPublishedVersion("v-new");

    const [r1, r2] = await Promise.all([
      orch.process(turnoEvent("mensaje A", "wamid-conc-A")),
      orch.process(turnoEvent("mensaje B", "wamid-conc-B")),
    ]);

    // Ninguno de los dos debe fallar ni quedar sin procesar.
    assert.equal(r1.engineError, undefined);
    assert.equal(r2.engineError, undefined);
    assert.equal(r1.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(r2.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);

    // La vieja quedó cerrada (failed), nunca dos veces con error.
    const vieja = s.rows.get(rowViejaId)!;
    assert.equal(vieja.status, "failed");

    // Existe EXACTAMENTE una ejecución nueva activa en v-new -- nunca dos.
    const activasEnVNew = [...s.rows.values()].filter((r) => r.flow_version_id === "v-new");
    assert.equal(activasEnVNew.length, 1, "debe existir una sola ejecución nueva válida, nunca dos");

    // Ambos mensajes (wamid distintos, ambos reales) terminaron procesados
    // contra esa MISMA fila nueva -- nunca se creó una segunda para ninguno.
    assert.equal(r1.executionRowId, activasEnVNew[0]!.id);
    assert.equal(r2.executionRowId, activasEnVNew[0]!.id);
  });

  it("Caso F: dos process() simultáneos con el MISMO wamid durante la migración -- un solo procesamiento, ninguna reserva/respuesta duplicada", async () => {
    const s = buildConcurrentStore(testFlowConReserva);
    const { executor: resolver, crearCitaCallCount } = buildResolverConReservaExecutor();
    const orch = buildOrchestrator(s.store, resolver);

    // El turno inicial "inicia" YA completa su propia reserva (agendamiento
    // sin completado -> modo="reservar" -> act-crear-cita) -- se mide la
    // reserva de la CARRERA como delta contra este conteo base, para no
    // confundirla con la reserva legítima de este primer turno.
    await orch.process(turnoEvent("inicia", "wamid-1", "start"));
    const crearCitaAntesDeLaCarrera = crearCitaCallCount();

    s.addVersion("v-new");
    s.setPublishedVersion("v-new");

    const mismoEvento = turnoEvent("Si de acuerdo", "wamid-MISMO");
    const [r1, r2] = await Promise.all([orch.process(mismoEvento), orch.process(mismoEvento)]);

    const outcomes = [r1.outcome, r2.outcome].sort();
    assert.deepEqual(
      outcomes,
      [ORCHESTRATOR_OUTCOMES.DUPLICATE_EVENT, ORCHESTRATOR_OUTCOMES.PROCESSED],
      "el mismo wamid debe procesarse UNA sola vez -- la otra invocación debe verlo como duplicado",
    );

    // Solo existe una ejecución nueva activa en v-new.
    const activasEnVNew = [...s.rows.values()].filter((r) => r.flow_version_id === "v-new");
    assert.equal(activasEnVNew.length, 1, "nunca deben crearse dos ejecuciones nuevas para el mismo mensaje");

    // Como el mock resolver siempre pide "reservar" para un agendamiento sin
    // completar, y el mismo wamid nunca debe procesarse dos veces, la
    // acción de reserva se despachó como máximo UNA vez MÁS durante la
    // carrera -- nunca dos, nunca una reserva duplicada por la carrera.
    assert.ok(
      crearCitaCallCount() - crearCitaAntesDeLaCarrera <= 1,
      "ninguna reserva duplicada por la carrera del mismo wamid",
    );
  });
});
