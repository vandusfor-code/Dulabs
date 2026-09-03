/**
 * Etapa 6 (Flow Builder, autorizado) — tests de create-flow.ts. `fetchImpl`
 * inyectado (mismo patrón que save-flow.test.ts) -- nunca red real.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFlow, ensureInitialVersion, slugFromNombre } from "@/lib/flow-builder/create-flow";

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

describe("slugFromNombre", () => {
  it("normaliza acentos, minúsculas, separadores -- y agrega un sufijo temporal único", () => {
    const slug = slugFromNombre("  Bienvenida y Agendamiento! ");
    assert.match(slug, /^bienvenida-y-agendamiento-[0-9a-z]+$/);
  });

  it("nombre vacío tras limpiar -> cae en 'flow-<sufijo>'", () => {
    const slug = slugFromNombre("¡¡¡!!!");
    assert.match(slug, /^flow-[0-9a-z]+$/);
  });
});

describe("createFlow", () => {
  it("nombre vacío -> ok:false SIN llamar a fetch (invalid_name)", async () => {
    let llamado = false;
    const result = await createFlow({
      name: "   ",
      accessToken: "tok",
      fetchImpl: (async () => {
        llamado = true;
        return {} as Response;
      }) as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "invalid_name");
    assert.equal(llamado, false);
  });

  it("éxito (201, {flow, version}) -> ok:true con ambos", async () => {
    const flow = { id: "f1", slug: "x", name: "x", status: "draft" };
    const version = { id: "v1", flow_id: "f1", version_number: 1 };
    const result = await createFlow({
      name: "Mi Flow",
      accessToken: "tok",
      fetchImpl: mockFetch(201, { flow, version }),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.flow, flow);
      assert.deepEqual(result.version, version);
    }
  });

  it("201 sin 'version' en el body (contrato viejo) -> ok:false (nunca finge éxito a medias)", async () => {
    const result = await createFlow({
      name: "Mi Flow",
      accessToken: "tok",
      fetchImpl: mockFetch(201, { flow: { id: "f1" } }),
    });
    assert.equal(result.ok, false);
  });

  it("manda slug generado, name recortado, y el token en Authorization", async () => {
    const capture: { input?: string; init?: RequestInit } = {};
    await createFlow({
      name: "  Mi Flow  ",
      accessToken: "tok-abc",
      fetchImpl: mockFetch(201, { flow: {}, version: {} }, { capture }),
    });
    assert.equal(capture.input, "/api/flows");
    assert.equal(capture.init?.method, "POST");
    assert.equal((capture.init?.headers as Record<string, string>)?.Authorization, "Bearer tok-abc");
    const body = JSON.parse(capture.init!.body as string);
    assert.equal(body.name, "Mi Flow");
    assert.match(body.slug, /^mi-flow-[0-9a-z]+$/);
  });

  it("descripción vacía -> no se manda 'description' en el body", async () => {
    const capture: { init?: RequestInit } = {};
    await createFlow({
      name: "Mi Flow",
      description: "   ",
      accessToken: "tok",
      fetchImpl: mockFetch(201, { flow: {}, version: {} }, { capture }),
    });
    const body = JSON.parse(capture.init!.body as string);
    assert.equal("description" in body, false);
  });

  it("409 (slug duplicado) -> ok:false, kind: slug_conflict", async () => {
    const result = await createFlow({
      name: "Mi Flow",
      accessToken: "tok",
      fetchImpl: mockFetch(409, { error: 'Ya existe un Flow con el slug "x"' }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.kind, "slug_conflict");
      assert.equal(result.error.message, 'Ya existe un Flow con el slug "x"');
    }
  });

  it("403 -> ok:false, kind: forbidden", async () => {
    const result = await createFlow({ name: "x", accessToken: "tok", fetchImpl: mockFetch(403, { error: "no" }) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "forbidden");
  });

  it("fetch lanza (red caída) -> ok:false, kind: network", async () => {
    const result = await createFlow({
      name: "x",
      accessToken: "tok",
      fetchImpl: mockFetch(0, {}, { throws: new Error("boom") }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "network");
  });
});

describe("ensureInitialVersion", () => {
  it("éxito (200 o 201, {version}) -> ok:true", async () => {
    const version = { id: "v1", flow_id: "f1", version_number: 1 };
    const result = await ensureInitialVersion({ flowId: "f1", accessToken: "tok", fetchImpl: mockFetch(200, { version }) });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.version, version);
  });

  it("manda POST sin body a /api/flows/[id]/initial-version", async () => {
    const capture: { input?: string; init?: RequestInit } = {};
    await ensureInitialVersion({
      flowId: "f1",
      accessToken: "tok-xyz",
      fetchImpl: mockFetch(201, { version: {} }, { capture }),
    });
    assert.equal(capture.input, "/api/flows/f1/initial-version");
    assert.equal(capture.init?.method, "POST");
    assert.equal((capture.init?.headers as Record<string, string>)?.Authorization, "Bearer tok-xyz");
  });

  it("404 (Flow no encontrado) -> ok:false, kind: not_found", async () => {
    const result = await ensureInitialVersion({
      flowId: "f1",
      accessToken: "tok",
      fetchImpl: mockFetch(404, { error: "Flow no encontrado" }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "not_found");
  });

  it("403 -> ok:false, kind: forbidden", async () => {
    const result = await ensureInitialVersion({ flowId: "f1", accessToken: "tok", fetchImpl: mockFetch(403, { error: "no" }) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "forbidden");
  });
});
