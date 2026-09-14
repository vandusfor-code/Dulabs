/**
 * HOTFIX "humano tiene prioridad absoluta sobre IA" — última barrera del
 * SendMessageExecutor. Prueba la carrera real del incidente: un asesor toma la
 * conversación MIENTRAS el Flow genera la respuesta; justo antes de enviar, el
 * executor re-consulta el estado y ABORTA sin tocar la Graph API, con un
 * resultado terminal (NON_RETRYABLE) para que ningún retry lo reviva.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SendMessageExecutor, type SendMessageDeps } from "@/lib/flow/executors/send-message-executor";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest } from "@/lib/flow/executor-types";
import type { ClienteConfig } from "@/lib/supabase";

const TENANT = "tenant-takeover";
const PHONE_NUMBER_ID = "1000000000009";
const CHAT = "573148127388";
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
    message: { content: { text: "respuesta generada por la IA" } },
    conversation: { phoneNumberId: PHONE_NUMBER_ID, telefonoCliente: CHAT },
    ...overrides,
  };
}

function buildExecutor(deps: Partial<SendMessageDeps>, sendSpy: { called: boolean }) {
  return new SendMessageExecutor({
    supabase: {} as never,
    resolverCliente: async () => CLIENTE,
    incrementarUsoMensajes: async () => {},
    registrarMensaje: async () => false,
    enviarTexto: async () => {
      sendSpy.called = true;
      return { wamid: "wamid-enviado" };
    },
    ...deps,
  });
}

describe("SendMessageExecutor — última barrera de human takeover", () => {
  let prevToken: string | undefined;
  before(() => {
    prevToken = process.env.META_ACCESS_TOKEN;
    process.env.META_ACCESS_TOKEN = "token-fake-test";
  });
  after(() => {
    if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = prevToken;
  });

  it("TAKEOVER: si la conversación pasó a humano, NO envía y devuelve NON_RETRYABLE", async () => {
    const sendSpy = { called: false };
    let consultado: { phoneNumberId: string; telefonoCliente: string } | null = null;
    const executor = buildExecutor(
      {
        chatEnPausaHumana: async (_s, phoneNumberId, telefonoCliente) => {
          consultado = { phoneNumberId, telefonoCliente };
          return true; // el asesor tomó la conversación
        },
      },
      sendSpy,
    );
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true });
    assert.equal(result.success, false);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
    assert.equal(result.error, "ai_blocked_human_takeover");
    assert.equal(sendSpy.called, false, "NUNCA debe tocar la Graph API con takeover activo");
    // consulta el estado de ESTA conversación exacta (aislamiento)
    assert.deepEqual(consultado, { phoneNumberId: PHONE_NUMBER_ID, telefonoCliente: CHAT });
  });

  it("AI ACTIVE: sin takeover, envía normalmente", async () => {
    const sendSpy = { called: false };
    const executor = buildExecutor({ chatEnPausaHumana: async () => false }, sendSpy);
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true });
    assert.equal(result.success, true);
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SUCCESS);
    assert.equal(sendSpy.called, true);
  });

  it("RETROCOMPAT: sin la dep inyectada, el executor no consulta pausa y envía (comportamiento previo)", async () => {
    const sendSpy = { called: false };
    const executor = buildExecutor({}, sendSpy); // sin chatEnPausaHumana
    const result = await executor.dispatch(buildRequest(), { tenantId: TENANT, internal: true });
    assert.equal(result.success, true);
    assert.equal(sendSpy.called, true);
  });
});
