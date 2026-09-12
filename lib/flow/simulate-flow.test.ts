/**
 * Tests del Flow Simulator — Fase 1 (Flow Simulator, autorizado).
 *
 * Cobertura mínima pedida (spec §28-29), puntos 1-14 y 20 (16-19 se cubren
 * en simulate-flow-security.test.ts y app/api/flows/[id]/simulate/simulate-api.test.ts).
 * Mismo patrón que lib/flow/flow-engine.test.ts: node:test nativo vía tsx,
 * sin mocks de red (no hay red que mockear -- el driver y los executors
 * simulados son 100% síncronos/en memoria).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowDefinition } from "@/lib/flow/types";
import { runSimulationTurn } from "@/lib/flow/simulate-flow";
import { createSimulatedExecutorRegistry } from "@/lib/flow/executors/simulated-executor-registry";

function registry(overrides?: Parameters<typeof createSimulatedExecutorRegistry>[0]) {
  return createSimulatedExecutorRegistry(overrides);
}

// -----------------------------------------------------------------------
// 1. START -> MESSAGE -> END
// -----------------------------------------------------------------------
function simpleFlow(): FlowDefinition {
  return {
    name: "simple",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "Hola" } },
      { id: "end", type: "end", config: { message: "Adiós" } },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "end" },
    ],
    variables: [],
  };
}

describe("Simulate Flow — 1. START -> MESSAGE -> END", () => {
  it("corre de punta a punta en un solo turno y queda 'completed'", async () => {
    const r = await runSimulationTurn({ flow: simpleFlow(), engineState: null, event: { type: "start" }, registry: registry(), tenantId: "t1" });
    assert.equal(r.status, "completed");
    assert.equal(r.completed?.nodeId, "end");
    assert.deepEqual(r.messages.map((m) => m.content.text), ["Hola", "Adiós"]);
    assert.ok(r.messages.every((m) => m.simulated === true));
    assert.ok(r.effectsLog.some((e) => e.kind === "end" && e.summary === "✓ Flow finalizado"));
    assert.equal(r.transitions[0]!.reason, "start");
  });
});

// -----------------------------------------------------------------------
// 2. QUESTION (+ 7. interpolación, + validación)
// -----------------------------------------------------------------------
function questionFlow(): FlowDefinition {
  return {
    name: "question",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "q", type: "question", config: { text: "¿Cómo te llamas?", variableKey: "nombre", required: true, validation: { kind: "text" } } },
      { id: "greet", type: "message", config: { text: "Hola {{nombre}}, bienvenido/a" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "q" },
      { id: "e2", source: "q", target: "greet" },
      { id: "e3", source: "greet", target: "end" },
    ],
    variables: [{ key: "nombre", label: "Nombre", type: "string" }],
  };
}

describe("Simulate Flow — 2. QUESTION + 7. interpolación", () => {
  it("espera texto, valida, guarda la variable e interpola el siguiente mensaje", async () => {
    const reg = registry();
    const r1 = await runSimulationTurn({ flow: questionFlow(), engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    assert.equal(r1.status, "waiting_input");
    assert.equal(r1.expectedInput, "text");
    assert.equal(r1.currentNodeId, "q");

    const r2 = await runSimulationTurn({ flow: questionFlow(), engineState: r1.engineState, event: { type: "text", text: "Duvan" }, registry: reg, tenantId: "t1" });
    assert.equal(r2.variables.nombre, "Duvan");
    assert.ok(r2.messages.some((m) => m.content.text === "Hola Duvan, bienvenido/a"), "debe interpolar EXACTAMENTE con lib/flow/message-interpolation.ts");
    assert.equal(r2.status, "completed");
  });

  it("texto inválido -> reintento con mensaje de error, nunca avanza de nodo", async () => {
    const flow: FlowDefinition = {
      name: "validacion",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "q", type: "question", config: { text: "Edad?", variableKey: "edad", required: true, validation: { kind: "number" } } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "q" },
        { id: "e2", source: "q", target: "end" },
      ],
      variables: [{ key: "edad", label: "Edad", type: "number" }],
    };
    const reg = registry();
    const r1 = await runSimulationTurn({ flow, engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    const r2 = await runSimulationTurn({ flow, engineState: r1.engineState, event: { type: "text", text: "no-es-numero" }, registry: reg, tenantId: "t1" });
    assert.equal(r2.status, "waiting_input");
    assert.equal(r2.currentNodeId, "q");
    assert.ok(r2.messages.some((m) => m.origin === "system"));
  });
});

// -----------------------------------------------------------------------
// 3. BUTTONS
// -----------------------------------------------------------------------
function buttonsFlow(): FlowDefinition {
  return {
    name: "buttons",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      {
        id: "b",
        type: "buttons",
        config: { text: "¿Te gustó?", buttons: [{ id: "si", label: "Sí" }, { id: "no", label: "No" }] },
      },
      { id: "yes", type: "message", config: { text: "¡Genial!" } },
      { id: "no", type: "message", config: { text: "Lo sentimos" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "b" },
      { id: "e2", source: "b", target: "yes", sourceHandle: "button:si" },
      { id: "e3", source: "b", target: "no", sourceHandle: "button:no" },
      { id: "e4", source: "yes", target: "end" },
      { id: "e5", source: "no", target: "end" },
    ],
    variables: [],
  };
}

describe("Simulate Flow — 3. BUTTONS", () => {
  it("expone los botones reales del nodo y un clic produce el MISMO evento que un tap real", async () => {
    const reg = registry();
    const r1 = await runSimulationTurn({ flow: buttonsFlow(), engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    assert.equal(r1.expectedInput, "button");
    assert.deepEqual(r1.currentButtons?.map((b) => b.id), ["si", "no"]);

    const r2 = await runSimulationTurn({ flow: buttonsFlow(), engineState: r1.engineState, event: { type: "button", id: "si" }, registry: reg, tenantId: "t1" });
    assert.ok(r2.messages.some((m) => m.content.text === "¡Genial!"));
    assert.equal(r2.status, "completed");
    assert.ok(r2.transitions.some((t) => t.reason === "button" && t.toNodeId === "yes"));
  });

  it("botón inexistente -> invalid_input, nunca avanza (el Engine real lo rechaza igual)", async () => {
    const reg = registry();
    const r1 = await runSimulationTurn({ flow: buttonsFlow(), engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    const r2 = await runSimulationTurn({ flow: buttonsFlow(), engineState: r1.engineState, event: { type: "button", id: "no-existe" }, registry: reg, tenantId: "t1" });
    assert.equal(r2.status, "waiting_input");
    assert.equal(r2.currentNodeId, "b");
  });
});

// -----------------------------------------------------------------------
// 4/5. CONDITION true/false + 6. SAVE_DATA + 8. múltiples variables
// -----------------------------------------------------------------------
function conditionFlow(): FlowDefinition {
  return {
    name: "condition",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "save", type: "save_data", config: { mappings: [{ variable: "tipo_cliente", target: "custom_field", targetKey: "tipo" }] } },
      { id: "cond", type: "condition", config: { rules: [{ field: "tipo_cliente", operator: "equals", value: "empresa" }], match: "all" } },
      { id: "msgEmpresa", type: "message", config: { text: "Bienvenida empresa {{nombre}} de {{ciudad}}" } },
      { id: "msgPersona", type: "message", config: { text: "Bienvenida persona {{nombre}}" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "save" },
      { id: "e2", source: "save", target: "cond" },
      { id: "e3", source: "cond", target: "msgEmpresa", sourceHandle: "true" },
      { id: "e4", source: "cond", target: "msgPersona", sourceHandle: "false" },
      { id: "e5", source: "msgEmpresa", target: "end" },
      { id: "e6", source: "msgPersona", target: "end" },
    ],
    variables: [
      { key: "nombre", label: "Nombre", type: "string" },
      { key: "ciudad", label: "Ciudad", type: "string" },
      { key: "tipo_cliente", label: "Tipo", type: "string" },
    ],
  };
}

describe("Simulate Flow — 4/5. CONDITION true/false + 6. SAVE_DATA + 8. múltiples variables", () => {
  it("4. condición TRUE -- usa exactamente el mismo evaluador (equals/match:all)", async () => {
    const reg = registry();
    const r = await runSimulationTurn({
      flow: conditionFlow(),
      engineState: null,
      event: { type: "start" },
      registry: reg,
      tenantId: "t1",
      initialVariables: { nombre: "Duvan", ciudad: "Montería", tipo_cliente: "empresa" },
    });
    assert.ok(r.messages.some((m) => m.content.text === "Bienvenida empresa Duvan de Montería"), "8. múltiples variables interpoladas a la vez");
    const cond = r.conditionEvaluations.find((c) => c.nodeId === "cond");
    assert.equal(cond?.result, true, "el inspector debe mostrar la condición evaluada y el resultado (TRUE)");
    // 6. save_data: antes/después de exports visibles.
    assert.equal(r.saveDataNodeId, "save");
    assert.deepEqual(r.exportsBefore.custom_fields, {});
    assert.equal(r.exports.custom_fields.tipo, "empresa");
  });

  it("5. condición FALSE", async () => {
    const reg = registry();
    const r = await runSimulationTurn({
      flow: conditionFlow(),
      engineState: null,
      event: { type: "start" },
      registry: reg,
      tenantId: "t1",
      initialVariables: { nombre: "Ana", tipo_cliente: "persona" },
    });
    assert.ok(r.messages.some((m) => m.content.text === "Bienvenida persona Ana"));
    const cond = r.conditionEvaluations.find((c) => c.nodeId === "cond");
    assert.equal(cond?.result, false, "el inspector debe mostrar la condición evaluada y el resultado (FALSE)");
  });
});

// -----------------------------------------------------------------------
// 9. AI simulada
// -----------------------------------------------------------------------
function aiFlow(): FlowDefinition {
  return {
    name: "ai",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "ai", type: "ai", config: { instruction: "Responde amablemente", mode: "respond" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "ai" },
      { id: "e2", source: "ai", target: "end", sourceHandle: "success" },
    ],
    variables: [],
  };
}

describe("Simulate Flow — 9. AI simulada", () => {
  it("nunca llama a Claude/Gemini real -- devuelve una respuesta simulada controlada y el flow continúa", async () => {
    const reg = registry();
    const r = await runSimulationTurn({ flow: aiFlow(), engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    assert.equal(r.status, "completed");
    const aiEffect = r.effectsLog.find((e) => e.kind === "ai");
    assert.ok(aiEffect);
    assert.equal(aiEffect!.data?.simulated, true);
    assert.equal(aiEffect!.data?.response, "Respuesta simulada de IA");
  });

  it("permite override configurable de la respuesta simulada por nodo", async () => {
    const reg = registry({ ai: { ai: { responseText: "Hola desde override" } } });
    const r = await runSimulationTurn({ flow: aiFlow(), engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    assert.ok(r.messages.some((m) => m.content.text === "Hola desde override"));
  });

  it("modo classify -- usa la primera clasificación declarada por defecto y toma la rama correspondiente", async () => {
    const flow: FlowDefinition = {
      name: "ai-classify",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "ai", type: "ai", config: { instruction: "Clasifica", mode: "classify", classifications: ["interesado", "no_interesado"] } },
        { id: "a", type: "message", config: { text: "Rama interesado" } },
        { id: "b", type: "message", config: { text: "Rama no interesado" } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "ai" },
        { id: "e2", source: "ai", target: "a", sourceHandle: "class:interesado" },
        { id: "e3", source: "ai", target: "b", sourceHandle: "class:no_interesado" },
        { id: "e4", source: "a", target: "end" },
        { id: "e5", source: "b", target: "end" },
      ],
      variables: [],
    };
    const reg = registry();
    const r = await runSimulationTurn({ flow, engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    assert.ok(r.messages.some((m) => m.content.text === "Rama interesado"));
    assert.ok(r.transitions.some((t) => t.reason === "ai_classification" && t.toNodeId === "a"));
  });
});

// -----------------------------------------------------------------------
// 10. ACTION simulada + 11. WEBHOOK simulado
// -----------------------------------------------------------------------
describe("Simulate Flow — 10. ACTION simulada + 11. WEBHOOK simulado", () => {
  it("crear_lead_enterprise -- nunca crea un lead real, registra la intención", async () => {
    const flow: FlowDefinition = {
      name: "action",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "act", type: "action", config: { actionType: "crear_lead_enterprise", params: { nombre: "Ana", telefono: "3001234567" } } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "act" },
        { id: "e2", source: "act", target: "end", sourceHandle: "success" },
      ],
      variables: [],
    };
    const reg = registry();
    const r = await runSimulationTurn({ flow, engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    const actionEffect = r.effectsLog.find((e) => e.kind === "action");
    assert.ok(actionEffect);
    assert.equal(actionEffect!.data?.simulated, true);
    assert.match(actionEffect!.summary, /Acción simulada/);
    assert.match(actionEffect!.summary, /nombre=Ana/);
    assert.equal(r.status, "completed");
  });

  it("webhook_http -- nunca hace la llamada HTTP real", async () => {
    const flow: FlowDefinition = {
      name: "webhook",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "wh", type: "action", config: { actionType: "webhook_http", url: "https://ejemplo.com/hook", method: "POST" } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "wh" },
        { id: "e2", source: "wh", target: "end", sourceHandle: "success" },
      ],
      variables: [],
    };
    const reg = registry();
    const r = await runSimulationTurn({ flow, engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    const webhookEffect = r.effectsLog.find((e) => e.kind === "action");
    assert.ok(webhookEffect);
    assert.equal(webhookEffect!.data?.simulated, true);
    assert.match(webhookEffect!.summary, /Webhook simulado/);
  });

  it("enviar_plantilla -- nunca llama a Meta", async () => {
    const flow: FlowDefinition = {
      name: "plantilla",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "tpl", type: "action", config: { actionType: "enviar_plantilla", templateName: "bienvenida" } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { id: "e1", source: "start", target: "tpl" },
        { id: "e2", source: "tpl", target: "end", sourceHandle: "success" },
      ],
      variables: [],
    };
    const reg = registry();
    const r = await runSimulationTurn({ flow, engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    const tplEffect = r.effectsLog.find((e) => e.kind === "action");
    assert.match(tplEffect!.summary, /Plantilla Meta simulada/);
  });
});

// -----------------------------------------------------------------------
// 12. HUMAN simulado
// -----------------------------------------------------------------------
describe("Simulate Flow — 12. HUMAN simulado", () => {
  it("nunca transfiere de verdad -- marca dónde se pausa la automatización", async () => {
    const flow: FlowDefinition = {
      name: "human",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "h", type: "human", config: { message: "Te paso con un asesor", pauseDurationHours: 4 } },
      ],
      edges: [{ id: "e1", source: "start", target: "h" }],
      variables: [],
    };
    const reg = registry();
    const r = await runSimulationTurn({ flow, engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    assert.equal(r.status, "transferred");
    assert.equal(r.humanHandoff?.nodeId, "h");
    assert.equal(r.humanHandoff?.pauseDurationHours, 4);
    assert.ok(r.effectsLog.some((e) => e.kind === "human" && /Simulación transferida a un asesor/.test(e.summary)));
    assert.ok(r.messages.some((m) => m.content.text === "Te paso con un asesor"));
  });
});

// -----------------------------------------------------------------------
// 13. END
// -----------------------------------------------------------------------
describe("Simulate Flow — 13. END", () => {
  it("muestra '✓ Flow finalizado' y queda listo para 'Reiniciar simulación'", async () => {
    const r = await runSimulationTurn({ flow: simpleFlow(), engineState: null, event: { type: "start" }, registry: registry(), tenantId: "t1" });
    assert.equal(r.status, "completed");
    assert.equal(r.completed?.nodeId, "end");
  });
});

// -----------------------------------------------------------------------
// 14. Error de configuración
// -----------------------------------------------------------------------
describe("Simulate Flow — 14. Error de configuración", () => {
  it("nodo sin transición saliente -> error legible con nodeId, nunca cuelga el turno", async () => {
    const flow: FlowDefinition = {
      name: "roto",
      nodes: [
        { id: "start", type: "start", config: { triggerType: "first_message" } },
        { id: "msg", type: "message", config: { text: "Hola" } },
        // "msg" no tiene ninguna edge saliente -- error real de configuración.
      ],
      edges: [{ id: "e1", source: "start", target: "msg" }],
      variables: [],
    };
    const r = await runSimulationTurn({ flow, engineState: null, event: { type: "start" }, registry: registry(), tenantId: "t1" });
    assert.equal(r.status, "failed");
    assert.ok(r.error);
    assert.equal(r.error!.nodeId, "msg");
    assert.match(r.error!.message, /transición/);
  });
});

// -----------------------------------------------------------------------
// 20. Reset de simulación
// -----------------------------------------------------------------------
describe("Simulate Flow — 20. Reset de simulación", () => {
  it("engineState:null vuelve a arrancar desde el nodo start con variables frescas -- nunca arrastra estado previo", async () => {
    const reg = registry();
    const r1 = await runSimulationTurn({
      flow: questionFlow(),
      engineState: null,
      event: { type: "start" },
      registry: reg,
      tenantId: "t1",
    });
    const r2 = await runSimulationTurn({ flow: questionFlow(), engineState: r1.engineState, event: { type: "text", text: "Duvan" }, registry: reg, tenantId: "t1" });
    assert.equal(r2.variables.nombre, "Duvan");
    assert.equal(r2.status, "completed");

    // "Reiniciar" -- el cliente simplemente vuelve a mandar engineState:null.
    const rReset = await runSimulationTurn({ flow: questionFlow(), engineState: null, event: { type: "start" }, registry: reg, tenantId: "t1" });
    assert.equal(rReset.variables.nombre, undefined, "el reinicio no debe arrastrar la variable de la simulación anterior");
    assert.equal(rReset.status, "waiting_input");
    assert.equal(rReset.currentNodeId, "q");
  });
});

// -----------------------------------------------------------------------
// Límite de pasos / ciclos (spec §27) -- nunca cuelga el request.
// -----------------------------------------------------------------------
describe("Simulate Flow — límite de ciclos (spec §27)", () => {
  it("una cadena de nodos action encadenados sin fin se corta con un error controlado, nunca cuelga", async () => {
    const nodes: FlowDefinition["nodes"] = [{ id: "start", type: "start", config: { triggerType: "first_message" } }];
    const edges: FlowDefinition["edges"] = [];
    const N = 40;
    for (let i = 0; i < N; i++) {
      nodes.push({ id: `act${i}`, type: "action", config: { actionType: "crear_lead_enterprise", params: {} } });
      edges.push({ id: `e${i}`, source: i === 0 ? "start" : `act${i - 1}`, target: `act${i}`, sourceHandle: i === 0 ? undefined : "success" });
    }
    const flow: FlowDefinition = { name: "ciclo", nodes, edges, variables: [] };
    const r = await runSimulationTurn({ flow, engineState: null, event: { type: "start" }, registry: registry(), tenantId: "t1" });
    assert.equal(r.status, "failed");
    assert.equal(r.error?.code, "SIMULATION_EFFECT_LOOP_LIMIT");
  });
});
