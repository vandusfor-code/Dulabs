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
import { setBusinessAgentActiveOnNumber } from "@/lib/business-agent-client";

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
