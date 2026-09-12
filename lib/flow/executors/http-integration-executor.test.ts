/**
 * HTTP Integration Executor — Fase 5 (Actions + Integrations, autorizado).
 * Tests puramente unitarios/comportamentales, sin red real (fetch inyectado).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// `??` (usado en flow-executor-framework.test.ts) NO sustituye un string
// vacío -- si .env.local trae TOKEN_ENCRYPTION_KEY="" (hueco preexistente
// del entorno local, no de este código), `||` sí lo cubre.
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");

import { cifrarSecreto } from "@/lib/crypto";
import { ExecutorRegistry } from "@/lib/flow/executor-registry";
import { EffectExecutorFramework } from "@/lib/flow/executor-framework";
import { IntegrationResolver } from "@/lib/flow/integration-resolver";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectExecutionContext,
  type EffectExecutor,
} from "@/lib/flow/executor-types";
import { HttpIntegrationExecutor, createActionExecutorWithHttpIntegration } from "@/lib/flow/executors/http-integration-executor";
import type { FlowCredentialRow, FlowIntegrationRow } from "@/lib/flow/flow-store-types";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function mockIntegration(overrides: Partial<FlowIntegrationRow> = {}): FlowIntegrationRow {
  return {
    tenant_id: TENANT_A,
    id: "int-1",
    slug: "webhook",
    display_name: "Webhook de prueba",
    description: null,
    capability: "notificar_externo",
    criticality: "critical",
    requires_failure_branch: true,
    url: "https://api.ejemplo.com/webhook",
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
    credential_key: "Authorization",
    encrypted_value: cifrarSecreto("Bearer sk-live-secret-12345"),
    rotated_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function createResolverStore(input: { integration?: FlowIntegrationRow | null; credentials?: FlowCredentialRow[] }) {
  return {
    getIntegrationById: async (_tenantId: string, integrationId: string) => {
      if (!input.integration || integrationId !== input.integration.id) return null;
      return input.integration;
    },
    getIntegrationCredentials: async () => input.credentials ?? [],
  };
}

function webhookAction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    actionType: "webhook_http" as const,
    url: "https://api.ejemplo.com/webhook",
    semanticTag: "notificar_externo",
    integrationId: "int-1",
    bodyVariableKeys: ["nombre"],
    ...overrides,
  };
}

function baseRequest(overrides: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effectId: "fx-1",
    executionRowId: "exec-row-1",
    tenantId: TENANT_A,
    nodeId: "node-1",
    kind: "action",
    payload: { nombre: "Ana" },
    attempt: 1,
    action: webhookAction(),
    integrationId: "int-1",
    ...overrides,
  };
}

function externalContext(overrides: Partial<EffectExecutionContext> = {}): EffectExecutionContext {
  return {
    tenantId: TENANT_A,
    internal: false,
    integrationId: "int-1",
    capability: "notificar_externo",
    integrationUrl: "https://api.ejemplo.com/webhook",
    integrationHttpMethod: "POST",
    integrationHeadersTemplate: {},
    credentials: { Authorization: "Bearer sk-live-secret-12345" },
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Fase 5 — HttpIntegrationExecutor (dispatch directo, fetch inyectado)", () => {
  it("1. HTTP success -> success=true, SUCCESS, data disponible", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const executor = new HttpIntegrationExecutor({
      fetchImpl: (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return jsonResponse(200, { citaId: "abc-123", estado: "confirmado" });
      }) as typeof fetch,
    });

    const result = await executor.dispatch(baseRequest(), externalContext());

    assert.equal(result.success, true);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SUCCESS);
    assert.equal((result.data as Record<string, unknown>).citaId, "abc-123");
    assert.equal(capturedUrl, "https://api.ejemplo.com/webhook");
    assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer sk-live-secret-12345");
    assert.equal(JSON.parse(capturedInit?.body as string).nombre, "Ana");
  });

  it("2. Timeout -> AbortSignal ya cancelado antes del fetch, nunca llega a hacer la llamada", async () => {
    const controller = new AbortController();
    controller.abort();
    let fetchCalled = false;
    const executor = new HttpIntegrationExecutor({
      fetchImpl: (async () => {
        fetchCalled = true;
        return jsonResponse(200, {});
      }) as typeof fetch,
    });

    await assert.rejects(() => executor.dispatch(baseRequest(), externalContext(), controller.signal));
    assert.equal(fetchCalled, false, "no debe intentar la llamada si el signal ya está abortado");
  });

  it("3. Error externo (500) -> success=false, EXTERNAL_AMBIGUOUS, NO lanza excepción", async () => {
    const executor = new HttpIntegrationExecutor({
      fetchImpl: (async () => jsonResponse(500, { error: "server_error" })) as typeof fetch,
    });

    const result = await executor.dispatch(baseRequest(), externalContext());

    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.EXTERNAL_AMBIGUOUS);
    assert.equal(result.error, "http_status_500");
  });

  it("3b. 401 -> AUTH_ERROR; 429 -> RATE_LIMIT; 400 -> VALIDATION_ERROR", async () => {
    for (const [status, expected] of [
      [401, EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR],
      [429, EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT],
      [400, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR],
    ] as const) {
      const executor = new HttpIntegrationExecutor({
        fetchImpl: (async () => jsonResponse(status, {})) as typeof fetch,
      });
      const result = await executor.dispatch(baseRequest(), externalContext());
      assert.equal(result.classification, expected, `status ${status}`);
    }
  });

  it("6. SSRF -- URL no-HTTPS resuelta en la integración -> rechazada, nunca llama fetch", async () => {
    let fetchCalled = false;
    const executor = new HttpIntegrationExecutor({
      fetchImpl: (async () => {
        fetchCalled = true;
        return jsonResponse(200, {});
      }) as typeof fetch,
    });

    const result = await executor.dispatch(baseRequest(), externalContext({ integrationUrl: "http://api.ejemplo.com/webhook" }));

    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.match(result.error ?? "", /ssrf_rejected/);
    assert.equal(fetchCalled, false);
  });

  it("6b. SSRF -- localhost/IP privada resuelta en la integración -> rechazada", async () => {
    const executor = new HttpIntegrationExecutor({ fetchImpl: (async () => jsonResponse(200, {})) as typeof fetch });
    for (const url of ["https://localhost/x", "https://127.0.0.1/x", "https://192.168.1.5/x", "https://10.0.0.1/x"]) {
      const result = await executor.dispatch(baseRequest(), externalContext({ integrationUrl: url }));
      assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED, url);
    }
  });

  it("dispatch directo con context.internal=true -> rechazado (defensa en profundidad, nunca debería llegar así)", async () => {
    const executor = new HttpIntegrationExecutor();
    const result = await executor.dispatch(baseRequest(), { tenantId: TENANT_A, internal: true });
    assert.equal(result.success, false);
    assert.equal(result.error, "http_integration_requires_external_context");
  });
});

describe("Fase 5 — createActionExecutorWithHttpIntegration (router de composición)", () => {
  it("acción NO webhook_http -> delega EXACTO al executor interno inyectado (sin cambios)", async () => {
    let delegatedToInternal = false;
    const internalExecutor: EffectExecutor = {
      kind: "action",
      version: "internal-test",
      capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
      dispatch: async () => {
        delegatedToInternal = true;
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: { ok: true } };
      },
    };
    const router = createActionExecutorWithHttpIntegration(internalExecutor);
    const result = await router.dispatch(
      baseRequest({ action: { actionType: "crear_lead_enterprise" } }),
      { tenantId: TENANT_A, internal: true },
    );
    assert.equal(delegatedToInternal, true);
    assert.equal(result.success, true);
  });

  it("webhook_http con context.internal=true (allowlist interna) -> también delega al executor interno, no al HTTP nuevo", async () => {
    let delegatedToInternal = false;
    const internalExecutor: EffectExecutor = {
      kind: "action",
      version: "internal-test",
      capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
      dispatch: async () => {
        delegatedToInternal = true;
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS };
      },
    };
    const router = createActionExecutorWithHttpIntegration(internalExecutor);
    await router.dispatch(baseRequest(), { tenantId: TENANT_A, internal: true });
    assert.equal(delegatedToInternal, true);
  });

  it("webhook_http externo (context.internal=false) -> se enruta al HttpIntegrationExecutor real", async () => {
    const internalExecutor: EffectExecutor = {
      kind: "action",
      version: "internal-test",
      capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
      dispatch: async () => ({ success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED, error: "no debería llamarse" }),
    };
    const router = createActionExecutorWithHttpIntegration(internalExecutor, {
      fetchImpl: (async () => jsonResponse(200, { ok: true })) as typeof fetch,
    });
    const result = await router.dispatch(baseRequest(), externalContext());
    assert.equal(result.success, true);
    assert.equal((result.data as Record<string, unknown>).ok, true);
  });
});

describe("Fase 5 — integración completa vía EffectExecutorFramework (aislamiento y aprobación reales de IntegrationResolver)", () => {
  function frameworkWith(store: ReturnType<typeof createResolverStore>, fetchImpl?: typeof fetch) {
    const registry = new ExecutorRegistry();
    const internalStub: EffectExecutor = {
      kind: "action",
      version: "stub",
      capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
      dispatch: async () => ({ success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE, error: "internal_action_not_supported" }),
    };
    registry.register(createActionExecutorWithHttpIntegration(internalStub, { fetchImpl }));
    return new EffectExecutorFramework({ registry, integrationResolver: new IntegrationResolver(store) });
  }

  it("4. Integración no aprobada (status=pending) -> SECURITY_REJECTED, nunca llama fetch", async () => {
    let fetchCalled = false;
    const framework = frameworkWith(
      createResolverStore({ integration: mockIntegration({ status: "pending" }), credentials: [mockCredential()] }),
      (async () => {
        fetchCalled = true;
        return jsonResponse(200, {});
      }) as typeof fetch,
    );
    const result = await framework.execute(baseRequest());
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.match(result.error ?? "", /not_approved/);
    assert.equal(fetchCalled, false);
  });

  it("4b. Credenciales faltantes -> AUTH_ERROR, nunca llama fetch", async () => {
    let fetchCalled = false;
    const framework = frameworkWith(
      createResolverStore({ integration: mockIntegration(), credentials: [] }),
      (async () => {
        fetchCalled = true;
        return jsonResponse(200, {});
      }) as typeof fetch,
    );
    const result = await framework.execute(baseRequest());
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR);
    assert.match(result.error ?? "", /credential_missing/);
    assert.equal(fetchCalled, false);
  });

  it("7. Aislamiento cross-tenant -- integración pertenece a OTRO tenant -> SECURITY_REJECTED, nunca llama fetch", async () => {
    let fetchCalled = false;
    const framework = frameworkWith(
      createResolverStore({ integration: mockIntegration({ tenant_id: TENANT_B }), credentials: [mockCredential()] }),
      (async () => {
        fetchCalled = true;
        return jsonResponse(200, {});
      }) as typeof fetch,
    );
    const result = await framework.execute(baseRequest({ tenantId: TENANT_A }));
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.match(result.error ?? "", /tenant_mismatch/);
    assert.equal(fetchCalled, false);
  });

  it("capability_mismatch -- semanticTag del nodo no coincide con la capability de la integración -> SECURITY_REJECTED", async () => {
    const framework = frameworkWith(createResolverStore({ integration: mockIntegration({ capability: "otra_cosa" }), credentials: [mockCredential()] }));
    const result = await framework.execute(baseRequest());
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.match(result.error ?? "", /capability_mismatch/);
  });

  it("5. Timeout real -- el Framework aborta tras overallTimeoutMs y clasifica TIMEOUT, sin lanzar sin control", async () => {
    const registry = new ExecutorRegistry();
    const internalStub: EffectExecutor = {
      kind: "action",
      version: "stub",
      capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
      dispatch: async () => ({ success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE }),
    };
    registry.register(
      createActionExecutorWithHttpIntegration(internalStub, {
        fetchImpl: ((_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          })) as typeof fetch,
      }),
    );
    const framework = new EffectExecutorFramework({
      registry,
      integrationResolver: new IntegrationResolver(createResolverStore({ integration: mockIntegration(), credentials: [mockCredential()] })),
      overallTimeoutMs: 50,
    });
    const result = await framework.execute(baseRequest());
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT);
  });

  it("integración aprobada, con credenciales -> ejecuta el fetch real y devuelve SUCCESS", async () => {
    const framework = frameworkWith(
      createResolverStore({ integration: mockIntegration(), credentials: [mockCredential()] }),
      (async () => jsonResponse(200, { recibido: true })) as typeof fetch,
    );
    const result = await framework.execute(baseRequest());
    assert.equal(result.success, true);
    assert.equal((result.data as Record<string, unknown>).recibido, true);
  });
});
