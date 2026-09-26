/**
 * Bloque 29 — lectura de la referencia en la foto del cliente: descarga de Meta y llamada a Gemini
 * con fetch simulado (sin red). Contrato: solo códigos con forma de referencia, topes, clave en header.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROMPT_LECTURA, crearLectorDeReferencias, extraerReferencias } from "@/lib/agente/lectura-referencias";

type Llamada = { url: string; init?: RequestInit };

function fetchFalso(opts: { mime?: string; size?: number; gemini?: unknown; metaStatus?: number } = {}) {
  const llamadas: Llamada[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    llamadas.push({ url: u, init });
    if (u.startsWith("https://graph.test/")) {
      return new Response(JSON.stringify({ url: "https://lookaside.test/img", mime_type: opts.mime ?? "image/jpeg", file_size: opts.size ?? 1000 }), { status: opts.metaStatus ?? 200 });
    }
    if (u === "https://lookaside.test/img") return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { status: 200 });
    if (u.includes(":generateContent")) return new Response(JSON.stringify(opts.gemini ?? { candidates: [{ content: { parts: [{ text: "DL-000087" }] } }] }), { status: 200 });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { f, llamadas };
}

const base = { token: "tok-meta", apiKey: "clave-secreta", model: "gemini-3.6-flash", graphBaseUrl: "https://graph.test", baseUrl: "https://gemini.test/v1beta" };

describe("B29 · lectura de la referencia en la foto", () => {
  it("extraerReferencias: solo LETRAS-NÚMEROS (6+ dígitos), normalizada, sin repetir", () => {
    assert.deepEqual(extraerReferencias("DL-000087"), ["DL-000087"]);
    assert.deepEqual(extraerReferencias("dl - 000087, DL-000087 y AB–1234567"), ["DL-000087", "AB-1234567"]);
    assert.deepEqual(extraerReferencias("NINGUNO"), []);
    assert.deepEqual(extraerReferencias("precio 45.000 DL-12"), []);
  });

  it("descarga de Meta con el token, imagen a Gemini con la clave SOLO en el header; devuelve la referencia", async () => {
    const { f, llamadas } = fetchFalso();
    const refs = await crearLectorDeReferencias({ ...base, fetch: f })("123456");
    assert.deepEqual(refs, ["DL-000087"]);
    assert.equal(llamadas[0].url, "https://graph.test/123456");
    assert.equal((llamadas[0].init?.headers as Record<string, string>).Authorization, "Bearer tok-meta");
    const g = llamadas[2];
    assert.equal(g.url, "https://gemini.test/v1beta/models/gemini-3.6-flash:generateContent");
    assert.equal((g.init?.headers as Record<string, string>)["x-goog-api-key"], "clave-secreta");
    assert.ok(!g.url.includes("clave-secreta"));
    const body = JSON.parse(String(g.init?.body));
    assert.equal(body.contents[0].parts[0].inlineData.mimeType, "image/jpeg");
    assert.equal(body.contents[0].parts[1].text, PROMPT_LECTURA);
  });

  it("no descarga ni lee: formato no permitido, archivo grande, Meta con error, sin token o id raro", async () => {
    for (const opts of [{ mime: "application/pdf" }, { size: 50 * 1024 * 1024 }, { metaStatus: 500 }]) {
      const { f, llamadas } = fetchFalso(opts);
      assert.deepEqual(await crearLectorDeReferencias({ ...base, fetch: f })("123456"), []);
      assert.ok(!llamadas.some((l) => l.url.includes(":generateContent")), JSON.stringify(opts));
    }
    const { f, llamadas } = fetchFalso();
    assert.deepEqual(await crearLectorDeReferencias({ ...base, token: null, fetch: f })("123456"), []);
    assert.deepEqual(await crearLectorDeReferencias({ ...base, fetch: f })("../x"), []);
    assert.equal(llamadas.length, 0);
  });

  it("Gemini sin códigos, con descripción o con error => [] (nunca se inventa)", async () => {
    for (const gemini of [{ candidates: [{ content: { parts: [{ text: "NINGUNO" }] } }] }, { candidates: [{ content: { parts: [{ text: "Una pulsera dorada con corazón lila" }] } }] }, {}]) {
      const { f } = fetchFalso({ gemini });
      assert.deepEqual(await crearLectorDeReferencias({ ...base, fetch: f })("123456"), []);
    }
    const roto = (async () => {
      throw new Error("red");
    }) as unknown as typeof fetch;
    assert.deepEqual(await crearLectorDeReferencias({ ...base, fetch: roto })("123456"), []);
  });
});
