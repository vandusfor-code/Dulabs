/**
 * FASE F8.4 (WhatsApp Media inbound, autorizado) — tests de
 * INCOMING_MEDIA_VARIABLE_KEY (lib/flow/constants.ts): el Engine solo
 * SIEMBRA la media normalizada del turno actual en variables, nunca decide
 * nada por sí solo -- mismo criterio EXACTO que FIRST_MESSAGE_TEXT_VARIABLE_KEY
 * (ver flow-engine.test.ts, "Fase 1 Blocker #1").
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FLOW_EDGE_HANDLE, INCOMING_MEDIA_VARIABLE_KEY } from "@/lib/flow/constants";
import type { FlowDefinition } from "@/lib/flow/types";
import type { NormalizedInboundMedia } from "@/lib/flow/engine-types";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";

function flowConPregunta(): FlowDefinition {
  return {
    name: "Test media",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "q", type: "question", config: { text: "?", variableKey: "respuesta", required: false, validation: { kind: "text" } } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "q" },
      { id: "e2", source: "q", target: "end" },
    ],
    variables: [],
  };
}

function imagen(overrides?: Partial<NormalizedInboundMedia>): NormalizedInboundMedia {
  return { type: "image", mediaId: "media-1", mimeType: "image/jpeg", ...overrides };
}

describe("Flow Engine — INCOMING_MEDIA_VARIABLE_KEY en evento 'start'", () => {
  it("1. sin event.media -> variable queda undefined (comportamiento EXACTO de antes de F8.4)", () => {
    const flow = flowConPregunta();
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" });
    assert.equal(r.state.variables[INCOMING_MEDIA_VARIABLE_KEY], undefined);
  });

  it("2. con event.media (image) -> se siembra tal cual, con mediaId/mimeType/caption", () => {
    const flow = flowConPregunta();
    const media = imagen({ caption: "mira esto" });
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start", media });
    assert.deepEqual(r.state.variables[INCOMING_MEDIA_VARIABLE_KEY], media);
  });

  it("3. document -> se siembra con filename", () => {
    const flow = flowConPregunta();
    const media: NormalizedInboundMedia = { type: "document", mediaId: "media-2", filename: "factura.pdf" };
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start", media });
    assert.deepEqual(r.state.variables[INCOMING_MEDIA_VARIABLE_KEY], media);
  });

  it("4. audio -> se siembra sin caption", () => {
    const flow = flowConPregunta();
    const media: NormalizedInboundMedia = { type: "audio", mediaId: "media-3" };
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start", media });
    assert.deepEqual(r.state.variables[INCOMING_MEDIA_VARIABLE_KEY], media);
  });

  it("5. sticker -> se siembra", () => {
    const flow = flowConPregunta();
    const media: NormalizedInboundMedia = { type: "sticker", mediaId: "media-4" };
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start", media });
    assert.deepEqual(r.state.variables[INCOMING_MEDIA_VARIABLE_KEY], media);
  });

  it("6. video -> se siembra con caption", () => {
    const flow = flowConPregunta();
    const media: NormalizedInboundMedia = { type: "video", mediaId: "media-5", caption: "video corto" };
    const r = runFlowEngine(flow, createFlowEngineState(flow), { type: "start", media });
    assert.deepEqual(r.state.variables[INCOMING_MEDIA_VARIABLE_KEY], media);
  });
});

describe("Flow Engine — INCOMING_MEDIA_VARIABLE_KEY en evento 'text' (turno posterior)", () => {
  it("7. un turno de texto normal NO trae media -> queda explícitamente undefined, nunca hereda la del turno anterior", () => {
    const flow = flowConPregunta();
    const state = runFlowEngine(flow, createFlowEngineState(flow), { type: "start", media: imagen() }).state;
    assert.deepEqual(state.variables[INCOMING_MEDIA_VARIABLE_KEY], imagen());
    const r = runFlowEngine(flow, state, { type: "text", text: "hola" });
    assert.equal(r.state.variables[INCOMING_MEDIA_VARIABLE_KEY], undefined, "la media del turno 'start' no debe filtrarse al turno 'text' siguiente");
  });

  it("8. un turno de texto CON media (ej. respondió la pregunta enviando una foto con caption) -> se siembra la de ESTE turno", () => {
    const flow = flowConPregunta();
    const state = runFlowEngine(flow, createFlowEngineState(flow), { type: "start" }).state;
    const media = imagen({ caption: "aquí está" });
    const r = runFlowEngine(flow, state, { type: "text", text: "aquí está", media });
    assert.deepEqual(r.state.variables[INCOMING_MEDIA_VARIABLE_KEY], media);
    // Un flow que no lee la variable de media sigue funcionando exactamente
    // igual -- la respuesta de texto normal a la pregunta no cambia.
    assert.equal(r.state.variables.respuesta, "aquí está");
  });
});

describe("Flow Engine — la variable es realmente utilizable por el grafo (condition)", () => {
  const flowConCondicion: FlowDefinition = {
    name: "Test condición media",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "cond", type: "condition", config: { rules: [{ field: INCOMING_MEDIA_VARIABLE_KEY, operator: "exists" }], match: "all" } },
      { id: "msg-con-media", type: "message", config: { text: "Recibí tu archivo" } },
      { id: "msg-sin-media", type: "message", config: { text: "¿Qué necesitas?" } },
      { id: "end-a", type: "end", config: {} },
      { id: "end-b", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond" },
      { id: "e2", source: "cond", target: "msg-con-media", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
      { id: "e3", source: "cond", target: "msg-sin-media", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
      { id: "e4", source: "msg-con-media", target: "end-a" },
      { id: "e5", source: "msg-sin-media", target: "end-b" },
    ],
    variables: [],
  };

  it("9. con media -> la condición 'exists' toma la rama TRUE (mensaje 'Recibí tu archivo')", () => {
    const r = runFlowEngine(flowConCondicion, createFlowEngineState(flowConCondicion), { type: "start", media: imagen() });
    assert.equal(r.state.status, "completed");
    assert.ok(r.effects.some((e) => e.type === "send_message" && "content" in e && e.content.text === "Recibí tu archivo"));
  });

  it("10. sin media -> la condición 'exists' toma la rama FALSE (mensaje '¿Qué necesitas?')", () => {
    const r = runFlowEngine(flowConCondicion, createFlowEngineState(flowConCondicion), { type: "start" });
    assert.equal(r.state.status, "completed");
    assert.ok(r.effects.some((e) => e.type === "send_message" && "content" in e && e.content.text === "¿Qué necesitas?"));
  });
});
