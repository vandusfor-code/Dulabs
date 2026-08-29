/**
 * Tests de integración del Flow Engine (Fase 2.5).
 * Escenarios empresariales reales en memoria.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import { FLOW_ENGINE_ERROR_CODES } from "@/lib/flow/engine-types";
import type { FlowEngineState } from "@/lib/flow/engine-types";
import type { FlowDefinition } from "@/lib/flow/types";
import {
  createFlowEngineState,
  runFlowEngine,
  DEFAULT_MAX_AUTO_STEPS,
} from "@/lib/flow/flow-engine";

// ---------------------------------------------------------------------------
// Helpers (executionId-scoped IDs — safe bajo concurrencia de node:test)
// ---------------------------------------------------------------------------

const effectCounters = new Map<string, number>();

function resetIds() {
  effectCounters.clear();
}

function makeIdGenerator(executionId: string) {
  return () => {
    const n = (effectCounters.get(executionId) ?? 0) + 1;
    effectCounters.set(executionId, n);
    return `${executionId}-fx-${n}`;
  };
}

function run(
  flow: FlowDefinition,
  state: FlowEngineState,
  event: Parameters<typeof runFlowEngine>[2],
) {
  return runFlowEngine(flow, state, event, {
    idGenerator: makeIdGenerator(state.executionId),
  });
}

function start(flow: FlowDefinition, executionId?: string) {
  const execId =
    executionId ?? `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return run(flow, createFlowEngineState(flow, { executionId: execId }), { type: "start" });
}

function completeEffect(
  flow: FlowDefinition,
  state: FlowEngineState,
  opts: {
    success?: boolean;
    data?: Record<string, unknown>;
    error?: string;
    effectId?: string;
  } = {},
) {
  const pending = state.pendingEffect!;
  return run(flow, state, {
    type: "effect_result",
    success: opts.success ?? true,
    effectId: opts.effectId ?? pending.effectId,
    data: opts.data,
    error: opts.error,
  });
}

function messagesFrom(effects: ReturnType<typeof run>["effects"]) {
  return effects
    .filter((e): e is Extract<(typeof effects)[number], { type: "send_message" }> => e.type === "send_message")
    .map((e) => ("text" in e.content ? e.content.text : undefined));
}

function hasConfirmMessage(effects: ReturnType<typeof run>["effects"]) {
  return messagesFrom(effects).some((t) => t?.includes("confirmada"));
}

// ---------------------------------------------------------------------------
// ESCENARIO 1 — SPA / RESERVAS
// ---------------------------------------------------------------------------

function spaBookingFlow(): FlowDefinition {
  return {
    name: "Spa Reservas",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "welcome", type: "message", config: { text: "Bienvenido al spa DuLabs" } },
      {
        id: "ai-intent",
        type: "ai",
        config: {
          instruction: "Interpreta si el cliente quiere reservar una cita",
          mode: "classify",
          classifications: ["wants_booking", "other"],
          outputVariables: ["intent"],
        },
      },
      {
        id: "consultar",
        type: "action",
        config: {
          actionType: "webhook_http",
          url: "https://api.dulabs/internal/consultar_disponibilidad",
          bodyVariableKeys: ["fecha"],
        },
      },
      {
        id: "check-available",
        type: "condition",
        config: {
          match: "all",
          rules: [{ field: "available", operator: "equals", value: true }],
        },
      },
      {
        id: "reservar",
        type: "action",
        config: { actionType: "agendar_cita_marketplace", params: { slot: "{{fecha}}" } },
      },
      { id: "confirm", type: "message", config: { text: "Tu cita está confirmada." } },
      {
        id: "alternatives",
        type: "message",
        config: { text: "No hay disponibilidad. Te ofrecemos otros horarios." },
      },
      {
        id: "reserva-fail",
        type: "message",
        config: { text: "No pudimos completar la reserva." },
      },
      { id: "other", type: "message", config: { text: "Cuéntanos en qué más podemos ayudarte." } },
      { id: "end-ok", type: "end", config: {} },
      { id: "end-alt", type: "end", config: {} },
      { id: "end-fail", type: "end", config: {} },
      { id: "end-other", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "welcome" },
      { id: "e2", source: "welcome", target: "ai-intent" },
      {
        id: "e3",
        source: "ai-intent",
        target: "consultar",
        sourceHandle: FLOW_EDGE_HANDLE.aiClass("wants_booking"),
      },
      {
        id: "e4",
        source: "ai-intent",
        target: "other",
        sourceHandle: FLOW_EDGE_HANDLE.aiClass("other"),
      },
      { id: "e5", source: "consultar", target: "check-available" },
      { id: "e6", source: "check-available", target: "reservar", sourceHandle: "true" },
      { id: "e7", source: "check-available", target: "alternatives", sourceHandle: "false" },
      { id: "e8", source: "reservar", target: "confirm" },
      {
        id: "e9",
        source: "reservar",
        target: "reserva-fail",
        sourceHandle: FLOW_EDGE_HANDLE.aiFailure,
      },
      { id: "e10", source: "confirm", target: "end-ok" },
      { id: "e11", source: "alternatives", target: "end-alt" },
      { id: "e12", source: "reserva-fail", target: "end-fail" },
      { id: "e13", source: "other", target: "end-other" },
    ],
    variables: [
      { key: "intent", label: "Intent", type: "string" },
      { key: "available", label: "Disponible", type: "boolean" },
      { key: "fecha", label: "Fecha", type: "string" },
    ],
  };
}

function runSpaThroughConsultar(flow: FlowDefinition) {
  let r = start(flow);
  assert.equal(r.state.status, "waiting_effect");
  assert.equal(r.state.pendingEffect?.nodeId, "ai-intent");

  r = completeEffect(flow, r.state, {
    data: { classification: "wants_booking", intent: "wants_booking" },
  });
  assert.equal(r.state.status, "waiting_effect");
  assert.equal(r.state.pendingEffect?.nodeId, "consultar");

  return r;
}

describe("Escenario 1 — SPA / Reservas", () => {
  beforeEach(resetIds);

  it("1a. sin disponibilidad ofrece alternativas, no confirma", () => {
    const flow = spaBookingFlow();
    let r = runSpaThroughConsultar(flow);

    r = completeEffect(flow, r.state, { data: { available: false } });
    assert.equal(r.state.status, "completed");
    assert.equal(r.state.currentNodeId, "end-alt");
    assert.equal(r.state.variables.available, false);
    assert.ok(messagesFrom(r.effects).some((t) => t?.includes("otros horarios")));
    assert.ok(!hasConfirmMessage(r.effects));
  });

  it("1b. disponible + reservar exitoso produce confirmación", () => {
    const flow = spaBookingFlow();
    let r = runSpaThroughConsultar(flow);

    r = completeEffect(flow, r.state, { data: { available: true } });
    assert.equal(r.state.status, "waiting_effect");
    assert.equal(r.state.pendingEffect?.nodeId, "reservar");

    r = completeEffect(flow, r.state, { success: true, data: { reservationId: "R-123" } });
    assert.equal(r.state.status, "completed");
    assert.equal(r.state.currentNodeId, "end-ok");
    assert.ok(hasConfirmMessage(r.effects));
  });

  it("1c. reservar fallido NO confirma la reserva", () => {
    const flow = spaBookingFlow();
    let r = runSpaThroughConsultar(flow);

    r = completeEffect(flow, r.state, { data: { available: true } });
    r = completeEffect(flow, r.state, { success: false, error: "Slot ocupado" });

    assert.equal(r.state.status, "completed");
    assert.equal(r.state.currentNodeId, "end-fail");
    assert.ok(messagesFrom(r.effects).some((t) => t?.includes("No pudimos completar")));
    assert.ok(!hasConfirmMessage(r.effects));
  });

  it("1d. IA interpreta intención pero no confirma disponibilidad", () => {
    const flow = spaBookingFlow();
    const r = start(flow);
    const aiFx = r.effects.find((e) => e.type === "effect_required" && e.nodeId === "ai-intent");
    assert.ok(aiFx?.type === "effect_required" && aiFx.kind === "ai");
    assert.equal(r.state.status, "waiting_effect");
    assert.notEqual(r.state.currentNodeId, "confirm");
    assert.ok(!hasConfirmMessage(r.effects));
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 2 — RESTAURANTE
// ---------------------------------------------------------------------------

function restaurantFlow(): FlowDefinition {
  return {
    name: "Restaurante",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "welcome", type: "message", config: { text: "Hola, somos Restaurante DuLabs" } },
      {
        id: "q-tipo",
        type: "question",
        config: {
          text: "¿Qué tipo de negocio tienes?",
          variableKey: "tipo_negocio",
          required: true,
          validation: { kind: "text" },
        },
      },
      {
        id: "q-necesidad",
        type: "question",
        config: {
          text: "¿Qué necesitas?",
          variableKey: "necesidad",
          required: true,
          validation: { kind: "text" },
        },
      },
      {
        id: "buttons",
        type: "buttons",
        config: {
          text: "¿Quieres agendar una demo?",
          buttons: [
            { id: "si", label: "Sí" },
            { id: "no", label: "No" },
          ],
          variableKey: "demo",
        },
      },
      {
        id: "action",
        type: "action",
        config: { actionType: "crear_lead_campana", params: { origen: "restaurante" } },
      },
      { id: "end", type: "end", config: { message: "Gracias por tu interés" } },
      { id: "end-skip", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "welcome" },
      { id: "e2", source: "welcome", target: "q-tipo" },
      { id: "e3", source: "q-tipo", target: "q-necesidad" },
      { id: "e4", source: "q-necesidad", target: "buttons" },
      { id: "e5", source: "buttons", target: "action", sourceHandle: FLOW_EDGE_HANDLE.button("si") },
      { id: "e6", source: "buttons", target: "end-skip", sourceHandle: FLOW_EDGE_HANDLE.button("no") },
      { id: "e7", source: "action", target: "end" },
    ],
    variables: [
      { key: "tipo_negocio", label: "Tipo", type: "string" },
      { key: "necesidad", label: "Necesidad", type: "string" },
      { key: "demo", label: "Demo", type: "string" },
    ],
  };
}

describe("Escenario 2 — Restaurante", () => {
  beforeEach(resetIds);

  it("conversación completa con variables, botones, acción y fin", () => {
    const flow = restaurantFlow();
    let r = start(flow);
    assert.equal(r.state.status, "waiting_input");

    r = run(flow, r.state, { type: "text", text: "Restaurante" });
    assert.equal(r.state.variables.tipo_negocio, "Restaurante");

    r = run(flow, r.state, { type: "text", text: "Automatizar reservas" });
    assert.equal(r.state.variables.necesidad, "Automatizar reservas");

    r = run(flow, r.state, { type: "button", id: "si" });
    assert.equal(r.state.variables.demo, "si");
    assert.equal(r.state.status, "waiting_effect");

    const leadFx = r.effects.find((e) => e.type === "effect_required");
    assert.ok(leadFx?.type === "effect_required" && leadFx.action?.actionType === "crear_lead_campana");

    r = completeEffect(flow, r.state, { data: { leadId: "L-99" } });
    assert.equal(r.state.status, "completed");
    assert.equal(r.state.currentNodeId, "end");
    assert.equal(r.state.variables.tipo_negocio, "Restaurante");
    assert.equal(r.state.variables.necesidad, "Automatizar reservas");
    assert.ok(messagesFrom(r.effects).some((t) => t?.includes("Gracias")));
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 3 — LEAD COMERCIAL
// ---------------------------------------------------------------------------

function leadCommercialFlow(): FlowDefinition {
  return {
    name: "Lead Comercial",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      {
        id: "ai",
        type: "ai",
        config: {
          instruction: "Clasifica el mensaje del lead",
          mode: "classify",
          classifications: ["commercial", "support", "enterprise"],
          outputVariables: ["classification"],
        },
      },
      { id: "commercial", type: "message", config: { text: "Rama comercial" } },
      { id: "support", type: "message", config: { text: "Rama soporte" } },
      { id: "enterprise", type: "message", config: { text: "Rama enterprise" } },
      { id: "unknown", type: "message", config: { text: "Rama desconocida" } },
      { id: "end-c", type: "end", config: {} },
      { id: "end-s", type: "end", config: {} },
      { id: "end-e", type: "end", config: {} },
      { id: "end-u", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "ai" },
      {
        id: "e2",
        source: "ai",
        target: "commercial",
        sourceHandle: FLOW_EDGE_HANDLE.aiClass("commercial"),
      },
      {
        id: "e3",
        source: "ai",
        target: "support",
        sourceHandle: FLOW_EDGE_HANDLE.aiClass("support"),
      },
      {
        id: "e4",
        source: "ai",
        target: "enterprise",
        sourceHandle: FLOW_EDGE_HANDLE.aiClass("enterprise"),
      },
      { id: "e5", source: "ai", target: "unknown", sourceHandle: FLOW_EDGE_HANDLE.aiDefault },
      { id: "e6", source: "commercial", target: "end-c" },
      { id: "e7", source: "support", target: "end-s" },
      { id: "e8", source: "enterprise", target: "end-e" },
      { id: "e9", source: "unknown", target: "end-u" },
    ],
    variables: [{ key: "classification", label: "Clasificación", type: "string" }],
  };
}

function classify(flow: FlowDefinition, state: FlowEngineState, classification: string) {
  return completeEffect(flow, state, { data: { classification } });
}

describe("Escenario 3 — Lead Comercial", () => {
  beforeEach(resetIds);

  it("3a. commercial → rama comercial", () => {
    const flow = leadCommercialFlow();
    let r = start(flow);
    r = classify(flow, r.state, "commercial");
    assert.equal(r.state.currentNodeId, "end-c");
    assert.ok(messagesFrom(r.effects).some((t) => t === "Rama comercial"));
  });

  it("3b. support → rama soporte", () => {
    const flow = leadCommercialFlow();
    let r = start(flow);
    r = classify(flow, r.state, "support");
    assert.equal(r.state.currentNodeId, "end-s");
  });

  it("3c. enterprise → rama enterprise", () => {
    const flow = leadCommercialFlow();
    let r = start(flow);
    r = classify(flow, r.state, "enterprise");
    assert.equal(r.state.currentNodeId, "end-e");
  });

  it("3d. clasificación desconocida → default, no rama incorrecta", () => {
    const flow = leadCommercialFlow();
    let r = start(flow);
    r = classify(flow, r.state, "spam_xyz");
    assert.equal(r.state.currentNodeId, "end-u");
    assert.ok(messagesFrom(r.effects).some((t) => t === "Rama desconocida"));
    assert.ok(!messagesFrom(r.effects).some((t) => t === "Rama enterprise"));
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 4 — ENTERPRISE
// ---------------------------------------------------------------------------

function enterpriseFlow(): FlowDefinition {
  return {
    name: "Enterprise",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      {
        id: "ai",
        type: "ai",
        config: {
          instruction: "Clasifica si es enterprise",
          mode: "classify",
          classifications: ["enterprise", "other"],
        },
      },
      {
        id: "action",
        type: "action",
        config: { actionType: "crear_lead_enterprise" },
      },
      {
        id: "human",
        type: "human",
        config: { pauseDurationHours: 48, message: "Un ejecutivo te contactará" },
      },
      { id: "end", type: "end", config: { message: "Fin enterprise" } },
      { id: "end-other", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "ai" },
      {
        id: "e2",
        source: "ai",
        target: "action",
        sourceHandle: FLOW_EDGE_HANDLE.aiClass("enterprise"),
      },
      { id: "e3", source: "ai", target: "end-other", sourceHandle: FLOW_EDGE_HANDLE.aiClass("other") },
      { id: "e4", source: "action", target: "human" },
      { id: "e5", source: "human", target: "end" },
    ],
    variables: [],
  };
}

describe("Escenario 4 — Enterprise", () => {
  beforeEach(resetIds);

  it("AI → ACTION → effect → HUMAN transferred, sin auto-continuar a END", () => {
    const flow = enterpriseFlow();
    let r = start(flow);

    assert.ok(r.effects.some((e) => e.type === "effect_required" && e.kind === "ai"));
    assert.equal(r.state.status, "waiting_effect");
    assert.notEqual(r.state.status, "transferred");

    r = classify(flow, r.state, "enterprise");
    assert.ok(r.effects.some((e) => e.type === "effect_required" && e.kind === "action"));
    assert.equal(r.state.status, "waiting_effect");
    assert.equal(r.state.pendingEffect?.nodeId, "action");

    r = completeEffect(flow, r.state, { data: { leadId: "ENT-1" } });
    assert.equal(r.state.status, "transferred");
    assert.equal(r.state.currentNodeId, "human");
    assert.ok(r.effects.some((e) => e.type === "transferred"));
    assert.notEqual(r.state.currentNodeId, "end");

    const after = run(flow, r.state, { type: "text", text: "hola" });
    assert.equal(after.error?.code, FLOW_ENGINE_ERROR_CODES.INVALID_STATE);
    // El engine rechaza el evento y marca failed; el runtime debe ignorar input post-transfer.
    assert.equal(after.state.status, "failed");
    assert.equal(after.state.currentNodeId, "human");
    assert.ok(!messagesFrom(after.effects).some((t) => t?.includes("Fin enterprise")));
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 5 — FALLBACK / FAILURE (regresión resolveNextNodeId)
// ---------------------------------------------------------------------------

function failureBranchFlow(): FlowDefinition {
  return {
    name: "Failure Branch",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      {
        id: "action",
        type: "action",
        config: { actionType: "webhook_http", url: "https://api.dulabs/test" },
      },
      { id: "success-end", type: "end", config: {} },
      { id: "failure-msg", type: "message", config: { text: "Falló la acción" } },
      { id: "failure-end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "action" },
      { id: "e2", source: "action", target: "success-end" },
      {
        id: "e3",
        source: "action",
        target: "failure-msg",
        sourceHandle: FLOW_EDGE_HANDLE.aiFailure,
      },
      { id: "e4", source: "failure-msg", target: "failure-end" },
    ],
    variables: [],
  };
}

describe("Escenario 5 — Fallback / Failure", () => {
  beforeEach(resetIds);

  it("failure NO usa default ni llega a success-end", () => {
    const flow = failureBranchFlow();
    let r = start(flow);
    assert.equal(r.state.status, "waiting_effect");

    r = completeEffect(flow, r.state, { success: false, error: "HTTP 500" });
    assert.equal(r.state.status, "completed");
    assert.equal(r.state.currentNodeId, "failure-end");
    assert.notEqual(r.state.currentNodeId, "success-end");
    assert.ok(messagesFrom(r.effects).some((t) => t === "Falló la acción"));
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 6 — IDEMPOTENCIA
// ---------------------------------------------------------------------------

describe("Escenario 6 — Idempotencia", () => {
  beforeEach(resetIds);

  it("6a. effectId incorrecto no completa el efecto", () => {
    const flow = failureBranchFlow();
    let r = start(flow);
    r = run(flow, r.state, {
      type: "effect_result",
      success: true,
      effectId: "wrong-id",
    });
    assert.equal(r.state.status, "failed");
    assert.equal(r.error?.code, FLOW_ENGINE_ERROR_CODES.UNEXPECTED_EFFECT_RESULT);
  });

  it("6b. evento inválido no avanza el flujo", () => {
    const flow = restaurantFlow();
    let r = start(flow);
    r = run(flow, r.state, { type: "button", id: "si" });
    assert.equal(r.error?.code, FLOW_ENGINE_ERROR_CODES.INVALID_STATE);
    assert.equal(r.state.status, "failed");
  });

  it("6c. doble effect_result: el segundo no re-completa", () => {
    const flow = failureBranchFlow();
    let r = start(flow);
    const pendingId = r.state.pendingEffect!.effectId;

    r = completeEffect(flow, r.state, { success: true, effectId: pendingId });
    assert.equal(r.state.status, "completed");

    const again = run(flow, r.state, {
      type: "effect_result",
      success: true,
      effectId: pendingId,
    });
    assert.equal(again.error?.code, FLOW_ENGINE_ERROR_CODES.UNEXPECTED_EFFECT_RESULT);
    // Reintento inválido: el engine rechaza pero no revierte el completed previo en memoria
    // sin store; el estado queda failed hasta que el runtime restaure desde persistencia.
    assert.equal(again.state.status, "failed");
  });

  it("6d. executionId y eventId se registran en state", () => {
    const flow = failureBranchFlow();
    const r = run(
      flow,
      createFlowEngineState(flow, { executionId: "exec-42" }),
      { type: "start", eventId: "evt-1" },
    );
    assert.equal(r.state.executionId, "exec-42");
    assert.equal(r.state.lastEventId, "evt-1");
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 7 — LOOPS
// ---------------------------------------------------------------------------

function questionLoopFlow(): FlowDefinition {
  return {
    name: "Question Loop",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      {
        id: "q",
        type: "question",
        config: {
          text: "Intento?",
          variableKey: "intento",
          required: true,
          validation: { kind: "text" },
        },
      },
      {
        id: "check",
        type: "condition",
        config: {
          match: "all",
          rules: [{ field: "intento", operator: "equals", value: "ok" }],
        },
      },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "q" },
      { id: "e2", source: "q", target: "check" },
      { id: "e3", source: "check", target: "end", sourceHandle: "true" },
      { id: "e4", source: "check", target: "q", sourceHandle: "false" },
    ],
    variables: [{ key: "intento", label: "Intento", type: "string" }],
  };
}

function autoLoopFlow(): FlowDefinition {
  return {
    name: "Auto Loop",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      {
        id: "cond",
        type: "condition",
        config: {
          match: "all",
          rules: [{ field: "x", operator: "equals", value: 1 }],
        },
      },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond" },
      { id: "e2", source: "cond", target: "cond", sourceHandle: "false" },
      { id: "e3", source: "cond", target: "end", sourceHandle: "true" },
    ],
    variables: [{ key: "x", label: "X", type: "number", defaultValue: 0 }],
  };
}

describe("Escenario 7 — Loops", () => {
  beforeEach(resetIds);

  it("7a. ciclo A→QUESTION→A con input es válido", () => {
    const flow = questionLoopFlow();
    let r = start(flow);

    for (const text of ["no", "todavía no", "ok"]) {
      r = run(flow, r.state, { type: "text", text });
      if (text !== "ok") {
        assert.equal(r.state.status, "waiting_input");
        assert.equal(r.state.currentNodeId, "q");
      }
    }
    assert.equal(r.state.status, "completed");
    assert.equal(r.state.variables.intento, "ok");
  });

  it("7b. ciclo A→CONDITION→A sin wait termina en MAX_STEPS_EXCEEDED", () => {
    const flow = autoLoopFlow();
    const r = start(flow, "exec-loop");
    assert.equal(r.state.status, "failed");
    assert.equal(r.error?.code, FLOW_ENGINE_ERROR_CODES.MAX_STEPS_EXCEEDED);
    assert.notEqual(r.state.status, "running");
  });

  it("7c. límite configurable se respeta", () => {
    const flow = autoLoopFlow();
    const execId = `exec-loop-${Math.random().toString(36).slice(2, 9)}`;
    let local = 0;
    const r = runFlowEngine(
      flow,
      createFlowEngineState(flow, { executionId: execId }),
      { type: "start" },
      { maxAutoSteps: 3, idGenerator: () => `${execId}-fx-${++local}` },
    );
    assert.equal(r.error?.code, FLOW_ENGINE_ERROR_CODES.MAX_STEPS_EXCEEDED);
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 8 — VARIABLES / CONTEXTO IA
// ---------------------------------------------------------------------------

describe("Escenario 8 — Variables en contexto IA", () => {
  beforeEach(resetIds);

  it("QUESTION → SAVE_DATA → AI recibe contexto con variables", () => {
    const flow: FlowDefinition = {
      name: "Vars to AI",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "q-nombre",
          type: "question",
          config: {
            text: "Nombre?",
            variableKey: "nombre",
            required: true,
            validation: { kind: "text" },
          },
        },
        {
          id: "q-email",
          type: "question",
          config: {
            text: "Email?",
            variableKey: "email",
            required: true,
            validation: { kind: "email" },
          },
        },
        {
          id: "save",
          type: "save_data",
          config: {
            mappings: [
              { variable: "nombre", target: "lead" },
              { variable: "email", target: "lead" },
            ],
          },
        },
        {
          id: "ai",
          type: "ai",
          config: {
            instruction: "Personaliza respuesta",
            mode: "respond",
            outputVariables: ["respuesta"],
          },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "q-nombre" },
        { id: "e2", source: "q-nombre", target: "q-email" },
        { id: "e3", source: "q-email", target: "save" },
        { id: "e4", source: "save", target: "ai" },
        { id: "e5", source: "ai", target: "end" },
      ],
      variables: [
        { key: "nombre", label: "Nombre", type: "string" },
        { key: "email", label: "Email", type: "string" },
      ],
    };

    let r = start(flow);
    r = run(flow, r.state, { type: "text", text: "Carlos" });
    r = run(flow, r.state, { type: "text", text: "carlos@empresa.com" });

    assert.equal(r.state.exports.lead.nombre, "Carlos");
    assert.equal(r.state.exports.lead.email, "carlos@empresa.com");

    const aiFx = r.effects.find((e) => e.type === "effect_required" && e.kind === "ai");
    assert.ok(aiFx?.type === "effect_required");
    assert.equal(aiFx.context.nombre, "Carlos");
    assert.equal(aiFx.context.email, "carlos@empresa.com");
    assert.equal(r.state.status, "waiting_effect");
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 9 — HUMAN HANDOFF
// ---------------------------------------------------------------------------

describe("Escenario 9 — Human Handoff", () => {
  beforeEach(resetIds);

  it("AI → HUMAN: transferred y sin auto-procesamiento posterior", () => {
    const flow: FlowDefinition = {
      name: "Handoff",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: { instruction: "Responde", mode: "respond" },
        },
        {
          id: "human",
          type: "human",
          config: { pauseDurationHours: 24, message: "Te paso con un humano" },
        },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "human" },
        { id: "e3", source: "human", target: "end" },
      ],
      variables: [],
    };

    let r = start(flow);
    r = completeEffect(flow, r.state, { data: { responseText: "Entendido" } });
    assert.equal(r.state.status, "transferred");
    assert.equal(r.state.currentNodeId, "human");

    const noop = run(flow, r.state, { type: "text", text: "hola" });
    assert.equal(noop.error?.code, FLOW_ENGINE_ERROR_CODES.INVALID_STATE);
    assert.equal(noop.state.status, "failed");
    assert.equal(noop.state.currentNodeId, "human");
  });
});

// ---------------------------------------------------------------------------
// ESCENARIO 10 — REGLA DE ORO: LA IA NO ES LA FUENTE DE VERDAD
// ---------------------------------------------------------------------------

describe("Escenario 10 — Regla de oro", () => {
  beforeEach(resetIds);

  it("10a. flujo correcto: IA no puede confirmar sin effect_result de reserva", () => {
    const flow = spaBookingFlow();
    let r = runSpaThroughConsultar(flow);

    r = completeEffect(flow, r.state, {
      data: { available: true, classification: "available" },
    });
    assert.equal(r.state.pendingEffect?.nodeId, "reservar");
    assert.ok(!hasConfirmMessage(r.effects));
    assert.equal(r.state.status, "waiting_effect");
  });

  it("10b. IA con outputVariables no salta consultar si el grafo exige ACTION", () => {
    const flow = spaBookingFlow();
    let r = start(flow);

    r = completeEffect(flow, r.state, {
      data: {
        classification: "wants_booking",
        intent: "wants_booking",
        available: true,
      },
    });
    assert.equal(r.state.pendingEffect?.nodeId, "consultar");
    assert.ok(!hasConfirmMessage(r.effects));
  });

  it("10c. grafo mal diseñado: IA→confirm directo SÍ llegaría (responsabilidad del builder)", () => {
    const badFlow: FlowDefinition = {
      name: "Bad Flow",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "manual" } },
        {
          id: "ai",
          type: "ai",
          config: {
            instruction: "Clasifica",
            mode: "classify",
            classifications: ["available"],
          },
        },
        { id: "confirm", type: "message", config: { text: "Tu cita está confirmada." } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        {
          id: "e2",
          source: "ai",
          target: "confirm",
          sourceHandle: FLOW_EDGE_HANDLE.aiClass("available"),
        },
        { id: "e3", source: "confirm", target: "end" },
      ],
      variables: [],
    };

    let r = start(badFlow);
    r = completeEffect(badFlow, r.state, { data: { classification: "available" } });
    assert.ok(hasConfirmMessage(r.effects));
    // El engine ejecuta el grafo; validate-publish / builder deben impedir este patrón.
  });
});
