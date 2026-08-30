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

  // Fase 1 (bug crítico real, prueba 314 sin confirmación) -- ver nota de
  // diseño completa en daniela-agendar-cita.flow.ts.

  it("q-nombre conecta DIRECTO a act-consultar -- consultar disponibilidad no depende de ningún nodo AI intermedio", () => {
    const flow = danielaAgendarCitaFlow();
    const desdeNombre = flow.edges.filter((e) => e.source === "q-nombre");
    assert.equal(desdeNombre.length, 1);
    assert.equal(desdeNombre[0]?.target, "act-consultar");
    const nodoConsultar = flow.nodes.find((n) => n.id === "act-consultar");
    assert.equal(nodoConsultar?.type, "action", "act-consultar debe ser un nodo action directo, no un ai");
  });

  it("act-agendar SOLO es alcanzable desde la rama 'confirma' de la clasificación -- nunca desde 'no_confirma' ni desde default", () => {
    const flow = danielaAgendarCitaFlow();
    const haciaAgendar = flow.edges.filter((e) => e.target === "act-agendar");
    assert.equal(haciaAgendar.length, 1);
    assert.equal(haciaAgendar[0]?.source, "ai-clasificar-confirmacion");
    assert.equal(haciaAgendar[0]?.sourceHandle, "class:confirma");
  });

  it("ninguna rama de 'no confirma' llega a act-agendar", () => {
    const flow = danielaAgendarCitaFlow();
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
    assert.equal(alcanzables("msg-cita-no-confirmada").has("act-agendar"), false);
    assert.equal(alcanzables("msg-sin-disponibilidad").has("act-agendar"), false);
  });

  it("la pregunta de confirmación ocurre DESPUÉS de consultar disponibilidad y ANTES de act-agendar", () => {
    const flow = danielaAgendarCitaFlow();
    const nodeIds = flow.nodes.map((n) => n.id);
    assert.ok(nodeIds.indexOf("act-consultar") < nodeIds.indexOf("q-confirmar-cita"));
    assert.ok(nodeIds.indexOf("q-confirmar-cita") < nodeIds.indexOf("act-agendar"));
  });

  it("el mensaje que propone la cita (ai-proponer-cita) ocurre antes de preguntar confirmación, nunca la afirma como agendada", () => {
    const flow = danielaAgendarCitaFlow();
    const nodeIds = flow.nodes.map((n) => n.id);
    assert.ok(nodeIds.indexOf("ai-proponer-cita") < nodeIds.indexOf("q-confirmar-cita"));
    const edge = flow.edges.find((e) => e.source === "ai-proponer-cita");
    assert.equal(edge?.target, "q-confirmar-cita");
  });
});
