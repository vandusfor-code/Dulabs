/**
 * Etapa 5 (Flow Builder, autorizado) — tests de publish-flow.ts. Mismo
 * patrón que save-flow.test.ts: fetchImpl inyectado, nunca red real.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchFlowVersions, publishFlowVersion } from "@/lib/flow-builder/publish-flow";

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

describe("publishFlowVersion", () => {
  it("200 -> ok:true con el flow devuelto", async () => {
    const flow = { id: "f1", published_version_id: "v3", status: "published" };
    const result = await publishFlowVersion({
      flowId: "f1",
      versionId: "v3",
      accessToken: "tok",
      fetchImpl: mockFetch(200, { flow }),
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.flow, flow);
  });

  it("manda SIEMPRE {versionId}, nunca definition ni publish:true", async () => {
    const capture: { input?: string; init?: RequestInit } = {};
    await publishFlowVersion({
      flowId: "f1",
      versionId: "v3",
      accessToken: "tok-123",
      fetchImpl: mockFetch(200, { flow: {} }, { capture }),
    });
    assert.equal(capture.input, "/api/flows/f1/publish");
    assert.equal(capture.init?.method, "POST");
    assert.equal((capture.init?.headers as Record<string, string>)?.Authorization, "Bearer tok-123");
    const body = JSON.parse(capture.init!.body as string);
    assert.deepEqual(body, { versionId: "v3" });
  });

  it("401 -> ok:false, kind: unauthorized", async () => {
    const result = await publishFlowVersion({
      flowId: "f1",
      versionId: "v3",
      accessToken: "tok",
      fetchImpl: mockFetch(401, { error: "Falta el token de sesión" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "unauthorized");
  });

  it("403 (no-admin) -> ok:false, kind: forbidden", async () => {
    const result = await publishFlowVersion({
      flowId: "f1",
      versionId: "v3",
      accessToken: "tok",
      fetchImpl: mockFetch(403, { error: "No tienes permiso para esta acción" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "forbidden");
  });

  it("404 (versión inexistente/de otro tenant) -> ok:false, kind: not_found", async () => {
    const result = await publishFlowVersion({
      flowId: "f1",
      versionId: "v-nope",
      accessToken: "tok",
      fetchImpl: mockFetch(404, { error: "Versión no encontrada" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "not_found");
  });

  it("error de red -> ok:false, kind: network, nunca lanza la excepción hacia arriba", async () => {
    const result = await publishFlowVersion({
      flowId: "f1",
      versionId: "v3",
      accessToken: "tok",
      fetchImpl: mockFetch(0, {}, { throws: new TypeError("Failed to fetch") }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "network");
  });

  it("200 sin `flow` en el body -> ok:false, kind: unknown (nunca inventa un flow)", async () => {
    const result = await publishFlowVersion({
      flowId: "f1",
      versionId: "v3",
      accessToken: "tok",
      fetchImpl: mockFetch(200, {}),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "unknown");
  });

  it("500 genérico -> ok:false, kind: unknown", async () => {
    const result = await publishFlowVersion({
      flowId: "f1",
      versionId: "v3",
      accessToken: "tok",
      fetchImpl: mockFetch(500, { error: "Error inesperado" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "unknown");
  });
});

describe("fetchFlowVersions", () => {
  it("200 -> ok:true con la lista tal cual llega", async () => {
    const versions = [
      { id: "v2", version_number: 2, definition_json: {}, published_at: null },
      { id: "v1", version_number: 1, definition_json: {}, published_at: "2026-01-01T00:00:00Z" },
    ];
    const result = await fetchFlowVersions({
      flowId: "f1",
      accessToken: "tok",
      fetchImpl: mockFetch(200, { versions }),
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.versions, versions);
  });

  it("manda GET al endpoint correcto con Authorization", async () => {
    const capture: { input?: string; init?: RequestInit } = {};
    await fetchFlowVersions({
      flowId: "flow-xyz",
      accessToken: "tok-abc",
      fetchImpl: mockFetch(200, { versions: [] }, { capture }),
    });
    assert.equal(capture.input, "/api/flows/flow-xyz/versions");
    assert.equal((capture.init?.headers as Record<string, string>)?.Authorization, "Bearer tok-abc");
  });

  it("403 -> ok:false, kind: forbidden", async () => {
    const result = await fetchFlowVersions({
      flowId: "f1",
      accessToken: "tok",
      fetchImpl: mockFetch(403, { error: "No tienes permiso para esta acción" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "forbidden");
  });

  it("error de red -> ok:false, kind: network", async () => {
    const result = await fetchFlowVersions({
      flowId: "f1",
      accessToken: "tok",
      fetchImpl: mockFetch(0, {}, { throws: new Error("network down") }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "network");
  });

  it("200 sin `versions` en el body -> ok:false, kind: unknown (nunca inventa una lista)", async () => {
    const result = await fetchFlowVersions({
      flowId: "f1",
      accessToken: "tok",
      fetchImpl: mockFetch(200, {}),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "unknown");
  });
});
