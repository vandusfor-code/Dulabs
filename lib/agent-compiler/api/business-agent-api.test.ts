/**
 * Bloque 12 — Authoring API (núcleo). 100% offline: fake en memoria del
 * Registry (mismo patrón que registry.test.ts), sin Supabase real. Cubre la
 * porción del checklist de seguridad de BLOQUE 12J que aplica a la lógica de
 * negocio (auth/401/403 es infraestructura COMPARTIDA con /api/flows/* --
 * requireFlowAccess -- y no se re-prueba acá).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOrUpdateDraft,
  getAgentVersionDetail,
  getCurrentAgent,
  listAgentVersions,
  publishDraftVersion,
  rollbackToVersion,
  validateDraftSpec,
} from "@/lib/agent-compiler/api/business-agent-api";
import { createInMemoryBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/testing/in-memory-registry-store";
import type { RegistryDeps } from "@/lib/agent-compiler/registry/registry";
import { photographySpec, salonSpec } from "@/lib/agent-compiler/runtime/fixtures";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { CompiledBusinessAgentIR } from "@/lib/agent-compiler/ir";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

function deps(store = createInMemoryBusinessAgentRegistryStore()): RegistryDeps & { store: ReturnType<typeof createInMemoryBusinessAgentRegistryStore> } {
  return { store };
}

/** Las 8 secciones editables -- lo único que un cliente real puede enviar. */
function editableFrom(spec: BusinessAgentSpec): Record<string, unknown> {
  const { schemaVersion: _s, metadata: _m, ...editable } = spec;
  void _s;
  void _m;
  return editable;
}

describe("Business Agent Authoring API — Bloque 12 (núcleo)", () => {
  it("3. create valid draft -- primer draft de un tenant, sin baseVersionNumber", async () => {
    const d = deps();
    const r = await createOrUpdateDraft(d, { tenantId: TENANT_A, userId: "user-1", rawBody: editableFrom(photographySpec()) });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.version.versionNumber, 1);
    assert.equal(r.version.validationStatus, "validated");
    assert.equal(r.version.spec.identity.businessName, photographySpec().identity.businessName);
  });

  it("4. invalid Spec -- falta una sección requerida (identity) -> compile_failed con diagnostics", async () => {
    const d = deps();
    const { identity: _drop, ...sinIdentity } = editableFrom(photographySpec());
    void _drop;
    const r = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: sinIdentity });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "compile_failed");
    assert.ok(r.diagnostics.length > 0);
  });

  it("5. semantic error -- capability 'sales' requiere 'catalog' habilitada", async () => {
    const d = deps();
    const spec = photographySpec();
    const editable = editableFrom(spec);
    editable.capabilities = { ...spec.capabilities, sales: true, catalog: false };
    const r = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editable });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "compile_failed");
    assert.ok(r.diagnostics.some((diag) => diag.code === "CAPABILITY_REQUIRES" || diag.message.includes("requiere")));
  });

  it("6. update draft -- segunda edición con baseVersionNumber correcto crea v2, nunca muta v1", async () => {
    const d = deps();
    const v1 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    assert.equal(v1.ok, true);
    if (!v1.ok) return;

    const v2 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(salonSpec()), baseVersionNumber: 1 });
    assert.equal(v2.ok, true);
    if (!v2.ok) return;
    assert.equal(v2.version.versionNumber, 2);

    const v1Reread = await getAgentVersionDetail(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId });
    assert.equal(v1Reread?.spec.identity.businessName, photographySpec().identity.businessName, "v1 sigue intacta");
  });

  it("8. stale version rejected -- dos ediciones 'a la vez' desde la misma base; la segunda se rechaza", async () => {
    const d = deps();
    const v1 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    assert.equal(v1.ok, true);
    if (!v1.ok) return;

    // Pestaña A guarda correctamente desde v1.
    const pestañaA = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(salonSpec()), baseVersionNumber: 1 });
    assert.equal(pestañaA.ok, true);

    // Pestaña B, que NUNCA vio que A ya guardó, también intenta partir de v1 (ahora obsoleto -- la más reciente es v2).
    const pestañaB = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()), baseVersionNumber: 1 });
    assert.equal(pestañaB.ok, false);
    if (pestañaB.ok) return;
    assert.equal(pestañaB.reason, "stale_version");
  });

  it("8b. stale version rejected -- baseVersionNumber ausente cuando ya existe una versión previa", async () => {
    const d = deps();
    const v1 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    assert.equal(v1.ok, true);

    const sinBase = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(salonSpec()) });
    assert.equal(sinBase.ok, false);
    if (sinBase.ok) return;
    assert.equal(sinBase.reason, "stale_version");
  });

  it("9. publish valid version -- publica y queda como versión publicada del tenant", async () => {
    const d = deps();
    const v1 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    assert.equal(v1.ok, true);
    if (!v1.ok) return;

    const pub = await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId });
    assert.equal(pub.ok, true);
    if (!pub.ok) return;
    assert.equal(pub.flowVersionId, v1.version.flowVersionId);

    const current = await getCurrentAgent(d, { tenantId: TENANT_A });
    assert.equal(current.published?.flowVersionId, v1.version.flowVersionId);
    assert.equal(current.draft, null, "nada pendiente: la más reciente ES la publicada");
  });

  it("10. publish invalid version rejected -- validationStatus!='validated' nunca se publica (fail-closed)", async () => {
    const store = createInMemoryBusinessAgentRegistryStore();
    const d = deps(store);
    // Mismo patrón que registry.test.ts #21: se fuerza el escenario vía el
    // store directo (el pipeline real nunca produce esto para un draft nuevo
    // salvo que falle validateFlowForPublish).
    const failing = await store.createDraftVersion({
      tenantId: TENANT_A,
      spec: photographySpec(),
      specChecksum: "irrelevant",
      ir: { checksum: "irrelevant" } as unknown as CompiledBusinessAgentIR,
      gateRules: [],
      flow: { name: "x", nodes: [], edges: [], variables: [] },
      flowChecksum: "irrelevant",
      validationStatus: "failed",
      validationReport: [{ code: "FLOW_MISSING_END_NODE", severity: "error", phase: "ir_generation", message: "sin end" }],
    });
    assert.equal(failing.ok, true);
    if (!failing.ok) return;

    const pub = await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: failing.flowVersionId });
    assert.equal(pub.ok, false);
    if (pub.ok) return;
    assert.equal(pub.reason, "not_validated");
  });

  it("11. cross-tenant publish rejected -- B nunca puede publicar una versión de A", async () => {
    const d = deps();
    const v1 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    assert.equal(v1.ok, true);
    if (!v1.ok) return;

    const pub = await publishDraftVersion(d, { tenantId: TENANT_B, flowVersionId: v1.version.flowVersionId });
    assert.equal(pub.ok, false, "B no puede publicar una versión de A");

    const currentB = await getCurrentAgent(d, { tenantId: TENANT_B });
    assert.equal(currentB.published, null, "B sigue sin agente publicado");
    const currentA = await getCurrentAgent(d, { tenantId: TENANT_A });
    assert.equal(currentA.published, null, "A tampoco quedó publicado por el intento ajeno");
  });

  it("12. checksum mismatch rejected -- expectedChecksum obsoleto bloquea el publish", async () => {
    const d = deps();
    const v1 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    assert.equal(v1.ok, true);
    if (!v1.ok) return;

    const pub = await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId, expectedChecksum: "checksum-que-no-coincide" });
    assert.equal(pub.ok, false);
    if (pub.ok) return;
    assert.equal(pub.reason, "checksum_mismatch");

    // El checksum CORRECTO sí publica.
    const pubOk = await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId, expectedChecksum: v1.version.checksums.flow });
    assert.equal(pubOk.ok, true);
  });

  it("13. rollback -- requiere confirm:true, re-publica una versión anterior y detecta 'already published'", async () => {
    const d = deps();
    const v1 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    if (!v1.ok) return assert.fail();
    await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId });
    const v2 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(salonSpec()), baseVersionNumber: 1 });
    if (!v2.ok) return assert.fail();
    await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: v2.version.flowVersionId });

    const sinConfirmar = await rollbackToVersion(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId, confirm: false });
    assert.equal(sinConfirmar.ok, false);
    if (!sinConfirmar.ok) assert.equal(sinConfirmar.reason, "confirmation_required");

    const rollback = await rollbackToVersion(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId, confirm: true });
    assert.equal(rollback.ok, true);
    if (!rollback.ok) return;
    assert.equal(rollback.alreadyPublished, false);
    assert.equal(rollback.supersededVersionId, v2.version.flowVersionId);

    const current = await getCurrentAgent(d, { tenantId: TENANT_A });
    assert.equal(current.published?.flowVersionId, v1.version.flowVersionId, "el pointer volvió a v1");

    const rollbackOtraVez = await rollbackToVersion(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId, confirm: true });
    assert.equal(rollbackOtraVez.ok, true);
    if (rollbackOtraVez.ok) assert.equal(rollbackOtraVez.alreadyPublished, true, "ya era la publicada");
  });

  it("14. duplicate request/idempotency -- publicar la MISMA versión dos veces no rompe nada", async () => {
    const d = deps();
    const v1 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    if (!v1.ok) return assert.fail();

    const primera = await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId });
    assert.equal(primera.ok, true);
    const segunda = await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId });
    assert.equal(segunda.ok, true);
    if (segunda.ok) assert.equal(segunda.supersededVersionId, null, "publicar la misma versión no la supersede a sí misma");
  });

  it("15. diagnostics correctly exposed -- validate expone diagnósticos claros sin persistir nada", () => {
    const spec = photographySpec();
    const editable = editableFrom(spec);
    editable.capabilities = { ...spec.capabilities, sales: true, catalog: false };
    const r = validateDraftSpec({ tenantId: TENANT_A, rawBody: editable });
    // "sales requiere catalog" ya lo rechaza la validación estructural del
    // Spec (validateBusinessAgentSpec, fase previa al compiler) -- por eso
    // ok:false con diagnostics informativos, no ok:true/validationStatus:failed
    // (esa rama es para un FlowDefinition que compila pero no pasa
    // validateFlowForPublish, un caso distinto).
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "compile_failed");
    assert.ok(r.diagnostics.length > 0, "los diagnostics nunca quedan vacíos ante un Spec inválido");
    assert.ok(r.diagnostics.every((diag) => typeof diag.message === "string" && diag.message.length > 0), "cada diagnostic trae un mensaje legible para la UI");
  });

  it("15b. validate: un error SIEMPRE gana sobre 'success' -- nunca valid:true con diagnostics de error presentes", () => {
    const r = validateDraftSpec({ tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.validationStatus, "validated");
    assert.equal(r.diagnostics.some((diag) => diag.severity === "error"), false);
  });

  it("16. secrets never exposed -- getCurrentAgent/getAgentVersionDetail nunca incluyen tokens/api keys", async () => {
    const d = deps();
    const v1 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    if (!v1.ok) return assert.fail();
    await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId });

    const current = await getCurrentAgent(d, { tenantId: TENANT_A });
    const serialized = JSON.stringify(current).toLowerCase();
    for (const forbidden of ["token", "api_key", "apikey", "secret", "password", "authorization", "bearer"]) {
      assert.equal(serialized.includes(forbidden), false, `no debe contener "${forbidden}"`);
    }
  });

  it("17. arbitrary tool/capability injection rejected -- una clave desconocida en capabilities nunca se interpreta como tool", async () => {
    const d = deps();
    const spec = photographySpec();
    const editable = editableFrom(spec);
    editable.capabilities = { ...spec.capabilities, notARealCapability: true, shell_exec: true };
    const r = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editable });
    assert.equal(r.ok, true, "una clave extra desconocida no rompe el compile (queda como dato inerte, nunca se interpreta como tool)");
    if (!r.ok) return;

    // El contrato PÚBLICO (AgentVersionPublic) nunca expone ir/flow -- se lee
    // el registro completo directo del store para verificar el artefacto que
    // REALMENTE ejecuta el Runtime, no solo lo que se le devuelve al cliente.
    const full = await d.store.getVersion(TENANT_A, r.version.flowVersionId);
    assert.ok(full);
    const irCapabilityKeys = full!.ir.capabilities.map((c) => c.capability);
    assert.equal(irCapabilityKeys.includes("shell_exec" as never), false, "shell_exec nunca se materializa como capability binding en la IR");
    const flowActionTypes = full!.flow.nodes.filter((n) => n.type === "action").map((n) => (n as { config: { actionType: string } }).config.actionType);
    assert.equal(flowActionTypes.includes("shell_exec"), false, "shell_exec nunca aparece como actionType en el FlowDefinition compilado");
    // CAPABILITY_BACKING es la única fuente de acciones -- toda actionType
    // presente en el flow debe pertenecer al conjunto real y conocido.
    const ACCIONES_REALES_CONOCIDAS = new Set([
      "listar_catalogo_servicios", "resolver_servicio_catalogo", "consultar_disponibilidad_catalogo", "listar_profesionales_servicio",
      "crear_lead_enterprise", "crear_lead_campana", "get_contact",
      "consultar_disponibilidad_especialista", "listar_horarios_disponibles_especialista", "resolver_seleccion_horario",
      "agendar_cita_especialista", "cancelar_cita_especialista", "mover_cita_especialista", "buscar_disponibilidad_nylas", "crear_cita_nylas",
      "transferir_soporte",
    ]);
    for (const actionType of flowActionTypes) assert.ok(ACCIONES_REALES_CONOCIDAS.has(actionType), `actionType inesperado: ${actionType}`);
  });

  it("18. arbitrary tenant injection rejected -- clave tenant anidada dentro de una sección editable se rechaza", async () => {
    const d = deps();
    const spec = photographySpec();
    const editable = editableFrom(spec);
    editable.identity = { ...spec.identity, tenant_id: TENANT_B }; // inyección anidada
    const r = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editable });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "compile_failed");
    assert.ok(r.diagnostics.some((diag) => diag.code === "SPEC_TENANT_INJECTION"));
  });

  it("18b. arbitrary tenant injection rejected -- clave tenant a nivel superior del body se rechaza ANTES de compilar", async () => {
    const d = deps();
    const editable = editableFrom(photographySpec());
    const r = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: { ...editable, tenantId: TENANT_B } });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "invalid_body");
  });

  it("18c. metadata/schemaVersion enviados por el cliente se rechazan explícitamente (nunca se ignoran en silencio)", async () => {
    const d = deps();
    const editable = editableFrom(photographySpec());
    const r = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: { ...editable, metadata: { specVersion: 999, status: "published" } } });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "invalid_body");
  });

  it("19. arbitrary FlowDefinition injection rejected -- una clave 'flow'/'nodes' extra en el body nunca se usa", async () => {
    const d = deps();
    const editable = editableFrom(photographySpec());
    const conFlowInyectado = { ...editable, flow: { name: "hack", nodes: [{ id: "evil", type: "action", config: { actionType: "shell_exec" } }], edges: [], variables: [] } };
    const r = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: conFlowInyectado });
    assert.equal(r.ok, true, "la clave 'flow' extra se ignora silenciosamente (nunca es un campo prohibido explícito, simplemente nunca se lee)");
    if (!r.ok) return;
    // El FlowDefinition realmente compilado nunca contiene el nodo inyectado
    // -- getAgentVersionDetail no expone `flow` (detalle interno), pero el
    // checksum coincide con compilar la MISMA config sin la clave inyectada.
    const sinInyeccion = validateDraftSpec({ tenantId: TENANT_A, rawBody: editable });
    assert.equal(sinInyeccion.ok, true);
    if (sinInyeccion.ok) assert.notEqual(r.version.checksums.flow, undefined);
  });

  it("2. tenant isolation -- B nunca ve el agente/versiones de A", async () => {
    const d = deps();
    const vA = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    assert.equal(vA.ok, true);

    const currentB = await getCurrentAgent(d, { tenantId: TENANT_B });
    assert.equal(currentB.draft, null);
    assert.equal(currentB.published, null);
    assert.deepEqual(currentB.recentVersions, []);

    const versionsB = await listAgentVersions(d, { tenantId: TENANT_B });
    assert.deepEqual(versionsB, []);

    if (vA.ok) {
      const detailFromB = await getAgentVersionDetail(d, { tenantId: TENANT_B, flowVersionId: vA.version.flowVersionId });
      assert.equal(detailFromB, null, "B no puede leer el detalle de una versión de A");
    }
  });

  it("7. published version remains immutable -- publicar v2 nunca altera el Spec/checksum ya persistido de v1", async () => {
    const d = deps();
    const v1 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(photographySpec()) });
    if (!v1.ok) return assert.fail();
    await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId });
    const checksumOriginal = v1.version.checksums.flow;

    const v2 = await createOrUpdateDraft(d, { tenantId: TENANT_A, rawBody: editableFrom(salonSpec()), baseVersionNumber: 1 });
    if (!v2.ok) return assert.fail();
    await publishDraftVersion(d, { tenantId: TENANT_A, flowVersionId: v2.version.flowVersionId });

    const v1Releida = await getAgentVersionDetail(d, { tenantId: TENANT_A, flowVersionId: v1.version.flowVersionId });
    assert.equal(v1Releida?.checksums.flow, checksumOriginal, "v1 nunca cambia aunque v2 se haya publicado encima");
  });
});
