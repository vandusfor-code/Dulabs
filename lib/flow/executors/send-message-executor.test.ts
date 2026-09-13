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

  it("12. FASE F8.4: media real (antes stub media_send_not_implemented) -- envía por enviarMedia, preserva wamid y mediaType", async () => {
    const executor = buildExecutor({
      enviarMedia: async (p) => {
        assert.equal(p.tipo, "image");
        assert.equal(p.link, "https://x/y.jpg");
        return { wamid: "wamid-media-1" };
      },
    });
    const result = await executor.dispatch(
      buildRequest({ message: { content: { media: { type: "image", url: "https://x/y.jpg" } } } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal((result.data as Record<string, unknown>).wamid, "wamid-media-1");
    assert.equal((result.data as Record<string, unknown>).mediaType, "image");
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

describe("SendMessageExecutor — media (F8.4)", () => {
  let prevToken: string | undefined;
  before(() => {
    prevToken = process.env.META_ACCESS_TOKEN;
    process.env.META_ACCESS_TOKEN = "token-fake-test";
  });
  after(() => {
    if (prevToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = prevToken;
  });

  it("1. video por mediaId (sin caption) -> success, contentType=video", async () => {
    const executor = buildExecutor({
      enviarMedia: async (p) => {
        assert.equal(p.tipo, "video");
        assert.equal(p.mediaId, "media-abc");
        assert.equal(p.link, undefined);
        return { wamid: "w-video" };
      },
    });
    const result = await executor.dispatch(
      buildRequest({ message: { content: { media: { type: "video", mediaId: "media-abc" } } } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal((result.metadata as Record<string, unknown>).contentType, "video");
  });

  it("2. audio -> success, nunca envía caption (Meta no lo admite)", async () => {
    const executor = buildExecutor({
      enviarMedia: async (p) => {
        assert.equal(p.tipo, "audio");
        return { wamid: "w-audio" };
      },
    });
    const result = await executor.dispatch(
      buildRequest({ message: { content: { media: { type: "audio", url: "https://x/a.ogg" } } } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.success, true);
  });

  it("3. document con filename y caption -> se pasan ambos a enviarMedia", async () => {
    const executor = buildExecutor({
      enviarMedia: async (p) => {
        assert.equal(p.tipo, "document");
        assert.equal(p.filename, "factura.pdf");
        assert.equal(p.caption, "Aquí tienes tu factura");
        return { wamid: "w-doc" };
      },
    });
    const result = await executor.dispatch(
      buildRequest({
        message: {
          content: { media: { type: "document", url: "https://x/f.pdf", filename: "factura.pdf", caption: "Aquí tienes tu factura" } },
        },
      }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.success, true);
  });

  it("4. sticker -> success, contentType=sticker", async () => {
    const executor = buildExecutor({
      enviarMedia: async () => ({ wamid: "w-sticker" }),
    });
    const result = await executor.dispatch(
      buildRequest({ message: { content: { media: { type: "sticker", mediaId: "media-sticker" } } } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal((result.metadata as Record<string, unknown>).contentType, "sticker");
  });

  it("5. imagen sin caption -> success, dulabs_mensajes_log recibe el placeholder '[imagen]', NUNCA descarta el media silenciosamente", async () => {
    let contenidoRegistrado: string | undefined;
    const executor = buildExecutor({
      enviarMedia: async () => ({ wamid: "w-img" }),
      registrarMensaje: async (_s, _p, _t, _d, contenido) => {
        contenidoRegistrado = contenido;
        return false;
      },
    });
    const result = await executor.dispatch(
      buildRequest({ message: { content: { media: { type: "image", url: "https://x/y.jpg" } } } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(contenidoRegistrado, "[imagen]", "el bug de F8 (enviar solo el caption y descartar el media) no debe reaparecer -- acá el media SÍ se envía");
  });

  it("6. imagen con caption -> dulabs_mensajes_log recibe el caption real, no el placeholder", async () => {
    let contenidoRegistrado: string | undefined;
    const executor = buildExecutor({
      enviarMedia: async () => ({ wamid: "w-img-cap" }),
      registrarMensaje: async (_s, _p, _t, _d, contenido) => {
        contenidoRegistrado = contenido;
        return false;
      },
    });
    await executor.dispatch(
      buildRequest({ message: { content: { media: { type: "image", url: "https://x/y.jpg", caption: "Mira esto" } } } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(contenidoRegistrado, "Mira esto");
  });

  it("7. media + botones + type=image -> usa enviarBotones con headerMediaLink, nunca enviarMedia", async () => {
    let enviarMediaLlamado = false;
    const executor = buildExecutor({
      enviarMedia: async () => {
        enviarMediaLlamado = true;
        return { wamid: "no-deberia" };
      },
      enviarBotones: async (p) => {
        assert.equal(p.headerMediaLink, "https://x/y.jpg");
        assert.equal(p.headerMediaId, undefined);
        assert.equal(p.cuerpo, "elige una opción");
        return { wamid: "w-botones-media" };
      },
    });
    const result = await executor.dispatch(
      buildRequest({
        message: {
          content: { text: "elige una opción", media: { type: "image", url: "https://x/y.jpg" } },
          buttons: [{ id: "b1", label: "Sí" }],
        },
      }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(enviarMediaLlamado, false);
    assert.equal((result.metadata as Record<string, unknown>).contentType, "buttons_with_media");
  });

  it("8. media + botones + type=video -> VALIDATION_ERROR media_buttons_unsupported_type, nunca llama a Meta", async () => {
    let llamadoAlgo = false;
    const executor = buildExecutor({
      enviarMedia: async () => {
        llamadoAlgo = true;
        return { wamid: "x" };
      },
      enviarBotones: async () => {
        llamadoAlgo = true;
        return { wamid: "x" };
      },
    });
    const result = await executor.dispatch(
      buildRequest({
        message: {
          content: { text: "elige", media: { type: "video", url: "https://x/v.mp4" } },
          buttons: [{ id: "b1", label: "Sí" }],
        },
      }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
    assert.equal(result.error, "media_buttons_unsupported_type");
    assert.equal(llamadoAlgo, false);
  });

  it("9. media sin url NI mediaId -> VALIDATION_ERROR media_reference_required, nunca llama a Meta", async () => {
    let llamado = false;
    const executor = buildExecutor({ enviarMedia: async () => { llamado = true; return { wamid: "x" }; } });
    const result = await executor.dispatch(
      buildRequest({ message: { content: { media: { type: "image" } } } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
    assert.equal(result.error, "media_reference_required");
    assert.equal(llamado, false);
  });

  it("10. media + botones sin ningún texto/caption -> VALIDATION_ERROR empty_message_content", async () => {
    const executor = buildExecutor();
    const result = await executor.dispatch(
      buildRequest({
        message: { content: { media: { type: "image", url: "https://x/y.jpg" } }, buttons: [{ id: "b1", label: "Sí" }] },
      }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR);
    assert.equal(result.error, "empty_message_content");
  });

  it("11. HTTP 400 (payload/link inválido) al enviar media -> NON_RETRYABLE, sin retry (regla F8.3 aplicada a media)", async () => {
    const executor = buildExecutor({
      enviarMedia: async () => {
        throw new MetaGraphApiError({ httpStatus: 400, metaErrorMessage: "Invalid media url" });
      },
    });
    const result = await executor.dispatch(
      buildRequest({ message: { content: { media: { type: "image", url: "https://x/y.jpg" } } } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE);
    const raw = result.rawResult as Record<string, unknown>;
    assert.equal(raw.mediaType, "image");
  });

  it("12. HTTP 503 al enviar media -> RETRYABLE (misma clasificación F8.3, reutilizada sin duplicar)", async () => {
    const executor = buildExecutor({
      enviarMedia: async () => {
        throw new MetaGraphApiError({ httpStatus: 503 });
      },
    });
    const result = await executor.dispatch(
      buildRequest({ message: { content: { media: { type: "image", url: "https://x/y.jpg" } } } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
  });

  it("13. token de Meta ausente -> AUTH_ERROR incluso para media (mismo gate que texto, sin duplicar)", async () => {
    const withoutToken = new SendMessageExecutor({
      supabase: {} as never,
      resolverCliente: async () => ({ ...CLIENTE, meta_permanent_token: null } as ClienteConfig),
    });
    const prev = process.env.META_ACCESS_TOKEN;
    delete process.env.META_ACCESS_TOKEN;
    try {
      const result = await withoutToken.dispatch(
        buildRequest({ message: { content: { media: { type: "image", url: "https://x/y.jpg" } } } }),
        { tenantId: TENANT, internal: true },
      );
      assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR);
    } finally {
      if (prev === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = prev;
    }
  });

  it("14. cross-tenant sigue rechazando aunque el efecto sea media (regresión, sin cambios)", async () => {
    const executor = buildExecutor({ resolverCliente: async () => ({ ...CLIENTE, id_tenant: "otro-tenant" }) as ClienteConfig });
    const result = await executor.dispatch(
      buildRequest({ message: { content: { media: { type: "image", url: "https://x/y.jpg" } } } }),
      { tenantId: TENANT, internal: true },
    );
    assert.equal(result.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
  });
});
