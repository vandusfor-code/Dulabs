/**
 * Fase 0 — prueba de que el Flow diseñado para Daniela es REALIZABLE dentro
 * del validador de publicación real (el mismo que usaría un publish de
 * verdad) -- no una afirmación sin verificar. No publica nada: solo corre
 * `validateFlowForPublish` sobre la definición.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { danielaAgendarCitaFlow } from "@/lib/flows/daniela-agendar-cita.flow";

describe("Fase 0 — Flow de Daniela pasa el validador real de publicación", () => {
  it("validateFlowForPublish: sin errores", () => {
    const result = validateFlowForPublish(danielaAgendarCitaFlow());
    if (!result.valid) {
      console.error(JSON.stringify(result.errors, null, 2));
    }
    assert.equal(result.valid, true, "el flow debe pasar schema + grafo + reglas de publicación + seguridad");
  });

  it("agendar_cita_especialista es crítica y SÍ tiene rama de fallo (act-agendar --failure--> msg-ocupado)", () => {
    const flow = danielaAgendarCitaFlow();
    const edgesDeAgendar = flow.edges.filter((e) => e.source === "act-agendar");
    assert.ok(edgesDeAgendar.some((e) => e.sourceHandle === "failure"));
  });

  it("la confirmación al cliente ocurre en un nodo AI DESPUÉS de act-agendar, nunca antes", () => {
    const flow = danielaAgendarCitaFlow();
    const nodeIds = flow.nodes.map((n) => n.id);
    const idxAgendar = nodeIds.indexOf("act-agendar");
    const idxConfirmar = nodeIds.indexOf("ai-confirmar");
    assert.ok(idxAgendar < idxConfirmar, "act-agendar debe declararse antes que ai-confirmar");
    const edgeAExito = flow.edges.find((e) => e.source === "act-agendar" && e.sourceHandle === "success");
    assert.equal(edgeAExito?.target, "ai-confirmar");
  });

  it("consultar disponibilidad ocurre antes de agendar (nunca se agenda a ciegas)", () => {
    const flow = danielaAgendarCitaFlow();
    const nodeIds = flow.nodes.map((n) => n.id);
    assert.ok(nodeIds.indexOf("act-consultar") < nodeIds.indexOf("act-agendar"));
  });
});
