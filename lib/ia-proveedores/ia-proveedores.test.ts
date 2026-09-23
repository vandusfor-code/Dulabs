/**
 * Fase 8, Bloque 1 — contrato neutral de proveedores + GeminiProvider.
 * Sin red: `fetch` falso y proveedor simulado. Ninguna prueba llama a Gemini real.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AIProviderError, type AIGenerateRequest, type AITurn } from "@/lib/ia-proveedores/contrato";
import { buildGeminiRequestBody, createGeminiProvider, geminiHttpError, parseGeminiResponse } from "@/lib/ia-proveedores/gemini";
import { SUPPORTED_MODELS, resolveAIProvider, validateAIProviderConfig } from "@/lib/ia-proveedores/registro";
import { generateWithRetry } from "@/lib/ia-proveedores/reintentos";
import { createSimulatedProvider } from "@/lib/ia-proveedores/simulado";
import { agentToolDefinitions } from "@/lib/catalogo/pedidos/herramientas";

const KEY = "clave-de-prueba-no-real-0123456789";
const baseReq = (over: Partial<AIGenerateRequest> = {}): AIGenerateRequest => ({
  model: "gemini-3.6-flash",
  system: "Reglas de prueba",
  turns: [{ role: "user", text: "hola" }],
  tools: [],
  toolMode: "auto",
  maxOutputTokens: 512,
  timeoutMs: 2_000,
  ...over,
});

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {}, body: JSON.parse(String(init?.body ?? "{}")) });
    return handler(u, init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const okText = (text: string) => json(200, { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 }, modelVersion: "gemini-3.6-flash" });

describe("registro: proveedor, modelo y credencial EXPLÍCITOS (fail-closed)", () => {
  const env = { GEMINI_KEY_DELACOUR: KEY, GEMINI_KEY: "clave-plataforma-no-real", ANTHROPIC_API_KEY: "sk-ant-no-real" };

  it("sin proveedor no hay default: provider_missing; nada se construye", () => {
    for (const provider of [undefined, null, ""]) {
      assert.deepEqual(resolveAIProvider({ provider, model: "gemini-3.6-flash", credentialRef: "env:GEMINI_KEY_DELACOUR" }, { env }), { ok: false, reason: "provider_missing" });
    }
  });

  it("Anthropic/Claude u otro proveedor no registrado => provider_unsupported (sin fallback)", () => {
    for (const provider of ["anthropic", "claude", "openai", "GEMINI", "gemini "]) {
      assert.deepEqual(resolveAIProvider({ provider, model: "gemini-3.6-flash", credentialRef: "env:GEMINI_KEY_DELACOUR" }, { env }), { ok: false, reason: "provider_unsupported" });
    }
  });

  it("modelo faltante o no soportado => fail-closed (nunca se inventa ni se sustituye)", () => {
    assert.deepEqual(resolveAIProvider({ provider: "gemini", model: undefined, credentialRef: "env:GEMINI_KEY_DELACOUR" }, { env }), { ok: false, reason: "model_missing" });
    for (const model of ["gemini-2.0-flash", "gemini-3.6-pro", "claude-sonnet-5", "gemini-3.6-flash/../x"]) {
      assert.deepEqual(resolveAIProvider({ provider: "gemini", model, credentialRef: "env:GEMINI_KEY_DELACOUR" }, { env }), { ok: false, reason: "model_unsupported" });
    }
    assert.deepEqual(SUPPORTED_MODELS.gemini, ["gemini-3.6-flash"]);
  });

  it("credencial: solo referencias env:GEMINI_KEY[_SUFIJO]; una key de otro proveedor no sirve", () => {
    for (const credentialRef of [undefined, "GEMINI_KEY_DELACOUR", "env:ANTHROPIC_API_KEY", "env:GEMINI_KEY_delacour", "env:SUPABASE_SERVICE_ROLE_KEY", KEY]) {
      assert.deepEqual(resolveAIProvider({ provider: "gemini", model: "gemini-3.6-flash", credentialRef }, { env }), { ok: false, reason: "credential_ref_invalid" });
    }
  });

  it("la key propia del tenant falta => credential_missing, AUNQUE exista la de plataforma (sin caer a otra clave)", () => {
    assert.deepEqual(resolveAIProvider({ provider: "gemini", model: "gemini-3.6-flash", credentialRef: "env:GEMINI_KEY_DELACOUR" }, { env: { GEMINI_KEY: "plataforma" } }), {
      ok: false,
      reason: "credential_missing",
    });
    assert.deepEqual(resolveAIProvider({ provider: "gemini", model: "gemini-3.6-flash", credentialRef: "env:GEMINI_KEY_DELACOUR_ORUS" }, { env: {} }), { ok: false, reason: "credential_missing" });
  });

  it("configuración válida => GeminiProvider con SU key; validar la forma no lee secretos", () => {
    const keys: string[] = [];
    const r = resolveAIProvider(
      { provider: "gemini", model: "gemini-3.6-flash", credentialRef: "env:GEMINI_KEY_DELACOUR" },
      { env, factories: { gemini: (k) => (keys.push(k), createSimulatedProvider([])) } },
    );
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.providerId, "gemini");
    assert.equal(r.ok && r.provider.id, "gemini");
    assert.deepEqual(keys, [KEY]);
    assert.deepEqual(validateAIProviderConfig({ provider: "gemini", model: "gemini-3.6-flash", credentialRef: "env:GEMINI_KEY_DELACOUR" }), {
      ok: true,
      providerId: "gemini",
      model: "gemini-3.6-flash",
      envVar: "GEMINI_KEY_DELACOUR",
    });
  });

  it("la capa de proveedores no depende de Anthropic ni del cliente Gemini de AMORE/Flow", () => {
    const dir = join(process.cwd(), "lib/ia-proveedores");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const imports = [...readFileSync(join(dir, f), "utf8").matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
      for (const mod of imports) {
        assert.doesNotMatch(mod, /@anthropic-ai|claude|anthropic/, `${f} importa ${mod}`);
        assert.doesNotMatch(mod, /^@\/lib\/flow\//, `${f} importa ${mod}`);
      }
    }
  });
});

describe("GeminiProvider: cuerpo de la petición (function calling real)", () => {
  const tools = [{ name: "search_products", description: "Busca", parameters: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } }];

  it("herramientas => functionDeclarations + modo VALIDATED restringido a la allowlist", () => {
    const body = buildGeminiRequestBody(baseReq({ tools }));
    assert.deepEqual(body.tools, [
      {
        functionDeclarations: [
          { name: "search_products", description: "Busca", parametersJsonSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
        ],
      },
    ]);
    assert.deepEqual(body.toolConfig, { functionCallingConfig: { mode: "VALIDATED", allowedFunctionNames: ["search_products"] } });
    assert.deepEqual(body.systemInstruction, { parts: [{ text: "Reglas de prueba" }] });
  });

  it("toolMode none => NONE; sin herramientas => ni tools ni toolConfig", () => {
    assert.deepEqual(buildGeminiRequestBody(baseReq({ tools, toolMode: "none" })).toolConfig, { functionCallingConfig: { mode: "NONE" } });
    const sin = buildGeminiRequestBody(baseReq());
    assert.equal("tools" in sin, false);
    assert.equal("toolConfig" in sin, false);
  });

  it("generationConfig: thinkingLevel en mayúsculas; temperatura SOLO si se configuró", () => {
    assert.deepEqual(buildGeminiRequestBody(baseReq({ thinking: "low" })).generationConfig, { maxOutputTokens: 512, thinkingConfig: { thinkingLevel: "LOW" } });
    assert.deepEqual(buildGeminiRequestBody(baseReq({ temperature: 0.4 })).generationConfig, { maxOutputTokens: 512, temperature: 0.4 });
  });

  it("el turno del modelo se reenvía con sus partes ORIGINALES (thoughtSignature) y los resultados como functionResponse", () => {
    const parts = [{ functionCall: { id: "fc-1", name: "search_products", args: { query: "aretes" } }, thoughtSignature: "c2lnbmF0dXJh" }];
    const turns: AITurn[] = [
      { role: "user", text: "aretes" },
      { role: "model", text: null, toolCalls: [{ id: "fc-1", name: "search_products", args: { query: "aretes" } }], continuation: { provider: "gemini", data: parts } },
      { role: "tool", results: [{ callId: "fc-1", name: "search_products", output: { status: "candidates", candidates: [] } }] },
    ];
    const body = buildGeminiRequestBody(baseReq({ turns, tools }));
    assert.deepEqual(body.contents, [
      { role: "user", parts: [{ text: "aretes" }] },
      { role: "model", parts },
      { role: "user", parts: [{ functionResponse: { id: "fc-1", name: "search_products", response: { status: "candidates", candidates: [] } } }] },
    ]);
  });

  it("ids asignados localmente no se reenvían; un turno sin continuación de Gemini se reconstruye", () => {
    const turns: AITurn[] = [
      { role: "model", text: "ok", toolCalls: [{ id: "gemini-local-0", name: "x", args: {} }], continuation: { provider: "gemini", data: { no: "array" } } },
      { role: "tool", results: [{ callId: "gemini-local-0", name: "x", output: { ok: true } }] },
    ];
    assert.deepEqual(buildGeminiRequestBody(baseReq({ turns })).contents, [
      { role: "model", parts: [{ text: "ok" }, { functionCall: { name: "x", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { name: "x", response: { ok: true } } }] },
    ]);
  });

  it("los esquemas reales de las herramientas del catálogo se declaran sin $schema y cerrados", () => {
    const decl = agentToolDefinitions().map((d) => ({ name: d.name, description: d.description, parameters: d.input_schema as Record<string, unknown> }));
    const body = buildGeminiRequestBody(baseReq({ tools: decl }));
    const fns = (body.tools as Array<{ functionDeclarations: Array<{ parametersJsonSchema: Record<string, unknown> }> }>)[0].functionDeclarations;
    assert.equal(fns.length, decl.length);
    for (const f of fns) {
      assert.equal("$schema" in f.parametersJsonSchema, false);
      assert.equal(f.parametersJsonSchema.additionalProperties, false);
    }
  });
});

describe("GeminiProvider: interpretación de la respuesta", () => {
  it("texto sin las partes de pensamiento; uso de tokens normalizado", () => {
    const r = parseGeminiResponse(
      {
        candidates: [{ content: { parts: [{ text: "pensando…", thought: true }, { text: "Hola, " }, { text: "¿en qué te ayudo?" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 9, thoughtsTokenCount: 30, cachedContentTokenCount: 64 },
        modelVersion: "gemini-3.6-flash",
      },
      "gemini-3.6-flash",
      5,
    );
    assert.equal(r.text, "Hola, ¿en qué te ayudo?");
    assert.equal(r.finish, "stop");
    assert.deepEqual(r.usage, { inputTokens: 120, outputTokens: 9, thinkingTokens: 30, cachedTokens: 64 });
    assert.equal(r.provider, "gemini");
  });

  it("llamadas a herramientas (con y sin id) => finish tool_calls y continuación con las partes originales", () => {
    const parts = [
      { functionCall: { id: "a1", name: "search_products", args: { query: "anillo" } }, thoughtSignature: "firma" },
      { functionCall: { name: "get_cart" } },
    ];
    const r = parseGeminiResponse({ candidates: [{ content: { parts }, finishReason: "STOP" }] }, "gemini-3.6-flash", 1);
    assert.equal(r.finish, "tool_calls");
    assert.deepEqual(r.toolCalls, [
      { id: "a1", name: "search_products", args: { query: "anillo" } },
      { id: "gemini-local-1", name: "get_cart", args: {} },
    ]);
    assert.deepEqual(r.continuation, { provider: "gemini", data: parts });
    assert.equal(r.text, null);
  });

  it("finishReason: seguridad, llamada mal formada, límite de tokens", () => {
    const f = (finishReason: string) => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: "x" }] }, finishReason }] }, "m", 1).finish;
    assert.equal(f("SAFETY"), "safety");
    assert.equal(f("PROHIBITED_CONTENT"), "safety");
    assert.equal(f("MALFORMED_FUNCTION_CALL"), "invalid_output");
    assert.equal(f("UNEXPECTED_TOOL_CALL"), "invalid_output");
    assert.equal(f("MAX_TOKENS"), "max_tokens");
    assert.equal(f("LANGUAGE"), "other");
  });

  it("prompt bloqueado => safety_blocked; respuesta vacía o mal formada => invalid_response", () => {
    assert.throws(() => parseGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } }, "m", 1), (e: AIProviderError) => e.kind === "safety_blocked" && !e.retryable);
    assert.throws(() => parseGeminiResponse({ candidates: [] }, "m", 1), (e: AIProviderError) => e.kind === "invalid_response");
    assert.throws(() => parseGeminiResponse({ candidates: "x" }, "m", 1), (e: AIProviderError) => e.kind === "invalid_response");
    assert.throws(() => parseGeminiResponse({ candidates: [{ content: { parts: [{ functionCall: { name: "" } }] } }] }, "m", 1), (e: AIProviderError) => e.kind === "invalid_response");
  });
});

describe("GeminiProvider: transporte, errores y secretos", () => {
  it("URL con el modelo, key SOLO en el header, cuerpo JSON", async () => {
    const f = fakeFetch(() => okText("hola"));
    const p = createGeminiProvider({ apiKey: KEY, fetchImpl: f.impl, baseUrl: "https://gemini.test/v1beta/" });
    const r = await p.generate(baseReq());
    assert.equal(r.text, "hola");
    assert.equal(f.calls[0].url, "https://gemini.test/v1beta/models/gemini-3.6-flash:generateContent");
    assert.doesNotMatch(f.calls[0].url, new RegExp(KEY));
    assert.equal((f.calls[0].init.headers as Record<string, string>)["x-goog-api-key"], KEY);
    assert.doesNotMatch(JSON.stringify(f.calls[0].body), new RegExp(KEY));
  });

  it("errores HTTP normalizados; el mensaje del proveedor y la key nunca llegan al error", async () => {
    const casos: Array<[number, string, boolean]> = [
      [400, "invalid_request", false],
      [401, "auth", false],
      [403, "auth", false],
      [404, "invalid_request", false],
      [429, "rate_limit", true],
      [500, "server", true],
      [503, "server", true],
      [504, "timeout", true],
    ];
    for (const [status, kind, retryable] of casos) {
      const f = fakeFetch(() => json(status, { error: { code: status, status: "SOME_STATUS", message: `detalle con ${KEY} y texto del cliente` } }));
      const p = createGeminiProvider({ apiKey: KEY, fetchImpl: f.impl });
      await assert.rejects(p.generate(baseReq()), (e: AIProviderError) => {
        assert.equal(e.kind, kind);
        assert.equal(e.retryable, retryable);
        assert.equal(e.detail.providerCode, "SOME_STATUS");
        assert.doesNotMatch(e.message, new RegExp(KEY));
        assert.doesNotMatch(e.message, /texto del cliente/);
        return true;
      });
    }
    assert.equal(geminiHttpError(418, null).detail.providerCode, undefined);
  });

  it("red caída => network; se excede el timeout => timeout", async () => {
    const caida = createGeminiProvider({
      apiKey: KEY,
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    await assert.rejects(caida.generate(baseReq()), (e: AIProviderError) => e.kind === "network" && e.retryable);
    const lenta = createGeminiProvider({
      apiKey: KEY,
      fetchImpl: ((_u: string, init?: RequestInit) =>
        new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch,
    });
    await assert.rejects(lenta.generate(baseReq({ timeoutMs: 30 })), (e: AIProviderError) => e.kind === "timeout" && e.retryable);
  });

  it("respuesta 200 que no es JSON => invalid_response", async () => {
    const p = createGeminiProvider({ apiKey: KEY, fetchImpl: (async () => new Response("<html>", { status: 200 })) as typeof fetch });
    await assert.rejects(p.generate(baseReq()), (e: AIProviderError) => e.kind === "invalid_response");
  });

  it("modelo con caracteres de ruta o sin key => config (nunca se llama a la red)", async () => {
    const f = fakeFetch(() => okText("x"));
    const p = createGeminiProvider({ apiKey: KEY, fetchImpl: f.impl });
    await assert.rejects(p.generate(baseReq({ model: "../../otro" })), (e: AIProviderError) => e.kind === "config");
    assert.equal(f.calls.length, 0);
    assert.throws(() => createGeminiProvider({ apiKey: "" }), (e: AIProviderError) => e.kind === "config");
  });

  it("bucle de dos pasos: pide herramienta, recibe el resultado del backend y responde", async () => {
    const respuestas = [
      json(200, { candidates: [{ content: { parts: [{ functionCall: { id: "c1", name: "search_products", args: { query: "aretes" } }, thoughtSignature: "sig-1" }] }, finishReason: "STOP" }] }),
      okText("Encontré 2 opciones."),
    ];
    const f = fakeFetch(() => respuestas.shift() as Response);
    const p = createGeminiProvider({ apiKey: KEY, fetchImpl: f.impl });
    const tools = [{ name: "search_products", description: "Busca", parameters: { type: "object", properties: { query: { type: "string" } } } }];
    const paso1 = await p.generate(baseReq({ tools }));
    assert.deepEqual(paso1.toolCalls, [{ id: "c1", name: "search_products", args: { query: "aretes" } }]);
    const turns: AITurn[] = [
      { role: "user", text: "aretes" },
      { role: "model", text: paso1.text, toolCalls: paso1.toolCalls, continuation: paso1.continuation },
      { role: "tool", results: [{ callId: "c1", name: "search_products", output: { status: "candidates", candidates: [{ reference: "DL-000185" }] } }] },
    ];
    const paso2 = await p.generate(baseReq({ tools, turns }));
    assert.equal(paso2.text, "Encontré 2 opciones.");
    const contents = f.calls[1].body.contents as Array<{ parts: Array<Record<string, unknown>> }>;
    assert.equal(contents[1].parts[0].thoughtSignature, "sig-1", "la firma de pensamiento vuelve intacta");
    assert.deepEqual(contents[2].parts[0], { functionResponse: { id: "c1", name: "search_products", response: { status: "candidates", candidates: [{ reference: "DL-000185" }] } } });
  });
});

describe("reintento controlado (sin cambiar de proveedor)", () => {
  const opts = (now = 0) => ({ deadlineAt: now + 60_000, now: () => now, sleep: async () => {}, random: () => 0 });

  it("error transitorio => un reintento con el MISMO proveedor y modelo", async () => {
    const p = createSimulatedProvider([{ error: new AIProviderError("rate_limit", "gemini") }, { text: "listo" }]);
    const avisos: string[] = [];
    const r = await generateWithRetry(p, baseReq(), { ...opts(), onRetry: (i) => avisos.push(`${i.attempt}:${i.kind}:${i.delayMs}`) });
    assert.equal(r.text, "listo");
    assert.equal(p.requests.length, 2);
    assert.deepEqual(
      p.requests.map((q) => q.model),
      ["gemini-3.6-flash", "gemini-3.6-flash"],
    );
    assert.deepEqual(avisos, ["1:rate_limit:400"]);
  });

  it("no transitorio (auth, invalid_request, safety) => sin reintento", async () => {
    for (const kind of ["auth", "invalid_request", "safety_blocked", "invalid_response", "config"] as const) {
      const p = createSimulatedProvider([{ error: new AIProviderError(kind, "gemini") }, { text: "no debería llegar" }]);
      await assert.rejects(generateWithRetry(p, baseReq(), opts()), (e: AIProviderError) => e.kind === kind);
      assert.equal(p.requests.length, 1, kind);
    }
  });

  it("máximo 1 reintento por defecto; sin tiempo restante no se reintenta", async () => {
    const p = createSimulatedProvider([{ error: new AIProviderError("server", "gemini") }, { error: new AIProviderError("server", "gemini") }, { text: "x" }]);
    await assert.rejects(generateWithRetry(p, baseReq(), opts()), (e: AIProviderError) => e.kind === "server");
    assert.equal(p.requests.length, 2);
    const q = createSimulatedProvider([{ error: new AIProviderError("server", "gemini") }, { text: "x" }]);
    await assert.rejects(generateWithRetry(q, baseReq(), { deadlineAt: 1_800, now: () => 0, sleep: async () => {}, random: () => 0 }));
    assert.equal(q.requests.length, 1);
  });

  it("el timeout de la llamada nunca excede lo que queda del turno", async () => {
    const p = createSimulatedProvider([{ text: "x" }]);
    await generateWithRetry(p, baseReq({ timeoutMs: 15_000 }), { deadlineAt: 5_000, now: () => 0, sleep: async () => {} });
    assert.equal(p.requests[0].timeoutMs, 5_000);
  });
});

describe("proveedor simulado", () => {
  it("registra lo recibido y falla fuerte si el guion se agota (nunca inventa)", async () => {
    const p = createSimulatedProvider([{ toolCalls: [{ name: "get_cart", args: {} }] }, (req) => ({ text: `turnos=${req.turns.length}` })]);
    const a = await p.generate(baseReq());
    assert.equal(a.finish, "tool_calls");
    assert.equal(a.toolCalls[0].name, "get_cart");
    const b = await p.generate(baseReq({ turns: [{ role: "user", text: "a" }, { role: "user", text: "b" }] }));
    assert.equal(b.text, "turnos=2");
    await assert.rejects(p.generate(baseReq()), /guion agotado/);
    assert.equal(p.requests.length, 3);
  });
});
