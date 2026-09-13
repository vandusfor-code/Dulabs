/**
 * FASE F8.4 (WhatsApp Media, autorizado) — pruebas puras de enviarMedia con
 * `fetch` global mockeado (nunca una llamada de red real, nunca Meta real).
 * Verifica el payload exacto que se le manda a la Graph API por tipo de
 * media, y la clasificación de errores (reutiliza MetaGraphApiError de
 * F8.3, sin duplicar reglas).
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { enviarMedia, MetaGraphApiError } from "./whatsapp";

const ORIGINAL_FETCH = global.fetch;

function mockFetch(respuesta: unknown, ok = true, status = 200, headers: Record<string, string> = {}) {
  const llamadas: { url: string; init: RequestInit | undefined }[] = [];
  global.fetch = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url: String(url), init });
    return {
      ok,
      status,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: async () => respuesta,
    } as unknown as Response;
  }) as typeof fetch;
  return llamadas;
}

describe("enviarMedia (F8.4)", () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it("1. image por link con caption -> payload {type:image, image:{link, caption}}", async () => {
    const llamadas = mockFetch({ messages: [{ id: "wamid-1" }] });
    const { wamid } = await enviarMedia({
      phoneNumberId: "123", token: "t", para: "573000000000", tipo: "image", link: "https://x/y.jpg", caption: "hola",
    });
    assert.equal(wamid, "wamid-1");
    const body = JSON.parse(String(llamadas[0].init?.body));
    assert.equal(body.type, "image");
    assert.deepEqual(body.image, { link: "https://x/y.jpg", caption: "hola" });
  });

  it("2. image por mediaId -> payload usa {id}, nunca {link}", async () => {
    const llamadas = mockFetch({ messages: [{ id: "wamid-2" }] });
    await enviarMedia({ phoneNumberId: "123", token: "t", para: "573000000000", tipo: "image", mediaId: "media-abc" });
    const body = JSON.parse(String(llamadas[0].init?.body));
    assert.deepEqual(body.image, { id: "media-abc" });
  });

  it("3. video con caption -> incluye caption (Meta lo admite en video)", async () => {
    const llamadas = mockFetch({ messages: [{ id: "w" }] });
    await enviarMedia({ phoneNumberId: "123", token: "t", para: "573000000000", tipo: "video", link: "https://x/v.mp4", caption: "mira" });
    const body = JSON.parse(String(llamadas[0].init?.body));
    assert.equal(body.video.caption, "mira");
  });

  it("4. audio -> NUNCA incluye caption aunque se pase (Meta lo rechaza)", async () => {
    const llamadas = mockFetch({ messages: [{ id: "w" }] });
    await enviarMedia({ phoneNumberId: "123", token: "t", para: "573000000000", tipo: "audio", link: "https://x/a.ogg", caption: "no debería ir" });
    const body = JSON.parse(String(llamadas[0].init?.body));
    assert.equal(body.audio.caption, undefined);
    assert.deepEqual(Object.keys(body.audio), ["link"]);
  });

  it("5. sticker -> NUNCA incluye caption aunque se pase", async () => {
    const llamadas = mockFetch({ messages: [{ id: "w" }] });
    await enviarMedia({ phoneNumberId: "123", token: "t", para: "573000000000", tipo: "sticker", mediaId: "m1", caption: "no debería ir" });
    const body = JSON.parse(String(llamadas[0].init?.body));
    assert.deepEqual(Object.keys(body.sticker), ["id"]);
  });

  it("6. document con filename y caption -> incluye ambos", async () => {
    const llamadas = mockFetch({ messages: [{ id: "w" }] });
    await enviarMedia({
      phoneNumberId: "123", token: "t", para: "573000000000", tipo: "document",
      link: "https://x/f.pdf", caption: "tu factura", filename: "factura.pdf",
    });
    const body = JSON.parse(String(llamadas[0].init?.body));
    assert.deepEqual(body.document, { link: "https://x/f.pdf", caption: "tu factura", filename: "factura.pdf" });
  });

  it("7. filename se ignora en tipos que no son document", async () => {
    const llamadas = mockFetch({ messages: [{ id: "w" }] });
    await enviarMedia({ phoneNumberId: "123", token: "t", para: "573000000000", tipo: "image", link: "https://x/y.jpg", filename: "no-aplica.jpg" });
    const body = JSON.parse(String(llamadas[0].init?.body));
    assert.equal(body.image.filename, undefined);
  });

  it("8. Authorization header lleva el token real -- nunca se omite", async () => {
    const llamadas = mockFetch({ messages: [{ id: "w" }] });
    await enviarMedia({ phoneNumberId: "123", token: "token-secreto", para: "573000000000", tipo: "image", link: "https://x/y.jpg" });
    const headers = llamadas[0].init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer token-secreto");
  });

  it("9. HTTP 400 -> lanza MetaGraphApiError con httpStatus y metaErrorCode", async () => {
    mockFetch({ error: { message: "Invalid parameter", code: 100 } }, false, 400);
    await assert.rejects(
      enviarMedia({ phoneNumberId: "123", token: "t", para: "573000000000", tipo: "image", link: "https://x/y.jpg" }),
      (err: unknown) => {
        assert.ok(err instanceof MetaGraphApiError);
        assert.equal(err.httpStatus, 400);
        assert.equal(err.metaErrorCode, 100);
        return true;
      },
    );
  });

  it("10. HTTP 429 con Retry-After -> retryAfterMs propagado en ms", async () => {
    mockFetch({ error: { message: "rate limited" } }, false, 429, { "retry-after": "5" });
    await assert.rejects(
      enviarMedia({ phoneNumberId: "123", token: "t", para: "573000000000", tipo: "image", link: "https://x/y.jpg" }),
      (err: unknown) => {
        assert.ok(err instanceof MetaGraphApiError);
        assert.equal(err.retryAfterMs, 5000);
        return true;
      },
    );
  });

  it("11. wamid ausente en la respuesta -> devuelve null, nunca revienta", async () => {
    mockFetch({ messages: [] });
    const { wamid } = await enviarMedia({ phoneNumberId: "123", token: "t", para: "573000000000", tipo: "image", link: "https://x/y.jpg" });
    assert.equal(wamid, null);
  });

  it("12. la URL nunca se descarga desde este servidor -- solo se envía como campo `link` en el body a Meta (cero superficie de SSRF)", async () => {
    const llamadas = mockFetch({ messages: [{ id: "w" }] });
    await enviarMedia({ phoneNumberId: "123", token: "t", para: "573000000000", tipo: "image", link: "https://interno.local/secreto" });
    // La única llamada de red hecha por este código es al Graph API de Meta,
    // nunca a la URL del media -- confirmado: solo hubo 1 fetch, y va a graph.facebook.com.
    assert.equal(llamadas.length, 1);
    assert.match(llamadas[0].url, /graph\.facebook\.com/);
  });
});
