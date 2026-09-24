/**
 * Bloque 10 — búsqueda escalable del agente (miles de referencias).
 *
 * La búsqueda real es dulabs_catalogo_buscar (texto completo en español en la BD; su
 * prueba SQL con ~2.000 productos está en supabase/tests). Aquí: el contrato de la
 * resolución y de las herramientas contra el repositorio en memoria, que emula las
 * mismas reglas. Gemini SIMULADO; nada toca Supabase ni Gemini.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { formatCop } from "@/lib/business-agent-quote";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createResolucionCatalogo } from "@/lib/catalogo/resolucion";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import type { AIGenerateRequest, AITurn } from "@/lib/ia-proveedores/contrato";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { createMemoryConversationStateStore, type ConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn, type AgentTurnTrace } from "@/lib/agente/runtime";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const CLIENTE = "573001112233";

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let resolucion: ReturnType<typeof createResolucionCatalogo>;
let stateStore: ConversationStateStore;
let sent: string[];
let seq: number;

const configRow = (over: Partial<AgentConfigRow> = {}): AgentConfigRow => ({
  id_tenant: A.tenantId,
  phone_number_id: PN_A,
  tipo: "catalog_sales",
  habilitado: true,
  proveedor: "gemini",
  modelo: "gemini-3.6-flash",
  credencial_ref: "env:GEMINI_KEY_DELACOUR",
  nivel_razonamiento: "low",
  herramientas: [...AGENT_TOOL_NAMES],
  canal: "retail",
  negocio: {},
  ...over,
});
const cfg = (over: Partial<AgentConfigRow> = {}) => (parseAgentConfig(configRow(over), { tenantId: A.tenantId, phoneNumberId: PN_A }) as { config: AgentRuntimeConfig }).config;

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  resolucion = createResolucionCatalogo({ repo: mem.repo });
  stateStore = createMemoryConversationStateStore();
  sent = [];
  seq = 0;
  for (const actor of [A, B]) mem.enableModule(actor.tenantId);
});

const producto = (actor: CatalogActor, name: string, retail: number, stock: number, extra: { wholesale?: number; color?: string; material?: string; description?: string; categoryId?: string; status?: "INACTIVE" } = {}) =>
  admin.createProduct(actor, { name, retailPrice: retail, wholesalePrice: extra.wholesale ?? null, stock, color: extra.color, material: extra.material, description: extra.description, categoryId: extra.categoryId });

async function turno(script: SimulatedStep[], text: string, over: { config?: AgentRuntimeConfig } = {}) {
  const provider = createSimulatedProvider(script);
  const engine = createOrderEngine({ orders: createMemoryOrdersRepository(), catalog: mem.repo, key: Buffer.alloc(32, 5), log: () => {} });
  const r = await runAgentTurn(
    {
      config: over.config ?? cfg(),
      provider,
      model: "gemini-3.6-flash",
      tools: { engine, catalog: mem.repo, log: () => {}, ownsPhoneNumber: async () => true, siteUrl: () => "https://dulabs.test" },
      state: stateStore,
      history: { recent: async () => [] },
      sender: { sendText: async (t) => (sent.push(t), true), sendImage: async () => true, humanTookOver: async () => false },
      log: () => {},
      now: () => Date.parse("2026-09-24T15:00:00Z"),
    },
    { tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE, wamid: `wamid.b10.${++seq}`, text },
  );
  return { ...r, provider };
}
const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });
const estado = async (): Promise<ConversationState> => (await stateStore.load({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE })).state;
function salida(req: AIGenerateRequest) {
  const t = [...req.turns].reverse().find((x): x is Extract<AITurn, { role: "tool" }> => x.role === "tool");
  return t?.results[0]?.output as { count: number; total: number; has_more: boolean; relaxed: boolean; page_start: number; candidates: Array<{ reference: string; name: string; unit_price: number }>; note: string; error?: { code: string } };
}
const results = (r: { trace: AgentTurnTrace }) => r.trace.tool_calls.map((t) => t.result);
const nombres = (xs: Array<{ name: string }>) => xs.map((x) => x.name);

describe("resolución: búsqueda indexada (contrato)", () => {
  it("sin tildes, plural/singular, varias palabras no contiguas, color/material/categoría/descripción", async () => {
    const aretes = await admin.createCategory(A, { name: "Aretes" });
    await producto(A, "Arete Luna", 45_000, 5, { color: "Dorado", material: "Oro laminado", categoryId: aretes.id });
    await producto(A, "Argolla grande", 52_000, 5, { color: "Dorado", categoryId: aretes.id });
    await producto(A, "Dije Corazón", 38_000, 5, { color: "Plateado", description: "Con circón" });
    await producto(A, "Pulsera tejida", 30_000, 5, { description: "Hecha a mano en hilo" });
    const buscar = async (query: string) => nombres((await resolucion.buscarCatalogo(A.tenantId, { query, channel: "retail", limit: 20 })).candidates);
    assert.deepEqual(await buscar("corazon"), ["Dije Corazón"]);
    assert.deepEqual((await buscar("aretes")).sort(), ["Arete Luna", "Argolla grande"], "plural y categoría 'Aretes'");
    assert.deepEqual(await buscar("aretes dorados oro"), ["Arete Luna"]);
    assert.deepEqual(await buscar("hecha a mano"), ["Pulsera tejida"]);
  });

  it("modo relajado: sin coincidencia con todas las palabras => alguna, marcado 'relaxed'", async () => {
    await producto(A, "Arete Luna", 45_000, 5);
    const r = await resolucion.buscarCatalogo(A.tenantId, { query: "aretes rubí", channel: "retail" });
    assert.equal(r.relaxed, true);
    assert.deepEqual(nombres(r.candidates), ["Arete Luna"]);
  });

  it("filtros y precio DEL CANAL en la BD (no después de traer 10)", async () => {
    for (let i = 0; i < 30; i++) await producto(A, `Anillo negro ${i}`, 20_000, 5, { color: "Negro" });
    await producto(A, "Anillo plateado", 58_000, 5, { color: "Plateado", wholesale: 32_000 });
    const plateado = await resolucion.buscarCatalogo(A.tenantId, { query: "anillo", channel: "retail", color: "plateado" });
    assert.deepEqual(nombres(plateado.candidates), ["Anillo plateado"], "el filtro se aplica sobre TODO el catálogo, no sobre una página");
    assert.equal((await resolucion.buscarCatalogo(A.tenantId, { query: "anillo plateado", channel: "retail", maxPrice: 40_000, mode: "all" })).total, 0, "detal: $58.000 > tope");
    assert.equal((await resolucion.buscarCatalogo(A.tenantId, { query: "anillo plateado", channel: "wholesale", maxPrice: 40_000, mode: "all" })).total, 1, "mayor: $32.000 <= tope");
    // Sin modo forzado, lo que no cumple TODO se relaja y se marca (el agente dice que son los más cercanos).
    const relajado = await resolucion.buscarCatalogo(A.tenantId, { query: "anillo plateado", channel: "retail", maxPrice: 40_000 });
    assert.equal(relajado.relaxed, true);
    assert.ok(!relajado.candidates.some((c) => c.name === "Anillo plateado"), "el filtro de precio nunca se relaja");
    assert.ok(mem.searchCalls.some((q) => q.channel === "wholesale" && q.maxPrice === 40_000 && q.color === null), "canal y tope viajan a la BD");
  });

  it("aislamiento, solo activos, referencia exacta y paginación sin solaparse", async () => {
    await producto(B, "Anillo de otro negocio", 99_000, 5);
    const inactivo = await producto(A, "Anillo retirado", 10_000, 5);
    await admin.updateProduct(A, inactivo.id, { status: "INACTIVE" });
    const refs: string[] = [];
    for (let i = 0; i < 12; i++) refs.push((await producto(A, `Anillo ${i}`, 10_000 + i, 5)).reference);
    const p1 = await resolucion.buscarCatalogo(A.tenantId, { query: "anillo", channel: "retail", limit: 5, offset: 0 });
    const p2 = await resolucion.buscarCatalogo(A.tenantId, { query: "anillo", channel: "retail", limit: 5, offset: 5 });
    assert.equal(p1.total, 12);
    assert.equal(
      p1.candidates.filter((c) => p2.candidates.some((d) => d.reference === c.reference)).length,
      0,
    );
    assert.ok(![...p1.candidates, ...p2.candidates].some((c) => c.name.includes("otro negocio") || c.name.includes("retirado")));
    assert.deepEqual(nombres((await resolucion.buscarCatalogo(A.tenantId, { query: refs[3].toLowerCase(), channel: "retail" })).candidates), ["Anillo 3"]);
  });

  it("sin la migración de búsqueda: usa la búsqueda anterior (indexed:false), nunca falla", async () => {
    await producto(A, "Anillo solitario", 58_000, 5);
    mem.setSearchEnabled(false);
    const r = await resolucion.buscarCatalogo(A.tenantId, { query: "anillo", channel: "retail" });
    assert.equal(r.indexed, false);
    assert.deepEqual(nombres(r.candidates), ["Anillo solitario"]);
  });
});

describe("herramientas: búsqueda paginada, más resultados y parecidos", () => {
  it("con 2.000 productos el modelo recibe solo 5 candidatos, el total y si hay más (nunca el catálogo)", async () => {
    const categoria = await admin.createCategory(A, { name: "Aretes" });
    for (let i = 0; i < 2000; i++) {
      const tipo = ["Arete", "Anillo", "Pulsera", "Dije", "Cadena"][i % 5];
      await producto(A, `${tipo} modelo ${i}`, 10_000 + (i % 40) * 1_000, i % 6, { color: ["Dorado", "Plateado", "Negro"][i % 3], categoryId: tipo === "Arete" ? categoria.id : undefined });
    }
    const r = await turno([call("search_products", { query: "aretes dorados" }), { text: "Tengo varias opciones." }], "quiero ver aretes dorados");
    const out = salida(r.provider.requests[1]);
    assert.equal(out.count, 5);
    assert.ok(out.total > 100 && out.total < 400, `total ${out.total}`);
    assert.equal(out.has_more, true);
    assert.ok(out.candidates.every((c) => /^Arete/.test(c.name)));
    const bytes = JSON.stringify(r.provider.requests.at(-1)).length;
    assert.ok(bytes < 30_000, `el contexto no crece con el catálogo (${bytes} bytes)`);
  });

  it("'muéstrame más': página siguiente de la MISMA búsqueda, sin repetir; 'el segundo' es de la página nueva; al final, sugiere el catálogo", async () => {
    for (let i = 0; i < 12; i++) await producto(A, `Dije ${i}`, 20_000 + i * 1_000, 5);
    await producto(A, "Pulsera sin relación", 10_000, 5);
    const r1 = await turno([call("search_products", { query: "dije" }), { text: "Opciones." }], "quiero un dije");
    const p1 = salida(r1.provider.requests[1]).candidates.map((c) => c.reference);
    const r2 = await turno([call("more_products"), { text: "Más opciones." }], "muéstrame más");
    const o2 = salida(r2.provider.requests[1]);
    assert.equal(o2.page_start, 6);
    assert.equal(o2.candidates.filter((c) => p1.includes(c.reference)).length, 0, "no repite");
    assert.ok(o2.candidates.every((c) => c.name.startsWith("Dije")), "la misma búsqueda (el modelo no la puede cambiar)");
    const s = await estado();
    assert.deepEqual(
      s.lastShown.map((x) => x.reference),
      o2.candidates.map((c) => c.reference),
    );
    await turno([call("more_products"), { text: "Las últimas." }], "otros");
    const fin = await turno([call("more_products"), { text: "Eso es todo; te comparto el catálogo." }], "más");
    const ofin = salida(fin.provider.requests[1]);
    assert.equal(ofin.count, 0);
    assert.match(ofin.note, /get_catalog_link/);
  });

  it("'muéstrame más' sin búsqueda previa => NOT_FOUND (el modelo no inventa la consulta)", async () => {
    const r = await turno([call("more_products"), { text: "¿Qué estás buscando?" }], "muéstrame más");
    assert.deepEqual(results(r), ["NOT_FOUND"]);
  });

  it("'¿tienes algo parecido?': misma categoría primero, sin el producto base; exige que ya se haya mostrado", async () => {
    const collares = await admin.createCategory(A, { name: "Collares" });
    const base = await producto(A, "Cadena veneciana", 90_000, 5, { color: "Dorado", categoryId: collares.id });
    await producto(A, "Cadena rolo", 70_000, 5, { color: "Dorado", categoryId: collares.id });
    await producto(A, "Cadena de reloj", 20_000, 5, { color: "Dorado" });
    const antes = await turno([call("similar_products", { reference: base.reference }), { text: "¿De cuál producto?" }], "algo parecido");
    assert.deepEqual(results(antes), ["REFERENCE_NOT_ALLOWED"]);
    await turno([call("resolve_product_by_reference", { reference: base.reference }), { text: `Cadena veneciana: ${formatCop(90_000)}.` }], base.reference);
    const r = await turno([call("similar_products", { reference: base.reference }), { text: "Te muestro opciones parecidas." }], "¿tienes algo parecido?");
    const out = salida(r.provider.requests[1]);
    assert.deepEqual(nombres(out.candidates), ["Cadena rolo"], "misma categoría, sin el base");
    // Sin nada más en su categoría: busca en todo el catálogo.
    await turno([call("similar_products", { reference: base.reference }), { text: "…" }], "otra parecida");
    await admin.updateProduct(A, (await mem.repo.getProductByReference(A.tenantId, out.candidates[0].reference))!.id, { status: "INACTIVE" });
    const r3 = await turno([call("similar_products", { reference: base.reference }), { text: "…" }], "otra");
    assert.deepEqual(nombres(salida(r3.provider.requests[1]).candidates), ["Cadena de reloj"]);
  });

  it("filtros del modelo van a la BD con el canal de la CONVERSACIÓN (el modelo no puede pasar el canal)", async () => {
    await producto(A, "Anillo solitario", 58_000, 5, { wholesale: 32_000 });
    const r = await turno([call("search_products", { query: "anillo", max_price: 40_000 }), { text: "…" }], "anillo barato", { config: cfg({ canal: "wholesale" }) });
    const out = salida(r.provider.requests[1]);
    assert.deepEqual(
      out.candidates.map((c) => c.unit_price),
      [32_000],
      "precio mayorista en una conversación mayorista",
    );
    assert.equal(mem.searchCalls.at(-1)!.channel, "wholesale");
    const trampa = await turno([call("search_products", { query: "anillo", channel: "retail" }), { text: "…" }], "anillo");
    assert.deepEqual(results(trampa), ["INVALID_INPUT"]);
  });
});
