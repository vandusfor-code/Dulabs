/**
 * Etapa 0 (spike del Flow Builder, autorizado) — tests del adapter puro
 * FlowDefinition <-> React Flow. Usa el Flow real de Daniela (agendar cita),
 * nunca nodos escritos a mano, para comprobar la traducción contra datos de
 * producción reales.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import { danielaAgendarCitaFlow } from "@/lib/flows/daniela-agendar-cita.flow";
import { applyCanvasPositions, flowDefinitionToCanvas } from "@/lib/flow-builder/canvas-adapter";

describe("canvas-adapter — flowDefinitionToCanvas (Flow real de Daniela)", () => {
  const flow = danielaAgendarCitaFlow();
  const { nodes, edges } = flowDefinitionToCanvas(flow);

  it("1. produce un CanvasNode por cada FlowNode, mismos ids", () => {
    assert.equal(nodes.length, flow.nodes.length);
    const canvasIds = new Set(nodes.map((n) => n.id));
    for (const node of flow.nodes) assert.ok(canvasIds.has(node.id), `falta el nodo ${node.id}`);
  });

  it("2. produce un CanvasEdge por cada FlowEdge, mismos ids/source/target", () => {
    assert.equal(edges.length, flow.edges.length);
    const byId = new Map(edges.map((e) => [e.id, e]));
    for (const edge of flow.edges) {
      const canvasEdge = byId.get(edge.id);
      assert.ok(canvasEdge, `falta el edge ${edge.id}`);
      assert.equal(canvasEdge!.source, edge.source);
      assert.equal(canvasEdge!.target, edge.target);
    }
  });

  it("3. preserva sourceHandle tal cual, incluyendo edges sin handle", () => {
    const byId = new Map(edges.map((e) => [e.id, e]));
    // edge real sin sourceHandle (transición única start -> ai-extraer)
    const startEdge = byId.get("e-start")!;
    assert.equal(startEdge.sourceHandle, undefined);
    // edge real con sourceHandle "true" (condition)
    const condEdge = byId.get("e-hay-servicios")!;
    assert.equal(condEdge.sourceHandle, FLOW_EDGE_HANDLE.conditionTrue);
  });

  it("4. asigna position real cuando existe, y una posición determinística cuando falta", () => {
    for (const node of nodes) {
      assert.ok(node.position);
      assert.equal(typeof node.position.x, "number");
      assert.equal(typeof node.position.y, "number");
    }
    // ningún nodo de este flow trae position propia -- todos deben caer en
    // el fallback determinístico (no NaN, no undefined).
    assert.ok(flow.nodes.every((n) => n.position === undefined));
  });

  it("5. nodo buttons (q-confirmar-cita) genera un handle por botón + fallback de texto", () => {
    const node = nodes.find((n) => n.id === "q-confirmar-cita")!;
    const ids = node.data.sourceHandles.map((h) => h.id);
    assert.deepEqual(ids, [
      FLOW_EDGE_HANDLE.button("confirmar_cita"),
      FLOW_EDGE_HANDLE.button("otro_horario"),
      FLOW_EDGE_HANDLE.text,
    ]);
  });

  it("6. nodo condition (cond-hay-servicios) genera true/false", () => {
    const node = nodes.find((n) => n.id === "cond-hay-servicios")!;
    const ids = node.data.sourceHandles.map((h) => h.id);
    assert.deepEqual(ids, [FLOW_EDGE_HANDLE.conditionTrue, FLOW_EDGE_HANDLE.conditionFalse]);
  });

  it("7. nodo ai classify (ai-clasificar-confirmacion) genera class:* + default", () => {
    const node = nodes.find((n) => n.id === "ai-clasificar-confirmacion")!;
    const ids = node.data.sourceHandles.map((h) => h.id);
    assert.deepEqual(ids, [
      FLOW_EDGE_HANDLE.aiClass("confirma"),
      FLOW_EDGE_HANDLE.aiClass("no_confirma"),
      FLOW_EDGE_HANDLE.aiDefault,
    ]);
  });

  it("8. nodo ai no-classify (ai-confirmar, mode respond) genera success/failure", () => {
    const node = nodes.find((n) => n.id === "ai-confirmar")!;
    const ids = node.data.sourceHandles.map((h) => h.id);
    assert.deepEqual(ids, [FLOW_EDGE_HANDLE.aiSuccess, FLOW_EDGE_HANDLE.aiFailure]);
  });

  it("9. nodo action (act-agendar) genera success/failure", () => {
    const node = nodes.find((n) => n.id === "act-agendar")!;
    const ids = node.data.sourceHandles.map((h) => h.id);
    assert.deepEqual(ids, [FLOW_EDGE_HANDLE.aiSuccess, FLOW_EDGE_HANDLE.aiFailure]);
  });

  it("10. nodo start no declara sourceHandles propios (transición única implícita)", () => {
    const node = nodes.find((n) => n.id === "start")!;
    assert.deepEqual(node.data.sourceHandles, []);
  });

  it("11. cubre los 10 tipos de nodo entre los flows de Daniela (agendar + cancelar + reagendar + router)", async () => {
    const { danielaCancelarCitaFlow } = await import("@/lib/flows/daniela-cancelar-cita.flow");
    const { danielaReagendarCitaFlow } = await import("@/lib/flows/daniela-reagendar-cita.flow");
    const seen = new Set<string>();
    for (const f of [flow, danielaCancelarCitaFlow(), danielaReagendarCitaFlow()]) {
      const { nodes: ns } = flowDefinitionToCanvas(f);
      for (const n of ns) seen.add(n.data.nodeType);
    }
    // save_data y human no aparecen en ningún flow real de Daniela (ver auditoría Fase 2, §7/§17) --
    // se comprueban por separado con nodos mínimos sintéticos en el test 12.
    for (const t of ["start", "message", "question", "buttons", "condition", "ai", "action", "end"]) {
      assert.ok(seen.has(t), `tipo ${t} no representado`);
    }
  });
});

describe("canvas-adapter — tipos sin caso de uso real hoy (save_data, human)", () => {
  it("12. genera representación válida para save_data y human con un FlowDefinition mínimo sintético", () => {
    const flow = {
      name: "spike-synthetic",
      nodes: [
        { id: "n1", type: "save_data" as const, config: { mappings: [{ variable: "x", target: "lead" as const }] } },
        { id: "n2", type: "human" as const, config: { pauseDurationHours: 2 } },
      ],
      edges: [],
      variables: [],
    };
    const { nodes } = flowDefinitionToCanvas(flow);
    assert.equal(nodes.find((n) => n.id === "n1")?.data.nodeType, "save_data");
    assert.equal(nodes.find((n) => n.id === "n2")?.data.nodeType, "human");
  });
});

describe("canvas-adapter — applyCanvasPositions (round-trip mínimo)", () => {
  it("13. actualiza solo position, nunca config/edges/variables del FlowDefinition original", () => {
    const flow = danielaAgendarCitaFlow();
    const { nodes } = flowDefinitionToCanvas(flow);
    const moved = nodes.map((n) => (n.id === "start" ? { ...n, position: { x: 999, y: 111 } } : n));

    const result = applyCanvasPositions(flow, moved);

    assert.deepEqual(result.nodes.find((n) => n.id === "start")!.position, { x: 999, y: 111 });
    // todo lo demás permanece idéntico -- misma cantidad de nodos/edges/variables,
    // mismo config del nodo movido (solo cambió position).
    assert.equal(result.nodes.length, flow.nodes.length);
    assert.deepEqual(result.edges, flow.edges);
    assert.deepEqual(result.variables, flow.variables);
    const originalStart = flow.nodes.find((n) => n.id === "start")!;
    const resultStart = result.nodes.find((n) => n.id === "start")!;
    assert.deepEqual(resultStart.config, originalStart.config);

    // el FlowDefinition original pasado como argumento no se muta.
    assert.equal(flow.nodes.find((n) => n.id === "start")!.position, undefined);
  });
});
