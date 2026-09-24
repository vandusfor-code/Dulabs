/**
 * Bloque 13 — trazas persistentes del agente: qué se guarda (y qué NUNCA), errores de envío
 * de Meta en la traza, errores de frontera, tope de tamaño y que el guardado se espere.
 * Gemini SIMULADO; nada toca Supabase (la función SQL de diagnóstico tiene su prueba SQL).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCatalogService } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { contactRef } from "@/lib/catalogo/pedidos/log";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { createMemoryAgentConfigStore, parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { createMemoryConversationStateStore } from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn, type AgentSender, type AgentTurnTrace } from "@/lib/agente/runtime";
import { boundaryRecord, createMemoryTraceSink, sanitizeTurnTrace, turnRecord } from "@/lib/agente/trazas";
import { atenderConAgenteSiAplica } from "@/lib/agente/webhook";

const T = "aaaaaaaa-0000-4000-8000-00000000000a";
const PN = "100000000000001";
const CLIENTE = "573001112233";
const row = (over: Partial<AgentConfigRow> = {}): AgentConfigRow => ({
  id_tenant: T,
  phone_number_id: PN,
  tipo: "catalog_sales",
  habilitado: true,
  proveedor: "gemini",
  modelo: "gemini-3.6-flash",
  credencial_ref: "env:GEMINI_KEY_DELACOUR",
  nivel_razonamiento: null,
  herramientas: [...AGENT_TOOL_NAMES],
  canal: "retail",
  negocio: {},
  ...over,
});
const cfg = () => (parseAgentConfig(row(), { tenantId: T, phoneNumberId: PN }) as { config: AgentRuntimeConfig }).config;

async function turno(script: SimulatedStep[], text: string, sender: Partial<AgentSender> = {}) {
  const mem = createInMemoryCatalogRepository();
  mem.enableModule(T);
  const admin = createCatalogService({ repo: mem.repo });
  const p = await admin.createProduct({ tenantId: T, userId: "a" }, { name: "Arete Luna", retailPrice: 45_000, stock: 5 });
  await mem.repo.attachMedia(T, "a", { productId: p.id, storagePath: `${T}/${p.id}/f.webp`, thumbPath: null, mimeType: "image/webp", bytes: 10, width: 800, height: 800, makePrimary: true });
  await mem.repo.insertPublication(T, "joyeria", "Joyería");
  const traces: AgentTurnTrace[] = [];
  const engine = createOrderEngine({ orders: createMemoryOrdersRepository(), catalog: mem.repo, key: Buffer.alloc(32, 2), log: () => {} });
  await runAgentTurn(
    {
      config: cfg(),
      provider: createSimulatedProvider(typeof script === "function" ? script : script),
      model: "gemini-3.6-flash",
      tools: { engine, catalog: mem.repo, log: () => {}, ownsPhoneNumber: async () => true, siteUrl: () => "https://dulabs.test" },
      state: createMemoryConversationStateStore(),
      history: { recent: async () => [] },
      sender: { sendText: async () => ({ sent: true, wamid: "wamid.out.1" }), sendImage: async () => ({ sent: true, wamid: "wamid.img.1" }), humanTookOver: async () => false, ...sender },
      log: (t) => traces.push(t),
    },
    { tenantId: T, phoneNumberId: PN, waId: CLIENTE, wamid: "wamid.in.1", text },
  );
  return { trace: traces[0], product: p };
}
const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });

describe("trazas: qué se guarda y qué nunca", () => {
  it("la traza persistida permite reconstruir el turno y NO lleva teléfono, texto del cliente ni secretos", async () => {
    const texto = "Hola, soy Laura, mi número es 3001112233 y mi dirección es Calle 10 #20-30; busco aretes";
    const { trace, product } = await turno([call("search_products", { query: "aretes" }), call("request_product_images", { references: ["DL-000001"] }), { text: "Te envío la foto." }], texto);
    const rec = turnRecord(trace, PN);
    const json = JSON.stringify(rec);
    assert.equal(rec.contactRef, contactRef(CLIENTE));
    for (const sensible of [CLIENTE, "3001112233", "Laura", "Calle 10", "busco aretes", "GEMINI_KEY", product.id, T + "/"]) assert.ok(!json.includes(sensible), `no debe contener: ${sensible}`);
    const t = rec.trace as { input: unknown; context: unknown; stage: unknown; tool_calls: Array<{ name: string; result: string; args: unknown }>; delivery: unknown; sent: boolean };
    assert.deepEqual(t.input, { wamids: ["wamid.in.1"], messages: 1, chars: texto.length });
    assert.deepEqual(t.context, { channel: "retail", cart_lines: 0, open_options: 0, proposal_presented: false, active_order: null });
    assert.deepEqual(t.stage, { start: "inicio", end: "explorando" });
    assert.deepEqual(
      t.tool_calls.map((c: { name: string; result: string }) => `${c.name}:${c.result}`),
      ["search_products:ok", "request_product_images:ok"],
    );
    assert.deepEqual(t.tool_calls[0].args, { query: "<text:6>" }, "argumentos de texto libre: solo su largo");
    assert.deepEqual(t.delivery, { text_wamid: "wamid.out.1", text_error: null, images: [{ reference: "DL-000001", wamid: "wamid.img.1", recorded: false }] });
    assert.equal(t.sent, true);
  });

  it("el rechazo de Meta queda en la traza con su código (sin el token ni el texto)", async () => {
    const { trace } = await turno([call("search_products", { query: "aretes" }), call("request_product_images", { references: ["DL-000001"] }), { text: "Te envío la foto." }], "aretes", {
      sendImage: async () => ({ sent: false, wamid: null, error: "meta_rejected 400/131053" }),
    });
    assert.deepEqual(trace.delivery.images, [{ reference: "DL-000001", wamid: null, recorded: false, error: "meta_rejected 400/131053" }]);
    const fallo = await turno([{ text: "Hola" }], "hola", { sendText: async () => ({ sent: false, wamid: null, error: "no_meta_token" }) });
    assert.deepEqual([fallo.trace.sent, fallo.trace.delivery.text_error], [false, "no_meta_token"]);
  });

  it("solo claves conocidas y tamaño acotado", async () => {
    const { trace } = await turno([{ text: "Hola" }], "hola");
    const raro = { ...trace, algo_inesperado: "x", tool_calls: Array.from({ length: 200 }, (_, i) => ({ name: `t${i}`, result: "ok", ms: 1, args: { a: "x".repeat(300) } })) } as AgentTurnTrace;
    const s = sanitizeTurnTrace(raro);
    assert.equal("algo_inesperado" in s, false);
    assert.ok(JSON.stringify(s).length < 32_768);
    assert.equal((s.tool_calls as unknown[]).length, 20);
    assert.equal("args" in (s.tool_calls as Array<Record<string, unknown>>)[0], false);
  });

  it("errores de frontera (p. ej. falta la credencial) se guardan con el motivo, y la frontera ESPERA el guardado", async () => {
    const sink = createMemoryTraceSink();
    let released!: () => void;
    const slow = new Promise<void>((r) => (released = r));
    const pending: Promise<void>[] = [];
    let done = false;
    const r = atenderConAgenteSiAplica(
      { cliente: { id_tenant: T, phone_number_id: PN }, waId: CLIENTE, destino: CLIENTE, wamid: "wamid.x", text: "hola" },
      {
        configStore: createMemoryAgentConfigStore([row({ credencial_ref: "env:GEMINI_KEY_NO_EXISTE" })]),
        env: {},
        logError: (entry) => {
          pending.push(slow.then(() => sink.record(boundaryRecord(entry, { tenantId: T, phoneNumberId: PN, contactRef: entry.contact_ref as string, wamid: null }))));
        },
        flush: async () => {
          await Promise.all(pending);
        },
        build: () => null,
      },
    ).then((x) => ((done = true), x));
    await new Promise((res) => setImmediate(res));
    assert.equal(done, false, "no termina mientras la traza no se haya guardado");
    released();
    assert.deepEqual(await r, { handled: true, outcome: "invalid_config", reason: "credential_missing" });
    assert.equal(sink.records.length, 1);
    assert.deepEqual(sink.records[0], { tenantId: T, phoneNumberId: PN, contactRef: contactRef(CLIENTE), wamid: null, kind: "boundary", result: "invalid_config", trace: { result: "invalid_config", reason: "credential_missing", provider: "gemini" } });
  });
});
