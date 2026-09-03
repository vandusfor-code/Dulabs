/**
 * Fase 3 (Flow Builder, autorizado) — tests de triggers.ts. `fetchImpl`
 * inyectado (mismo patrón que create-flow.test.ts/save-flow.test.ts) --
 * nunca red real.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTrigger, deleteTrigger, listTriggers, updateTrigger } from "@/lib/flow-builder/triggers";

function mockFetch(status: number, body: unknown, opts: { throws?: unknown; capture?: { input?: string; init?: RequestInit } } = {}) {
  return (async (input: string, init?: RequestInit) => {
    if (opts.throws) throw opts.throws;
    if (opts.capture) {
      opts.capture.input = input;
      opts.capture.init = init;
    }
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
}

const ROW = {
  id: "trig-1",
  tenant_id: "tenant-1",
  flow_id: "flow-1",
  type: "keyword",
  enabled: true,
  priority: 10,
  config: { keywords: ["hola"] },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("listTriggers", () => {
  it("éxito -> ok:true, filas traducidas a FlowTrigger (config con `type` reconstruido)", async () => {
    const result = await listTriggers({ flowId: "flow-1", accessToken: "tok", fetchImpl: mockFetch(200, { triggers: [ROW] }) });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.triggers.length, 1);
      assert.deepEqual(result.triggers[0].config, { type: "keyword", keywords: ["hola"] });
      assert.equal(result.triggers[0].priority, 10);
    }
  });

  it("manda el token en Authorization al endpoint correcto", async () => {
    const capture: { input?: string; init?: RequestInit } = {};
    await listTriggers({ flowId: "flow-1", accessToken: "tok-abc", fetchImpl: mockFetch(200, { triggers: [] }, { capture }) });
    assert.equal(capture.input, "/api/flows/flow-1/triggers");
    assert.equal((capture.init?.headers as Record<string, string>)?.Authorization, "Bearer tok-abc");
  });

  it("403 -> ok:false, kind: forbidden", async () => {
    const result = await listTriggers({ flowId: "flow-1", accessToken: "tok", fetchImpl: mockFetch(403, { error: "no" }) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "forbidden");
  });

  it("error de red -> ok:false, kind: network", async () => {
    const result = await listTriggers({ flowId: "flow-1", accessToken: "tok", fetchImpl: mockFetch(0, {}, { throws: new Error("boom") }) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "network");
  });
});

describe("createTrigger", () => {
  it("manda {type, config, priority, enabled} -- 'type' fuera de config, nunca duplicado adentro", async () => {
    const capture: { init?: RequestInit } = {};
    await createTrigger({
      flowId: "flow-1",
      config: { type: "keyword", keywords: ["hola"] },
      priority: 5,
      enabled: true,
      accessToken: "tok",
      fetchImpl: mockFetch(201, { trigger: ROW }, { capture }),
    });
    const body = JSON.parse(capture.init!.body as string);
    assert.equal(body.type, "keyword");
    assert.deepEqual(body.config, { keywords: ["hola"] });
    assert.equal("type" in body.config, false);
    assert.equal(body.priority, 5);
    assert.equal(body.enabled, true);
  });

  it("201 -> ok:true con el trigger creado", async () => {
    const result = await createTrigger({ flowId: "flow-1", config: { type: "manual" }, accessToken: "tok", fetchImpl: mockFetch(201, { trigger: ROW }) });
    assert.equal(result.ok, true);
  });

  it("400 (config inválido) -> ok:false, kind: invalid", async () => {
    const result = await createTrigger({
      flowId: "flow-1",
      config: { type: "keyword", keywords: [] },
      accessToken: "tok",
      fetchImpl: mockFetch(400, { error: "config inválido" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "invalid");
  });
});

describe("updateTrigger", () => {
  it("manda solo los campos presentes (nunca 'type')", async () => {
    const capture: { init?: RequestInit } = {};
    await updateTrigger({ flowId: "flow-1", triggerId: "trig-1", priority: 99, accessToken: "tok", fetchImpl: mockFetch(200, { trigger: ROW }, { capture }) });
    const body = JSON.parse(capture.init!.body as string);
    assert.deepEqual(body, { priority: 99 });
  });

  it("actualiza config -- manda solo los campos específicos del tipo, sin 'type'", async () => {
    const capture: { init?: RequestInit } = {};
    await updateTrigger({
      flowId: "flow-1",
      triggerId: "trig-1",
      config: { type: "keyword", keywords: ["nuevo"] },
      accessToken: "tok",
      fetchImpl: mockFetch(200, { trigger: ROW }, { capture }),
    });
    const body = JSON.parse(capture.init!.body as string);
    assert.deepEqual(body.config, { keywords: ["nuevo"] });
  });

  it("404 -> ok:false, kind: not_found", async () => {
    const result = await updateTrigger({ flowId: "flow-1", triggerId: "trig-1", enabled: false, accessToken: "tok", fetchImpl: mockFetch(404, { error: "no" }) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "not_found");
  });
});

describe("deleteTrigger", () => {
  it("200 -> ok:true", async () => {
    const result = await deleteTrigger({ flowId: "flow-1", triggerId: "trig-1", accessToken: "tok", fetchImpl: mockFetch(200, { ok: true }) });
    assert.equal(result.ok, true);
  });

  it("manda DELETE al endpoint correcto", async () => {
    const capture: { input?: string; init?: RequestInit } = {};
    await deleteTrigger({ flowId: "flow-1", triggerId: "trig-1", accessToken: "tok", fetchImpl: mockFetch(200, {}, { capture }) });
    assert.equal(capture.input, "/api/flows/flow-1/triggers/trig-1");
    assert.equal(capture.init?.method, "DELETE");
  });

  it("403 -> ok:false, kind: forbidden", async () => {
    const result = await deleteTrigger({ flowId: "flow-1", triggerId: "trig-1", accessToken: "tok", fetchImpl: mockFetch(403, { error: "no" }) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "forbidden");
  });
});
