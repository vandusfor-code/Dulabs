/**
 * Tests del Flow Store (Fase 3 / 3.1).
 * Unit: siempre ejecutan.
 * Integración Supabase: SKIPPED si faltan SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it, before } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { createFlowEngineState } from "@/lib/flow/flow-engine";
import type { FlowDefinition } from "@/lib/flow/types";
import {
  definitionContainsEmbeddedSecrets,
  looksLikeEmbeddedSecret,
} from "@/lib/flow/detect-embedded-secrets";
import {
  engineStateToExecutionUpdate,
  executionRowToEngineState,
  type FlowExecutionRow,
} from "@/lib/flow/flow-store-types";
import {
  FLOW_STORE_ERROR_CODES,
  FlowExecutionConcurrencyConflictError,
  FlowStoreError,
} from "@/lib/flow/flow-store-errors";
import {
  createFlow,
  createFlowVersion,
  createExecution,
  createIntegration,
  ensureInitialFlowVersion,
  insertEventIdempotent,
  publishFlowVersion,
  getFlowVersion,
  getExecutionById,
  getActiveExecutionByConversation,
  listFlowVersions,
  saveExecutionState,
  getExecutionEngineState,
  upsertCredential,
} from "@/lib/flow/flow-store";

const HAS_DB =
  Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

function minimalFlowDefinition(name: string): FlowDefinition {
  return {
    name,
    nodes: [
      { id: "start", type: "start", config: { triggerType: "manual" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [{ id: "e1", source: "start", target: "end" }],
    variables: [],
  };
}

function baseExecutionRow(overrides: Partial<FlowExecutionRow> = {}): FlowExecutionRow {
  return {
    tenant_id: randomUUID(),
    id: randomUUID(),
    flow_id: randomUUID(),
    flow_version_id: randomUUID(),
    execution_id: "exec-test-1",
    phone_number_id: "123",
    telefono_cliente: "573001112233",
    status: "waiting_input",
    current_node_id: "q1",
    variables: { nombre: "Ana" },
    expected_input: "text",
    pending_effect: null,
    exports: { lead: {}, custom_fields: {}, webhook_body: {} },
    metadata: { lastEventId: "evt-1", foo: "bar" },
    state_version: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit — mappers
// ---------------------------------------------------------------------------

describe("flow-store-types — unit", () => {
  it("executionRowToEngineState roundtrip preserva campos del engine", () => {
    const row = baseExecutionRow();
    const state = executionRowToEngineState(row);
    assert.equal(state.executionId, "exec-test-1");
    assert.equal(state.status, "waiting_input");
    assert.equal(state.variables.nombre, "Ana");
    assert.equal(state.lastEventId, "evt-1");

    const patch = engineStateToExecutionUpdate(state);
    assert.equal(patch.current_node_id, "q1");
    assert.equal(patch.expected_input, "text");
    assert.equal(patch.metadata.lastEventId, "evt-1");
  });
});

// ---------------------------------------------------------------------------
// C3 — detección adversarial de secretos (unit)
// ---------------------------------------------------------------------------

describe("detect-embedded-secrets — unit (C3)", () => {
  it("4. bloquea apiKey con valor sk-live", () => {
    assert.equal(definitionContainsEmbeddedSecrets({ apiKey: "sk-live-abc1234567890" }), true);
  });

  it("5. bloquea X-Api-Key en headers de webhook", () => {
    const def = {
      nodes: [
        {
          id: "act",
          type: "action",
          config: {
            actionType: "webhook_http",
            url: "https://api.example.com",
            headers: { "X-Api-Key": "super-secret-key-value-12345" },
          },
        },
      ],
    };
    assert.equal(definitionContainsEmbeddedSecrets(def), true);
  });

  it("6. bloquea Authorization Bearer token", () => {
    const def = {
      headers: {
        Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
      },
    };
    assert.equal(definitionContainsEmbeddedSecrets(def), true);
  });

  it("7. bloquea JWT en valor genérico", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    assert.equal(definitionContainsEmbeddedSecrets({ token: jwt }), true);
  });

  it("8. NO bloquea texto instructivo sin secreto real", () => {
    assert.equal(looksLikeEmbeddedSecret("Bearer authentication is required"), false);
    assert.equal(looksLikeEmbeddedSecret("Enter your password here"), false);
    assert.equal(looksLikeEmbeddedSecret("token"), false);
    assert.equal(definitionContainsEmbeddedSecrets({ message: "Use your API key from settings" }), false);
  });

  it("bloquea client_secret con valor real", () => {
    assert.equal(definitionContainsEmbeddedSecrets({ client_secret: "cs_live_abcdefghijklmnop" }), true);
  });

  it("permite placeholders {{variable}}", () => {
    assert.equal(
      definitionContainsEmbeddedSecrets({
        headers: { Authorization: "Bearer {{integration.api_token}}" },
      }),
      false,
    );
  });

  it("createFlowVersion rechaza definition con secretos (sin DB)", async () => {
    const fakeSupabase = {
      from: () => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: null, error: null }) }),
        }),
      }),
    } as unknown as SupabaseClient;

    await assert.rejects(
      () =>
        createFlowVersion(fakeSupabase, {
          tenantId: randomUUID(),
          flowId: randomUUID(),
          versionNumber: 1,
          definition: {
            ...minimalFlowDefinition("x"),
            nodes: [
              {
                id: "a",
                type: "action",
                config: {
                  actionType: "webhook_http",
                  url: "https://x.com",
                  headers: { "X-Api-Key": "real-secret-value-here-1234567890" },
                },
              },
            ],
          } as FlowDefinition,
        }),
      (err: FlowStoreError) => err.code === FLOW_STORE_ERROR_CODES.EMBEDDED_SECRETS,
    );
  });
});

// ---------------------------------------------------------------------------
// C2 — concurrencia optimista (unit, mock)
// ---------------------------------------------------------------------------

describe("saveExecutionState — unit (C2)", () => {
  it("3. segundo worker con state_version 7 recibe concurrency conflict", async () => {
    const tenantId = randomUUID();
    const executionRowId = randomUUID();
    const state = createFlowEngineState(minimalFlowDefinition("x"), { executionId: "exec-1" });

    const fakeSupabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await assert.rejects(
      () => saveExecutionState(fakeSupabase, tenantId, executionRowId, state, 7),
      (err: FlowExecutionConcurrencyConflictError) =>
        err.code === FLOW_STORE_ERROR_CODES.EXECUTION_CONCURRENCY_CONFLICT &&
        err.expectedStateVersion === 7,
    );
  });

  it("worker exitoso retorna stateVersion incrementado", async () => {
    const state = createFlowEngineState(minimalFlowDefinition("x"), { executionId: "exec-2" });

    const fakeSupabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: { state_version: 8 }, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await saveExecutionState(fakeSupabase, randomUUID(), randomUUID(), state, 7);
    assert.equal(result.stateVersion, 8);
  });
});

// ---------------------------------------------------------------------------
// Integración Supabase — SKIPPED sin env (describe.skip → no cuenta como PASS)
// ---------------------------------------------------------------------------

const integrationDescribe = HAS_DB
  ? describe
  : describe.skip.bind(describe);

integrationDescribe(
  HAS_DB
    ? "flow-store — integración Supabase [PASS REAL]"
    : "flow-store — integración Supabase [SKIPPED — requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY]",
  () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const supabase = () => supabaseAdmin();

    let flowAId: string;
    let versionA1Id: string;
    let versionA2Id: string;
    let versionA3Id: string;
    let integrationAId: string;
    let executionRowId: string;
    const conversationPhone = "573000000001";
    const conversationPhoneId = "999888777";

    before(async () => {
      const flow = await createFlow(supabase(), {
        tenantId: tenantA,
        slug: `test-flow-${Date.now()}`,
        name: "Test Flow A",
      });
      flowAId = flow.id;

      const v1 = await createFlowVersion(supabase(), {
        tenantId: tenantA,
        flowId: flowAId,
        versionNumber: 1,
        definition: minimalFlowDefinition("v1"),
        publish: true,
      });
      versionA1Id = v1.id;

      const v2 = await createFlowVersion(supabase(), {
        tenantId: tenantA,
        flowId: flowAId,
        versionNumber: 2,
        definition: minimalFlowDefinition("v2"),
      });
      versionA2Id = v2.id;
      await publishFlowVersion(supabase(), tenantA, flowAId, versionA2Id);

      versionA3Id = (
        await createFlowVersion(supabase(), {
          tenantId: tenantA,
          flowId: flowAId,
          versionNumber: 3,
          definition: minimalFlowDefinition("v3"),
        })
      ).id;

      const integration = await createIntegration(supabase(), {
        tenantId: tenantA,
        slug: `int-${Date.now()}`,
        displayName: "Consultar",
        capability: "appointment.available",
        url: "https://api.example.com/consultar",
        approve: true,
      });
      integrationAId = integration.id;

      await upsertCredential(supabase(), {
        tenantId: tenantA,
        integrationId: integrationAId,
        credentialKey: "api_key",
        plaintext: "secret-test-value",
      });

      const state = createFlowEngineState(minimalFlowDefinition("run"), {
        executionId: `exec-${randomUUID()}`,
      });
      const exec = await createExecution(supabase(), {
        tenantId: tenantA,
        flowId: flowAId,
        flowVersionId: versionA1Id,
        executionId: state.executionId,
        phoneNumberId: conversationPhoneId,
        telefonoCliente: conversationPhone,
        initialState: state,
      });
      assert.equal(exec.created, true);
      executionRowId = exec.row.id;
    });

    it("C1.1 — dos createExecution activos: solo uno existe", async () => {
      const state = createFlowEngineState(minimalFlowDefinition("dup"), {
        executionId: `exec-${randomUUID()}`,
      });
      const second = await createExecution(supabase(), {
        tenantId: tenantA,
        flowId: flowAId,
        flowVersionId: versionA1Id,
        executionId: state.executionId,
        phoneNumberId: conversationPhoneId,
        telefonoCliente: conversationPhone,
        initialState: state,
      });
      assert.equal(second.created, false);
      if (!second.created) {
        assert.equal(second.reason, "active_execution_exists");
        assert.ok(second.existing.id);
      }
      const active = await getActiveExecutionByConversation(supabase(), {
        tenantId: tenantA,
        phoneNumberId: conversationPhoneId,
        telefonoCliente: conversationPhone,
      });
      assert.ok(active);
    });

    it("C1.2 — completed permite nueva ejecución activa", async () => {
      const row = await getExecutionById(supabase(), tenantA, executionRowId);
      assert.ok(row);
      const state = executionRowToEngineState(row!);
      state.status = "completed";
      await saveExecutionState(supabase(), tenantA, executionRowId, state, row!.state_version);

      const newState = createFlowEngineState(minimalFlowDefinition("new-run"), {
        executionId: `exec-${randomUUID()}`,
      });
      const created = await createExecution(supabase(), {
        tenantId: tenantA,
        flowId: flowAId,
        flowVersionId: versionA1Id,
        executionId: newState.executionId,
        phoneNumberId: conversationPhoneId,
        telefonoCliente: conversationPhone,
        initialState: newState,
      });
      assert.equal(created.created, true);
    });

    it("C2 — saveExecutionState concurrency conflict real", async () => {
      const convPhone = "573000000099";
      const state = createFlowEngineState(minimalFlowDefinition("conc"), {
        executionId: `exec-${randomUUID()}`,
      });
      const created = await createExecution(supabase(), {
        tenantId: tenantA,
        flowId: flowAId,
        flowVersionId: versionA1Id,
        executionId: state.executionId,
        phoneNumberId: "111222333",
        telefonoCliente: convPhone,
        initialState: state,
      });
      assert.equal(created.created, true);
      const rowId = created.row.id;
      const row = await getExecutionById(supabase(), tenantA, rowId);
      assert.ok(row);

      const s1 = executionRowToEngineState(row!);
      s1.variables.worker = "A";
      await saveExecutionState(supabase(), tenantA, rowId, s1, row!.state_version);

      const s2 = executionRowToEngineState(row!);
      s2.variables.worker = "B";
      await assert.rejects(
        () => saveExecutionState(supabase(), tenantA, rowId, s2, row!.state_version),
        (err: FlowExecutionConcurrencyConflictError) =>
          err.code === FLOW_STORE_ERROR_CODES.EXECUTION_CONCURRENCY_CONFLICT,
      );

      const final = await getExecutionById(supabase(), tenantA, rowId);
      assert.equal(final!.variables.worker, "A");
      assert.equal(final!.state_version, row!.state_version + 1);
    });

    it("C4.9 — publishFlowVersion atómico exitoso", async () => {
      await publishFlowVersion(supabase(), tenantA, flowAId, versionA3Id);
      const v3 = await getFlowVersion(supabase(), tenantA, versionA3Id);
      assert.ok(v3!.published_at);
      const { data: flow } = await supabase()
        .from("dulabs_flows")
        .select("published_version_id, status")
        .eq("tenant_id", tenantA)
        .eq("id", flowAId)
        .single();
      assert.equal(flow!.published_version_id, versionA3Id);
      assert.equal(flow!.status, "published");
    });

    it("C4.12 — publicar versión de otro tenant rechazado", async () => {
      await assert.rejects(
        () => publishFlowVersion(supabase(), tenantB, flowAId, versionA3Id),
        (err: FlowStoreError) =>
          err.code === FLOW_STORE_ERROR_CODES.PUBLISH_VERSION_NOT_FOUND,
      );
    });

    it("C4.11 — dos publicaciones simultáneas del mismo flow", async () => {
      const flow = await createFlow(supabase(), {
        tenantId: tenantA,
        slug: `concurrent-${Date.now()}`,
        name: "Concurrent Publish",
      });
      const v4 = await createFlowVersion(supabase(), {
        tenantId: tenantA,
        flowId: flow.id,
        versionNumber: 4,
        definition: minimalFlowDefinition("v4"),
      });
      const v5 = await createFlowVersion(supabase(), {
        tenantId: tenantA,
        flowId: flow.id,
        versionNumber: 5,
        definition: minimalFlowDefinition("v5"),
      });
      await Promise.all([
        publishFlowVersion(supabase(), tenantA, flow.id, v4.id),
        publishFlowVersion(supabase(), tenantA, flow.id, v5.id),
      ]);
      const { data: flowRow } = await supabase()
        .from("dulabs_flows")
        .select("published_version_id")
        .eq("tenant_id", tenantA)
        .eq("id", flow.id)
        .single();
      assert.ok(flowRow!.published_version_id === v4.id || flowRow!.published_version_id === v5.id);
      const v4Row = await getFlowVersion(supabase(), tenantA, v4.id);
      const v5Row = await getFlowVersion(supabase(), tenantA, v5.id);
      assert.ok(v4Row!.published_at);
      assert.ok(v5Row!.published_at);
    });

    it("C4.10 — publish fallido no deja estado inconsistente", async () => {
      const draft = await createFlowVersion(supabase(), {
        tenantId: tenantA,
        flowId: flowAId,
        versionNumber: 99,
        definition: minimalFlowDefinition("draft-99"),
      });
      const fakeVersionId = randomUUID();
      await assert.rejects(() =>
        publishFlowVersion(supabase(), tenantA, flowAId, fakeVersionId),
      );
      const stillDraft = await getFlowVersion(supabase(), tenantA, draft.id);
      assert.equal(stillDraft!.published_at, null);
      const { data: flow } = await supabase()
        .from("dulabs_flows")
        .select("published_version_id")
        .eq("tenant_id", tenantA)
        .eq("id", flowAId)
        .single();
      assert.equal(flow!.published_version_id, versionA3Id);
    });

    it("inmutabilidad — published_at no reversible", async () => {
      const { error } = await supabase()
        .from("dulabs_flow_versions")
        .update({ published_at: null })
        .eq("tenant_id", tenantA)
        .eq("id", versionA1Id);
      assert.ok(error);
      assert.match(String(error.message), /published_at|inmutable/i);
    });

    it("Tenant B no puede leer ejecución de Tenant A", async () => {
      const row = await getExecutionById(supabase(), tenantB, executionRowId);
      assert.equal(row, null);
    });

    it("evento duplicado no crea segunda fila", async () => {
      const eventId = `wamid.${randomUUID()}`;
      const first = await insertEventIdempotent(supabase(), {
        tenantId: tenantA,
        flowExecutionId: executionRowId,
        eventId,
        eventType: "text",
      });
      assert.equal(first.inserted, true);
      const second = await insertEventIdempotent(supabase(), {
        tenantId: tenantA,
        flowExecutionId: executionRowId,
        eventId,
        eventType: "text",
      });
      assert.equal(second.inserted, false);
    });

    it("save/load execution preserva FlowEngineState con state_version", async () => {
      const loaded = await getExecutionEngineState(supabase(), tenantA, executionRowId);
      assert.ok(loaded);
      const row = await getExecutionById(supabase(), tenantA, executionRowId);
      loaded!.variables.testKey = "persisted";
      const saved = await saveExecutionState(
        supabase(),
        tenantA,
        executionRowId,
        loaded!,
        row!.state_version,
      );
      assert.ok(saved.stateVersion > row!.state_version);
    });

    describe("ensureInitialFlowVersion — idempotencia de la primera versión", () => {
      it("Flow recién creado (0 versiones) -> crea v1 con un nodo Start", async () => {
        const flow = await createFlow(supabase(), {
          tenantId: tenantA,
          slug: `ensure-v1-${Date.now()}`,
          name: "Ensure V1",
        });
        const result = await ensureInitialFlowVersion(supabase(), {
          tenantId: tenantA,
          flowId: flow.id,
          flowName: flow.name,
        });
        assert.equal(result.created, true);
        assert.equal(result.version.version_number, 1);
        assert.equal(result.version.published_at, null, "no debe publicarse automáticamente");
        const nodes = (result.version.definition_json as { nodes: { type: string }[] }).nodes;
        assert.equal(nodes.length, 1);
        assert.equal(nodes[0].type, "start");
      });

      it("llamado dos veces seguidas -> la segunda NO crea v2, devuelve la misma v1", async () => {
        const flow = await createFlow(supabase(), {
          tenantId: tenantA,
          slug: `ensure-idem-${Date.now()}`,
          name: "Ensure Idempotente",
        });
        const primera = await ensureInitialFlowVersion(supabase(), {
          tenantId: tenantA,
          flowId: flow.id,
          flowName: flow.name,
        });
        const segunda = await ensureInitialFlowVersion(supabase(), {
          tenantId: tenantA,
          flowId: flow.id,
          flowName: flow.name,
        });
        assert.equal(primera.created, true);
        assert.equal(segunda.created, false);
        assert.equal(segunda.version.id, primera.version.id);

        const todas = await listFlowVersions(supabase(), { tenantId: tenantA, flowId: flow.id });
        assert.equal(todas.length, 1, "solo debe existir v1, nunca una v2 por el segundo llamado");
      });

      it("carrera -- 5 llamadas concurrentes sobre el mismo Flow -> solo 1 versión creada", async () => {
        const flow = await createFlow(supabase(), {
          tenantId: tenantA,
          slug: `ensure-race-${Date.now()}`,
          name: "Ensure Carrera",
        });
        const resultados = await Promise.all(
          Array.from({ length: 5 }, () =>
            ensureInitialFlowVersion(supabase(), { tenantId: tenantA, flowId: flow.id, flowName: flow.name }),
          ),
        );
        const creadas = resultados.filter((r) => r.created);
        assert.equal(creadas.length, 1, "de 5 llamadas concurrentes, exactamente una debe haber creado la v1");
        const idsDevueltos = new Set(resultados.map((r) => r.version.id));
        assert.equal(idsDevueltos.size, 1, "las 5 llamadas deben devolver la MISMA versión");

        const todas = await listFlowVersions(supabase(), { tenantId: tenantA, flowId: flow.id });
        assert.equal(todas.length, 1);
      });

      it("Flow que YA tenía versiones (flowAId, creado en before()) -> no crea nada, devuelve la más reciente", async () => {
        const antes = await listFlowVersions(supabase(), { tenantId: tenantA, flowId: flowAId });
        const result = await ensureInitialFlowVersion(supabase(), {
          tenantId: tenantA,
          flowId: flowAId,
          flowName: "Test Flow A",
        });
        assert.equal(result.created, false);
        assert.equal(result.version.version_number, antes[0].version_number);
        const despues = await listFlowVersions(supabase(), { tenantId: tenantA, flowId: flowAId });
        assert.equal(despues.length, antes.length, "no debe agregar ninguna versión nueva");
      });
    });
  },
);
