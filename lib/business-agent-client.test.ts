/**
 * setBusinessAgentActiveOnNumber (Conectar/Desconectar) — SIEMPRE resuelve.
 *
 * Cubre el bug real del botón "Conectar": una petición que se estanca dejaba el
 * botón en spinner infinito y sin error. Ahora hay un timeout duro
 * (AbortController) y todos los caminos devuelven un resultado, así que el caller
 * puede apagar el loading y mostrar el error SIEMPRE. fetchImpl es inyectable.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createBusinessAgentService,
  deleteBusinessAgentService,
  listBusinessAgentServices,
  setBusinessAgentActiveOnNumber,
  updateBusinessAgentService,
} from "@/lib/business-agent-client";

const base = { accessToken: "tok", flowId: "flow-1", phoneNumberId: "111", active: true as const };

describe("setBusinessAgentActiveOnNumber — nunca cuelga", () => {
  it("petición que nunca responde => resuelve por timeout (no spinner infinito)", async () => {
    // fetch que solo se resuelve/rechaza al abortar (como el fetch real).
    const nunca = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
      })) as unknown as typeof fetch;
    const inicio = Date.now();
    const r = await setBusinessAgentActiveOnNumber({ ...base, fetchImpl: nunca, timeoutMs: 60 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /tard[oó] demasiado|conexi[oó]n/i);
    assert.ok(Date.now() - inicio < 5000, "debe resolver por el timeout, no colgarse");
  });

  it("200 => ok:true", async () => {
    const ok = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const r = await setBusinessAgentActiveOnNumber({ ...base, fetchImpl: ok });
    assert.equal(r.ok, true);
  });

  it("404 con body => devuelve el error del body (no cuelga, sí muestra error)", async () => {
    const nf = (async () =>
      new Response(JSON.stringify({ error: "Número no encontrado" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const r = await setBusinessAgentActiveOnNumber({ ...base, active: false, fetchImpl: nf });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "Número no encontrado");
  });

  it("error de red (throw) => resuelve con error, nunca lanza", async () => {
    const boom = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await setBusinessAgentActiveOnNumber({ ...base, fetchImpl: boom });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "network down");
  });

  it("llama al endpoint correcto según active (activate/deactivate)", async () => {
    const urls: string[] = [];
    const spy = ((input: unknown) => {
      urls.push(String(input));
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as unknown as typeof fetch;
    await setBusinessAgentActiveOnNumber({ ...base, active: true, fetchImpl: spy });
    await setBusinessAgentActiveOnNumber({ ...base, active: false, fetchImpl: spy });
    assert.ok(urls[0]?.endsWith("/api/flows/flow-1/activate"));
    assert.ok(urls[1]?.endsWith("/api/flows/flow-1/deactivate"));
  });
});

describe("servicios del Business Agent — CRUD (envelope + endpoints)", () => {
  it("list => GET /api/business-agent/services y parsea services", async () => {
    let url = "";
    const spy = ((input: unknown) => {
      url = String(input);
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { services: [{ id: "s1", nombre: "Manicure", categoria: null, descripcion: null, duracionMin: 30, precio: 30000, activo: true }] } }), { status: 200, headers: { "content-type": "application/json" } }));
    }) as unknown as typeof fetch;
    const r = await listBusinessAgentServices({ accessToken: "t", fetchImpl: spy });
    assert.ok(url.endsWith("/api/business-agent/services"));
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.data.services[0]?.precio, 30000);
  });

  it("create => POST con el body del servicio", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const spy = ((input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method, body: init?.body as string });
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { service: { id: "s2" } } }), { status: 201, headers: { "content-type": "application/json" } }));
    }) as unknown as typeof fetch;
    const r = await createBusinessAgentService({ accessToken: "t", input: { nombre: "Pedicure", duracionMin: 45, precio: 40000 }, fetchImpl: spy });
    assert.ok(r.ok);
    assert.equal(calls[0]?.method, "POST");
    assert.ok(calls[0]?.url.endsWith("/api/business-agent/services"));
    assert.match(calls[0]?.body ?? "", /Pedicure/);
  });

  it("update => PUT /api/business-agent/services/:id", async () => {
    let method = "";
    let url = "";
    const spy = ((input: unknown, init?: RequestInit) => {
      url = String(input);
      method = init?.method ?? "";
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { service: { id: "s3" } } }), { status: 200, headers: { "content-type": "application/json" } }));
    }) as unknown as typeof fetch;
    await updateBusinessAgentService({ accessToken: "t", id: "s3", input: { nombre: "Uñas", duracionMin: 120 }, fetchImpl: spy });
    assert.equal(method, "PUT");
    assert.ok(url.endsWith("/api/business-agent/services/s3"));
  });

  it("delete => DELETE /api/business-agent/services/:id", async () => {
    let method = "";
    let url = "";
    const spy = ((input: unknown, init?: RequestInit) => {
      url = String(input);
      method = init?.method ?? "";
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } }));
    }) as unknown as typeof fetch;
    const r = await deleteBusinessAgentService({ accessToken: "t", id: "s4", fetchImpl: spy });
    assert.ok(r.ok);
    assert.equal(method, "DELETE");
    assert.ok(url.endsWith("/api/business-agent/services/s4"));
  });
});
