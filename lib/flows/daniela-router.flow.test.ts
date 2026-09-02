/**
 * Fase 1 (Blocker #7) — el enrutador de Daniela es REALIZABLE dentro del
 * validador real de publicación (schema + grafo + reglas de seguridad). No
 * publica nada.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { danielaRouterFlow } from "@/lib/flows/daniela-router.flow";

describe("Fase 1 — Enrutador de Daniela pasa el validador real de publicación", () => {
  it("validateFlowForPublish: sin errores", () => {
    const result = validateFlowForPublish(danielaRouterFlow());
    if (!result.valid) {
      console.error(JSON.stringify(result.errors, null, 2));
    }
    assert.equal(result.valid, true, "el enrutador combinado debe pasar schema + grafo + reglas de publicación + seguridad");
  });

  it("no hay ids de nodo duplicados tras combinar los 3 sub-flows", () => {
    const flow = danielaRouterFlow();
    const ids = flow.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, "el merge no debe producir ids de nodo colisionados");
  });

  it("no hay ids de edge duplicados tras combinar los 3 sub-flows", () => {
    const flow = danielaRouterFlow();
    const ids = flow.edges.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("las ramas de clasificación apuntan a un nodo real distinto cada una", () => {
    const flow = danielaRouterFlow();
    const nodeIds = new Set(flow.nodes.map((n) => n.id));
    const ramas = flow.edges.filter((e) => e.source === "ai-clasificar-intencion");
    assert.equal(
      ramas.length,
      10,
      "agendar, cancelar, reagendar, consultar, producto, info_servicio, handoff_tema, menu, otro, default",
    );
    const targets = new Set(ramas.map((r) => r.target));
    for (const r of ramas) assert.ok(nodeIds.has(r.target), `el target "${r.target}" debe existir como nodo real`);
    assert.ok(targets.has("msg-handoff-tema"));
    assert.ok(targets.has("msg-handoff-duda"));
    assert.ok(targets.has("bt-menu-inicial"));
    assert.ok(targets.has("msg-producto"));
  });

  it("'otro' y el default pasan por handoff (mensaje + transferir_soporte)", () => {
    const flow = danielaRouterFlow();
    const edgesOtro = flow.edges.filter(
      (e) =>
        e.source === "ai-clasificar-intencion" &&
        (e.sourceHandle === "class:otro" || e.sourceHandle === "default"),
    );
    assert.equal(edgesOtro.length, 2);
    for (const e of edgesOtro) {
      assert.equal(e.target, "msg-handoff-duda");
    }
    const haciaHandoff = flow.edges.filter((e) => e.target === "act-handoff-daniela");
    assert.ok(haciaHandoff.length >= 3);
    const endHandoff = flow.nodes.find((n) => n.id === "end-handoff");
    assert.equal(endHandoff?.type, "end");
  });

  // Corrección real (chats reales, sept. 2026) — 'info_servicio' (precio/
  // horario/info de servicio, sin pedir cita) YA NO pasa por handoff: debe
  // responder con la información real del negocio, nunca inventarla.
  describe("'info_servicio' responde con baseConocimiento, sin pasar por handoff", () => {
    it("la rama info_servicio va a un nodo IA (respond), no a msg-handoff-tema", () => {
      const flow = danielaRouterFlow();
      const edge = flow.edges.find(
        (e) => e.source === "ai-clasificar-intencion" && e.sourceHandle === "class:info_servicio",
      );
      assert.ok(edge);
      assert.equal(edge!.target, "ai-responder-info-servicio");
      const nodo = flow.nodes.find((n) => n.id === "ai-responder-info-servicio");
      assert.equal(nodo?.type, "ai");
      if (nodo?.type === "ai") assert.equal(nodo.config.mode, "respond");
    });

    it("la instrucción del nodo lee baseConocimiento y prohíbe inventar", () => {
      const flow = danielaRouterFlow();
      const nodo = flow.nodes.find((n) => n.id === "ai-responder-info-servicio");
      assert.equal(nodo?.type, "ai");
      if (nodo?.type === "ai") {
        assert.match(nodo.config.instruction, /baseConocimiento/);
        assert.match(nodo.config.instruction, /nunca invent/i);
      }
    });

    it("termina en un nodo end propio (end-info-servicio), nunca en act-handoff-daniela", () => {
      const flow = danielaRouterFlow();
      const salida = flow.edges.find((e) => e.source === "ai-responder-info-servicio");
      assert.ok(salida);
      assert.equal(salida!.target, "end-info-servicio");
      assert.equal(flow.nodes.find((n) => n.id === "end-info-servicio")?.type, "end");
    });

    it("handoff_tema (pagos/temas administrativos) sigue yendo a handoff -- no se tocó", () => {
      const flow = danielaRouterFlow();
      const edge = flow.edges.find(
        (e) => e.source === "ai-clasificar-intencion" && e.sourceHandle === "class:handoff_tema",
      );
      assert.equal(edge?.target, "msg-handoff-tema");
    });
  });
});
