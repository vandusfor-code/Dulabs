// Business Agent 2.0, FASE 1 — gate de activación y estado de producto del agente.
//
// El gate corre sobre el Registry REAL en memoria, con versiones compiladas por el compilador real; las
// dependencias de datos (número, plan, otro motor, readiness) son inyectables y se prueban con hechos concretos.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInMemoryBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/testing/in-memory-registry-store";
import { compileAndCreateDraftVersion, publishBusinessAgentVersion } from "@/lib/agent-compiler/registry/registry";
import { evaluateBusinessAgentActivation, type ActivationGateDeps } from "@/lib/agent-compiler/lifecycle/activation-gate";
import { deriveAgentLifecycle } from "@/lib/agent-compiler/lifecycle/lifecycle";
import { photographySpec } from "@/lib/agent-compiler/runtime/fixtures";
import type { ReadinessReport } from "@/lib/business-agent-readiness";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LISTO: ReadinessReport = { ready: true, blockers: [], warnings: [], summary: [] };

async function registry(opts: { publicar?: boolean } = {}) {
  const store = createInMemoryBusinessAgentRegistryStore();
  const draft = await compileAndCreateDraftVersion({ store }, { tenantId: TENANT_A, spec: photographySpec() });
  if (!draft.ok) throw new Error("no compiló");
  if (opts.publicar !== false) await publishBusinessAgentVersion({ store }, { tenantId: TENANT_A, flowId: draft.flowId, flowVersionId: draft.flowVersionId });
  return { store, flowId: draft.flowId, flowVersionId: draft.flowVersionId };
}

function deps(store: ActivationGateDeps["store"], over: Partial<ActivationGateDeps> = {}): ActivationGateDeps {
  return {
    store,
    numberBelongsToTenant: async (tenantId, phone) => tenantId === TENANT_A && phone === "pn-a",
    evaluateReadiness: async () => LISTO,
    hasActivePlan: async () => true,
    otherEngineOnNumber: async () => null,
    ...over,
  };
}

describe("FASE 1 — gate de activación (server-side)", () => {
  it("14. configuración válida, publicada, con plan y sin conflicto => allowed", async () => {
    const { store, flowId, flowVersionId } = await registry();
    const r = await evaluateBusinessAgentActivation(deps(store), { tenantId: TENANT_A, flowId, phoneNumberId: "pn-a" });
    assert.deepEqual(r, { kind: "allowed", flowVersionId });
  });

  it("13. configuración inválida (readiness con bloqueos reales) => blocked, con el motivo del negocio", async () => {
    const { store, flowId } = await registry();
    const r = await evaluateBusinessAgentActivation(
      deps(store, {
        evaluateReadiness: async () => ({ ready: false, blockers: [{ code: "CALENDAR_NOT_CONNECTED", severity: "blocker", capability: "scheduling", message: "Conecta tu Google Calendar." }], warnings: [], summary: [] }),
      }),
      { tenantId: TENANT_A, flowId, phoneNumberId: "pn-a" },
    );
    assert.equal(r.kind, "blocked");
    assert.deepEqual(r.kind === "blocked" && r.blockers.map((b) => [b.code, b.message]), [["READINESS_BLOCKED", "Conecta tu Google Calendar."]]);
  });

  it("13b. agente sin publicar => blocked NOT_PUBLISHED (no se evalúa readiness sobre un borrador)", async () => {
    const { store, flowId } = await registry({ publicar: false });
    let evaluado = false;
    const r = await evaluateBusinessAgentActivation(deps(store, { evaluateReadiness: async () => { evaluado = true; return LISTO; } }), { tenantId: TENANT_A, flowId, phoneNumberId: "pn-a" });
    assert.equal(r.kind, "blocked");
    assert.equal(r.kind === "blocked" && r.blockers[0]!.code, "NOT_PUBLISHED");
    assert.equal(evaluado, false);
  });

  it("versión publicada alterada (checksum) => blocked AGENT_INVALID", async () => {
    const { store, flowId } = await registry();
    const alterado: typeof store = {
      ...store,
      async resolvePublishedVersion(t, f) {
        const v = await store.resolvePublishedVersion(t, f);
        return v ? { ...v, flow: { ...v.flow, name: "alterado" } } : null;
      },
    };
    const r = await evaluateBusinessAgentActivation(deps(alterado), { tenantId: TENANT_A, flowId, phoneNumberId: "pn-a" });
    assert.equal(r.kind === "blocked" && r.blockers[0]!.code, "AGENT_INVALID");
  });

  it("sin plan activo => blocked BILLING_REQUIRED (sin plan el runtime no respondería)", async () => {
    const { store, flowId } = await registry();
    const r = await evaluateBusinessAgentActivation(deps(store, { hasActivePlan: async () => false }), { tenantId: TENANT_A, flowId, phoneNumberId: "pn-a" });
    assert.deepEqual(r.kind === "blocked" && r.blockers.map((b) => b.code), ["BILLING_REQUIRED"]);
  });

  it("número atendido por el Agente conversacional => blocked ENGINE_CONFLICT (antes: activación silenciosa sin efecto)", async () => {
    const { store, flowId } = await registry();
    const r = await evaluateBusinessAgentActivation(deps(store, { otherEngineOnNumber: async () => "agente_conversacional" }), { tenantId: TENANT_A, flowId, phoneNumberId: "pn-a" });
    assert.deepEqual(r.kind === "blocked" && r.blockers.map((b) => b.code), ["ENGINE_CONFLICT"]);
  });

  it("15. cross-tenant: TENANT_B no puede activar el agente de TENANT_A ni activar en un número ajeno", async () => {
    const { store, flowId } = await registry();
    // El Registry es tenant-scoped: para TENANT_B ese flow no tiene versiones => no es "su" Business Agent.
    const otro = await evaluateBusinessAgentActivation(deps(store), { tenantId: TENANT_B, flowId, phoneNumberId: "pn-a" });
    assert.deepEqual(otro, { kind: "not_business_agent" }, "la ruta ya exige además que el flow sea del tenant (getFlowById tenant-scoped)");
    const numeroAjeno = await evaluateBusinessAgentActivation(deps(store), { tenantId: TENANT_A, flowId, phoneNumberId: "pn-de-b" });
    assert.equal(numeroAjeno.kind === "blocked" && numeroAjeno.blockers[0]!.code, "NUMBER_NOT_FOUND");
    assert.equal(numeroAjeno.kind === "blocked" && numeroAjeno.blockers.length, 1, "de un número ajeno no se revela nada más");
  });

  it("un flow de Flow Studio (sin versiones de Business Agent) sigue su camino de siempre", async () => {
    const store = createInMemoryBusinessAgentRegistryStore();
    const r = await evaluateBusinessAgentActivation(deps(store), { tenantId: TENANT_A, flowId: "flow-studio-1", phoneNumberId: "pn-a" });
    assert.deepEqual(r, { kind: "not_business_agent" });
  });
});

describe("FASE 1 — estado de producto derivado (capa compatible hacia la state machine de FASE 3)", () => {
  const n = (over: Partial<{ phoneNumberId: string; iaPausada: boolean; otherEngine: "agente_conversacional" | null }> = {}) => ({ phoneNumberId: "pn", iaPausada: false, otherEngine: null, ...over });

  it("DRAFT / CONFIGURED / PUBLISHED / ACTIVE / PAUSED / ERROR", () => {
    assert.equal(deriveAgentLifecycle({ latestValidationStatus: null, published: null, boundNumbers: [] }).state, "DRAFT");
    assert.equal(deriveAgentLifecycle({ latestValidationStatus: "failed", published: null, boundNumbers: [] }).state, "DRAFT");
    assert.equal(deriveAgentLifecycle({ latestValidationStatus: "validated", published: null, boundNumbers: [] }).state, "CONFIGURED");
    assert.equal(deriveAgentLifecycle({ latestValidationStatus: "validated", published: { servable: true }, boundNumbers: [] }).state, "PUBLISHED");
    assert.equal(deriveAgentLifecycle({ latestValidationStatus: "validated", published: { servable: true }, boundNumbers: [n()] }).state, "ACTIVE");
    assert.equal(deriveAgentLifecycle({ latestValidationStatus: "validated", published: { servable: true }, boundNumbers: [n({ iaPausada: true })] }).state, "PAUSED");
    assert.equal(deriveAgentLifecycle({ latestValidationStatus: "validated", published: { servable: false }, boundNumbers: [n()] }).state, "ERROR");
    const conflicto = deriveAgentLifecycle({ latestValidationStatus: "validated", published: { servable: true }, boundNumbers: [n({ otherEngine: "agente_conversacional" })] });
    assert.deepEqual([conflicto.state, conflicto.reasons], ["ERROR", ["ENGINE_CONFLICT"]]);
  });

  it("ACTIVE si al menos un número atiende, y explica el estado de cada número", () => {
    const r = deriveAgentLifecycle({
      latestValidationStatus: "validated",
      published: { servable: true },
      boundNumbers: [n({ phoneNumberId: "a" }), n({ phoneNumberId: "b", iaPausada: true }), n({ phoneNumberId: "c", otherEngine: "agente_conversacional" })],
    });
    assert.equal(r.state, "ACTIVE");
    assert.deepEqual(r.numbers, [
      { phoneNumberId: "a", status: "serving" },
      { phoneNumberId: "b", status: "paused" },
      { phoneNumberId: "c", status: "blocked_by_other_engine" },
    ]);
  });
});

describe("FASE 1 — guardas estructurales de las rutas (el gate no se puede saltar desde la UI)", () => {
  const activate = readFileSync("app/api/flows/[id]/activate/route.ts", "utf8");
  const rollback = readFileSync("app/api/business-agent/rollback/route.ts", "utf8");

  it("activar: el gate corre ANTES de escribir la activación, y los errores no filtran detalle interno", () => {
    const gate = activate.indexOf("evaluateBusinessAgentActivation(");
    const escritura = activate.indexOf("activarFlowParaNumero(supabase");
    assert.ok(gate > 0 && escritura > gate, "el gate debe ejecutarse antes de activarFlowParaNumero");
    assert.equal(/\(error as Error\)\.message/.test(activate), false, "la respuesta 500 no devuelve error.message");
  });

  it("proveedor de IA del Business Agent = Gemini (nodos del agente y clasificador del Gate), sin Anthropic", () => {
    const runtime = readFileSync("lib/agent-compiler/runtime/production/atender-business-agent.ts", "utf8");
    const ports = readFileSync("lib/agent-compiler/runtime/production/ports.ts", "utf8");
    assert.ok(runtime.includes('aiProviderRouterDeps: { defaultProvider: "gemini" }'));
    assert.ok(runtime.includes("createGeminiSemanticClassifier("));
    assert.equal(/ClaudeExecutor|anthropic/i.test(ports), false);
  });

  it("rollback: pasa por la misma readiness que publicar antes de re-apuntar la versión", () => {
    const readiness = rollback.indexOf("evaluateVersionReadiness(");
    const rollbackCall = rollback.indexOf("rollbackToVersion(");
    assert.ok(readiness > 0 && rollbackCall > readiness);
  });
});
