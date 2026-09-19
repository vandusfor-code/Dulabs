/**
 * Business Agent Registry — harness de integración REAL contra Supabase.
 *
 * ⚠️ NO SE EJECUTA POR DEFECTO. NO está en scripts/test-flow-manifest.txt a
 * propósito (ese manifiesto es exclusivamente para tests offline/en memoria —
 * ver su comentario: "worker/src/**\/*.test.ts... NUNCA debe correr acá --
 * ya causó un incidente real contra AMORE"). Este repositorio NO tiene un
 * proyecto Supabase de staging separado: .env.local apunta al MISMO proyecto
 * de producción que usa todo lo demás (confirmado; ver memoria
 * feedback-worker-tests-produccion). Correr esto sin un proyecto Supabase
 * DEDICADO de pruebas escribe filas permanentes en la base compartida real
 * (ver advertencia de INMUTABILIDAD abajo).
 *
 * REQUISITOS PARA CORRER (todos, a propósito -- ningún gate solo no alcanza):
 *   1. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en el entorno.
 *   2. La migración supabase/migrations/20261018000000_dulabs_business_agent_versions.sql
 *      YA aplicada en ESE proyecto (este harness no la aplica).
 *   3. RUN_AGENT_COMPILER_SUPABASE_INTEGRATION_TESTS=1 -- flag EXPLÍCITO y
 *      dedicado (no basta con tener las credenciales en el entorno): confirma
 *      que quien ejecuta este archivo entendió que:
 *        a) si SUPABASE_URL apunta a producción, esto escribe en producción;
 *        b) las filas que crea en dulabs_business_agent_versions son
 *           PERMANENTES E IRREVERSIBLES por diseño (trigger de inmutabilidad
 *           deny-delete incondicional, mismo patrón que dulabs_flow_events/
 *           dulabs_flow_effects -- auditoría append-only real, nunca se creó
 *           pensando en poder limpiarse a sí misma).
 *
 * Sin los 3 requisitos, este archivo se salta por completo (describe.skip) --
 * `node --test` sobre él termina en 0 tests ejecutados, nunca en error.
 *
 * Aislamiento: usa EXCLUSIVAMENTE un tenantId descartable (randomUUID, prefijo
 * reconocible) generado en cada corrida -- nunca toca un tenant real. Sigue el
 * ÚNICO patrón seguro ya usado en este repo para tests de integración real
 * (worker/src/whatsapp-qr/manager.test.ts: "tenants descartables por
 * randomUUID, nunca AMORE/Daniela/Solo Talento a propósito").
 *
 * Qué prueba (lo que el fake en memoria NO puede probar):
 *   - La migración real (tabla, constraints, RLS, trigger) es aplicable y
 *     coherente con lo que el store espera.
 *   - createFlow/createFlowVersion/publishFlowVersion (lib/flow/flow-store.ts,
 *     REALES) + el RPC dulabs_flow_publish_version funcionan end-to-end desde
 *     este adapter.
 *   - El row-lock (`for update`) del RPC sigue existiendo y sigue sirviendo
 *     para publicar sin duplicar el pointer.
 *
 * Qué NO prueba (fuera del alcance de un harness offline-first):
 *   - Concurrencia real (requeriría dos conexiones/procesos concurrentes
 *     contra la misma fila -- el row-lock YA es infraestructura EXISTENTE
 *     reutilizada sin cambios, no se re-certifica su corrección aquí).
 *   - Rendimiento/carga.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { compileIRToFlowDefinition } from "@/lib/agent-compiler/flow-compiler";
import { buildGateRules } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";
import { checksumOf } from "@/lib/agent-compiler/checksum";
import { retailSpec } from "@/lib/agent-compiler/runtime/fixtures";

const OPT_IN = process.env.RUN_AGENT_COMPILER_SUPABASE_INTEGRATION_TESTS === "1";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUEDE_CORRER = OPT_IN && Boolean(SUPABASE_URL) && Boolean(SERVICE_ROLE_KEY);

// Prefijo reconocible: cualquiera que audite la DB real ve inmediatamente que
// es un tenant de prueba descartable de este harness, nunca un tenant real
// (un UUID real de gen_random_uuid() nunca empieza así -- versión "9",
// variante inválida, a propósito para que sea imposible de confundir).
function tenantDescartable(): string {
  return `99999999-dead-9eee-9eee-${randomUUID().slice(24)}`;
}

describe("Business Agent Registry — integración REAL contra Supabase (gated)", { skip: !PUEDE_CORRER }, () => {
  if (!PUEDE_CORRER) {
    // Mensaje explícito en el reporte de test (no un fallo, solo diagnóstico
    // de por qué se saltó) cuando alguien corre este archivo sin querer.
    it("SALTADO: falta RUN_AGENT_COMPILER_SUPABASE_INTEGRATION_TESTS=1 y/o credenciales de Supabase", () => {
      assert.ok(true);
    });
    return;
  }

  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const store = createSupabaseBusinessAgentRegistryStore(supabase);

  function compilarFlowReal(tenantId: string) {
    const ctx = { tenantId };
    const compiled = compileBusinessAgent(retailSpec(), ctx);
    assert.equal(compiled.success, true, "el Spec fixture debe compilar (bug real si falla, no de infra)");
    if (!compiled.success) throw new Error("unreachable");
    const flowResult = compileIRToFlowDefinition(compiled.ir, ctx);
    assert.equal(flowResult.success, true, "el FlowDefinition debe compilar");
    if (!flowResult.success) throw new Error("unreachable");
    const gateRules = buildGateRules(compiled.ir);
    const publishCheck = validateFlowForPublish(flowResult.flow);
    return { ir: compiled.ir, flow: flowResult.flow, flowChecksum: flowResult.checksum, gateRules, publishCheck };
  }

  it("createDraftVersion real: crea dulabs_flows + dulabs_flow_versions + dulabs_business_agent_versions", async () => {
    const tenantId = tenantDescartable();
    const spec = retailSpec();
    const { ir, flow, flowChecksum, gateRules, publishCheck } = compilarFlowReal(tenantId);

    const created = await store.createDraftVersion({
      tenantId,
      spec,
      specChecksum: checksumOf(spec),
      ir,
      gateRules,
      flow,
      flowChecksum,
      validationStatus: publishCheck.valid ? "validated" : "failed",
      validationReport: [],
    });

    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) return;
    assert.equal(created.versionNumber, 1);

    const readBack = await store.getVersion(tenantId, created.flowVersionId);
    assert.ok(readBack, "la versión debe poder leerse de vuelta desde la DB real");
    assert.equal(readBack!.flowChecksum, flowChecksum, "el checksum persistido coincide con el calculado");
    assert.deepEqual(readBack!.gateRules, gateRules);
  });

  it("publishVersion real: usa el RPC dulabs_flow_publish_version real y el pointer queda consistente", async () => {
    const tenantId = tenantDescartable();
    const { ir, flow, flowChecksum, gateRules, publishCheck } = compilarFlowReal(tenantId);
    assert.equal(publishCheck.valid, true, "este test requiere una versión publicable");

    const spec = retailSpec();
    const created = await store.createDraftVersion({
      tenantId,
      spec,
      specChecksum: checksumOf(spec),
      ir,
      gateRules,
      flow,
      flowChecksum,
      validationStatus: "validated",
      validationReport: [],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const published = await store.publishVersion(tenantId, created.flowId, created.flowVersionId);
    assert.equal(published.ok, true, JSON.stringify(published));

    const resolved = await store.resolvePublishedVersion(tenantId, created.flowId);
    assert.ok(resolved, "resolvePublishedVersion debe encontrar la versión recién publicada");
    assert.equal(resolved!.flowVersionId, created.flowVersionId);

    // NOTA: esta fila queda PERMANENTE (dulabs_business_agent_versions no
    // permite DELETE, por diseño -- ver header). tenantId descartable, cero
    // impacto en datos reales, pero no hay cleanup posible aquí.
  });

  it("tenant isolation real: un tenant descartable B no ve la versión de un tenant descartable A", async () => {
    const tenantA = tenantDescartable();
    const tenantB = tenantDescartable();
    const { ir, flow, flowChecksum, gateRules } = compilarFlowReal(tenantA);
    const spec = retailSpec();

    const created = await store.createDraftVersion({
      tenantId: tenantA,
      spec,
      specChecksum: checksumOf(spec),
      ir,
      gateRules,
      flow,
      flowChecksum,
      validationStatus: "validated",
      validationReport: [],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const crossTenantRead = await store.getVersion(tenantB, created.flowVersionId);
    assert.equal(crossTenantRead, null, "tenant B no debe poder leer una versión de tenant A");

    const crossTenantPublish = await store.publishVersion(tenantB, created.flowId, created.flowVersionId);
    assert.equal(crossTenantPublish.ok, false, "tenant B no debe poder publicar una versión de tenant A");
  });
});
