/**
 * Etapa 2 (Flow Builder, autorizado) — tests de las funciones puras de
 * edición local. Fixture propio (no Daniela, no red): un Flow sintético
 * mínimo que toca los 10 tipos de nodo.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addEdge, addNode, deleteEdge, deleteEdges, deleteNode, deleteNodes, updateNodeConfig, updateNodeLabel, updateNodePosition } from "@/lib/flow-builder/edit-flow";
import { validateNodeEdit } from "@/lib/flow-builder/validate-node-edit";
import type { FlowDefinition } from "@/lib/flow/types";

function fixture(): FlowDefinition {
  return {
    name: "fixture",
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, config: { triggerType: "first_message" } },
      { id: "msg-1", type: "message", position: { x: 100, y: 0 }, config: { text: "hola", messageRole: "informational" } },
      { id: "q-1", type: "question", position: { x: 200, y: 0 }, config: { text: "¿cuál?", variableKey: "respuesta", required: true, validation: { kind: "text" } } },
      {
        id: "bt-1",
        type: "buttons",
        position: { x: 300, y: 0 },
        config: { text: "elige", buttons: [{ id: "si", label: "Sí" }, { id: "no", label: "No" }] },
      },
      {
        id: "cond-1",
        type: "condition",
        position: { x: 400, y: 0 },
        config: { rules: [{ field: "x", operator: "exists" }], match: "all" },
      },
      {
        id: "ai-1",
        type: "ai",
        position: { x: 500, y: 0 },
        config: { instruction: "clasifica", mode: "classify", classifications: ["a", "b"] },
      },
      {
        id: "save-1",
        type: "save_data",
        position: { x: 600, y: 0 },
        config: { mappings: [{ variable: "x", target: "lead" }] },
      },
      {
        id: "act-1",
        type: "action",
        position: { x: 700, y: 0 },
        config: { actionType: "webhook_http", url: "https://example.com", method: "POST" },
      },
      {
        id: "human-1",
        type: "human",
        position: { x: 800, y: 0 },
        config: { pauseDurationHours: 1 },
      },
      { id: "end-1", type: "end", position: { x: 900, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg-1" },
      { id: "e2", source: "msg-1", target: "q-1" },
      { id: "e3", source: "bt-1", target: "cond-1", sourceHandle: "button:si" },
      { id: "e4", source: "cond-1", target: "ai-1", sourceHandle: "true" },
      { id: "e5", source: "ai-1", target: "save-1", sourceHandle: "class:a" },
      { id: "e6", source: "save-1", target: "act-1" },
      { id: "e7", source: "act-1", target: "human-1", sourceHandle: "success" },
      { id: "e8", source: "human-1", target: "end-1" },
    ],
    variables: [{ key: "respuesta", label: "Respuesta", type: "string" }],
  };
}

describe("updateNodeLabel", () => {
  it("2. edita el label de un nodo sin tocar nada más", () => {
    const flow = fixture();
    const result = updateNodeLabel(flow, "msg-1", "Mensaje de bienvenida");
    const node = result.nodes.find((n) => n.id === "msg-1")!;
    assert.equal(node.label, "Mensaje de bienvenida");
    assert.deepEqual(node.config, fixture().nodes.find((n) => n.id === "msg-1")!.config);
  });

  it("15a. updateNodeLabel nunca cambia id ni type", () => {
    const flow = fixture();
    const result = updateNodeLabel(flow, "msg-1", "otro label");
    const node = result.nodes.find((n) => n.id === "msg-1")!;
    assert.equal(node.id, "msg-1");
    assert.equal(node.type, "message");
  });
});

describe("updateNodeConfig — un caso por tipo", () => {
  it("3. message.text", () => {
    const flow = fixture();
    const result = updateNodeConfig(flow, "msg-1", { text: "nuevo texto", messageRole: "informational" });
    assert.equal((result.nodes.find((n) => n.id === "msg-1") as { config: { text: string } }).config.text, "nuevo texto");
  });

  it("4. question.text", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "q-1")!;
    assert.equal(node.type, "question");
    const result = updateNodeConfig(flow, "q-1", { ...node.config, text: "¿nueva pregunta?" });
    const updated = result.nodes.find((n) => n.id === "q-1")!;
    assert.equal(updated.type, "question");
    assert.equal((updated as typeof node).config.text, "¿nueva pregunta?");
  });

  it("5. question.validation", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "q-1")!;
    assert.equal(node.type, "question");
    const result = updateNodeConfig(flow, "q-1", { ...node.config, validation: { kind: "email" } });
    const updated = result.nodes.find((n) => n.id === "q-1")!;
    assert.equal(updated.type, "question");
    assert.deepEqual((updated as typeof node).config.validation, { kind: "email" });
  });

  it("6. buttons (label de un botón existente)", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "bt-1")!;
    assert.equal(node.type, "buttons");
    const nuevosBotones = node.config.buttons.map((b) => (b.id === "si" ? { ...b, label: "Claro que sí" } : b));
    const result = updateNodeConfig(flow, "bt-1", { ...node.config, buttons: nuevosBotones });
    const updated = result.nodes.find((n) => n.id === "bt-1")!;
    assert.equal(updated.type, "buttons");
    assert.equal((updated as typeof node).config.buttons.find((b) => b.id === "si")!.label, "Claro que sí");
    // el id del botón (del que depende el edge button:si) permanece igual
    assert.equal((updated as typeof node).config.buttons.map((b) => b.id).join(","), "si,no");
  });

  it("7. condition (regla existente)", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "cond-1")!;
    assert.equal(node.type, "condition");
    const result = updateNodeConfig(flow, "cond-1", {
      ...node.config,
      rules: [{ field: "y", operator: "equals", value: "z" }],
    });
    const updated = result.nodes.find((n) => n.id === "cond-1")!;
    assert.equal(updated.type, "condition");
    assert.deepEqual((updated as typeof node).config.rules, [{ field: "y", operator: "equals", value: "z" }]);
  });

  it("8. ai (instrucción, sin tocar mode ni classifications)", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(node.type, "ai");
    const result = updateNodeConfig(flow, "ai-1", { ...node.config, instruction: "nueva instrucción" });
    const updated = result.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(updated.type, "ai");
    assert.equal((updated as typeof node).config.instruction, "nueva instrucción");
    assert.equal((updated as typeof node).config.mode, "classify");
    assert.deepEqual((updated as typeof node).config.classifications, ["a", "b"]);
  });

  it("9. action (url de webhook_http)", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "act-1")!;
    assert.equal(node.type, "action");
    assert.equal(node.config.actionType, "webhook_http");
    const result = updateNodeConfig(flow, "act-1", { ...node.config, url: "https://otra.com/webhook" });
    const updated = result.nodes.find((n) => n.id === "act-1")!;
    assert.equal(updated.type, "action");
    assert.equal((updated as typeof node).config.actionType, "webhook_http");
    assert.equal((updated as { config: { url: string } }).config.url, "https://otra.com/webhook");
  });

  it("10. save_data (variable de un mapeo existente)", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "save-1")!;
    assert.equal(node.type, "save_data");
    const result = updateNodeConfig(flow, "save-1", { mappings: [{ variable: "y", target: "lead" }] });
    const updated = result.nodes.find((n) => n.id === "save-1")!;
    assert.equal(updated.type, "save_data");
    assert.equal((updated as typeof node).config.mappings[0].variable, "y");
  });

  it("11. human (pauseDurationHours)", () => {
    const flow = fixture();
    const result = updateNodeConfig(flow, "human-1", { pauseDurationHours: 4, assignTo: "agente-x" });
    const updated = result.nodes.find((n) => n.id === "human-1")!;
    assert.equal(updated.type, "human");
    assert.equal((updated as { config: { pauseDurationHours: number } }).config.pauseDurationHours, 4);
  });

  it("15b. updateNodeConfig nunca cambia id ni type, sin importar qué config se pase", () => {
    const flow = fixture();
    const result = updateNodeConfig(flow, "msg-1", { text: "x" });
    const node = result.nodes.find((n) => n.id === "msg-1")!;
    assert.equal(node.id, "msg-1");
    assert.equal(node.type, "message");
  });
});

describe("updateNodePosition", () => {
  it("12. cambia la posición del nodo", () => {
    const flow = fixture();
    const result = updateNodePosition(flow, "msg-1", { x: 555, y: 777 });
    assert.deepEqual(result.nodes.find((n) => n.id === "msg-1")!.position, { x: 555, y: 777 });
  });

  it("13. mover un nodo no altera su config", () => {
    const flow = fixture();
    const antes = flow.nodes.find((n) => n.id === "msg-1")!.config;
    const result = updateNodePosition(flow, "msg-1", { x: 555, y: 777 });
    const despues = result.nodes.find((n) => n.id === "msg-1")!.config;
    assert.deepEqual(despues, antes);
  });

  it("14. editar config no altera edges", () => {
    const flow = fixture();
    const result = updateNodeConfig(flow, "msg-1", { text: "cambiado" });
    assert.deepEqual(result.edges, flow.edges);
  });

  it("19. drag node -> cambia position, config idéntica, edges idénticos (test combinado pedido)", () => {
    const flow = fixture();
    const result = updateNodePosition(flow, "bt-1", { x: 42, y: 99 });
    assert.deepEqual(result.nodes.find((n) => n.id === "bt-1")!.position, { x: 42, y: 99 });
    assert.deepEqual(result.nodes.find((n) => n.id === "bt-1")!.config, flow.nodes.find((n) => n.id === "bt-1")!.config);
    assert.deepEqual(result.edges, flow.edges);
    // el resto de nodos ni se tocan
    for (const id of ["start", "msg-1", "q-1", "cond-1", "ai-1", "save-1", "act-1", "human-1", "end-1"]) {
      assert.deepEqual(result.nodes.find((n) => n.id === id), flow.nodes.find((n) => n.id === id));
    }
  });
});

// ---------------------------------------------------------------------------
// Corrección de cierre de Etapa 2 -- ai.mode, ai.classifications[].value y
// buttons[].id pasan de solo-lectura a editables. Verifican exactamente lo
// que motivó la corrección: cambiarlos nunca toca `edges` ni `id`, y el nodo
// resultante sigue siendo válido según flowNodeSchema (el edge anterior
// puede quedar huérfano en el canvas -- eso es esperado hasta Etapa 3, y no
// es responsabilidad de estas funciones puras).
// ---------------------------------------------------------------------------

describe("Corrección Etapa 2 — ai.mode editable", () => {
  it("cambia mode correctamente", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(node.type, "ai");
    const result = updateNodeConfig(flow, "ai-1", { ...node.config, mode: "respond" });
    const updated = result.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(updated.type, "ai");
    assert.equal((updated as typeof node).config.mode, "respond");
  });

  it("edges permanece exactamente igual al cambiar mode", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(node.type, "ai");
    const result = updateNodeConfig(flow, "ai-1", { ...node.config, mode: "respond" });
    assert.deepEqual(result.edges, flow.edges);
    // en particular, el edge e5 (source ai-1, sourceHandle class:a) sigue
    // existiendo tal cual -- queda huérfano en el canvas, no se borra.
    assert.deepEqual(
      result.edges.find((e) => e.id === "e5"),
      flow.edges.find((e) => e.id === "e5"),
    );
  });

  it("id del nodo permanece intacto al cambiar mode", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(node.type, "ai");
    const result = updateNodeConfig(flow, "ai-1", { ...node.config, mode: "extract" });
    assert.equal(result.nodes.find((n) => n.id === "ai-1")!.id, "ai-1");
  });

  it("el FlowNode sigue siendo válido según flowNodeSchema tras cambiar mode", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(node.type, "ai");
    const result = updateNodeConfig(flow, "ai-1", { ...node.config, mode: "propose_action" });
    const updated = result.nodes.find((n) => n.id === "ai-1")!;
    assert.deepEqual(validateNodeEdit(updated), []);
  });
});

describe("Corrección Etapa 2 — ai.classifications[].value editable", () => {
  it("cambia el valor de una clasificación existente", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(node.type, "ai");
    const result = updateNodeConfig(flow, "ai-1", { ...node.config, classifications: ["urgente", "b"] });
    const updated = result.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(updated.type, "ai");
    assert.deepEqual((updated as typeof node).config.classifications, ["urgente", "b"]);
  });

  it("no cambia la cantidad de clasificaciones (no add/remove en esta etapa)", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(node.type, "ai");
    const result = updateNodeConfig(flow, "ai-1", { ...node.config, classifications: ["urgente", "b"] });
    const updated = result.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(updated.type, "ai");
    assert.equal((updated as typeof node).config.classifications?.length, node.config.classifications?.length);
  });

  it("edges permanece exactamente igual al cambiar un valor de clasificación", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(node.type, "ai");
    const result = updateNodeConfig(flow, "ai-1", { ...node.config, classifications: ["urgente", "b"] });
    assert.deepEqual(result.edges, flow.edges);
    // e5 seguía apuntando a class:a -- ahora huérfano, pero intacto.
    assert.equal(result.edges.find((e) => e.id === "e5")?.sourceHandle, "class:a");
  });

  it("id del nodo permanece intacto al cambiar una clasificación", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(node.type, "ai");
    const result = updateNodeConfig(flow, "ai-1", { ...node.config, classifications: ["urgente", "b"] });
    assert.equal(result.nodes.find((n) => n.id === "ai-1")!.id, "ai-1");
  });

  it("el FlowNode sigue siendo válido según flowNodeSchema tras editar una clasificación", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "ai-1")!;
    assert.equal(node.type, "ai");
    const result = updateNodeConfig(flow, "ai-1", { ...node.config, classifications: ["urgente", "b"] });
    const updated = result.nodes.find((n) => n.id === "ai-1")!;
    assert.deepEqual(validateNodeEdit(updated), []);
  });
});

describe("Corrección Etapa 2 — buttons[].id editable", () => {
  it("cambia el id de un botón existente", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "bt-1")!;
    assert.equal(node.type, "buttons");
    const nuevosBotones = node.config.buttons.map((b) => (b.id === "si" ? { ...b, id: "afirmativo" } : b));
    const result = updateNodeConfig(flow, "bt-1", { ...node.config, buttons: nuevosBotones });
    const updated = result.nodes.find((n) => n.id === "bt-1")!;
    assert.equal(updated.type, "buttons");
    assert.deepEqual(
      (updated as typeof node).config.buttons.map((b) => b.id),
      ["afirmativo", "no"],
    );
    // el label no se ve afectado por cambiar el id
    assert.equal((updated as typeof node).config.buttons[0].label, "Sí");
  });

  it("no cambia la cantidad de botones (no add/remove en esta etapa)", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "bt-1")!;
    assert.equal(node.type, "buttons");
    const nuevosBotones = node.config.buttons.map((b) => (b.id === "si" ? { ...b, id: "afirmativo" } : b));
    const result = updateNodeConfig(flow, "bt-1", { ...node.config, buttons: nuevosBotones });
    const updated = result.nodes.find((n) => n.id === "bt-1")!;
    assert.equal(updated.type, "buttons");
    assert.equal((updated as typeof node).config.buttons.length, node.config.buttons.length);
  });

  it("edges permanece exactamente igual al cambiar el id de un botón", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "bt-1")!;
    assert.equal(node.type, "buttons");
    const nuevosBotones = node.config.buttons.map((b) => (b.id === "si" ? { ...b, id: "afirmativo" } : b));
    const result = updateNodeConfig(flow, "bt-1", { ...node.config, buttons: nuevosBotones });
    assert.deepEqual(result.edges, flow.edges);
    // e3 seguía apuntando a button:si -- ahora huérfano (el botón ya se
    // llama "afirmativo"), pero el edge en sí queda intacto.
    assert.equal(result.edges.find((e) => e.id === "e3")?.sourceHandle, "button:si");
  });

  it("id del nodo permanece intacto al cambiar el id de un botón", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "bt-1")!;
    assert.equal(node.type, "buttons");
    const nuevosBotones = node.config.buttons.map((b) => (b.id === "si" ? { ...b, id: "afirmativo" } : b));
    const result = updateNodeConfig(flow, "bt-1", { ...node.config, buttons: nuevosBotones });
    assert.equal(result.nodes.find((n) => n.id === "bt-1")!.id, "bt-1");
  });

  it("el FlowNode sigue siendo válido según flowNodeSchema tras cambiar el id de un botón", () => {
    const flow = fixture();
    const node = flow.nodes.find((n) => n.id === "bt-1")!;
    assert.equal(node.type, "buttons");
    const nuevosBotones = node.config.buttons.map((b) => (b.id === "si" ? { ...b, id: "afirmativo" } : b));
    const result = updateNodeConfig(flow, "bt-1", { ...node.config, buttons: nuevosBotones });
    const updated = result.nodes.find((n) => n.id === "bt-1")!;
    assert.deepEqual(validateNodeEdit(updated), []);
  });
});

// ---------------------------------------------------------------------------
// Etapa 3 (autorizado) — addNode / deleteNode / addEdge / deleteEdge.
// ---------------------------------------------------------------------------

describe("Etapa 3 — addNode", () => {
  it("agrega el nodo al final, sin tocar los existentes", () => {
    const flow = fixture();
    const nuevo = { id: "msg-nuevo", type: "message" as const, position: { x: 1000, y: 0 }, config: { text: "nuevo" } };
    const result = addNode(flow, nuevo);
    assert.equal(result.nodes.length, flow.nodes.length + 1);
    assert.deepEqual(result.nodes.slice(0, -1), flow.nodes);
    assert.deepEqual(result.nodes.at(-1), nuevo);
  });

  it("no toca edges", () => {
    const flow = fixture();
    const nuevo = { id: "msg-nuevo", type: "message" as const, position: { x: 1000, y: 0 }, config: { text: "nuevo" } };
    const result = addNode(flow, nuevo);
    assert.deepEqual(result.edges, flow.edges);
  });

  it("el nodo agregado es válido según flowNodeSchema", () => {
    const flow = fixture();
    const nuevo = { id: "msg-nuevo", type: "message" as const, position: { x: 1000, y: 0 }, config: { text: "nuevo" } };
    const result = addNode(flow, nuevo);
    assert.deepEqual(validateNodeEdit(result.nodes.at(-1)!), []);
  });
});

describe("Etapa 3 — deleteNode", () => {
  it("elimina el nodo pedido", () => {
    const flow = fixture();
    const result = deleteNode(flow, "cond-1");
    assert.equal(result.nodes.some((n) => n.id === "cond-1"), false);
    assert.equal(result.nodes.length, flow.nodes.length - 1);
  });

  it("purga los edges donde el nodo es source", () => {
    const flow = fixture();
    // bt-1 es source de e3
    const result = deleteNode(flow, "bt-1");
    assert.equal(result.edges.some((e) => e.id === "e3"), false);
  });

  it("purga los edges donde el nodo es target", () => {
    const flow = fixture();
    // cond-1 es target de e3
    const result = deleteNode(flow, "cond-1");
    assert.equal(result.edges.some((e) => e.id === "e3"), false);
  });

  it("purga TODOS los edges relacionados (source y target) de un mismo nodo, sin dejar referencias colgantes", () => {
    const flow = fixture();
    // cond-1 es target de e3 y source de e4
    const result = deleteNode(flow, "cond-1");
    assert.equal(result.edges.some((e) => e.source === "cond-1" || e.target === "cond-1"), false);
  });

  it("no toca nodos/edges no relacionados", () => {
    const flow = fixture();
    const result = deleteNode(flow, "cond-1");
    assert.deepEqual(
      result.nodes.filter((n) => n.id !== "cond-1"),
      flow.nodes.filter((n) => n.id !== "cond-1"),
    );
    assert.deepEqual(
      result.edges.filter((e) => e.id !== "e3" && e.id !== "e4"),
      flow.edges.filter((e) => e.id !== "e3" && e.id !== "e4"),
    );
  });

  it("borrar el único start no revienta -- el FlowDefinition resultante sigue siendo una estructura válida (la semántica la reporta el validador, no deleteNode)", () => {
    const flow = fixture();
    const result = deleteNode(flow, "start");
    assert.equal(result.nodes.some((n) => n.id === "start"), false);
    assert.equal(result.edges.some((e) => e.source === "start" || e.target === "start"), false);
  });
});

describe("Etapa 3 — addEdge", () => {
  it("agrega el edge sin tocar nodos ni otros edges", () => {
    const flow = fixture();
    const nuevo = { id: "e-nuevo", source: "q-1", target: "bt-1" };
    const result = addEdge(flow, nuevo);
    assert.equal(result.edges.length, flow.edges.length + 1);
    assert.deepEqual(result.edges.slice(0, -1), flow.edges);
    assert.deepEqual(result.nodes, flow.nodes);
  });
});

describe("Etapa 3 — deleteEdge", () => {
  it("elimina solo el edge pedido", () => {
    const flow = fixture();
    const result = deleteEdge(flow, "e3");
    assert.equal(result.edges.some((e) => e.id === "e3"), false);
    assert.equal(result.edges.length, flow.edges.length - 1);
  });

  it("no toca ningún nodo", () => {
    const flow = fixture();
    const result = deleteEdge(flow, "e3");
    assert.deepEqual(result.nodes, flow.nodes);
  });

  it("no toca otros edges", () => {
    const flow = fixture();
    const result = deleteEdge(flow, "e3");
    assert.deepEqual(
      result.edges,
      flow.edges.filter((e) => e.id !== "e3"),
    );
  });
});

// Professional Flow Editor UX (autorizado) — versiones en lote, para
// selección múltiple. deleteNode/deleteEdge ahora delegan en estas, así que
// los tests de arriba ya las cubren indirectamente para el caso de 1 solo id;
// estos prueban específicamente el caso de VARIOS ids en una sola llamada.
describe("Professional Editor UX — deleteNodes (lote)", () => {
  it("elimina varios nodos y TODOS los edges relacionados en una sola pasada", () => {
    const flow = fixture();
    const result = deleteNodes(flow, ["msg-1", "bt-1"]);
    assert.equal(result.nodes.some((n) => n.id === "msg-1" || n.id === "bt-1"), false);
    assert.equal(result.edges.some((e) => e.source === "bt-1" || e.target === "msg-1"), false);
  });

  it("array vacío devuelve la MISMA referencia (no-op, nunca ensucia el historial de undo)", () => {
    const flow = fixture();
    assert.equal(deleteNodes(flow, []), flow);
  });

  it("no toca nodos/edges no relacionados con la selección", () => {
    const flow = fixture();
    const result = deleteNodes(flow, ["msg-1"]);
    assert.deepEqual(
      result.nodes.filter((n) => n.id !== "msg-1"),
      flow.nodes.filter((n) => n.id !== "msg-1"),
    );
  });

  it("deleteNode(id) individual sigue produciendo exactamente el mismo resultado (delega en deleteNodes)", () => {
    const flow = fixture();
    assert.deepEqual(deleteNode(flow, "msg-1"), deleteNodes(flow, ["msg-1"]));
  });
});

describe("Professional Editor UX — deleteEdges (lote)", () => {
  it("elimina varios edges en una sola pasada", () => {
    const flow = fixture();
    const result = deleteEdges(flow, ["e1", "e3"]);
    assert.equal(result.edges.some((e) => e.id === "e1" || e.id === "e3"), false);
    assert.equal(result.edges.length, flow.edges.length - 2);
  });

  it("array vacío devuelve la MISMA referencia", () => {
    const flow = fixture();
    assert.equal(deleteEdges(flow, []), flow);
  });

  it("nunca toca nodos", () => {
    const flow = fixture();
    const result = deleteEdges(flow, ["e1", "e3"]);
    assert.deepEqual(result.nodes, flow.nodes);
  });

  it("deleteEdge(id) individual sigue produciendo exactamente el mismo resultado (delega en deleteEdges)", () => {
    const flow = fixture();
    assert.deepEqual(deleteEdge(flow, "e3"), deleteEdges(flow, ["e3"]));
  });
});

describe("Etapa 3 — integración: crear nodo -> conectar -> eliminar edge -> eliminar nodo", () => {
  it("cada paso deja el FlowDefinition consistente y el siguiente paso solo afecta lo que le corresponde", () => {
    let flow = fixture();

    const nuevo = { id: "msg-nuevo", type: "message" as const, position: { x: 1000, y: 0 }, config: { text: "nuevo" } };
    flow = addNode(flow, nuevo);
    assert.ok(flow.nodes.some((n) => n.id === "msg-nuevo"));

    flow = addEdge(flow, { id: "e-nuevo", source: "q-1", target: "msg-nuevo" });
    assert.ok(flow.edges.some((e) => e.id === "e-nuevo"));

    flow = deleteEdge(flow, "e-nuevo");
    assert.equal(flow.edges.some((e) => e.id === "e-nuevo"), false);
    assert.ok(flow.nodes.some((n) => n.id === "msg-nuevo")); // el nodo sigue existiendo, solo se quitó el edge

    flow = deleteNode(flow, "msg-nuevo");
    assert.equal(flow.nodes.some((n) => n.id === "msg-nuevo"), false);

    // el resto del flow original permanece intacto
    const original = fixture();
    assert.deepEqual(
      flow.nodes.filter((n) => original.nodes.some((o) => o.id === n.id)),
      original.nodes,
    );
  });
});
