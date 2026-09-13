/**
 * FASE F8.3 (Meta Send Reliability, autorizado) — retry real de efectos
 * send_message a nivel de flow-orchestrator.ts. Mismo estilo/patrón exacto
 * que flow-orchestrator-ai-retry.test.ts (store en memoria, executors fake
 * inyectados vía createTestEffectExecutorFramework), pero probando el
 * bloque `if (effect.type === "send_message")` nuevo en
 * registerAndDispatchEffects en vez del de IA.
 *
 * El clock se inyecta con sleepMs sin espera real (Promise.resolve
 * inmediata) para que estos tests no tarden segundos reales -- solo se
 * registra CUÁNTAS veces y con qué delay se llamó, para poder verificar
 * backoff sin bloquear la suite.
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
import { EFFECT_RESULT_CLASSIFICATIONS, MAX_SEND_MESSAGE_ATTEMPTS, type EffectExecutor } from "@/lib/flow/executor-types";
import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";
import { engineStateToExecutionUpdate } from "@/lib/flow/flow-store-types";
import type { FlowEngineState } from "@/lib/flow/engine-types";

const TENANT = "tenant-f83-orchestrator";
const CONV: ConversationKey = { phoneNumberId: "1000000000099", telefonoCliente: "573000000001" };

function flowSaludoSimple(): FlowDefinition {
  return {
    name: "F8.3 -- saludo simple (repro retry send_message)",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg-saludo", type: "message", config: { text: "¡Hola! Gracias por escribir." } },
      { id: "q-fin", type: "question", config: { text: "¿Algo más?", variableKey: "algoMas", required: false, validation: { kind: "text" } } },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg-saludo" },
      { id: "e2", source: "msg-saludo", target: "q-fin" },
    ],
    variables: [],
  };
}

function buildInMemoryStore(flow: FlowDefinition = flowSaludoSimple()): {
  store: FlowOrchestratorStore;
  getEffectRow: (effectId: string) => { status: string; raw?: Record<string, unknown>; applied?: Record<string, unknown> } | undefined;
} {
  let row: FlowExecutionRow | null = null;
  const effects = new Map<string, { status: string; applied?: Record<string, unknown>; raw?: Record<string, unknown> }>();

  const store = {
    getActiveExecution: async () => row,
    getExecutionById: async () => row,
    getFlow: async () =>
      ({ tenant_id: TENANT, id: "flow-1", slug: "s", name: "n", status: "published", published_version_id: "fv-1" }) as never,
    getFlowVersion: async () =>
      ({ tenant_id: TENANT, id: "fv-1", flow_id: "flow-1", version_number: 1, definition_json: flow }) as never,
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
        kind: "send_message", status: fx.status === "succeeded" ? "succeeded" : "failed",
        result_payload_applied: fx.applied ?? null, result_payload_raw: fx.raw ?? null,
        integration_id: null, created_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
      } as never;
    },
    resolveEffectResult: async (input: { effectId: string; status: "succeeded" | "failed"; resultPayloadApplied?: Record<string, unknown>; resultPayloadRaw?: Record<string, unknown> }) => {
      const fx = effects.get(input.effectId)!;
      fx.status = input.status;
      fx.applied = input.resultPayloadApplied;
      fx.raw = input.resultPayloadRaw;
      return {
        ok: true,
        row: {
          tenant_id: TENANT, id: 1, flow_execution_id: "row-1", effect_id: input.effectId, node_id: "?",
          kind: "send_message", status: input.status === "succeeded" ? "succeeded" : "failed",
          result_payload_applied: input.resultPayloadApplied ?? null,
          result_payload_raw: input.resultPayloadRaw ?? null,
          integration_id: null, created_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
        } as never,
      };
    },
    recordNodeTransition: async () => {},
  };
  return { store: store as unknown as FlowOrchestratorStore, getEffectRow: (id: string) => effects.get(id) };
}

/** Executor fake que responde una secuencia fija de resultados, uno por llamada (attempt 1, 2, 3, ...). */
function buildScriptedSendMessageExecutor(script: Array<{ success: boolean; classification: string; metadata?: Record<string, unknown>; wamid?: string; httpStatus?: number }>) {
  let calls = 0;
  const attempts: number[] = [];
  const executor: EffectExecutor = {
    kind: "send_message",
    version: "test",
    capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
    async dispatch(request) {
      attempts.push(request.attempt);
      const step = script[Math.min(calls, script.length - 1)];
      calls += 1;
      return {
        success: step.success,
        classification: step.classification as never,
        data: step.success ? { delivered: true, wamid: step.wamid ?? null } : undefined,
        appliedResult: step.success ? { delivered: true, wamid: step.wamid ?? null } : undefined,
        rawResult: step.success ? undefined : { httpStatus: step.httpStatus, attempt: request.attempt },
        metadata: step.metadata,
        externalReference: step.wamid ? `wamid:${step.wamid}` : undefined,
        error: step.success ? undefined : "meta_send_failed",
      };
    },
  };
  return { executor, callCount: () => calls, attempts: () => attempts };
}

function buildFakeClock() {
  const sleeps: number[] = [];
  return {
    clock: { nowIso: () => new Date().toISOString(), sleepMs: async (ms: number) => { sleeps.push(ms); } },
    sleeps: () => sleeps,
  };
}

const DETERMINISTIC_EFFECT_ID = "eff-msg-saludo-1";

async function runTurno(
  flow: FlowDefinition,
  store: FlowOrchestratorStore,
  sendMessageExecutor: EffectExecutor,
  clock: ReturnType<typeof buildFakeClock>["clock"],
) {
  const orchestrator = createExecutionOrchestrator({
    store,
    engine: { createFlowEngineState, runFlowEngine },
    effectFramework: createTestEffectExecutorFramework({ executors: [sendMessageExecutor] }),
    clock,
    ids: { effectId: () => DETERMINISTIC_EFFECT_ID },
  });
  return orchestrator.process({
    tenantId: TENANT,
    conversation: CONV,
    flowId: "flow-1",
    eventId: "evt-1",
    eventType: "message",
    payload: { text: "hola" },
    engineEvent: { type: "start", text: "hola" },
    receivedAt: new Date().toISOString(),
  });
}

describe("F8.3 — retry de send_message en flow-orchestrator.ts", () => {
  it("1. 503 en el intento 1 -> reintenta (segundo intento con attempt=2)", async () => {
    const { executor, attempts } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
      { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, wamid: "w1" },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.deepEqual(attempts(), [1, 2]);
  });

  it("2. 429 en el intento 1 -> reintenta", async () => {
    const { executor, attempts } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT, httpStatus: 429 },
      { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, wamid: "w1" },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.deepEqual(attempts(), [1, 2]);
  });

  it("3. TIMEOUT en el intento 1 -> reintenta", async () => {
    const { executor, attempts } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT },
      { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, wamid: "w1" },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.deepEqual(attempts(), [1, 2]);
  });

  it("4. red (RETRYABLE genérico) en el intento 1 -> reintenta", async () => {
    const { executor, attempts } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE },
      { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, wamid: "w1" },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.deepEqual(attempts(), [1, 2]);
  });

  it("5. falla en intento 1 y 2, éxito en el 3 -> termina correctamente con 3 intentos", async () => {
    const { executor, attempts, callCount } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
      { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, wamid: "w1" },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    const result = await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.deepEqual(attempts(), [1, 2, 3]);
    assert.equal(callCount(), MAX_SEND_MESSAGE_ATTEMPTS);
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
  });

  it("6. todos los intentos fallan (503 x3) -> failure final, exactamente MAX_SEND_MESSAGE_ATTEMPTS intentos, nunca más, y el fallo queda persistido con httpStatus", async () => {
    const { executor, attempts, callCount } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
    ]);
    const { store, getEffectRow } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.equal(callCount(), MAX_SEND_MESSAGE_ATTEMPTS, "nunca debe exceder el máximo de intentos configurado");
    assert.deepEqual(attempts(), [1, 2, 3]);
    const fx = getEffectRow(DETERMINISTIC_EFFECT_ID);
    assert.equal(fx?.status, "failed");
    assert.equal(fx?.raw?.httpStatus, 503, "el fallo final queda persistido con el httpStatus real, no solo un string plano");
  });

  it("7. máximo de intentos respetado incluso si el executor seguiría fallando indefinidamente (no infinite loop)", async () => {
    const { executor, callCount } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    const start = Date.now();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    const elapsed = Date.now() - start;
    assert.equal(callCount(), MAX_SEND_MESSAGE_ATTEMPTS);
    assert.ok(elapsed < 2000, "con clock fake (sleepMs sin espera real) el turno debe terminar casi instantáneo");
  });

  it("8. HTTP 400 (permanente) -> NO reintenta, un único intento", async () => {
    const { executor, callCount, attempts } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, httpStatus: 400 },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.equal(callCount(), 1, "un error NON_RETRYABLE nunca se reintenta");
    assert.deepEqual(attempts(), [1]);
  });

  it("9. invalid token (AUTH_ERROR) -> NO reintenta", async () => {
    const { executor, callCount } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR, httpStatus: 401 },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.equal(callCount(), 1, "un AUTH_ERROR nunca se reintenta -- reintentar no arregla un token vencido");
  });

  it("10. permission error (NON_RETRYABLE) -> NO reintenta", async () => {
    const { executor, callCount } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, httpStatus: 403 },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.equal(callCount(), 1);
  });

  it("11. invalid recipient (NON_RETRYABLE) -> NO reintenta", async () => {
    const { executor, callCount } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, httpStatus: 400 },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.equal(callCount(), 1);
  });

  it("12. VALIDATION_ERROR (payload vacío) -> NO reintenta", async () => {
    const { executor, callCount } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.equal(callCount(), 1);
  });

  it("13. SECURITY_REJECTED (tenant mismatch) -> NO reintenta", async () => {
    const { executor, callCount } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.equal(callCount(), 1);
  });

  it("14. backoff creciente: el 2do delay es mayor o igual que el 1ro (exponencial)", async () => {
    const { executor } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
      { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, wamid: "w1" },
    ]);
    const { store } = buildInMemoryStore();
    const { clock, sleeps } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.equal(sleeps().length, 2, "debe haber esperado backoff antes de cada uno de los 2 reintentos");
    assert.ok(sleeps()[1] >= sleeps()[0] - 400, "el 2do backoff no debe ser menor que el 1ro (permitiendo jitter)");
  });

  it("15. backoff máximo respetado (nunca excede SEND_MESSAGE_BACKOFF_MAX_MS = 8000ms)", async () => {
    const { executor } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
      { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, wamid: "w1" },
    ]);
    const { store } = buildInMemoryStore();
    const { clock, sleeps } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    for (const s of sleeps()) assert.ok(s <= 8000, `backoff ${s}ms no debe exceder el techo de 8000ms`);
  });

  it("16. Retry-After (429) se respeta como backoff mínimo, acotado por el techo", async () => {
    const { executor } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT, httpStatus: 429, metadata: { retryAfterMs: 6000 } },
      { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, wamid: "w1" },
    ]);
    const { store } = buildInMemoryStore();
    const { clock, sleeps } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    assert.equal(sleeps().length, 1);
    assert.ok(sleeps()[0] >= 6000, "debe honrar el Retry-After de 6000ms como mínimo");
    assert.ok(sleeps()[0] <= 8000, "pero nunca excede el techo absoluto");
  });

  it("17. no duplica el effect: una sola fila resuelta por effectId (el store solo ve un insertEffectIdempotent)", async () => {
    const { executor } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
      { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, wamid: "w1" },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    let insertCalls = 0;
    const wrappedStore: FlowOrchestratorStore = {
      ...store,
      insertEffectIdempotent: async (input) => {
        insertCalls += 1;
        return store.insertEffectIdempotent(input);
      },
    };
    await runTurno(flowSaludoSimple(), wrappedStore, executor, clock);
    assert.equal(insertCalls, 1, "el effect se inserta UNA sola vez, los reintentos reusan el mismo effectId");
  });

  it("18. success final conserva wamid en el effect persistido (dulabs_flow_effects)", async () => {
    const { executor } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
      { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, wamid: "wamid-final" },
    ]);
    const { store, getEffectRow } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    await runTurno(flowSaludoSimple(), store, executor, clock);
    const fx = getEffectRow(DETERMINISTIC_EFFECT_ID);
    assert.equal(fx?.status, "succeeded");
    assert.equal(fx?.applied?.wamid, "wamid-final");
  });

  it("19. failure final nunca reporta success (outcome sigue PROCESSED pero el effect queda 'failed')", async () => {
    const { executor } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
    ]);
    const { store } = buildInMemoryStore();
    const { clock } = buildFakeClock();
    const result = await runTurno(flowSaludoSimple(), store, executor, clock);
    // send_message no pausa el engine (fire-and-forget, needsEngineContinuation=false,
    // preexistente y sin cambios de F8.3) -- el turno sigue PROCESSED igual;
    // lo que sí cambia es que el effect quedó 3 veces intentado y "failed"
    // en dulabs_flow_effects (ver test 6), nunca marcado succeeded.
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
  });
});

describe("F8.3 — mezcla AI + send_message en el mismo turno (no debe interferir con MAX_AI_DISPATCH_ATTEMPTS)", () => {
  // Un nodo "ai" exitoso ya dispara, en la MISMA invocación de
  // registerAndDispatchEffects, un effect send_message aparte con la
  // respuesta -- por diseño (ver flow-orchestrator-ai-retry.test.ts). Este
  // flow ejercita AMBOS bloques de retry (ai y send_message) en un solo
  // turno para confirmar que ninguno pisa al otro.
  function flowConAiYMensaje(): FlowDefinition {
    return {
      name: "F8.3 -- ai + send_message mezclados",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "ai-responde", type: "ai", config: { instruction: "Responde brevemente.", mode: "respond" } },
        { id: "q-fin", type: "question", config: { text: "¿Algo más?", variableKey: "algoMas", required: false, validation: { kind: "text" } } },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai-responde" },
        { id: "e2", source: "ai-responde", target: "q-fin", sourceHandle: "success" },
      ],
      variables: [],
    };
  }

  it("20. el nodo ai reintenta 2 veces (MAX_AI_DISPATCH_ATTEMPTS) Y el send_message resultante reintenta aparte (MAX_SEND_MESSAGE_ATTEMPTS) -- ninguno afecta al otro", async () => {
    let aiCalls = 0;
    const aiExecutor: EffectExecutor = {
      kind: "ai",
      version: "test",
      capabilities: { supportsIntegration: false, supportsAsync: true, operationClasses: [] },
      async dispatch() {
        aiCalls += 1;
        // Intento 1 de IA: falla (recuperable). Intento 2: éxito.
        if (aiCalls === 1) {
          return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, error: "ai_transient" };
        }
        const data = { responseText: "Con gusto te ayudo.", __textProvenance: "AI_GENERATED_TEXT" };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      },
    };

    const { executor: sendExecutor, callCount: sendCalls, attempts: sendAttempts } = buildScriptedSendMessageExecutor([
      { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, httpStatus: 503 },
      { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, wamid: "w-mix" },
    ]);

    const { store } = buildInMemoryStore(flowConAiYMensaje());
    const { clock } = buildFakeClock();
    const orchestrator = createExecutionOrchestrator({
      store,
      engine: { createFlowEngineState, runFlowEngine },
      effectFramework: createTestEffectExecutorFramework({ executors: [aiExecutor, sendExecutor] }),
      clock,
    });
    const result = await orchestrator.process({
      tenantId: TENANT,
      conversation: CONV,
      flowId: "flow-1",
      eventId: "evt-mix-1",
      eventType: "message",
      payload: { text: "hola" },
      engineEvent: { type: "start", text: "hola" },
      receivedAt: new Date().toISOString(),
    });

    assert.equal(aiCalls, 2, "el nodo ai debe reintentar exactamente 1 vez (2 intentos totales, MAX_AI_DISPATCH_ATTEMPTS sin cambios)");
    // Este turno produce DOS efectos send_message independientes: la
    // respuesta del nodo ai ("ai-responde", con retry real por el 503
    // guionado) y el prompt estático de la pregunta siguiente ("q-fin",
    // sin fallos guionados restantes -- toma el último paso del script,
    // éxito). Cada effectId lleva su PROPIO contador de intentos desde 1,
    // nunca comparte ni continúa el del otro -- por eso la secuencia real
    // es [1, 2, 1] (2 intentos del primer efecto + 1 del segundo) y no
    // [1, 2] como si fuera un solo efecto.
    assert.equal(sendCalls(), 3);
    assert.deepEqual(sendAttempts(), [1, 2, 1]);
    assert.equal(result.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(result.engineError, undefined);
  });
});
