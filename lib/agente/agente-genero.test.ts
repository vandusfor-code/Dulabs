/**
 * El agente y el «para quién» (Hombre / Mujer) de la tienda de joyería.
 *
 * Una tienda que separa Hombre y Mujer (Delacour · Vértice) tiene piezas de los dos lados en el MISMO catálogo. Sin esto el agente mezclaba todo: pedirle un anillo «para mi novio» traía anillos de
 * mujer. Aquí, con el catálogo, los pedidos y la memoria en memoria y Gemini SIMULADO (nada toca Supabase ni Gemini):
 *   - `genero` en la búsqueda (hombre = solo esas piezas; mujer = todo menos ellas), «muéstrame más» en el mismo lado, parecidos del MISMO lado, el campo `para` y el enlace de la colección de hombre;
 *   - lo que NO debe cambiar: en un negocio que no separa (o sin la migración, o sin piezas de hombre) las declaraciones del modelo, las salidas y el estado son EXACTAMENTE los de siempre, y ni
 *     siquiera se leen las piezas de hombre.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createResolucionCatalogo } from "@/lib/catalogo/resolucion";
import { HOMBRES_BUSQUEDA_MAX, hombresDelNegocio } from "@/lib/catalogo/genero-negocio";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import type { AIGenerateRequest, AITurn } from "@/lib/ia-proveedores/contrato";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { createMemoryConversationStateStore, type ConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import { agentToolDeclarations } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn, type AgentTurnTrace } from "@/lib/agente/runtime";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN: Record<string, string> = { [A.tenantId]: "100000000000001", [B.tenantId]: "100000000000002" };
const CLIENTE = "573001112233";

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let stateStore: ConversationStateStore;
let sent: string[];
let seq: number;
let dijesA: string;
let anillosA: string;
/** Referencias de las piezas de hombre del negocio A, y las de mujer. */
let hombresA: string[];
let mujeresA: string[];

const configRow = (actor: CatalogActor, over: Partial<AgentConfigRow> = {}): AgentConfigRow => ({
  id_tenant: actor.tenantId,
  phone_number_id: PN[actor.tenantId],
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
const cfg = (actor: CatalogActor = A, over: Partial<AgentConfigRow> = {}) => (parseAgentConfig(configRow(actor, over), { tenantId: actor.tenantId, phoneNumberId: PN[actor.tenantId] }) as { config: AgentRuntimeConfig }).config;

const nuevo = (actor: CatalogActor, name: string, o: { cat?: string; material?: string; color?: string; retail?: number; wholesale?: number | null } = {}) =>
  admin.createProduct(actor, { name, categoryId: o.cat, material: o.material, color: o.color, retailPrice: o.retail ?? 20_000, wholesalePrice: o.wholesale ?? null, stock: 10 });

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  stateStore = createMemoryConversationStateStore();
  sent = [];
  seq = 0;
  // A se llama «Delacour»: su tienda es la de la configuración real (slug «delacour»), que SÍ separa Hombre y Mujer. B es otro negocio: su tienda no separa.
  mem.setProfile(A.tenantId, { name: "Delacour", whatsapp: "573001110000" });
  mem.setProfile(B.tenantId, { name: "Otra Joyería", whatsapp: "573009990000" });
  for (const actor of [A, B]) {
    mem.enableModule(actor.tenantId);
    await admin.ensurePublication(actor);
  }
  anillosA = (await admin.createCategory(A, { name: "Anillos" })).id;
  dijesA = (await admin.createCategory(A, { name: "Dijes" })).id;
  const mujeres = [
    await nuevo(A, "Anillo rodio", { cat: anillosA, material: "Rodio", color: "Dorado", retail: 25_000, wholesale: 15_000 }),
    await nuevo(A, "Anillo plata", { cat: anillosA, material: "Plata 925", color: "Plateado", retail: 35_000 }),
    await nuevo(A, "Dije corazón", { cat: dijesA, material: "Rodio", color: "Dorado", retail: 18_000 }),
  ];
  // Piezas de hombre (como Vértice: dijes de acero y un anillo), 8 dijes para que «muéstrame más» tenga segunda página.
  const hombres = [await nuevo(A, "Anillo hombre acero", { cat: anillosA, material: "Acero", color: "Negro", retail: 30_000 })];
  for (let i = 1; i <= 8; i++) hombres.push(await nuevo(A, `Santo ${i} · 25111${i}`, { cat: dijesA, material: "Acero", retail: 10_000 + i * 1_000 }));
  for (const p of hombres) mem.setGeneroDirecto(p.id, "hombre");
  hombresA = hombres.map((p) => p.reference);
  mujeresA = mujeres.map((p) => p.reference);
  // B no separa: aunque una pieza suya figure «de hombre» en la base, su agente NO la trata distinto.
  const delOtro = await nuevo(B, "Anillo del otro negocio", { material: "Acero" });
  mem.setGeneroDirecto(delOtro.id, "hombre");
});

async function turno(script: SimulatedStep[], text: string, over: { actor?: CatalogActor; config?: AgentRuntimeConfig } = {}) {
  const actor = over.actor ?? A;
  const provider = createSimulatedProvider(script);
  const engine = createOrderEngine({ orders: createMemoryOrdersRepository(), catalog: mem.repo, key: Buffer.alloc(32, 7), log: () => {} });
  const r = await runAgentTurn(
    {
      config: over.config ?? cfg(actor),
      provider,
      model: "gemini-3.6-flash",
      tools: { engine, catalog: mem.repo, log: () => {}, ownsPhoneNumber: async () => true, siteUrl: () => "https://dulabs.test" },
      state: stateStore,
      history: { recent: async () => [] },
      sender: { sendText: async (t) => (sent.push(t), true), sendImage: async () => true, humanTookOver: async () => false },
      log: () => {},
      now: () => Date.parse("2026-09-24T15:00:00Z"),
    },
    { tenantId: actor.tenantId, phoneNumberId: PN[actor.tenantId], waId: CLIENTE, wamid: `wamid.genero.${++seq}`, text },
  );
  return { ...r, provider };
}
const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });
const estado = async (actor: CatalogActor = A): Promise<ConversationState> => (await stateStore.load({ tenantId: actor.tenantId, phoneNumberId: PN[actor.tenantId], waId: CLIENTE })).state;
type Candidato = { reference: string; name: string; para?: string };
type Salida = { count: number; total: number; has_more: boolean; relaxed: boolean; candidates: Candidato[]; url?: string; kind?: string; genero?: string; error?: { code: string } };
function salida(req: AIGenerateRequest): Salida {
  const t = [...req.turns].reverse().find((x): x is Extract<AITurn, { role: "tool" }> => x.role === "tool");
  return t?.results[0]?.output as unknown as Salida;
}
const refs = (s: Salida) => s.candidates.map((c) => c.reference);
const trace = (r: { trace: AgentTurnTrace }) => r.trace;

describe("lo que ve el modelo: el parámetro `genero` solo existe donde la tienda separa Hombre y Mujer", () => {
  it("en una tienda que separa: `genero` en la búsqueda y en el enlace del catálogo; el resto de las declaraciones, idénticas", async () => {
    const r = await turno([{ text: "Hola" }], "hola");
    const tools = r.provider.requests[0].tools;
    const base = agentToolDeclarations([...AGENT_TOOL_NAMES]);
    const con = agentToolDeclarations([...AGENT_TOOL_NAMES], { genero: true });
    assert.deepEqual(tools, con);
    const prop = (nombre: string, lista = tools) => (lista.find((t) => t.name === nombre)!.parameters.properties as Record<string, unknown>) ?? {};
    assert.ok("genero" in prop("search_products"));
    assert.ok("genero" in prop("get_catalog_link"));
    assert.ok(!("genero" in prop("search_products", base)));
    // Ninguna otra herramienta cambia ni un byte.
    for (const t of tools.filter((x) => x.name !== "search_products" && x.name !== "get_catalog_link")) assert.deepEqual(t, base.find((b) => b.name === t.name));
    assert.deepEqual((prop("search_products").genero as { enum: string[] }).enum.sort(), ["hombre", "mujer"]);
  });

  it("en un negocio que NO separa: las declaraciones son EXACTAMENTE las de siempre (sin `genero`) y no se leen las piezas de hombre", async () => {
    const antes = mem.hombreReads();
    const r = await turno([{ text: "Hola" }], "hola", { actor: B });
    assert.deepEqual(r.provider.requests[0].tools, agentToolDeclarations([...AGENT_TOOL_NAMES]));
    assert.doesNotMatch(JSON.stringify(r.provider.requests[0].tools), /genero/);
    assert.equal(mem.hombreReads(), antes, "ninguna lectura de piezas de hombre");
  });

  it("sin la migración de Hombre/Mujer, o sin ninguna pieza de hombre: sin `genero` y todo como siempre", async () => {
    mem.setGeneroEnabled(false);
    const sinColumna = await turno([{ text: "Hola" }], "hola");
    assert.deepEqual(sinColumna.provider.requests[0].tools, agentToolDeclarations([...AGENT_TOOL_NAMES]));
    mem.setGeneroEnabled(true);
    for (const ref of hombresA) {
      const p = await mem.repo.getProductByReference(A.tenantId, ref);
      mem.setGeneroDirecto(p!.id, "mujer");
    }
    const sinHombres = await turno([{ text: "Hola" }], "hola");
    assert.deepEqual(sinHombres.provider.requests[0].tools, agentToolDeclarations([...AGENT_TOOL_NAMES]));
  });

  it("un número sin herramientas de catálogo ni siquiera consulta la tienda para esto", async () => {
    const antes = mem.hombreReads();
    await turno([{ text: "Hola" }], "hola", { config: cfg(A, { herramientas: ["get_cart"] }) });
    assert.equal(mem.hombreReads(), antes);
  });

  it("las piezas de hombre se leen UNA sola vez por turno, aunque el modelo haga varias consultas", async () => {
    const antes = mem.hombreReads();
    await turno([call("search_products", { query: "dijes", genero: "hombre" }), call("search_products", { query: "anillo" }), call("get_catalog_link", { genero: "hombre" }), { text: "Listo." }], "dijes de hombre");
    assert.equal(mem.hombreReads() - antes, 1);
  });
});

describe("búsqueda con `genero`", () => {
  it("hombre: solo piezas de hombre, cada una dice para = hombre, y el cursor recuerda el lado", async () => {
    const r = await turno([call("search_products", { query: "anillo", genero: "hombre" }), { text: "Te muestro la opción." }], "un anillo para mi novio");
    const s = salida(r.provider.requests[1]);
    assert.deepEqual(s.candidates.map((c) => c.name), ["Anillo hombre acero"]);
    assert.ok(s.candidates.every((c) => c.para === "hombre"));
    assert.equal((await estado()).lastSearch?.gender, "hombre");
  });

  it("mujer: ninguna pieza de hombre (todo lo demás sí), cada una dice para = mujer", async () => {
    const r = await turno([call("search_products", { query: "anillo", genero: "mujer" }), { text: "Te muestro las opciones." }], "un anillo para mi mamá");
    const s = salida(r.provider.requests[1]);
    assert.deepEqual(s.candidates.map((c) => c.name).sort(), ["Anillo plata", "Anillo rodio"]);
    assert.ok(s.candidates.every((c) => c.para === "mujer"));
    assert.equal(s.total, 2);
    assert.ok(mem.searchCalls.at(-1)?.exclude?.includes(hombresA[0]), "las piezas de hombre viajan como excluidas a la búsqueda de la base");
  });

  it("sin `genero` la búsqueda mezcla (como siempre), pero cada pieza dice para quién es", async () => {
    const r = await turno([call("search_products", { query: "anillo" }), { text: "Te muestro las opciones." }], "anillos");
    const s = salida(r.provider.requests[1]);
    assert.deepEqual(s.candidates.map((c) => c.name).sort(), ["Anillo hombre acero", "Anillo plata", "Anillo rodio"]);
    assert.deepEqual(Object.fromEntries(s.candidates.map((c) => [c.name, c.para])), { "Anillo hombre acero": "hombre", "Anillo plata": "mujer", "Anillo rodio": "mujer" });
    assert.equal((await estado()).lastSearch?.gender, undefined, "sin lado elegido el estado no cambia");
  });

  it("«qué tienen para hombre»: un texto que solo repite el filtro o no describe nada trae TODO lo de hombre (paginado, con el total)", async () => {
    for (const query of ["hombre", "joyas para hombre", "un regalo para él", "piezas masculinas"]) {
      const r = await turno([call("search_products", { query, genero: "hombre" }), { text: "Estas son algunas." }], query);
      const s = salida(r.provider.requests[1]);
      assert.equal(s.total, hombresA.length, query);
      assert.equal(s.count, 5, query);
      assert.ok(s.has_more, query);
      assert.ok(refs(s).every((x) => hombresA.includes(x)), query);
    }
  });

  it("filtros dentro del lado: categoría, material y precio máximo", async () => {
    const r = await turno([call("search_products", { query: "dijes", genero: "hombre", max_price: 12_000 }), { text: "Esas." }], "dijes de hombre baratos");
    const s = salida(r.provider.requests[1]);
    assert.deepEqual(s.candidates.map((c) => c.name).sort(), ["Santo 1 · 251111", "Santo 2 · 251112"]);
    assert.equal(s.total, 2);
    const mat = await turno([call("search_products", { query: "anillo", genero: "hombre", material: "plata" }), { text: "Ninguno." }], "anillo de plata para hombre");
    assert.equal(salida(mat.provider.requests[1]).total, 0, "los anillos de plata son de mujer: no salen en el lado de hombre");
  });

  it("«muéstrame más» sigue en el MISMO lado: la segunda página es de hombre y no repite", async () => {
    const r1 = await turno([call("search_products", { query: "dijes", genero: "hombre" }), { text: "Primeros." }], "dijes de hombre");
    const p1 = refs(salida(r1.provider.requests[1]));
    assert.equal(p1.length, 5);
    const r2 = await turno([call("more_products"), { text: "Más." }], "muéstrame más");
    const s2 = salida(r2.provider.requests[1]);
    assert.equal(s2.candidates.length, 3, "los dijes de hombre son 8: 5 + 3");
    assert.ok(refs(s2).every((x) => hombresA.includes(x) && !p1.includes(x)));
    assert.equal(s2.has_more, false);
    assert.equal((await estado()).lastSearch?.gender, "hombre");
  });

  it("una referencia escrita tal cual se resuelve aunque sea del otro lado (el cliente la pidió)", async () => {
    const r = await turno([call("search_products", { query: mujeresA[0], genero: "hombre" }), { text: "Esa." }], mujeresA[0]);
    assert.deepEqual(refs(salida(r.provider.requests[1])), [mujeresA[0]]);
  });

  it("un negocio que NO separa ignora `genero`: mismos resultados que sin él, sin `para` y sin lado en el estado", async () => {
    await nuevo(B, "Anillo plata", { material: "Plata" });
    const con = await turno([call("search_products", { query: "anillo", genero: "hombre" }), { text: "Esos." }], "anillo para hombre", { actor: B });
    const s = salida(con.provider.requests[1]);
    assert.deepEqual(s.candidates.map((c) => c.name).sort(), ["Anillo del otro negocio", "Anillo plata"]);
    assert.ok(s.candidates.every((c) => !("para" in c)));
    assert.equal((await estado(B)).lastSearch?.gender, undefined);
  });
});

describe("parecidos del MISMO lado", () => {
  it("lo parecido a una pieza de mujer nunca trae piezas de hombre (aunque estén en su misma categoría)", async () => {
    // Los anillos de mujer y el anillo de hombre comparten la categoría «Anillos»: sin el lado, lo parecido a un anillo de mujer podría traer el de hombre.
    const r = await turno([call("search_products", { query: "anillo", genero: "mujer" }), call("similar_products", { reference: mujeresA[0] }), { text: "Algo así." }], "anillos");
    const s = salida(r.provider.requests[2]);
    assert.deepEqual(s.candidates.map((c) => c.name), ["Anillo plata"]);
    assert.ok(!refs(s).includes(hombresA[0]), "el anillo de hombre no sale");
    assert.equal((await estado()).lastSearch?.gender, "mujer");
  });

  it("lo parecido a una pieza de mujer sale del lado de mujer aunque la búsqueda anterior no tuviera lado", async () => {
    const r = await turno([call("search_products", { query: "anillo" }), call("similar_products", { reference: mujeresA[0] }), { text: "Algo así." }], "anillos");
    const s = salida(r.provider.requests[2]);
    assert.ok(refs(s).every((x) => mujeresA.includes(x)), "solo piezas de mujer");
    assert.ok(!refs(s).includes(mujeresA[0]), "ni la misma pieza");
  });

  it("lo parecido a una pieza de hombre solo trae piezas de hombre", async () => {
    const base = hombresA.at(-1)!; // la más reciente: sale en la primera página de la búsqueda
    const r = await turno([call("search_products", { query: "dijes", genero: "hombre" }), call("similar_products", { reference: base }), { text: "Algo así." }], "dijes de hombre");
    const s = salida(r.provider.requests[2]);
    assert.equal(s.count, 5);
    assert.ok(refs(s).every((x) => hombresA.includes(x)), "solo piezas de hombre");
    assert.ok(!refs(s).includes(base));
    assert.equal(s.total, hombresA.length - 2, "los dijes de hombre menos la pieza base: 7");
  });

  it("en un negocio que no separa, los parecidos son los de siempre (sin lado en el estado)", async () => {
    const a = await nuevo(B, "Anillo plata", { material: "Plata" });
    await nuevo(B, "Anillo oro", { material: "Oro" });
    const r = await turno([call("search_products", { query: "anillo" }), call("similar_products", { reference: a.reference }), { text: "Algo así." }], "anillos", { actor: B });
    assert.ok(refs(salida(r.provider.requests[2])).length > 0);
    assert.equal((await estado(B)).lastSearch?.gender, undefined);
  });
});

describe("`para` en el detalle de una pieza", () => {
  it("por referencia, por nombre y en el detalle: cada pieza dice para quién es (solo en la tienda que separa)", async () => {
    for (const [ref, esperado] of [[hombresA[0], "hombre"], [mujeresA[0], "mujer"]] as const) {
      const r = await turno([call("resolve_product_by_reference", { reference: ref }), call("get_product_details", { reference: ref }), { text: "Es esta." }], ref);
      const out = (i: number) => (([...r.provider.requests[i].turns].reverse().find((x) => x.role === "tool") as Extract<AITurn, { role: "tool" }>).results[0].output as { product: Candidato }).product;
      assert.equal(out(1).para, esperado);
      assert.equal(out(2).para, esperado);
    }
  });

  it("en el negocio que no separa la pieza no trae `para`", async () => {
    const p = await nuevo(B, "Anillo plata", { material: "Plata" });
    const r = await turno([call("resolve_product_by_reference", { reference: p.reference }), { text: "Es esta." }], p.reference, { actor: B });
    const out = ([...r.provider.requests[1].turns].reverse().find((x) => x.role === "tool") as Extract<AITurn, { role: "tool" }>).results[0].output as { product: Candidato };
    assert.ok(!("para" in out.product));
  });
});

describe("enlace de la colección de hombre", () => {
  it("al detal con genero = hombre: el enlace de la colección de hombre", async () => {
    const r = await turno([call("get_catalog_link", { genero: "hombre" }), { text: "Aquí está." }], "el catálogo de hombre");
    const s = salida(r.provider.requests[1]);
    assert.equal(s.url, "https://dulabs.test/catalogo/delacour?genero=hombre");
    assert.equal(s.kind, "catalog");
    assert.equal(s.genero, "hombre");
  });

  it("sin genero o con mujer: el catálogo de siempre (el lado de mujer es el de siempre y no se escribe)", async () => {
    const sin = await turno([call("get_catalog_link"), { text: "Aquí está." }], "el catálogo");
    assert.equal(salida(sin.provider.requests[1]).url, "https://dulabs.test/catalogo/delacour");
    assert.ok(!("genero" in salida(sin.provider.requests[1])));
    const mujer = await turno([call("get_catalog_link", { genero: "mujer" }), { text: "Aquí está." }], "el catálogo de mujer");
    assert.equal(salida(mujer.provider.requests[1]).url, "https://dulabs.test/catalogo/delacour");
  });

  it("el enlace con ?genero=hombre que devolvió el sistema SÍ se puede mandar al cliente", async () => {
    const ok = await turno([call("get_catalog_link", { genero: "hombre" }), (req) => ({ text: `Mira la colección: ${salida(req).url}` })], "el catálogo de hombre");
    assert.equal(ok.outcome, "replied");
    assert.match(sent.at(-1) ?? "", /catalogo\/delacour\?genero=hombre/);
    assert.deepEqual(ok.trace.grounding.violations, []);
  });

  it("un enlace del lado que el sistema NO devolvió no sale: se corrige y el cliente nunca lo recibe", async () => {
    const r = await turno([call("get_catalog_link"), { text: "Mira: https://dulabs.test/catalogo/delacour?genero=hombre" }, { text: "Aquí tienes el catálogo." }], "el catálogo");
    assert.ok(r.trace.grounding.violations.includes("link"));
    assert.ok(!sent.some((t) => t.includes("genero=hombre")));
  });

  it("al por mayor no hay colección de hombre (la tienda mayorista no separa): el enlace es el de siempre", async () => {
    const r = await turno([call("get_catalog_link", { genero: "hombre" }), { text: "Aquí está." }], "el catálogo de hombre", { config: cfg(A, { canal: "wholesale" }) });
    const s = salida(r.provider.requests[1]);
    assert.doesNotMatch(s.url ?? "", /genero=/);
    assert.ok(!("genero" in s));
  });

  it("en un negocio que no separa, `genero` se ignora: el catálogo de siempre", async () => {
    const r = await turno([call("get_catalog_link", { genero: "hombre" }), { text: "Aquí está." }], "el catálogo", { actor: B });
    const s = salida(r.provider.requests[1]);
    assert.doesNotMatch(s.url ?? "", /genero=/);
  });
});

describe("resolución: el filtro de género", () => {
  let resolucion: ReturnType<typeof createResolucionCatalogo>;
  let hombres: ReadonlySet<string>;
  beforeEach(() => {
    resolucion = createResolucionCatalogo({ repo: mem.repo });
    hombres = new Set(hombresA);
  });
  const buscar = (extra: Parameters<typeof resolucion.buscarCatalogo>[1]) => resolucion.buscarCatalogo(A.tenantId, extra);

  it("sin `hombres` el género se ignora (la búsqueda es la de siempre); con `hombres` pero sin género, también", async () => {
    const mezcla = await buscar({ query: "anillo", channel: "retail", gender: "hombre" });
    assert.equal(mezcla.total, 3);
    assert.equal((await buscar({ query: "anillo", channel: "retail", hombres })).total, 3);
  });

  it("hombre: total, paginación y orden de SU lista; mujer: el resto, con el total de ese lado", async () => {
    const todos = await buscar({ query: "", channel: "retail", gender: "hombre", hombres, limit: 20 });
    assert.equal(todos.total, hombresA.length);
    assert.equal(todos.candidates.length, hombresA.length);
    const p2 = await buscar({ query: "", channel: "retail", gender: "hombre", hombres, limit: 5, offset: 5 });
    assert.equal(p2.candidates.length, hombresA.length - 5);
    assert.equal(p2.total, hombresA.length, "el total no depende de la página");
    const mujer = await buscar({ query: "", channel: "retail", gender: "mujer", hombres, limit: 20 });
    assert.deepEqual(mujer.candidates.map((c) => c.reference).sort(), [...mujeresA].sort());
    assert.equal(mujer.total, mujeresA.length);
  });

  it("hombre con varias palabras que no coinciden todas: relaja a alguna y lo marca; el precio máximo nunca se relaja", async () => {
    // Ninguna pieza es a la vez «anillo» y «dijes»: con todas las palabras no hay nada y se relaja (el anillo y los 8 dijes).
    const r = await buscar({ query: "anillo dijes", channel: "retail", gender: "hombre", hombres, limit: 20 });
    assert.equal(r.relaxed, true);
    assert.equal(r.total, hombresA.length);
    const caro = await buscar({ query: "anillo dijes", channel: "retail", gender: "hombre", hombres, maxPrice: 5_000 });
    assert.equal(caro.total, 0);
    assert.equal(caro.relaxed, false);
  });

  it("las piezas inactivas de hombre no salen; las referencias excluidas tampoco", async () => {
    const p = await mem.repo.getProductByReference(A.tenantId, hombresA[1]);
    await admin.updateProduct(A, p!.id, { status: "INACTIVE" });
    const r = await buscar({ query: "dijes", channel: "retail", gender: "hombre", hombres, exclude: [hombresA[2]], limit: 20 });
    assert.ok(!r.candidates.some((c) => c.reference === hombresA[1] || c.reference === hombresA[2]));
  });
});

describe("hombresDelNegocio: cuándo hay algo que separar", () => {
  it("tienda que separa + migración + piezas de hombre => sus referencias (una lectura)", async () => {
    const antes = mem.hombreReads();
    const set = await hombresDelNegocio(mem.repo, A.tenantId);
    assert.deepEqual([...(set ?? [])].sort(), [...hombresA].sort());
    assert.equal(mem.hombreReads() - antes, 1);
  });

  it("negocio cuya tienda NO separa => null y no se leen las piezas de hombre", async () => {
    const antes = mem.hombreReads();
    assert.equal(await hombresDelNegocio(mem.repo, B.tenantId), null);
    assert.equal(mem.hombreReads(), antes);
  });

  it("sin publicación, sin la lectura en el repositorio, sin la migración o sin piezas de hombre => null", async () => {
    assert.equal(await hombresDelNegocio(mem.repo, "cccccccc-0000-4000-8000-00000000000c"), null, "sin publicación");
    const { listHombreReferences: _l, ...sinLectura } = mem.repo;
    void _l;
    assert.equal(await hombresDelNegocio(sinLectura, A.tenantId), null, "el repositorio no ofrece la lectura");
    mem.setGeneroEnabled(false);
    assert.equal(await hombresDelNegocio(mem.repo, A.tenantId), null, "sin la columna");
    mem.setGeneroEnabled(true);
    assert.ok(await hombresDelNegocio(mem.repo, A.tenantId));
    const vacio = { ...mem.repo, listHombreReferences: async () => [] };
    assert.equal(await hombresDelNegocio(vacio, A.tenantId), null, "ninguna pieza de hombre");
  });

  it("nunca lanza: una lectura caída => null; más piezas de hombre que el tope => null (no se devuelve una búsqueda incompleta)", async () => {
    const caido = { ...mem.repo, listHombreReferences: async (): Promise<string[] | null> => Promise.reject(new Error("base caída")) };
    assert.equal(await hombresDelNegocio(caido, A.tenantId), null);
    const demasiadas = { ...mem.repo, listHombreReferences: async () => Array.from({ length: HOMBRES_BUSQUEDA_MAX + 1 }, (_, i) => `DL-${String(i + 1).padStart(6, "0")}`) };
    assert.equal(await hombresDelNegocio(demasiadas, A.tenantId), null);
    const justo = { ...mem.repo, listHombreReferences: async () => Array.from({ length: HOMBRES_BUSQUEDA_MAX }, (_, i) => `DL-${String(i + 1).padStart(6, "0")}`) };
    assert.equal((await hombresDelNegocio(justo, A.tenantId))?.size, HOMBRES_BUSQUEDA_MAX);
  });
});

describe("el turno sigue sano", () => {
  it("el resultado de un turno con género no cambia el resto del estado (carrito, mostrados) ni la traza de errores", async () => {
    const r = await turno([call("search_products", { query: "dijes", genero: "hombre" }), { text: "Estas son." }], "dijes de hombre");
    assert.equal(r.outcome, "replied");
    assert.equal(trace(r).error_kind, null);
    const e = await estado();
    assert.equal(e.cart.length, 0);
    assert.equal(e.lastShown.length, 5);
  });
});
