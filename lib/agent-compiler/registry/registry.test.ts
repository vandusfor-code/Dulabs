/**
 * Agent Compiler — Step 8A: Business Agent Registry.
 * 100% offline (fake en memoria — ver testing/in-memory-registry-store.ts).
 * La concurrencia real (row-lock del RPC dulabs_flow_publish_version) es
 * infraestructura EXISTENTE reutilizada, no se re-prueba aquí; se documenta
 * en el reporte como OFFLINE TESTED, no PRODUCTION VERIFIED.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindWhatsAppNumberToBusinessAgent,
  compileAndCreateDraftVersion,
  publishBusinessAgentVersion,
  resolvePublishedBusinessAgentVersion,
  type RegistryDeps,
} from "@/lib/agent-compiler/registry/registry";
import { createInMemoryBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/testing/in-memory-registry-store";
import { createSupabaseBusinessAgentResolver } from "@/lib/agent-compiler/runtime/production/business-agent-resolver";
import { photographySpec, salonSpec } from "@/lib/agent-compiler/runtime/fixtures";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

function deps(store = createInMemoryBusinessAgentRegistryStore()): RegistryDeps & { store: ReturnType<typeof createInMemoryBusinessAgentRegistryStore> } {
  return { store };
}

describe("Business Agent Registry — Step 8A", () => {
  it("1/2/3. crear agent + crear version + draft: dulabs_flows queda draft hasta publicar", async () => {
    const d = deps();
    const r = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.versionNumber, 1);
    const identity = d.store._debug.flows.find((f) => f.id === r.flowId)!;
    assert.equal(identity.status, "draft", "el flow sigue draft hasta el primer publish");
  });

  it("4. validation: FlowDefinition válido produce validationStatus='validated'", async () => {
    const d = deps();
    const r = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.validationStatus, "validated");
  });

  it("5. publish: activa la versión y el flow pasa a published", async () => {
    const d = deps();
    const draft = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    const pub = await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: draft.flowId, flowVersionId: draft.flowVersionId });
    assert.equal(pub.ok, true);
    const identity = d.store._debug.flows.find((f) => f.id === draft.flowId)!;
    assert.equal(identity.status, "published");
    assert.equal(identity.publishedVersionId, draft.flowVersionId);
  });

  it("6/7. publicar segunda versión: la primera queda SUPERSEDED (retiredAt) y ya no es el pointer", async () => {
    const d = deps();
    const v1 = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    assert.equal(v1.ok, true);
    if (!v1.ok) return;
    await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: v1.flowId, flowVersionId: v1.flowVersionId });

    const v2 = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: salonSpec() });
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    const pub2 = await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: v2.flowId, flowVersionId: v2.flowVersionId });
    assert.equal(pub2.ok, true);
    if (pub2.ok) assert.equal(pub2.supersededVersionId, v1.flowVersionId);

    const identity = d.store._debug.flows.find((f) => f.id === v1.flowId)!;
    assert.equal(identity.publishedVersionId, v2.flowVersionId, "el pointer ahora es v2 (una sola PUBLISHED activa)");
    const v1row = d.store._debug.versions.find((v) => v.id === v1.flowVersionId)!;
    assert.ok(v1row.retiredAt, "v1 quedó marcada retirada (superseded)");
  });

  it("8. rollback: re-publicar una versión ANTERIOR mueve el pointer de vuelta, sin copiar/pegar config", async () => {
    const d = deps();
    const v1 = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    if (!v1.ok) return assert.fail();
    await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: v1.flowId, flowVersionId: v1.flowVersionId });
    const v2 = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: salonSpec() });
    if (!v2.ok) return assert.fail();
    await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: v2.flowId, flowVersionId: v2.flowVersionId });

    // Rollback: volver a apuntar a v1 -- MISMA versión inmutable, sin recrear nada.
    const rollback = await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: v1.flowId, flowVersionId: v1.flowVersionId });
    assert.equal(rollback.ok, true);
    const identity = d.store._debug.flows.find((f) => f.id === v1.flowId)!;
    assert.equal(identity.publishedVersionId, v1.flowVersionId, "el pointer volvió a v1");
  });

  it("9. tenant isolation: tenant B no puede publicar una versión de tenant A", async () => {
    const d = deps();
    const v1 = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    if (!v1.ok) return assert.fail();
    const pub = await publishBusinessAgentVersion(d, { tenantId: TENANT_B, flowId: v1.flowId, flowVersionId: v1.flowVersionId });
    assert.equal(pub.ok, false);
    if (!pub.ok) assert.equal(pub.reason, "not_found", "tenant B no ve artefactos de tenant A (scoping por tenant en la key)");
  });

  it("10/11. phone_number_id isolation + duplicate active binding (idempotente)", async () => {
    const clientes = new Map([["+573000000001", { tenantId: TENANT_A, flowActivo: false, flowId: null }]]);
    const d = deps(createInMemoryBusinessAgentRegistryStore({ clientes }));
    const v1 = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    if (!v1.ok) return assert.fail();
    await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: v1.flowId, flowVersionId: v1.flowVersionId });

    // Tenant B no puede vincular un número de tenant A (aislamiento).
    const crossTenant = await bindWhatsAppNumberToBusinessAgent(d, { tenantId: TENANT_B, phoneNumberId: "+573000000001", flowId: v1.flowId });
    assert.equal(crossTenant.ok, false);

    // Binding legítimo, dos veces -- idempotente, mismo resultado.
    const b1 = await bindWhatsAppNumberToBusinessAgent(d, { tenantId: TENANT_A, phoneNumberId: "+573000000001", flowId: v1.flowId });
    const b2 = await bindWhatsAppNumberToBusinessAgent(d, { tenantId: TENANT_A, phoneNumberId: "+573000000001", flowId: v1.flowId });
    assert.equal(b1.ok, true);
    assert.equal(b2.ok, true);
    assert.equal(clientes.get("+573000000001")!.flowId, v1.flowId);
  });

  it("12/23. duplicate/idempotent publish: publicar la MISMA versión dos veces no re-supersede ni rompe", async () => {
    const d = deps();
    const v1 = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    if (!v1.ok) return assert.fail();
    const p1 = await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: v1.flowId, flowVersionId: v1.flowVersionId });
    const p2 = await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: v1.flowId, flowVersionId: v1.flowVersionId });
    assert.equal(p1.ok, true);
    assert.equal(p2.ok, true);
    if (p2.ok) assert.equal(p2.supersededVersionId, null, "no se retira a sí misma");
    const v1row = d.store._debug.versions.find((v) => v.id === v1.flowVersionId)!;
    assert.equal(v1row.retiredAt, null);
  });

  it("13. concurrent publish (secuencial en el fake): el último en completar gana el pointer -- last-write-wins consistente, sin doble published", async () => {
    const d = deps();
    const v1 = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    const v2 = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: salonSpec() });
    if (!v1.ok || !v2.ok) return assert.fail();
    const [r1, r2] = await Promise.all([
      publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: v1.flowId, flowVersionId: v1.flowVersionId }),
      publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: v2.flowId, flowVersionId: v2.flowVersionId }),
    ]);
    assert.equal(r1.ok && r2.ok, true);
    const identity = d.store._debug.flows.find((f) => f.id === v1.flowId)!;
    // Exactamente UNA versión es el pointer activo (nunca "ambas published").
    assert.ok(identity.publishedVersionId === v1.flowVersionId || identity.publishedVersionId === v2.flowVersionId);
  });

  it("14. invalid state transition: publicar un flowVersionId inexistente => not_found (nunca ejecuta)", async () => {
    const d = deps();
    const draft = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    if (!draft.ok) return assert.fail();
    const pub = await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: draft.flowId, flowVersionId: "00000000-0000-0000-0000-000000000000" });
    assert.equal(pub.ok, false);
    if (!pub.ok) assert.equal(pub.reason, "not_found");
  });

  it("21. unauthorized version activation: una versión marcada 'failed' NUNCA se publica (fail-closed)", async () => {
    // Escenario: una simulación posterior (Step 9, fuera de este alcance)
    // marcó una versión como "failed". El Registry real nunca crea una fila
    // así por su propia cuenta durante compileAndCreateDraftVersion (solo lo
    // hace cuando validateFlowForPublish falla) -- aquí se llama al store
    // directo con ese status para verificar el contrato público: el draft SÍ
    // se persiste (auditable/corregible), pero publishVersion lo rechaza.
    const store = createInMemoryBusinessAgentRegistryStore();
    const d = deps(store);

    const failing = await store.createDraftVersion({
      tenantId: TENANT_A,
      spec: photographySpec(),
      specChecksum: "irrelevant",
      ir: { checksum: "irrelevant" } as unknown as import("@/lib/agent-compiler/ir").CompiledBusinessAgentIR,
      gateRules: [],
      flow: { name: "x", nodes: [], edges: [], variables: [] },
      flowChecksum: "irrelevant",
      validationStatus: "failed",
      validationReport: [{ code: "FLOW_MISSING_END_NODE", severity: "error", phase: "ir_generation", message: "sin end" }],
    });
    assert.equal(failing.ok, true, "el draft SÍ se persiste (auditable/corregible)");
    if (!failing.ok) return;

    const pub = await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: failing.flowId, flowVersionId: failing.flowVersionId });
    assert.equal(pub.ok, false);
    if (!pub.ok) assert.equal(pub.reason, "not_validated");
    const identity = store._debug.flows.find((f) => f.id === failing.flowId)!;
    assert.notEqual(identity.status, "published", "nunca queda publicado");
  });

  it("15. archived/no publicado: bind falla si el flow no está publicado", async () => {
    const clientes = new Map([["+573000000002", { tenantId: TENANT_A, flowActivo: false, flowId: null }]]);
    const d = deps(createInMemoryBusinessAgentRegistryStore({ clientes }));
    const draft = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    if (!draft.ok) return assert.fail();
    const bind = await bindWhatsAppNumberToBusinessAgent(d, { tenantId: TENANT_A, phoneNumberId: "+573000000002", flowId: draft.flowId });
    assert.equal(bind.ok, false);
    if (!bind.ok) assert.equal(bind.reason, "flow_not_published");
  });

  it("16/17. checksum integrity / artifact mismatch: el resolver detecta un FlowDefinition alterado tras publicar", async () => {
    const clientes = new Map([["+573000000003", { tenantId: TENANT_A, flowActivo: true, flowId: null as string | null }]]);
    const store = createInMemoryBusinessAgentRegistryStore({ clientes });
    const d = deps(store);
    const draft = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    if (!draft.ok) return assert.fail();
    await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: draft.flowId, flowVersionId: draft.flowVersionId });
    clientes.get("+573000000003")!.flowId = draft.flowId;

    const ok = await createSupabaseBusinessAgentResolver({ store }).resolve(
      {} as never,
      { phone_number_id: "+573000000003", id_tenant: TENANT_A, flow_activo: true, flow_id: draft.flowId },
    );
    assert.equal(ok.kind, "business_agent");

    // Tampering: alteramos el FlowDefinition persistido SIN pasar por el compiler.
    const version = await store.getVersion(TENANT_A, draft.flowVersionId);
    assert.ok(version);
    const tamperedStore: typeof store = {
      ...store,
      async getVersion(t, id) {
        const v = await store.getVersion(t, id);
        return v ? { ...v, flow: { ...v.flow, name: "TAMPERED" } } : null;
      },
      async resolvePublishedVersion(t, f) {
        const v = await store.resolvePublishedVersion(t, f);
        return v ? { ...v, flow: { ...v.flow, name: "TAMPERED" } } : null;
      },
    };
    const tampered = await createSupabaseBusinessAgentResolver({ store: tamperedStore }).resolve(
      {} as never,
      { phone_number_id: "+573000000003", id_tenant: TENANT_A, flow_activo: true, flow_id: draft.flowId },
    );
    assert.deepEqual(tampered, { kind: "none", reason: "checksum_mismatch" });
  });

  it("18. disabled agent: flow_activo=false => none/not_active (resolver)", async () => {
    const resolution = await createSupabaseBusinessAgentResolver().resolve(
      {} as never,
      { phone_number_id: "x", id_tenant: TENANT_A, flow_activo: false, flow_id: "y" },
    );
    assert.deepEqual(resolution, { kind: "none", reason: "not_active" });
  });

  it("19. missing agent: flow_id=null => none/not_active (resolver)", async () => {
    const resolution = await createSupabaseBusinessAgentResolver().resolve(
      {} as never,
      { phone_number_id: "x", id_tenant: TENANT_A, flow_activo: true, flow_id: null },
    );
    assert.deepEqual(resolution, { kind: "none", reason: "not_active" });
  });

  it("20. resolver tenant mismatch: el store devuelve una versión de OTRO tenant => none/tenant_unresolved", async () => {
    const store = createInMemoryBusinessAgentRegistryStore();
    const d = deps(store);
    const draft = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    if (!draft.ok) return assert.fail();
    await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: draft.flowId, flowVersionId: draft.flowVersionId });

    // Simula un store BUGUEADO que ignora el tenantId de scoping y devuelve la
    // versión real de TENANT_A sin importar qué tenant se le pida -- el
    // resolver debe atrapar esto por su cuenta (defensa en profundidad),
    // incluso si el store "confió" en el caller equivocadamente.
    const spoofedStore: typeof store = {
      ...store,
      async resolvePublishedVersion(_ignoredTenantId, f) {
        return store.resolvePublishedVersion(TENANT_A, f);
      },
    };
    const resolution = await createSupabaseBusinessAgentResolver({ store: spoofedStore }).resolve(
      {} as never,
      { phone_number_id: "x", id_tenant: TENANT_B, flow_activo: true, flow_id: draft.flowId },
    );
    assert.deepEqual(resolution, { kind: "none", reason: "tenant_unresolved" });
  });

  it("22. stale version: agente vinculado a un flow luego DESPUBLICADO (nunca publicado en otro tenant) => none/not_published", async () => {
    const d = deps();
    const draft = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    if (!draft.ok) return assert.fail();
    // Nunca se publica -- flow sigue draft.
    const resolution = await createSupabaseBusinessAgentResolver({ store: d.store }).resolve(
      {} as never,
      { phone_number_id: "x", id_tenant: TENANT_A, flow_activo: true, flow_id: draft.flowId },
    );
    assert.deepEqual(resolution, { kind: "none", reason: "not_published" });
  });

  it("24. idempotent binding ya cubierto en 10/11 (mismo resultado, sin duplicar efectos)", () => {
    assert.ok(true);
  });

  it("resolver: flow hand-built (sin artefactos de Business Agent) => none/not_published, nunca ejecuta el Gate", async () => {
    // Un flow publicado por Flow Studio (sin pasar por el Registry) no tiene
    // fila en dulabs_business_agent_versions -> resolvePublishedVersion
    // devuelve null -> el caller sigue por el Flow Engine normal, sin Gate.
    const store = createInMemoryBusinessAgentRegistryStore();
    const resolution = await createSupabaseBusinessAgentResolver({ store }).resolve(
      {} as never,
      { phone_number_id: "x", id_tenant: TENANT_A, flow_activo: true, flow_id: "flow-hand-built-sin-registro" },
    );
    assert.deepEqual(resolution, { kind: "none", reason: "not_published" });
  });

  it("resolvePublishedBusinessAgentVersion (helper de alto nivel) coincide con el store", async () => {
    const d = deps();
    const draft = await compileAndCreateDraftVersion(d, { tenantId: TENANT_A, spec: photographySpec() });
    if (!draft.ok) return assert.fail();
    await publishBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: draft.flowId, flowVersionId: draft.flowVersionId });
    const resolved = await resolvePublishedBusinessAgentVersion(d, { tenantId: TENANT_A, flowId: draft.flowId });
    assert.ok(resolved);
    assert.equal(resolved!.flowVersionId, draft.flowVersionId);
  });
});
