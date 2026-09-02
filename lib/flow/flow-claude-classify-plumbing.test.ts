/**
 * Blocker #7 (autorizado) — Fix A + Fix B, cierre del bug real encontrado en
 * la primera prueba de producción desde el 314.
 *
 * FIX A: classify ya NO puede producir responseText (schema + mapper) --
 * antes, cualquier responseText opcional que Claude decidiera incluir en una
 * clasificación se reenviaba como mensaje real (flow-engine.ts, sin tocar),
 * sin que ningún nodo del grafo lo pidiera.
 *
 * FIX B: __firstMessageText ahora SÍ llega a Claude como userMessage --
 * antes, stripInternalKeys() lo quitaba del bloque VARIABLES (por el prefijo
 * "__") y ningún otro campo lo reintroducía, así que el nodo clasificador
 * literalmente recibía "(empty)" en vez del mensaje real de la clienta.
 *
 * Archivos tocados (ninguno protegido): claude-output-schema.ts,
 * claude-engine-mapper.ts, claude-context-builder.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aiOutputSchema, buildAiOutputToolSchema } from "@/lib/flow/claude/claude-output-schema";
import { mapAiOutputToEngineData } from "@/lib/flow/claude/claude-engine-mapper";
import { buildAIRequest } from "@/lib/flow/claude/claude-context-builder";
import { buildClaudeUserMessages, buildClaudeSystemPrompt } from "@/lib/flow/claude/claude-prompt-builder";
import { buildAIExecutionContext } from "@/lib/flow/claude/claude-context-builder";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import type { AiNodeConfig, FlowDefinition } from "@/lib/flow/types";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";

function schemaProperties(schema: Record<string, unknown>): Record<string, unknown> {
  return schema.properties as Record<string, unknown>;
}

function baseRequest(overrides: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effectId: "fx-1",
    executionRowId: "row-1",
    tenantId: "tenant-1",
    nodeId: "ai-clasificar-intencion",
    attempt: 1,
    kind: "ai",
    payload: {},
    ...overrides,
  } as EffectDispatchRequest;
}

// ---------------------------------------------------------------------------
// A. Schema (aiOutputSchema + buildAiOutputToolSchema)
// ---------------------------------------------------------------------------
describe("Blocker #7 Fix A — schema: classify sin responseText", () => {
  it("1. mode=classify + classification válido -> PASS", () => {
    const r = aiOutputSchema.safeParse({ mode: "classify", classification: "agendar" });
    assert.equal(r.success, true);
  });

  it("2. mode=classify + responseText -> rechazado (campo no declarado, .strict())", () => {
    const r = aiOutputSchema.safeParse({ mode: "classify", classification: "agendar", responseText: "hola" });
    assert.equal(r.success, false, "responseText ya no es una salida válida para classify");
  });

  it("3. buildAiOutputToolSchema('classify') NO contiene responseText", () => {
    const schema = schemaProperties(buildAiOutputToolSchema("classify"));
    assert.equal("responseText" in schema, false);
    assert.deepEqual(Object.keys(schema).sort(), ["classification", "mode"]);
  });

  it("no afecta mode=respond -- sigue exigiendo responseText", () => {
    const r1 = aiOutputSchema.safeParse({ mode: "respond", responseText: "hola" });
    assert.equal(r1.success, true);
    const r2 = aiOutputSchema.safeParse({ mode: "respond" });
    assert.equal(r2.success, false, "respond sigue exigiendo responseText obligatorio, sin cambios");
    const schemaRespond = buildAiOutputToolSchema("respond") as Record<string, unknown>;
    assert.ok("responseText" in schemaProperties(schemaRespond));
    assert.deepEqual(schemaRespond.required, ["mode", "responseText"]);
  });

  it("no afecta mode=propose_action -- responseText sigue opcional, sin cambios", () => {
    const r1 = aiOutputSchema.safeParse({ mode: "propose_action", actionProposal: { actionType: "x" } });
    assert.equal(r1.success, true);
    const r2 = aiOutputSchema.safeParse({
      mode: "propose_action",
      actionProposal: { actionType: "x" },
      responseText: "propuesta",
    });
    assert.equal(r2.success, true);
    const schemaAction = buildAiOutputToolSchema("propose_action");
    assert.ok("responseText" in schemaProperties(schemaAction));
  });
});

// ---------------------------------------------------------------------------
// B. Mapper (claude-engine-mapper.ts)
// ---------------------------------------------------------------------------
describe("Blocker #7 Fix A — mapper: classify nunca produce data.responseText", () => {
  it("4. classify nunca debe producir data.responseText", () => {
    const data = mapAiOutputToEngineData({ mode: "classify", classification: "agendar" });
    assert.equal(data.classification, "agendar");
    assert.equal("responseText" in data, false);
  });

  it("5. respond sigue soportando responseText -- sin cambios", () => {
    const data = mapAiOutputToEngineData({ mode: "respond", responseText: "Hola clienta" });
    assert.equal(data.responseText, "Hola clienta");
  });

  it("6. propose_action no cambia -- responseText opcional sigue funcionando", () => {
    const conResponse = mapAiOutputToEngineData({
      mode: "propose_action",
      actionProposal: { actionType: "agendar_cita_especialista" },
      responseText: "Voy a agendar",
    });
    assert.equal(conResponse.responseText, "Voy a agendar");
    assert.deepEqual(conResponse.actionProposal, { actionType: "agendar_cita_especialista" });

    const sinResponse = mapAiOutputToEngineData({
      mode: "propose_action",
      actionProposal: { actionType: "agendar_cita_especialista" },
    });
    assert.equal("responseText" in sinResponse, false);
  });
});

// ---------------------------------------------------------------------------
// C. Context Builder (claude-context-builder.ts) -- Fix B
// ---------------------------------------------------------------------------
describe("Blocker #7 Fix B — buildAIRequest: __firstMessageText como fallback final de userMessage", () => {
  it("7. payload={__firstMessageText:'Quiero una cita'} -> userMessage='Quiero una cita'", () => {
    const req = buildAIRequest({
      request: baseRequest({ payload: { __firstMessageText: "Quiero una cita" } }),
      ai: { instruction: "Clasifica", mode: "classify", classifications: ["agendar", "otro"] },
      model: "claude-sonnet-5",
    });
    assert.equal(req.userMessage, "Quiero una cita");
  });

  it("8. payload.text sigue teniendo prioridad sobre __firstMessageText", () => {
    const req = buildAIRequest({
      request: baseRequest({ payload: { text: "texto prioritario", __firstMessageText: "no debe usarse" } }),
      ai: { instruction: "x", mode: "classify", classifications: ["a"] },
      model: "claude-sonnet-5",
    });
    assert.equal(req.userMessage, "texto prioritario");
  });

  it("9. aiContext.userMessage sigue teniendo prioridad máxima", () => {
    const req = buildAIRequest({
      request: baseRequest({ payload: { __firstMessageText: "no debe usarse" } }),
      ai: { instruction: "x", mode: "classify", classifications: ["a"] },
      aiContext: { userMessage: "desde aiContext" },
      model: "claude-sonnet-5",
    });
    assert.equal(req.userMessage, "desde aiContext");
  });

  it("10. payload.userMessage sigue funcionando (prioridad intacta sobre __firstMessageText)", () => {
    const req = buildAIRequest({
      request: baseRequest({ payload: { userMessage: "desde payload.userMessage", __firstMessageText: "no debe usarse" } }),
      ai: { instruction: "x", mode: "classify", classifications: ["a"] },
      model: "claude-sonnet-5",
    });
    assert.equal(req.userMessage, "desde payload.userMessage");
  });

  it("11. __firstMessageText vacío/solo espacios -> NO se inventa userMessage", () => {
    const req1 = buildAIRequest({
      request: baseRequest({ payload: { __firstMessageText: "" } }),
      ai: { instruction: "x", mode: "classify", classifications: ["a"] },
      model: "claude-sonnet-5",
    });
    assert.equal(req1.userMessage, undefined);

    const req2 = buildAIRequest({
      request: baseRequest({ payload: { __firstMessageText: "   " } }),
      ai: { instruction: "x", mode: "classify", classifications: ["a"] },
      model: "claude-sonnet-5",
    });
    assert.equal(req2.userMessage, undefined);
  });

  it("12. payload sin ningún campo de mensaje -> userMessage undefined (comportamiento anterior intacto)", () => {
    const req = buildAIRequest({
      request: baseRequest({ payload: {} }),
      ai: { instruction: "x", mode: "classify", classifications: ["a"] },
      model: "claude-sonnet-5",
    });
    assert.equal(req.userMessage, undefined);
  });
});

// ---------------------------------------------------------------------------
// D. Router / integración -- demuestra el plumbing real, node -> Claude
// ---------------------------------------------------------------------------
describe("Blocker #7 Fix B — integración real: Flow node -> buildAIRequest -> userMessage (nunca '(empty)')", () => {
  const routerLike: FlowDefinition = {
    name: "Router mínimo (reproduce el bug real)",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      {
        id: "ai-clasificar-intencion",
        type: "ai",
        config: {
          instruction: "Lee el primer mensaje de la clienta en la variable __firstMessageText y clasifica.",
          mode: "classify",
          classifications: ["agendar", "otro"],
        },
      },
      { id: "end-otro", type: "end", config: {} },
      { id: "end-agendar", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "ai-clasificar-intencion" },
      { id: "e2", source: "ai-clasificar-intencion", target: "end-agendar", sourceHandle: "class:agendar" },
      { id: "e3", source: "ai-clasificar-intencion", target: "end-otro", sourceHandle: "default" },
    ],
    variables: [],
  };

  it("13/14. 'Quiero una cita' llega EXACTO a Claude como USER CONTENT -- no 'agendar' mockeado, no '(empty)'", () => {
    // Paso 1: el motor real arranca con el mensaje real (igual que
    // atenderMensajeConFlow en producción) y emite el effect_required real
    // para el nodo ai-clasificar-intencion.
    const state = createFlowEngineState(routerLike, {});
    const run = runFlowEngine(routerLike, state, { type: "start", text: "Quiero una cita" });
    assert.equal(run.error, undefined);
    const aiEffect = run.effects.find((e) => e.type === "effect_required" && e.kind === "ai");
    assert.ok(aiEffect && aiEffect.type === "effect_required");
    assert.deepEqual(aiEffect!.context, { __firstMessageText: "Quiero una cita" }, "el contexto real que el engine adjunta al efecto -- exactamente lo que producía el bug");

    // Paso 2: ese context real (NO un mock a mano) pasa por buildAIRequest,
    // el mismo camino que usa ClaudeExecutor.dispatch en producción.
    const aiRequest = buildAIRequest({
      request: baseRequest({ payload: aiEffect!.context }),
      ai: routerLike.nodes.find((n) => n.id === "ai-clasificar-intencion")!.config as AiNodeConfig,
      model: "claude-sonnet-5",
    });

    // Antes del Fix B: aiRequest.userMessage era undefined -> Claude veía "(empty)".
    assert.equal(aiRequest.userMessage, "Quiero una cita", "el bug real: antes esto era undefined");

    // Paso 3: el mensaje que Claude realmente recibiría (buildClaudeUserMessages).
    const execCtx = buildAIExecutionContext(aiRequest);
    const userMessages = buildClaudeUserMessages(execCtx);
    assert.equal(userMessages.length, 1);
    assert.equal(
      userMessages[0]!.content,
      "=== USER CONTENT (UNTRUSTED) ===\nQuiero una cita",
      "antes del fix, este content era literalmente '=== USER CONTENT (UNTRUSTED) ===\\n(empty)'",
    );
    assert.ok(!userMessages[0]!.content.includes("(empty)"));

    // El bloque VARIABLES sigue sin exponer __firstMessageText -- el fix es
    // específicamente vía USER CONTENT, no relajando stripInternalKeys.
    const systemPrompt = buildClaudeSystemPrompt(execCtx);
    assert.ok(systemPrompt.includes("=== VARIABLES ===\n{}"), "VARIABLES sigue limpio de claves internas -- el fix no expone __firstMessageText ahí, solo como userMessage");
  });

  it("'Hola' (sin intención clara) también llega exacto -- y ya no puede generar responseText espontáneo", () => {
    const state = createFlowEngineState(routerLike, {});
    const run = runFlowEngine(routerLike, state, { type: "start", text: "Hola" });
    const aiEffect = run.effects.find((e) => e.type === "effect_required" && e.kind === "ai");
    assert.ok(aiEffect && aiEffect.type === "effect_required");
    const aiRequest = buildAIRequest({
      request: baseRequest({ payload: aiEffect.context }),
      ai: routerLike.nodes.find((n) => n.id === "ai-clasificar-intencion")!.config as AiNodeConfig,
      model: "claude-sonnet-5",
    });
    assert.equal(aiRequest.userMessage, "Hola");

    // Simula lo que devolvería Claude AHORA (solo puede producir classification,
    // el schema ya no le permite responseText) y confirma que el motor NO
    // genera ningún mensaje -- criterio de aceptación del Blocker #7.
    const engineData = mapAiOutputToEngineData({ mode: "classify", classification: "otro" });
    const resumed = runFlowEngine(routerLike, run.state, {
      type: "effect_result",
      success: true,
      effectId: run.state.pendingEffect!.effectId,
      data: engineData,
    });
    assert.equal(resumed.error, undefined);
    assert.equal(resumed.state.currentNodeId, "end-otro");
    assert.equal(
      resumed.effects.some((e) => e.type === "send_message"),
      false,
      "criterio de aceptación: 'otro' -> end-otro -> Flow NO manda responseText espontáneo",
    );
  });
});

// ---------------------------------------------------------------------------
// E. Fix C (autorizado) — bug raíz real encontrado revisando TODOS los chats
// reales de Daniela del 1-2 de sept: el tool schema de "classify" aceptaba
// `classification` como string libre (sin `enum`), así que Claude podía
// devolver algo que no calzara carácter por carácter con ninguna de las
// classifications del nodo. flow-engine.ts hace match EXACTO de string
// (rama classify, `FLOW_EDGE_HANDLE.aiClass(classification)`) -- cualquier
// variante caía al edge default, que en el router real de Daniela es
// SIEMPRE traspaso a humano. Resultado real observado: pedidos de cita
// clarísimos en lenguaje natural ("Tiene cita para las manos para el
// sábado en la tarde", "para pedir una cita para el sábado") terminando en
// "voy a pasar tu conversación con Daniela" en vez de agendar.
// ---------------------------------------------------------------------------
describe("Fix C — buildAiOutputToolSchema('classify', classifications) restringe el output real de Claude", () => {
  it("15. sin classifications -> mismo comportamiento de siempre (string libre, sin enum)", () => {
    const schema = buildAiOutputToolSchema("classify") as { properties: { classification: Record<string, unknown> } };
    assert.deepEqual(schema.properties.classification, { type: "string" });
  });

  it("16. con classifications -> el schema del tool_use trae enum EXACTO, en el mismo orden del nodo", () => {
    const schema = buildAiOutputToolSchema("classify", ["agendar", "cancelar", "otro"]) as {
      properties: { classification: Record<string, unknown> };
    };
    assert.deepEqual(schema.properties.classification, { type: "string", enum: ["agendar", "cancelar", "otro"] });
  });

  it("17. classifications=[] (vacío) -> se comporta igual que sin pasarlo, nunca un enum vacío inválido", () => {
    const schema = buildAiOutputToolSchema("classify", []) as { properties: { classification: Record<string, unknown> } };
    assert.deepEqual(schema.properties.classification, { type: "string" });
  });

  it("18. no afecta el resto del schema de classify (mode/required siguen intactos)", () => {
    const schema = buildAiOutputToolSchema("classify", ["agendar", "otro"]) as Record<string, unknown>;
    assert.deepEqual(schema.required, ["mode", "classification"]);
    assert.deepEqual((schema.properties as Record<string, unknown>).mode, { type: "string", enum: ["classify"] });
  });

  it("19. integración real: aiRequest.classifications del nodo llega intacto hasta el tool schema (mismo camino que ClaudeExecutor.dispatch)", () => {
    const aiRequest = buildAIRequest({
      request: baseRequest({ payload: { __firstMessageText: "Tiene cita para las manos para el sábado en la tarde" } }),
      ai: {
        instruction: "Clasifica la intención",
        mode: "classify",
        classifications: ["agendar", "cancelar", "reagendar", "consultar", "producto", "info_servicio", "menu", "handoff_tema", "otro"],
      },
      model: "claude-sonnet-5",
    });
    const schema = buildAiOutputToolSchema(aiRequest.mode, aiRequest.classifications) as {
      properties: { classification: Record<string, unknown> };
    };
    assert.deepEqual(schema.properties.classification, {
      type: "string",
      enum: ["agendar", "cancelar", "reagendar", "consultar", "producto", "info_servicio", "menu", "handoff_tema", "otro"],
    });
  });
});
