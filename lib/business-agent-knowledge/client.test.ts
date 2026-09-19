/**
 * R4 — wrappers de cliente del conocimiento (fetch inyectado, sin red):
 * URL/método/headers correctos, multipart SIN Content-Type manual, JSON para FAQ,
 * mapeo de errores del envelope y respuesta de red caída.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createBusinessAgentFaq,
  deleteBusinessAgentDocument,
  deleteBusinessAgentFaq,
  getBusinessAgentKnowledge,
  searchBusinessAgentKnowledge,
  updateBusinessAgentFaq,
  uploadBusinessAgentDocument,
} from "@/lib/business-agent-client";

interface Llamada {
  url: string;
  init: RequestInit;
}
function fakeFetch(respuesta: { ok?: boolean; status?: number; body: unknown }, llamadas: Llamada[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return { ok: respuesta.ok ?? true, status: respuesta.status ?? 200, json: async () => respuesta.body } as Response;
  }) as unknown as typeof fetch;
}
const ok = (data: unknown) => ({ body: { success: true, data } });
const auth = { accessToken: "tok" };
const header = (init: RequestInit, k: string) => (init.headers as Record<string, string>)[k];

describe("R4 cliente del conocimiento", () => {
  it("1. GET resumen: URL, Bearer y sin Content-Type", async () => {
    const calls: Llamada[] = [];
    const r = await getBusinessAgentKnowledge({ ...auth, fetchImpl: fakeFetch(ok({ faqs: [], documents: [], limits: {} }), calls) });
    assert.ok(r.ok);
    assert.equal(calls[0]!.url, "/api/business-agent/knowledge");
    assert.equal(header(calls[0]!.init, "Authorization"), "Bearer tok");
    assert.equal(header(calls[0]!.init, "Content-Type"), undefined);
  });

  it("2. FAQ: crear (POST JSON), editar (PUT con id codificado) y eliminar (DELETE)", async () => {
    const calls: Llamada[] = [];
    const f = fakeFetch(ok({ faq: { id: "x" }, warnings: [] }), calls);
    await createBusinessAgentFaq({ ...auth, fetchImpl: f, input: { question: "¿Horario?", answer: "8 a 6" } });
    await updateBusinessAgentFaq({ ...auth, fetchImpl: f, id: "a/b c", input: { question: "¿Horario?", answer: "8 a 6", active: false } });
    await deleteBusinessAgentFaq({ ...auth, fetchImpl: fakeFetch(ok({ ok: true }), calls), id: "abc" });
    assert.deepEqual(
      calls.map((c) => [c.init.method, c.url]),
      [
        ["POST", "/api/business-agent/knowledge/faqs"],
        ["PUT", "/api/business-agent/knowledge/faqs/a%2Fb%20c"],
        ["DELETE", "/api/business-agent/knowledge/faqs/abc"],
      ],
    );
    assert.equal(header(calls[0]!.init, "Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { question: "¿Horario?", answer: "8 a 6", active: false });
  });

  it("3. documento: subida multipart con el campo 'archivo' y SIN Content-Type manual (el navegador pone el boundary); eliminar por id", async () => {
    const calls: Llamada[] = [];
    const file = new File([Buffer.from("hola")], "politicas.txt", { type: "text/plain" });
    const r = await uploadBusinessAgentDocument({ ...auth, fetchImpl: fakeFetch(ok({ document: { id: "d1" } }), calls), file });
    assert.ok(r.ok);
    assert.equal(calls[0]!.url, "/api/business-agent/knowledge/documents");
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal(header(calls[0]!.init, "Content-Type"), undefined);
    assert.ok(calls[0]!.init.body instanceof FormData);
    assert.equal(((calls[0]!.init.body as FormData).get("archivo") as File).name, "politicas.txt");
    await deleteBusinessAgentDocument({ ...auth, fetchImpl: fakeFetch(ok({ ok: true }), calls), id: "d1" });
    assert.equal(calls[1]!.url, "/api/business-agent/knowledge/documents/d1");
    assert.equal(calls[1]!.init.method, "DELETE");
  });

  it("4. 'Probar': POST JSON con la consulta", async () => {
    const calls: Llamada[] = [];
    const r = await searchBusinessAgentKnowledge({ ...auth, fetchImpl: fakeFetch(ok({ found: true, emptyQuery: false, hits: [] }), calls), query: "¿Cancelaciones?" });
    assert.ok(r.ok);
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { query: "¿Cancelaciones?" });
  });

  it("5. errores del envelope y de red se devuelven tipados (nunca lanzan)", async () => {
    const calls: Llamada[] = [];
    const e = await uploadBusinessAgentDocument({
      ...auth,
      file: new File(["x"], "a.pdf"),
      fetchImpl: fakeFetch({ ok: false, status: 409, body: { success: false, error: { code: "DUPLICATE", message: "Este contenido ya está cargado." } } }, calls),
    });
    assert.ok(!e.ok && e.error.code === "DUPLICATE" && e.error.status === 409 && /ya está cargado/.test(e.error.message));
    const red = await getBusinessAgentKnowledge({
      ...auth,
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    assert.ok(!red.ok && red.error.code === "NETWORK_ERROR");
  });
});
