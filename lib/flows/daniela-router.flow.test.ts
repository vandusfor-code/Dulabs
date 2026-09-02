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

  it("'otro', 'info_servicio' y el default pasan por handoff (mensaje + transferir_soporte)", () => {
    const flow = danielaRouterFlow();
    const edgesOtro = flow.edges.filter(
      (e) =>
        e.source === "ai-clasificar-intencion" &&
        (e.sourceHandle === "class:otro" || e.sourceHandle === "class:info_servicio" || e.sourceHandle === "default"),
    );
    for (const e of edgesOtro) {
      assert.equal(e.target, e.sourceHandle === "class:info_servicio" ? "msg-handoff-tema" : "msg-handoff-duda");
    }
    const haciaHandoff = flow.edges.filter((e) => e.target === "act-handoff-daniela");
    assert.ok(haciaHandoff.length >= 3);
    const endHandoff = flow.nodes.find((n) => n.id === "end-handoff");
    assert.equal(endHandoff?.type, "end");
  });
});
