/**
 * R3 — Authoring API con datos del cliente. 100% offline (registry en memoria).
 * Prueba que la configuración viaja UI -> API -> Spec persistido -> flow
 * compilado, que el cliente no puede colar tenant/acciones/flows y que el
 * aislamiento por tenant se mantiene.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOrUpdateDraft, getCurrentAgent, publishDraftVersion, validateDraftSpec } from "@/lib/agent-compiler/api/business-agent-api";
import { createInMemoryBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/testing/in-memory-registry-store";
import type { RegistryDeps } from "@/lib/agent-compiler/registry/registry";
import { photographySpec, salonSpec } from "@/lib/agent-compiler/runtime/fixtures";
import { CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";
import type { AgentCapabilities, BusinessAgentSpec, CustomerField } from "@/lib/agent-compiler/spec/types";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const deps = (store = createInMemoryBusinessAgentRegistryStore()): RegistryDeps & { store: ReturnType<typeof createInMemoryBusinessAgentRegistryStore> } => ({ store });
const caps = (on: Partial<AgentCapabilities>): AgentCapabilities => ({ ...(Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, false])) as AgentCapabilities), ...on });
const campo = (over: Partial<CustomerField> & Pick<CustomerField, "key" | "type">): CustomerField => ({ label: over.key, required: false, enabled: true, scope: "customer", ...over });
const NOMBRE = campo({ key: "nombreCliente", type: "text", label: "Nombre", required: true });
const TEL = campo({ key: "telefonoCliente", type: "phone", label: "Teléfono", required: true });

const HORARIO = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "20:00" }] })), exceptions: [] };
function editableNylas(fields?: CustomerField[]): Record<string, unknown> {
  const s = salonSpec();
  const spec: BusinessAgentSpec = {
    ...s,
    capabilities: caps({ scheduling: true, humanHandoff: true }),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    scheduling: { ...s.scheduling, provider: "nylas", businessHours: HORARIO },
    ...(fields ? { customerData: { fields } } : {}),
  };
  const { schemaVersion: _s, metadata: _m, ...editable } = spec;
  void _s;
  void _m;
  return editable;
}

describe("R3 — Authoring API con datos del cliente", () => {
  it("1. el borrador con customerData se guarda: el Spec persistido conserva los campos y el flow compilado tiene la captura", async () => {
    const d = deps();
    const r = await createOrUpdateDraft(d, { tenantId: TENANT_A, userId: "u1", rawBody: editableNylas([NOMBRE, TEL, campo({ key: "edad", type: "number", label: "Edad", required: true })]) });
    assert.equal(r.ok, true, JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(r.version.validationStatus, "validated");
    assert.deepEqual(r.version.spec.customerData?.fields.map((f) => f.key), ["nombreCliente", "telefonoCliente", "edad"]);
    const row = await d.store.getVersion(TENANT_A, r.version.flowVersionId);
    assert.ok(row?.flow.nodes.some((n) => n.id === "q-data:edad"), "el flow persistido incluye la pregunta de edad");
    assert.ok(row?.flow.nodes.some((n) => n.id === "q-data:nombreCliente"));
  });

  it("2. un borrador SIN customerData (todo agente previo a R3) sigue guardándose y validando igual", async () => {
    const d = deps();
    const { schemaVersion: _s, metadata: _m, ...editable } = photographySpec();
    void _s;
    void _m;
    const r = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editable });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.version.validationStatus, "validated");
  });

  it("3. configuración inválida (clave reservada / tipo desconocido / nombre no obligatorio con agenda) => rechazada con diagnósticos claros", async () => {
    const d = deps();
    const casos: Array<[string, CustomerField[]]> = [
      ["reservada", [NOMBRE, campo({ key: "fecha", type: "text" })]],
      ["tipo", [NOMBRE, { ...campo({ key: "x", type: "text" }), type: "hologram" } as unknown as CustomerField]],
      ["nombre no obligatorio", [{ ...NOMBRE, required: false }]],
    ];
    for (const [nombre, fields] of casos) {
      const r = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableNylas(fields) });
      assert.equal(r.ok, false, nombre);
      if (!r.ok) {
        assert.equal(r.reason, "compile_failed", nombre);
        assert.ok(r.diagnostics.some((x) => x.severity === "error"), nombre);
      }
    }
    // nada se persistió por los intentos fallidos
    const agent = await getCurrentAgent(d, { tenantId: TENANT_A });
    assert.equal(agent.draft, null);
  });

  it("4. validate (sin persistir) expone el error de datos del cliente al Wizard", () => {
    const v = validateDraftSpec({ tenantId: TENANT_A, rawBody: editableNylas([campo({ key: "edad", type: "number" })]) });
    assert.equal(v.ok, false);
    if (!v.ok) assert.ok(v.diagnostics.some((x) => /Nombre/.test(x.message)), "avisa que falta el Nombre obligatorio");
    const ok = validateDraftSpec({ tenantId: TENANT_A, rawBody: editableNylas([NOMBRE, TEL]) });
    assert.equal(ok.ok && ok.validationStatus, "validated");
  });

  it("5. seguridad: tenantId anidado en un campo se rechaza; el cliente no puede colar acciones ni claves extra hacia el flow", async () => {
    const d = deps();
    const conTenant = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableNylas([{ ...NOMBRE, tenantId: TENANT_B } as unknown as CustomerField, TEL]) });
    assert.equal(conTenant.ok, false);
    if (!conTenant.ok) assert.ok(conTenant.diagnostics.some((x) => x.code === "SPEC_TENANT_INJECTION"));

    // Claves desconocidas dentro de un campo: inertes -- nunca llegan a la definición embebida en la acción.
    const conExtra = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableNylas([{ ...NOMBRE, actionType: "shell_exec", params: { x: "1" } } as unknown as CustomerField, TEL]) });
    assert.equal(conExtra.ok, true, JSON.stringify(conExtra));
    if (!conExtra.ok) return;
    const row = await d.store.getVersion(TENANT_A, conExtra.version.flowVersionId);
    const act = row!.flow.nodes.find((n) => n.id === "act-book") as { config: { actionType: string; params: Record<string, string> } };
    assert.equal(act.config.actionType, "crear_cita_nylas_generico");
    const embebida = JSON.parse(act.config.params.customerFieldsJson) as Array<Record<string, unknown>>;
    assert.equal(embebida.some((f) => "actionType" in f || "params" in f), false);
    assert.ok(!JSON.stringify(row!.flow).includes("shell_exec"));
  });

  it("6. publicar conserva la configuración; y tenant isolation: B nunca ve los datos de A", async () => {
    const d = deps();
    const draft = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableNylas([NOMBRE, TEL]) });
    assert.ok(draft.ok);
    if (!draft.ok) return;
    const pub = await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: draft.version.flowVersionId });
    assert.equal(pub.ok, true, JSON.stringify(pub));
    const a = await getCurrentAgent(d, { tenantId: TENANT_A });
    assert.deepEqual(a.published?.spec.customerData?.fields.map((f) => f.key), ["nombreCliente", "telefonoCliente"]);
    const b = await getCurrentAgent(d, { tenantId: TENANT_B });
    assert.equal(b.published, null);
    assert.equal(b.draft, null);
    // B no puede publicar la versión de A
    const cross = await publishDraftVersion(d, { tenantId: TENANT_B, flowVersionId: draft.version.flowVersionId });
    assert.equal(cross.ok, false);
  });
});
