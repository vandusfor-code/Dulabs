/**
 * Fase 0 (autorizado) — smoke test de integración REAL para el adaptador
 * FlowOrchestratorStore sobre Supabase. Mismo patrón que
 * especialistas-flow-adaptador.test.ts: se salta sin credenciales, usa un
 * tenant/flow descartables, limpia todo al final. No usa el tenant ni el
 * flow de Daniela.
 *
 * Cada función interna (createFlow, createExecution, saveExecutionState...)
 * ya tiene su propia cobertura exhaustiva en flow-store.test.ts -- este
 * archivo prueba específicamente que el ADAPTADOR (la capa de wiring que
 * convierte esas funciones en el objeto FlowOrchestratorStore que espera
 * ExecutionOrchestrator) resuelve correctamente cada método, de punta a
 * punta, contra la base de datos real.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseFlowOrchestratorStore } from "@/lib/flow/flow-orchestrator-store-supabase";
import { createFlow, createFlowVersion } from "@/lib/flow/flow-store";
import { createFlowEngineState } from "@/lib/flow/flow-engine";
import type { FlowDefinition } from "@/lib/flow/types";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function miniFlow(): FlowDefinition {
  return {
    name: "Store adapter smoke test",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [{ id: "e1", source: "start", target: "end" }],
    variables: [],
  };
}

describe(
  "Fase 0 — FlowOrchestratorStore sobre Supabase real (tenant de prueba)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_ID = randomUUID();
    const PHONE_NUMBER_ID = `test-store-adapter-${Date.now()}`;
    const TELEFONO_CLIENTE = "573009998888";
    let flowId: string;
    let versionId: string;
    let executionRowId: string;

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const flow = await createFlow(supabase, { tenantId: TENANT_ID, slug: `smoke-${Date.now()}`, name: "Smoke" });
      flowId = flow.id;
      const version = await createFlowVersion(supabase, {
        tenantId: TENANT_ID,
        flowId,
        versionNumber: 1,
        definition: miniFlow(),
      });
      versionId = version.id;
      // A propósito NO se publica esta versión: dulabs_flow_versions tiene
      // un trigger de inmutabilidad real que PROHÍBE eliminar una versión
      // publicada ("no se puede eliminar una versión publicada") -- correcto
      // para producción, pero incompatible con limpiar un flow descartable
      // de test. getFlow/getFlowVersion no requieren que esté publicada.
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      if (executionRowId) {
        await supabase.from("dulabs_flow_effects").delete().eq("flow_execution_id", executionRowId);
        await supabase.from("dulabs_flow_events").delete().eq("flow_execution_id", executionRowId);
        await supabase.from("dulabs_flow_executions").delete().eq("id", executionRowId);
      }
      if (flowId) {
        const { error: errV } = await supabase.from("dulabs_flow_versions").delete().eq("flow_id", flowId);
        if (errV) console.error("[cleanup] no se pudo borrar flow_versions de prueba:", errV.message);
        const { error: errF } = await supabase.from("dulabs_flows").delete().eq("id", flowId);
        if (errF) console.error("[cleanup] no se pudo borrar flow de prueba:", errF.message);
      }
    });

    it("getFlow / getFlowVersion — encuentra lo publicado", async () => {
      const store = createSupabaseFlowOrchestratorStore(supabase);
      const flow = await store.getFlow(TENANT_ID, flowId);
      assert.equal(flow?.id, flowId);
      const version = await store.getFlowVersion(TENANT_ID, versionId);
      assert.equal(version?.id, versionId);
    });

    it("getFlow con tenant equivocado → null (aislamiento real)", async () => {
      const store = createSupabaseFlowOrchestratorStore(supabase);
      const flow = await store.getFlow(randomUUID(), flowId);
      assert.equal(flow, null);
    });

    it("createExecution → getActiveExecution → getExecutionById → saveExecutionState", async () => {
      const store = createSupabaseFlowOrchestratorStore(supabase);
      const executionId = randomUUID();
      const initialState = createFlowEngineState(miniFlow(), { flowId, flowVersionId: versionId, executionId });

      const created = await store.createExecution({
        tenantId: TENANT_ID,
        flowId,
        flowVersionId: versionId,
        executionId,
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: TELEFONO_CLIENTE,
        initialState,
      });
      assert.equal(created.created, true);
      if (!created.created) return;
      executionRowId = created.row.id;

      const activa = await store.getActiveExecution(TENANT_ID, {
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: TELEFONO_CLIENTE,
      });
      assert.equal(activa?.id, executionRowId);

      const porId = await store.getExecutionById(TENANT_ID, executionRowId);
      assert.equal(porId?.id, executionRowId);

      const saved = await store.saveExecutionState(TENANT_ID, executionRowId, initialState, 0);
      assert.equal(saved.stateVersion, 1);
    });

    it("insertEventIdempotent — mismo eventId dos veces solo inserta una", async () => {
      const store = createSupabaseFlowOrchestratorStore(supabase);
      const eventId = randomUUID();
      const first = await store.insertEventIdempotent({
        tenantId: TENANT_ID,
        flowExecutionId: executionRowId,
        eventId,
        eventType: "message",
      });
      assert.equal(first.inserted, true);
      const second = await store.insertEventIdempotent({
        tenantId: TENANT_ID,
        flowExecutionId: executionRowId,
        eventId,
        eventType: "message",
      });
      assert.equal(second.inserted, false);
    });

    it("insertEffectIdempotent → getEffectByEffectId → resolveEffectResult", async () => {
      const store = createSupabaseFlowOrchestratorStore(supabase);
      const effectId = randomUUID();
      const inserted = await store.insertEffectIdempotent({
        tenantId: TENANT_ID,
        flowExecutionId: executionRowId,
        effectId,
        nodeId: "end",
        kind: "send_message",
      });
      assert.equal(inserted.inserted, true);

      const found = await store.getEffectByEffectId(TENANT_ID, executionRowId, effectId);
      assert.equal(found?.effect_id, effectId);

      const resolved = await store.resolveEffectResult({
        tenantId: TENANT_ID,
        flowExecutionId: executionRowId,
        effectId,
        status: "succeeded",
        resultPayloadApplied: { delivered: true },
      });
      assert.equal(resolved.ok, true);
    });

    it("recordNodeTransition — no lanza contra la tabla real", async () => {
      const store = createSupabaseFlowOrchestratorStore(supabase);
      await assert.doesNotReject(
        store.recordNodeTransition({
          tenantId: TENANT_ID,
          flowExecutionId: executionRowId,
          fromNodeId: "start",
          toNodeId: "end",
        }),
      );
    });
  },
);
