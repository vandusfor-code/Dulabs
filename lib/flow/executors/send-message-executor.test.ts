/**
 * FASE F8.3 (Meta Send Reliability, autorizado) — tests unitarios de
 * SendMessageExecutor.dispatch(): un solo intento por llamada (el retry
 * vive en flow-orchestrator.ts, ver flow-orchestrator-send-message-retry.test.ts),
 * pero cada resultado debe traer los campos estructurados nuevos
 * (attempt/maxAttempts/httpStatus/metaErrorCode) y la clasificación real
 * por tipo de error. Todas las dependencias de I/O (enviarTexto/
 * enviarBotones/resolverCliente/registrarMensaje/incrementarUsoMensajes)
 * están inyectadas — cero red, cero Supabase real.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SendMessageExecutor, type SendMessageDeps } from "@/lib/flow/executors/send-message-executor";
import { MetaGraphApiError } from "@/lib/whatsapp";
import { EFFECT_RESULT_CLASSIFICATIONS, MAX_SEND_MESSAGE_ATTEMPTS, type EffectDispatchRequest } from "@/lib/flow/executor-types";
import type { ClienteConfig } from "@/lib/supabase";

const TENANT = "tenant-f83-unit";
const PHONE_NUMBER_ID = "1000000000001";
const CLIENTE = {
  id: 1,
  id_tenant: TENANT,
  phone_number_id: PHONE_NUMBER_ID,
  meta_permanent_token: null,
  mensajes_usados_mes: 0,
  mes_actual: "2026-01",
} as unknown as ClienteConfig;

function buildRequest(overrides: Partial<EffectDispatchRequest> = {}): EffectDispatchRequest {
  return {
    effectId: "eff-1",
    executionRowId: "exec-1",
    tenantId: TENANT,
    nodeId: "node-1",
    kind: "send_message",
    payload: {},
    attempt: 1,
    message: { content: { text: "hola" } },
    conversation: { phoneNumberId: PHONE_NUMBER_ID, telefonoCliente: "573000000000" },
    ...overrides,
  };
}

function buildExecutor(deps: Partial<SendMessageDeps> = {}) {
  return new SendMessageExecutor({
    supabase: {} as never,
    resolverCliente: async () => CLIENTE,
    incrementarUsoMensajes: async () => {},
    registrarMensaje: async () => false,
    ...deps,
  });
}

describe("SendMessageExecutor — clasificación y campos estructurados (F8.3)", () => {
  // resolverTokenMeta cae a process.env.META_ACCESS_TOKEN cuando el cliente
  // fake no trae meta_permanent_token (evita depender de descifrarSecreto
  // real) -- mismo patrón ya usado en lib/flow-runtime-bridge.test.ts.
  let prevToken: string | undefined;
  before(() => {
    prevToken = process.env.META_ACCESS_TOKEN;
    process.env.META_ACCESS_TOKEN = "token-fake-test";
  });
  after(() => {
    if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = prevToken;
  });

  it("1. éxito: preserva wamid, incluye attempt", async () => {
    const executor = buildExecutor({
      enviarTexto: async () => ({ wamid: "wamid-abc" }),
    });
    const result = await executor.dispatch(buildRequest({ attempt: 2 }), { tenantId: TENANT, internal: true });
    assert.equal(result.success, true);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SUCCESS);
    assert.equal((result.data as Record<string, unknown>).wamid, "wamid-abc");
    assert.equal((result.data as Record<string, unknown>).attempt, 2);
    assert.equal(result.externalReference, "wamid:wamid-abc");
  });

  it("2. HTTP 503 -> classification RETRYABLE, httpStatus/attempt/maxAttempts en rawResult", async () => {
    const executor = buildExecutor({
      enviarTexto: async () => {
        throw new MetaGraphApiError({ httpStatus: 503, metaErrorMessage: "Service unavailable" });
      },
    });
    const result = await executor.dispatch(buildRequest({ attempt: 1 }), { tenantId: TENANT, internal: true });
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
    const raw = result.rawResult as Record<string, unknown>;
    assert.equal(raw.httpStatus, 503);
    assert.equal(raw.attempt, 1);
    assert.equal(raw.maxAttempts, MAX_SEND_MESSAGE_ATTEMPTS);
    assert.equal(raw.phoneNumberId, PHONE_NUMBER_ID);
  });

  it("3. HTTP 429 -> RATE_LIMIT, retryAfterMs en metadata", async () => {
    const executor = buildExecutor({
      enviarTexto: async () => {
        throw new MetaGraphApiError({ httpStatus: 429, retryAfterMs: 3000 });
      },
    });
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true });
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT);
    assert.equal((result.metadata as Record<string, unknown>).retryAfterMs, 3000);
  });

  it("4. HTTP 401 -> AUTH_ERROR", async () => {
    const executor = buildExecutor({
      enviarTexto: async () => {
        throw new MetaGraphApiError({ httpStatus: 401, metaErrorMessage: "Invalid OAuth access token" });
      },
    });
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true });
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR);
  });

  it("5. HTTP 400 destinatario inválido -> NON_RETRYABLE", async () => {
    const executor = buildExecutor({
      enviarTexto: async () => {
        throw new MetaGraphApiError({ httpStatus: 400, metaErrorCode: 131026, metaErrorMessage: "Message undeliverable" });
      },
    });
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true });
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("6. falla nunca reporta success:true", async () => {
    const executor = buildExecutor({
      enviarTexto: async () => {
        throw new MetaGraphApiError({ httpStatus: 500 });
      },
    });
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true });
    assert.equal(result.success, false);
  });

  it("7. rawResult/metadata nunca contienen el token ni un header Authorization", async () => {
    const executor = buildExecutor({
      enviarTexto: async () => {
        throw new MetaGraphApiError({ httpStatus: 500, metaErrorMessage: "Internal error" });
      },
    });
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /Bearer /i);
    assert.doesNotMatch(serialized, /Authorization/i);
  });

  it("8. envía con botones cuando el mensaje trae buttons, preserva wamid", async () => {
    const executor = buildExecutor({
      enviarBotones: async () => ({ wamid: "wamid-botones" }),
    });
    const result = await executor.dispatch(
      buildRequest({ message: { content: { text: "elige" }, buttons: [{ id: "b1", label: "Sí" }] } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal((result.data as Record<string, unknown>).wamid, "wamid-botones");
  });

  it("9. AbortSignal ya abortado antes de intentar -> TIMEOUT, sin llamar a Meta", async () => {
    let called = false;
    const executor = buildExecutor({
      enviarTexto: async () => {
        called = true;
        return { wamid: "no-deberia-llegar" };
      },
    });
    const controller = new AbortController();
    controller.abort();
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true }, controller.signal);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT);
    assert.equal(called, false);
  });

  it("10. tenant_resource_mismatch sigue rechazando cross-tenant (regresión, sin cambios de F8.3)", async () => {
    const executor = buildExecutor({ resolverCliente: async () => ({ ...CLIENTE, id_tenant: "otro-tenant" }) as ClienteConfig });
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true });
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });

  it("11. cliente_config_not_found sigue NON_RETRYABLE (regresión, sin cambios de F8.3)", async () => {
    const executor = buildExecutor({ resolverCliente: async () => null });
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true });
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
  });

  it("12. media_send_not_implemented sigue NON_RETRYABLE (F8.4 fuera de alcance, regresión)", async () => {
    const executor = buildExecutor();
    const result = await executor.dispatch(
      buildRequest({ message: { content: { media: { type: "image", url: "https://x/y.jpg" } } } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
    assert.equal(result.error, "media_send_not_implemented");
  });

  it("13. TypeError de red (fetch failed) -> RETRYABLE", async () => {
    const executor = buildExecutor({
      enviarTexto: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true });
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
  });
});
