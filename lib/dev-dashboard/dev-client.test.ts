/**
 * DuLabs Developer V1 -- Fase 9 (autorizado). Tests del cliente API central:
 * inyección de Authorization Bearer + X-Dulabs-Workspace, parseo de errores
 * uniformes, y clasificación (401/403/429/red). Con un fetch falso -- sin red.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDevClient, DevApiError } from "@/lib/dev-dashboard/dev-client";

type Llamada = { url: string; init: RequestInit };

function fakeFetch(respuesta: { status: number; body: unknown; requestId?: string }, capturas: Llamada[]) {
  return (async (url: string, init?: RequestInit) => {
    capturas.push({ url, init: init ?? {} });
    const headers = new Headers(respuesta.requestId ? { "X-Request-Id": respuesta.requestId } : {});
    return new Response(JSON.stringify(respuesta.body), { status: respuesta.status, headers });
  }) as unknown as typeof fetch;
}

describe("createDevClient -- headers e inyección de contexto", () => {
  it("envía Authorization Bearer y X-Dulabs-Workspace en las rutas de recurso", async () => {
    const capturas: Llamada[] = [];
    const client = createDevClient({ getToken: () => "tok-abc", getWorkspaceId: () => "ws-123", fetchImpl: fakeFetch({ status: 200, body: { apiKeys: [] } }, capturas) });
    await client.apiKeys.list();
    const h = new Headers(capturas[0].init.headers as HeadersInit);
    assert.equal(h.get("authorization"), "Bearer tok-abc");
    assert.equal(h.get("x-dulabs-workspace"), "ws-123");
    assert.match(capturas[0].url, /\/api\/developer\/api-keys$/);
  });

  it("el endpoint de workspace NO envía X-Dulabs-Workspace (para poder poblar el selector)", async () => {
    const capturas: Llamada[] = [];
    const client = createDevClient({ getToken: () => "tok", getWorkspaceId: () => "ws-123", fetchImpl: fakeFetch({ status: 200, body: { workspaces: [], selected: null } }, capturas) });
    await client.workspace();
    const h = new Headers(capturas[0].init.headers as HeadersInit);
    assert.equal(h.get("x-dulabs-workspace"), null);
  });

  it("sin token -> DevApiError unauthorized, sin tocar la red", async () => {
    const capturas: Llamada[] = [];
    const client = createDevClient({ getToken: () => null, getWorkspaceId: () => "ws", fetchImpl: fakeFetch({ status: 200, body: {} }, capturas) });
    await assert.rejects(() => client.usage(), (e: unknown) => e instanceof DevApiError && e.kind === "unauthorized");
    assert.equal(capturas.length, 0, "nunca debe llamar a fetch sin token");
  });

  it("parsea el envelope de error {error:{code,request_id}} y clasifica el kind", async () => {
    const capturas: Llamada[] = [];
    const client = createDevClient({ getToken: () => "t", getWorkspaceId: () => "ws", fetchImpl: fakeFetch({ status: 403, body: { error: { code: "forbidden", request_id: "dev_x" } } }, capturas) });
    await assert.rejects(
      () => client.members.create({ userId: "u", rol: "ADMIN" }),
      (e: unknown) => e instanceof DevApiError && e.kind === "forbidden" && e.code === "forbidden" && e.requestId === "dev_x"
    );
  });

  it("429 de cuota mensual -> kind quota", async () => {
    const client = createDevClient({ getToken: () => "t", getWorkspaceId: () => "ws", fetchImpl: fakeFetch({ status: 429, body: { error: { code: "monthly_message_limit_exceeded", request_id: "r" } } }, []) });
    await assert.rejects(() => client.usage(), (e: unknown) => e instanceof DevApiError && e.kind === "quota");
  });

  it("fallo de red -> kind network", async () => {
    const client = createDevClient({ getToken: () => "t", getWorkspaceId: () => "ws", fetchImpl: (async () => { throw new Error("boom"); }) as unknown as typeof fetch });
    await assert.rejects(() => client.usage(), (e: unknown) => e instanceof DevApiError && e.kind === "network");
  });

  it("POST envía el body serializado y Content-Type json", async () => {
    const capturas: Llamada[] = [];
    const client = createDevClient({ getToken: () => "t", getWorkspaceId: () => "ws", fetchImpl: fakeFetch({ status: 201, body: { id: "1", name: "k", prefix: "dl_live_x", createdAt: "now", apiKey: "dl_live_secret" } }, capturas) });
    await client.apiKeys.create("my-key");
    assert.equal(capturas[0].init.method, "POST");
    assert.equal(JSON.parse(capturas[0].init.body as string).name, "my-key");
    const h = new Headers(capturas[0].init.headers as HeadersInit);
    assert.equal(h.get("content-type"), "application/json");
  });
});
