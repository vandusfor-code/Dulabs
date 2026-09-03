/**
 * Etapa 4 (Flow Builder, autorizado) — tests de save-flow.ts. `fetchImpl`
 * inyectado (mismo patrón que anthropicClient en flow-claude-executor.test.ts)
 * -- nunca red real, y captura los params reales de fetch para confirmar el
 * body/headers que se mandan.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { saveFlowVersion, validateFlowDefinition } from "@/lib/flow-builder/save-flow";
import type { FlowDefinition } from "@/lib/flow/types";

function fixtureFlow(): FlowDefinition {
  return {
    name: "fixture",
    nodes: [{ id: "start", type: "start", config: { triggerType: "manual" } }],
    edges: [],
    variables: [],
  };
}

function mockFetch(status: number, body: unknown, opts: { throws?: unknown; capture?: { input?: string; init?: RequestInit } } = {}) {
  return (async (input: string, init?: RequestInit) => {
    if (opts.throws) throw opts.throws;
    if (opts.capture) {
      opts.capture.input = input;
      opts.capture.init = init;
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

describe("saveFlowVersion", () => {
  it("éxito (201) -> ok:true con la version devuelta", async () => {
    const version = { id: "v1", flow_id: "f1", version_number: 3, definition_json: {}, published_at: null };
    const result = await saveFlowVersion({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(201, { version }),
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.version, version);
  });

  it("manda SIEMPRE {definition}, nunca publish:true ni versionNumber", async () => {
    const capture: { input?: string; init?: RequestInit } = {};
    await saveFlowVersion({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok-123",
      fetchImpl: mockFetch(201, { version: {} }, { capture }),
    });
    assert.equal(capture.input, "/api/flows/f1/versions");
    assert.equal(capture.init?.method, "POST");
    assert.equal((capture.init?.headers as Record<string, string>)?.Authorization, "Bearer tok-123");
    const body = JSON.parse(capture.init!.body as string);
    assert.deepEqual(Object.keys(body), ["definition"]);
    assert.equal("publish" in body, false);
    assert.equal("versionNumber" in body, false);
  });

  it("400 (secretos embebidos) -> ok:false, kind: embedded_secrets, con el mensaje real del servidor", async () => {
    const result = await saveFlowVersion({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(400, { error: "La definición contiene un secreto embebido en config.headers" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.kind, "embedded_secrets");
      assert.match(result.error.message, /secreto/);
    }
  });

  it("409 (conflicto de versión) -> ok:false, kind: version_conflict", async () => {
    const result = await saveFlowVersion({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(409, { error: "Ya existe una versión con ese número para este Flow" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "version_conflict");
  });

  it("401 -> ok:false, kind: unauthorized", async () => {
    const result = await saveFlowVersion({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(401, { error: "Falta el token de sesión" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "unauthorized");
  });

  it("403 -> ok:false, kind: forbidden", async () => {
    const result = await saveFlowVersion({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(403, { error: "No tienes permiso para esta acción" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "forbidden");
  });

  it("error de red (fetch lanza) -> ok:false, kind: network, nunca lanza la excepción hacia arriba", async () => {
    const result = await saveFlowVersion({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(0, {}, { throws: new TypeError("Failed to fetch") }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.kind, "network");
      assert.match(result.error.message, /fetch/i);
    }
  });

  it("500 genérico -> ok:false, kind: unknown", async () => {
    const result = await saveFlowVersion({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(500, { error: "Error inesperado" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "unknown");
  });
});

describe("validateFlowDefinition", () => {
  it("valid:true -> ok:true con el resultado exacto de la API", async () => {
    const result = await validateFlowDefinition({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(200, { valid: true, errors: [] }),
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.result, { valid: true, errors: [] });
  });

  it("valid:false con errores -> ok:true, consume errors EXACTAMENTE como llega (sin reinterpretar)", async () => {
    const errores = [
      { code: "BUTTON_MISSING_EDGE", message: "Botón sin edge", nodeId: "bt-1" },
      { code: "MISSING_START_NODE", message: "Falta start" },
    ];
    const result = await validateFlowDefinition({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(200, { valid: false, errors: errores }),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.result.valid, false);
      assert.deepEqual(result.result.errors, errores);
    }
  });

  it("manda {definition} al endpoint correcto", async () => {
    const capture: { input?: string; init?: RequestInit } = {};
    await validateFlowDefinition({
      flowId: "flow-xyz",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(200, { valid: true, errors: [] }, { capture }),
    });
    assert.equal(capture.input, "/api/flows/flow-xyz/validate");
    const body = JSON.parse(capture.init!.body as string);
    assert.ok(body.definition);
  });

  it("401 -> ok:false, kind: unauthorized", async () => {
    const result = await validateFlowDefinition({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(401, { error: "Falta el token de sesión" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "unauthorized");
  });

  it("403 -> ok:false, kind: forbidden", async () => {
    const result = await validateFlowDefinition({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(403, { error: "No tienes permiso para esta acción" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "forbidden");
  });

  it("error de red/API -> ok:false, kind: network, NUNCA inventa un resultado de validación", async () => {
    const result = await validateFlowDefinition({
      flowId: "f1",
      definition: fixtureFlow(),
      accessToken: "tok",
      fetchImpl: mockFetch(0, {}, { throws: new Error("network down") }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "network");
  });
});
