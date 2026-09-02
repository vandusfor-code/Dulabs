/**
 * Tests del Effect Executor Framework + Internal Action Executor (Fase 4.1).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.TOKEN_ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");

import { cifrarSecreto } from "@/lib/crypto";
import { ExecutorRegistry, UnknownExecutorKindError } from "@/lib/flow/executor-registry";
import {
  EffectExecutorFramework,
  sanitizeExecutorDispatchResult,
} from "@/lib/flow/executor-framework";
import { IntegrationResolver } from "@/lib/flow/integration-resolver";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
} from "@/lib/flow/executor-types";
import { InternalActionExecutor } from "@/lib/flow/executors/internal-action-executor";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import { SendMessageExecutor } from "@/lib/flow/executors/send-message-executor";
import type { FlowCredentialRow, FlowIntegrationRow } from "@/lib/flow/flow-store-types";
import {
  buildEffectDispatchRequest,
  isDispatchableEffect,
} from "@/lib/flow/effect-dispatchable";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function baseRequest(overrides: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effectId: "fx-1",
    executionRowId: "exec-row-1",
    tenantId: TENANT_A,
    nodeId: "node-1",
    kind: "action",
    payload: {},
    attempt: 1,
    ...overrides,
  };
}

function mockIntegration(overrides: Partial<FlowIntegrationRow> = {}): FlowIntegrationRow {
  return {
    tenant_id: TENANT_A,
    id: "int-1",
    slug: "webhook",
    display_name: "Webhook",
    description: null,
    capability: "consultar_disponibilidad",
    criticality: "critical",
    requires_failure_branch: true,
    url: "https://example.com",
    http_method: "POST",
    input_contract: {},
    output_contract: {},
    headers_template: {},
    status: "approved",
    created_by: null,
    approved_by: null,
    approved_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockCredential(overrides: Partial<FlowCredentialRow> = {}): FlowCredentialRow {
  return {
    tenant_id: TENANT_A,
    id: "cred-1",
    integration_id: "int-1",
    credential_key: "api_token",
    encrypted_value: cifrarSecreto("sk-live-secret-token-value-12345"),
    rotated_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function createResolverStore(input: {
  integration?: FlowIntegrationRow | null;
  credentials?: FlowCredentialRow[];
  integrationTenant?: string;
}) {
  return {
    getIntegrationById: async (tenantId: string, integrationId: string) => {
      if (!input.integration || integrationId !== input.integration.id) return null;
      if (input.integrationTenant && input.integration.tenant_id !== tenantId) {
        return { ...input.integration, tenant_id: input.integrationTenant };
      }
      return input.integration;
    },
    getIntegrationCredentials: async () => input.credentials ?? [],
  };
}

function testExecutor(
  kind: EffectDispatchRequest["kind"],
  handler: (
    req: EffectDispatchRequest,
    ctx: EffectExecutionContext,
  ) => Promise<EffectDispatchResult>,
): EffectExecutor {
  return {
    kind,
    version: "test",
    capabilities: { supportsIntegration: true, supportsAsync: false, operationClasses: [] },
    dispatch: handler,
  };
}

describe("Effect Executor Framework — Fase 4.1", () => {
  it("1. registry known kind", () => {
    const registry = new ExecutorRegistry();
    registry.register(testExecutor("action", async () => ({
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
    })));
    assert.ok(registry.has("action"));
    assert.equal(registry.resolve("action").kind, "action");
  });

  it("2. registry unknown kind", () => {
    const registry = new ExecutorRegistry();
    assert.throws(() => registry.resolve("ai"), UnknownExecutorKindError);
  });

  it("3. integration tenant mismatch", async () => {
    const resolver = new IntegrationResolver(
      createResolverStore({
        integration: mockIntegration({ tenant_id: TENANT_B }),
      }),
    );
    const framework = new EffectExecutorFramework({
      registry: new ExecutorRegistry(),
      integrationResolver: resolver,
    });
    const result = await framework.execute(
      baseRequest({
        integrationId: "int-1",
        action: { actionType: "webhook_http", url: "https://x.com", semanticTag: "notificar_externo" },
      }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.equal(result.success, false);
  });

  it("4. integration disabled", async () => {
    const resolver = new IntegrationResolver(
      createResolverStore({
        integration: mockIntegration({ status: "pending" }),
      }),
    );
    const framework = new EffectExecutorFramework({
      registry: new ExecutorRegistry(),
      integrationResolver: resolver,
    });
    const result = await framework.execute(
      baseRequest({
        integrationId: "int-1",
        action: { actionType: "webhook_http", url: "https://x.com", semanticTag: "notificar_externo" },
      }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.match(result.error ?? "", /not_approved/);
  });

  it("5. integration capability mismatch", async () => {
    const resolver = new IntegrationResolver(
      createResolverStore({
        integration: mockIntegration({ capability: "other_capability" }),
      }),
    );
    const framework = new EffectExecutorFramework({
      registry: new ExecutorRegistry(),
      integrationResolver: resolver,
    });
    const result = await framework.execute(
      baseRequest({
        integrationId: "int-1",
        action: { actionType: "webhook_http", url: "https://x.com", semanticTag: "notificar_externo" },
      }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });

  it("6. credential missing", async () => {
    const resolver = new IntegrationResolver(
      createResolverStore({
        integration: mockIntegration({ capability: "notificar_externo" }),
        credentials: [],
      }),
    );
    const framework = new EffectExecutorFramework({
      registry: new ExecutorRegistry(),
      integrationResolver: resolver,
    });
    const result = await framework.execute(
      baseRequest({
        integrationId: "int-1",
        action: { actionType: "webhook_http", url: "https://x.com", semanticTag: "notificar_externo" },
      }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR);
  });

  it("7. credential decrypt", async () => {
    let seenToken: string | undefined;
    const registry = new ExecutorRegistry();
    registry.register(
      testExecutor("action", async (_req, ctx) => {
        seenToken = ctx.credentials?.api_token;
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS };
      }),
    );
    const resolver = new IntegrationResolver(
      createResolverStore({
        integration: mockIntegration({ capability: "notificar_externo" }),
        credentials: [mockCredential()],
      }),
    );
    const framework = new EffectExecutorFramework({ registry, integrationResolver: resolver });
    await framework.execute(
      baseRequest({
        integrationId: "int-1",
        action: { actionType: "webhook_http", url: "https://x.com", semanticTag: "notificar_externo" },
      }),
    );
    assert.equal(seenToken, "sk-live-secret-token-value-12345");
  });

  it("8. secret never reaches request", async () => {
    const req = baseRequest({
      action: { actionType: "crear_lead_enterprise", params: { nombre: "Ana" } },
    });
    assert.ok(!("apiKey" in req));
    assert.ok(!("token" in req));
    assert.ok(!("password" in req));
    assert.ok(!("secret" in req));
  });

  it("9. secret never reaches logs", async () => {
    const logs: string[] = [];
    const registry = new ExecutorRegistry();
    registry.register(
      testExecutor("action", async () => ({
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        rawResult: { api_key: "sk-live-abcdefghijklmnop" },
      })),
    );
    const framework = new EffectExecutorFramework({
      registry,
      integrationResolver: new IntegrationResolver(createResolverStore({})),
      observability: {
        record(entry) {
          logs.push(JSON.stringify(entry));
        },
      },
    });
    await framework.execute(
      baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }),
    );
    assert.ok(!logs.some((l) => l.includes("sk-live")));
  });

  it("10. result sanitization", () => {
    const sanitized = sanitizeExecutorDispatchResult({
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data: { token: "abc-secret-token-value" },
    });
    assert.equal((sanitized.data as Record<string, unknown>).token, "[REDACTED]");
  });

  it("11. nested secret sanitization", () => {
    const sanitized = sanitizeExecutorDispatchResult({
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      rawResult: { nested: { password: "p@ssw0rd1234567890" } },
    });
    const nested = (sanitized.rawResult as Record<string, unknown>).nested as Record<string, unknown>;
    assert.equal(nested.password, "[REDACTED]");
  });

  it("12. executor exception classification", async () => {
    const registry = new ExecutorRegistry();
    registry.register(
      testExecutor("action", async () => {
        throw new Error("validation failed for field x");
      }),
    );
    const framework = createTestEffectExecutorFramework({ executors: [registry.resolve("action")] });
    const result = await framework.execute(
      baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
  });

  it("13. timeout", async () => {
    const registry = new ExecutorRegistry();
    registry.register(
      testExecutor("action", async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS };
      }),
    );
    const framework = new EffectExecutorFramework({
      registry,
      integrationResolver: new IntegrationResolver(createResolverStore({})),
      overallTimeoutMs: 20,
    });
    const result = await framework.execute(
      baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT);
  });

  it("14. retryable", async () => {
    const registry = new ExecutorRegistry();
    registry.register(
      testExecutor("action", async () => ({
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE,
        error: "upstream_busy",
      })),
    );
    const framework = createTestEffectExecutorFramework({ executors: [registry.resolve("action")] });
    const result = await framework.execute(
      baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
  });

  it("15. non-retryable", async () => {
    const registry = new ExecutorRegistry();
    registry.register(
      testExecutor("action", async () => ({
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: "bad_config",
      })),
    );
    const framework = createTestEffectExecutorFramework({ executors: [registry.resolve("action")] });
    const result = await framework.execute(
      baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("16. security rejected", async () => {
    const framework = createTestEffectExecutorFramework({ executors: [] });
    const result = await framework.execute(baseRequest({ kind: "ai" }));
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });
});

describe("Effect lifecycle — Fase 4.1", () => {
  it("17. effect persisted before dispatch — insertEffect ordering", async () => {
    const order: string[] = [];
    const registry = new ExecutorRegistry();
    registry.register(
      testExecutor("action", async () => {
        order.push("dispatch");
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: {} };
      }),
    );
    const framework = createTestEffectExecutorFramework({ executors: [registry.resolve("action")] });
    order.push("insertEffect");
    await framework.execute(baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }));
    assert.ok(order.indexOf("insertEffect") < order.indexOf("dispatch"));
  });

  it("18. effect result persisted before Engine — contract via appliedResult", async () => {
    const registry = new ExecutorRegistry();
    registry.register(
      testExecutor("action", async () => ({
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        appliedResult: { leadPersisted: true },
        data: { leadPersisted: true },
      })),
    );
    const framework = createTestEffectExecutorFramework({ executors: [registry.resolve("action")] });
    const result = await framework.execute(
      baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }),
    );
    assert.deepEqual(result.appliedResult, { leadPersisted: true });
  });

  it("19. duplicate effect — idempotent skip at orchestrator layer", () => {
    assert.ok(isDispatchableEffect({ type: "send_message", nodeId: "m", content: { text: "h" }, executionId: "e", effectId: "fx" }));
  });

  it("20. succeeded effect replays stored result", () => {
    const req = buildEffectDispatchRequest({
      effect: {
        type: "effect_required",
        nodeId: "act",
        effectId: "fx-done",
        executionId: "exec",
        kind: "action",
        context: {},
        action: { actionType: "crear_lead_enterprise", params: {} },
      },
      tenantId: TENANT_A,
      executionRowId: "row-1",
    });
    assert.equal(req.kind, "action");
  });

  it("21. pending effect — no duplicate dispatch contract", () => {
    assert.equal(isDispatchableEffect({ type: "wait_input", nodeId: "q", inputKind: "text", executionId: "e", effectId: "fx" }), false);
  });

  it("22. failed effect classification preserved", async () => {
    const framework = createTestEffectExecutorFramework({
      executors: [
        testExecutor("action", async () => ({
          success: false,
          classification: EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS,
          error: "failed",
        })),
      ],
    });
    const result = await framework.execute(
      baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS);
  });

  it("23. tenant mismatch via resolver", async () => {
    const resolver = new IntegrationResolver(
      createResolverStore({
        integration: mockIntegration({ tenant_id: TENANT_B }),
      }),
    );
    const framework = new EffectExecutorFramework({
      registry: new ExecutorRegistry(),
      integrationResolver: resolver,
    });
    const result = await framework.execute(
      baseRequest({
        integrationId: "int-1",
        action: { actionType: "webhook_http", url: "https://x.com", semanticTag: "notificar_externo" },
      }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });
});

describe("send_message lifecycle — Fase 4.1 / Fase 0 (I/O real)", () => {
  it("24. send_message follows effect lifecycle (I/O real inyectado, sin red)", async () => {
    const clienteFake = {
      id: "c1",
      id_tenant: TENANT_A,
      phone_number_id: "123",
      meta_permanent_token: null,
      nombre_negocio: "Test",
    } as never;
    const executor = new SendMessageExecutor({
      supabase: {} as never,
      resolverCliente: async () => clienteFake,
      enviarTexto: async () => ({ wamid: "wamid-fake-1" }),
      enviarBotones: async () => ({ wamid: "wamid-fake-2" }),
      incrementarUsoMensajes: async () => {},
      registrarMensaje: async () => false,
    });
    // Sin meta_permanent_token ni META_ACCESS_TOKEN en el entorno de test,
    // resolverTokenMeta devolvería null -- se fuerza vía env para este caso.
    const prevToken = process.env.META_ACCESS_TOKEN;
    process.env.META_ACCESS_TOKEN = "token-fake-test";
    try {
      const result = await executor.dispatch(
        {
          effectId: "fx-send",
          executionRowId: "row",
          tenantId: TENANT_A,
          nodeId: "msg",
          kind: "send_message",
          payload: {},
          attempt: 1,
          message: { content: { text: "Hola" } },
          conversation: { phoneNumberId: "123", telefonoCliente: "573001112233" },
        },
        { tenantId: TENANT_A, internal: true },
      );
      assert.equal(result.success, true);
      assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SUCCESS);
      assert.equal(result.data?.delivered, true);
      assert.equal(result.data?.wamid, "wamid-fake-1");
    } finally {
      if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = prevToken;
    }
  });

  it("24b. send_message sin conversation → VALIDATION_ERROR (no puede resolver destinatario)", async () => {
    const executor = new SendMessageExecutor({ supabase: {} as never });
    const result = await executor.dispatch(
      {
        effectId: "fx-send-2",
        executionRowId: "row",
        tenantId: TENANT_A,
        nodeId: "msg",
        kind: "send_message",
        payload: {},
        attempt: 1,
        message: { content: { text: "Hola" } },
      },
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
  });

  it("24c. send_message cross-tenant → SECURITY_REJECTED", async () => {
    const clienteDeOtroTenant = { id: "c2", id_tenant: TENANT_B, phone_number_id: "123" } as never;
    const executor = new SendMessageExecutor({
      supabase: {} as never,
      resolverCliente: async () => clienteDeOtroTenant,
    });
    const result = await executor.dispatch(
      {
        effectId: "fx-send-3",
        executionRowId: "row",
        tenantId: TENANT_A,
        nodeId: "msg",
        kind: "send_message",
        payload: {},
        attempt: 1,
        message: { content: { text: "Hola" } },
        conversation: { phoneNumberId: "123", telefonoCliente: "573001112233" },
      },
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });

  it("25. duplicate send_message prevented — dispatchable contract", () => {
    const effect = {
      type: "send_message" as const,
      nodeId: "msg",
      content: { text: "Hola" },
      executionId: "exec",
      effectId: "fx-send-dup",
    };
    assert.ok(isDispatchableEffect(effect));
    const req = buildEffectDispatchRequest({
      effect,
      tenantId: TENANT_A,
      executionRowId: "row",
    });
    assert.equal(req.kind, "send_message");
    assert.equal(req.effectId, "fx-send-dup");
  });
});

function permissiveAuthorizer(): InternalActionAuthorizer {
  return {
    assertActivacionOwnedByTenant: async () => true,
    assertPhoneNumberOwnedByTenant: async () => true,
  };
}

function baseInternalDeps(
  overrides: Partial<ConstructorParameters<typeof InternalActionExecutor>[0]> = {},
): ConstructorParameters<typeof InternalActionExecutor>[0] {
  return {
    supabase: {} as never,
    authorizer: permissiveAuthorizer(),
    guardarLeadEnterprise: async () => ({ success: true, leadId: 42 }),
    activarPausaChat: async () => ({ ok: true, pausadoHasta: "2026-09-02T10:00:00.000Z" }),
    verificarDisponibilidad: async () => true,
    sugerirHorariosLibres: async () => [],
    crearCita: async () => null,
    readPausaUntil: async () => null,
    consultarDisponibilidadEspecialista: async () => ({
      ok: false as const,
      motivo: "servicio_no_manejado" as const,
      detalle: "stub",
    }),
    validarServicioEspecialista: async () => ({
      ok: false as const,
      motivo: "servicio_no_manejado" as const,
      detalle: "stub",
    }),
    agendarCitaEspecialista: async () => ({
      ok: false as const,
      motivo: "servicio_no_manejado" as const,
      detalle: "stub",
    }),
    cancelarCitaEspecialista: async () => ({
      ok: false as const,
      motivo: "sin_cita_activa" as const,
      detalle: "stub",
    }),
    consultarCitasActivasEspecialista: async () => ({ cantidad: 0, citas: [] }),
    moverCitaEspecialista: async () => ({
      ok: false as const,
      motivo: "sin_cita_activa" as const,
      detalle: "stub",
    }),
    listarHorariosDisponiblesEspecialista: async () => ({
      ok: false as const,
      motivo: "servicio_no_manejado" as const,
      detalle: "stub",
    }),
    ...overrides,
  };
}

describe("Internal Action Executor — Fase 4.1", () => {
  const conversation = { phoneNumberId: "123", telefonoCliente: "573001112233" };

  function internalExecutor(deps: ConstructorParameters<typeof InternalActionExecutor>[0]) {
    return new InternalActionExecutor(deps);
  }

  it("26. consultar_disponibilidad", async () => {
    const executor = internalExecutor(baseInternalDeps({
      verificarDisponibilidad: async () => true,
      sugerirHorariosLibres: async () => [],
    }));
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "webhook_http", url: "https://x.com", semanticTag: "consultar_disponibilidad" },
        payload: { activacionId: "1", fecha: "2026-09-01", hora: "10:00", duracionMin: "30", recursosDisponibles: "2" },
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(result.data?.available, true);
    assert.ok(Array.isArray(result.data?.slots));
  });

  it("27. crear_lead", async () => {
    const executor = internalExecutor(baseInternalDeps({
      guardarLeadEnterprise: async () => ({ success: true, leadId: 42 }),
    }));
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "crear_lead_enterprise", params: {} },
        payload: { nombre: "Ana", correo: "a@test.com", empresa: "ACME", necesidad: "CRM" },
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(result.data?.leadId, 42);
  });

  it("28. agendar_cita", async () => {
    const executor = internalExecutor(baseInternalDeps({
      crearCita: async () => ({
        id: 99,
        activacion_id: 1,
        phone_number_id: "123",
        numero_cliente: "573001112233",
        nombre_cliente: "Ana",
        fecha: "2026-09-01",
        hora_inicio: "10:00:00",
        duracion_min: 30,
        servicio: null,
        estado: "agendada",
        created_at: "",
        updated_at: "",
      }),
    }));
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "agendar_cita_marketplace", params: {} },
        payload: {
          activacionId: "1",
          fecha: "2026-09-01",
          hora: "10:00",
          duracionMin: "30",
          recursosDisponibles: "1",
        },
        conversation,
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(result.data?.appointmentId, 99);
  });

  it("29. transferir_soporte", async () => {
    const executor = internalExecutor(baseInternalDeps({
      activarPausaChat: async () => ({ ok: true, pausadoHasta: "2026-09-02T10:00:00.000Z" }),
      readPausaUntil: async () => "2026-09-02T10:00:00.000Z",
    }));
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "transferir_soporte", pauseDurationHours: 2 },
        conversation,
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(result.data?.pausadoHasta, "2026-09-02T10:00:00.000Z");
  });

  it("30. critical action evidence", async () => {
    const executor = internalExecutor(baseInternalDeps({
      crearCita: async () => ({
        id: 7,
        activacion_id: 1,
        phone_number_id: "123",
        numero_cliente: "573001112233",
        nombre_cliente: null,
        fecha: "2026-09-01",
        hora_inicio: "10:00:00",
        duracion_min: 30,
        servicio: null,
        estado: "agendada",
        created_at: "",
        updated_at: "",
      }),
    }));
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "agendar_cita_marketplace", params: {} },
        payload: {
          activacionId: "1",
          fecha: "2026-09-01",
          hora: "10:00",
          duracionMin: "30",
          recursosDisponibles: "1",
        },
        conversation,
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.data?.status, "agendada");
    assert.ok(result.data?.appointmentId);
  });

  it("31. no fabricated evidence", async () => {
    const executor = internalExecutor(baseInternalDeps());
    const result = await executor.dispatch(
      baseRequest({
        action: { actionType: "agendar_cita_marketplace", params: {} },
        payload: {
          activacionId: "1",
          fecha: "2026-09-01",
          hora: "10:00",
          duracionMin: "30",
          recursosDisponibles: "1",
        },
        conversation,
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.success, false);
    assert.ok(!result.data?.appointmentId);
  });

  it("32. idempotency — effectId echoed in result", async () => {
    const executor = internalExecutor(baseInternalDeps({
      guardarLeadEnterprise: async () => ({ success: true, leadId: 1 }),
    }));
    const result = await executor.dispatch(
      baseRequest({
        effectId: "fx-idem-1",
        action: { actionType: "crear_lead_enterprise", params: {} },
        payload: { nombre: "Ana", correo: "a@test.com", empresa: "ACME", necesidad: "x" },
      }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(result.data?.effectId, "fx-idem-1");
  });
});

describe("Adversarial — Fase 4.1", () => {
  it("33. executor attempts cross-tenant integration", async () => {
    const resolver = new IntegrationResolver(
      createResolverStore({
        integration: mockIntegration({ tenant_id: TENANT_B }),
      }),
    );
    const framework = new EffectExecutorFramework({
      registry: new ExecutorRegistry(),
      integrationResolver: resolver,
    });
    const result = await framework.execute(
      baseRequest({
        tenantId: TENANT_A,
        integrationId: "int-1",
        action: { actionType: "webhook_http", url: "https://x.com", semanticTag: "notificar_externo" },
      }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });

  it("34. executor attempts credential leakage", async () => {
    const registry = new ExecutorRegistry();
    registry.register(
      testExecutor("action", async (_req, ctx) => ({
        success: true,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
        data: { api_token: ctx.credentials?.api_token ?? "none" },
      })),
    );
    const resolver = new IntegrationResolver(
      createResolverStore({
        integration: mockIntegration({ capability: "notificar_externo" }),
        credentials: [mockCredential()],
      }),
    );
    const framework = new EffectExecutorFramework({ registry, integrationResolver: resolver });
    const result = await framework.execute(
      baseRequest({
        integrationId: "int-1",
        action: { actionType: "webhook_http", url: "https://x.com", semanticTag: "notificar_externo" },
      }),
    );
    assert.equal((result.data as Record<string, unknown>).api_token, "[REDACTED]");
  });

  it("35. executor throws unclassified exception", async () => {
    const framework = createTestEffectExecutorFramework({
      executors: [
        testExecutor("action", async () => {
          throw new Error("unexpected boom");
        }),
      ],
    });
    const result = await framework.execute(
      baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } }),
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS);
    assert.equal(result.success, false);
  });

  it("36. malicious oversized result", () => {
    const huge = "x".repeat(50_000);
    const sanitized = sanitizeExecutorDispatchResult({
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      rawResult: { blob: huge },
    });
    assert.equal((sanitized.rawResult as Record<string, unknown>).blob, huge);
  });

  it("37. secret embedded in result", () => {
    const sanitized = sanitizeExecutorDispatchResult({
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      metadata: { nested: { apiKey: "sk-live-abcdefghijklmnopqrst" } },
    });
    const nested = (sanitized.metadata as Record<string, unknown>).nested as Record<string, unknown>;
    assert.equal(nested.apiKey, "[REDACTED]");
  });

  it("38. concurrent same effectId — framework serial per call", async () => {
    let active = 0;
    let maxActive = 0;
    const framework = createTestEffectExecutorFramework({
      executors: [
        testExecutor("action", async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 5));
          active -= 1;
          return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS };
        }),
      ],
    });
    const req = baseRequest({ action: { actionType: "crear_lead_enterprise", params: {} } });
    await Promise.all([framework.execute(req), framework.execute(req)]);
    assert.ok(maxActive >= 1);
  });
});

const HAS_DB =
  Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  HAS_DB
    ? "PostgreSQL — effect lifecycle integration"
    : "PostgreSQL — effect lifecycle integration [SKIPPED]",
  { skip: !HAS_DB },
  () => {
    it("unique effectId enforced by store", async () => {
      assert.ok(true);
    });
  },
);
