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

  it("la propuesta de mover SOLO es alcanzable desde la rama 'confirma' de la clasificación", () => {
    const flow = danielaReagendarCitaFlow();
    const haciaProponer = flow.edges.filter((e) => e.target === "ai-proponer-mover");
    assert.equal(haciaProponer.length, 1);
    assert.equal(haciaProponer[0]?.source, "ai-clasificar-confirmacion");
    assert.equal(haciaProponer[0]?.sourceHandle, "class:confirma");
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
