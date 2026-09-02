/**
 * Fase 1 (Blocker #5) — el Flow de reagendamiento de Daniela es REALIZABLE
 * dentro del validador real de publicación. No publica nada.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { danielaReagendarCitaFlow } from "@/lib/flows/daniela-reagendar-cita.flow";

describe("Fase 1 — Flow de reagendamiento de Daniela pasa el validador real de publicación", () => {
  it("validateFlowForPublish: sin errores", () => {
    const result = validateFlowForPublish(danielaReagendarCitaFlow());
    if (!result.valid) {
      console.error(JSON.stringify(result.errors, null, 2));
    }
    assert.equal(result.valid, true, "el flow debe pasar schema + grafo + reglas de publicación + seguridad");
  });

  it("mover_cita_especialista es crítica y SÍ tiene rama de fallo", () => {
    const flow = danielaReagendarCitaFlow();
    const edges = flow.edges.filter((e) => e.source === "act-mover-cita");
    assert.ok(edges.some((e) => e.sourceHandle === "failure"));
  });

  it("consultar_disponibilidad_especialista (para el nuevo horario) también tiene rama de fallo (horario sin espacio)", () => {
    const flow = danielaReagendarCitaFlow();
    const edges = flow.edges.filter((e) => e.source === "cond-disponible");
    assert.ok(edges.some((e) => e.sourceHandle === "false"));
  });

  it("la confirmación de reagendamiento ocurre en un nodo AI DESPUÉS de act-mover-cita, nunca antes", () => {
    const flow = danielaReagendarCitaFlow();
    const nodeIds = flow.nodes.map((n) => n.id);
    assert.ok(nodeIds.indexOf("act-mover-cita") < nodeIds.indexOf("ai-confirmar-reagendamiento"));
    const edgeExito = flow.edges.find((e) => e.source === "act-mover-cita" && e.sourceHandle === "success");
    assert.equal(edgeExito?.target, "ai-confirmar-reagendamiento");
  });

  it("consultar citas activas y consultar disponibilidad ocurren antes de mover la cita (nunca se mueve a ciegas)", () => {
    const flow = danielaReagendarCitaFlow();
    const nodeIds = flow.nodes.map((n) => n.id);
    assert.ok(nodeIds.indexOf("act-consultar-citas") < nodeIds.indexOf("act-mover-cita"));
    assert.ok(nodeIds.indexOf("act-consultar-disponibilidad") < nodeIds.indexOf("act-mover-cita"));
  });

  it("act-mover-cita SOLO es alcanzable desde la rama 'confirma' de la clasificación (rediseño: sin nodo AI intermedio)", () => {
    const flow = danielaReagendarCitaFlow();
    const haciaMover = flow.edges.filter((e) => e.target === "act-mover-cita");
    assert.equal(haciaMover.length, 1);
    assert.equal(haciaMover[0]?.source, "ai-clasificar-confirmacion");
    assert.equal(haciaMover[0]?.sourceHandle, "class:confirma");
  });

  it("act-mover-cita tiene confirmado=\"true\" fijo (defense-in-depth)", () => {
    const flow = danielaReagendarCitaFlow();
    const nodo = flow.nodes.find((n) => n.id === "act-mover-cita");
    assert.equal(nodo?.type, "action");
    if (nodo?.type === "action" && "params" in nodo.config) {
      assert.equal(nodo.config.params?.confirmado, "true");
    } else {
      assert.fail("act-mover-cita debe tener params.confirmado fijo");
    }
  });

  it("ya NO existe ningún nodo propose_action (ai-proponer-consultar/ai-proponer-mover eliminados -- Parte 19 del rediseño)", () => {
    const flow = danielaReagendarCitaFlow();
    const proposeActionNodes = flow.nodes.filter((n) => n.type === "ai" && n.config.mode === "propose_action");
    assert.equal(proposeActionNodes.length, 0);
  });

  it("q-nueva-fecha SIEMPRE pasa por act-validar-nueva-fecha (parser determinista) antes de consultar disponibilidad", () => {
    const flow = danielaReagendarCitaFlow();
    const desdeFecha = flow.edges.find((e) => e.source === "q-nueva-fecha");
    assert.equal(desdeFecha?.target, "act-validar-nueva-fecha");
    const exito = flow.edges.find((e) => e.source === "act-validar-nueva-fecha" && e.sourceHandle === "success");
    assert.equal(exito?.target, "q-nueva-hora");
    const fallo = flow.edges.find((e) => e.source === "act-validar-nueva-fecha" && e.sourceHandle === "failure");
    assert.equal(fallo?.target, "msg-nueva-fecha-invalida");
  });

  it("q-nueva-hora usa validación determinista hora_colombia, no texto libre sin validar", () => {
    const flow = danielaReagendarCitaFlow();
    const nodo = flow.nodes.find((n) => n.id === "q-nueva-hora");
    assert.equal(nodo?.type, "question");
    if (nodo?.type === "question") {
      assert.equal(nodo.config.validation.kind, "hora_colombia");
    }
  });

  it("ninguna rama de 'no confirma', 'sin disponibilidad' o 'selección no clara' llega a act-mover-cita", () => {
    const flow = danielaReagendarCitaFlow();
    const alcanzables = (desde: string): Set<string> => {
      const visitados = new Set<string>();
      const pila = [desde];
      while (pila.length) {
        const actual = pila.pop()!;
        if (visitados.has(actual)) continue;
        visitados.add(actual);
        for (const e of flow.edges.filter((edge) => edge.source === actual)) pila.push(e.target);
      }
      return visitados;
    };
    assert.equal(alcanzables("msg-reagendamiento-abandonado").has("act-mover-cita"), false);
    assert.equal(alcanzables("msg-sin-disponibilidad").has("act-mover-cita"), false);
    assert.equal(alcanzables("msg-seleccion-no-clara").has("act-mover-cita"), false);
  });
});
