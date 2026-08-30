/**
 * Fase 1 (Blocker #4) — el Flow de cancelación de Daniela es REALIZABLE
 * dentro del validador real de publicación. No publica nada: solo corre
 * validateFlowForPublish sobre la definición.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { danielaCancelarCitaFlow } from "@/lib/flows/daniela-cancelar-cita.flow";

describe("Fase 1 — Flow de cancelación de Daniela pasa el validador real de publicación", () => {
  it("validateFlowForPublish: sin errores", () => {
    const result = validateFlowForPublish(danielaCancelarCitaFlow());
    if (!result.valid) {
      console.error(JSON.stringify(result.errors, null, 2));
    }
    assert.equal(result.valid, true, "el flow debe pasar schema + grafo + reglas de publicación + seguridad");
  });

  it("cancelar_cita_especialista es crítica y SÍ tiene rama de fallo", () => {
    const flow = danielaCancelarCitaFlow();
    const edges = flow.edges.filter((e) => e.source === "act-cancelar");
    assert.ok(edges.some((e) => e.sourceHandle === "failure"));
  });

  it("la confirmación de cancelación ocurre en un nodo AI DESPUÉS de act-cancelar, nunca antes", () => {
    const flow = danielaCancelarCitaFlow();
    const nodeIds = flow.nodes.map((n) => n.id);
    assert.ok(nodeIds.indexOf("act-cancelar") < nodeIds.indexOf("ai-confirmar-cancelacion"));
    const edgeExito = flow.edges.find((e) => e.source === "act-cancelar" && e.sourceHandle === "success");
    assert.equal(edgeExito?.target, "ai-confirmar-cancelacion");
  });

  it("consultar citas activas ocurre antes de cancelar (nunca se cancela sin verificar primero)", () => {
    const flow = danielaCancelarCitaFlow();
    const nodeIds = flow.nodes.map((n) => n.id);
    assert.ok(nodeIds.indexOf("act-consultar-citas") < nodeIds.indexOf("act-cancelar"));
  });

  it("la propuesta de cancelar SOLO es alcanzable desde la rama 'confirma' de la clasificación -- nunca desde 'no_confirma' ni desde default", () => {
    const flow = danielaCancelarCitaFlow();
    const haciaProponer = flow.edges.filter((e) => e.target === "ai-proponer-cancelar");
    assert.equal(haciaProponer.length, 1);
    assert.equal(haciaProponer[0]?.source, "ai-clasificar-confirmacion");
    assert.equal(haciaProponer[0]?.sourceHandle, "class:confirma");
  });

  it("ninguna rama de 'no confirma' o 'selección no clara' llega a act-cancelar", () => {
    const flow = danielaCancelarCitaFlow();
    // Recorrido simple: desde msg-cancelacion-abandonada y msg-seleccion-no-clara
    // no debe existir NINGÚN camino de vuelta a act-cancelar.
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
    assert.equal(alcanzables("msg-cancelacion-abandonada").has("act-cancelar"), false);
    assert.equal(alcanzables("msg-seleccion-no-clara").has("act-cancelar"), false);
  });
});
