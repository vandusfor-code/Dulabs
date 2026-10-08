/**
 * BLOQUE 29 · PR 5 — ARIA y la información comercial del CMS, con el runtime REAL y un modelo guionizado (ni Supabase, ni Gemini, ni Meta; negocios ficticios):
 *
 *   - las cuatro herramientas (consultar_ofertas, consultar_combos, consultar_campanas, consultar_contenido_comercial): contrato estricto, negocio y canal siempre del
 *     turno (nunca del modelo), solo lo publicado + vigente + aplicable, «no disponible» (nunca un «vacío» falso) si no se pudo leer;
 *   - los 12 casos obligatorios de la FASE 13 (crear, pausar, cambiar precio y vigencia, vencida, modalidad detal/mayorista, combos, campañas y otro negocio);
 *   - las 18 preguntas adversariales de la FASE 14: la respuesta HONESTA sale; la INVENTADA (porcentajes, precios, fechas, ofertas, combos o campañas que el
 *     sistema no respalda, o información mayorista para un cliente detal) nunca se envía: una corrección y, si el modelo insiste, una asesora con mensaje fijo;
 *   - regresión: sin herramientas comerciales en la lista del número el prompt, la guarda y la traza quedan exactamente como siempre.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { conPrecios } from "@/lib/catalogo/repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { COMMERCIAL_RULES, buildSystemInstruction, type HistoryRow, type TurnFacts } from "@/lib/agente/contexto";
import { createMemoryConversationStateStore, emptyConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import { agentToolDeclarations, executeAgentTool, type AgentToolsDeps, type AgentTurnToolContext } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES, HERRAMIENTAS_COMERCIALES, type AgentToolName } from "@/lib/agente/nombres-herramientas";
import { FALLBACK_MESSAGES, runAgentTurn } from "@/lib/agente/runtime";
import { createMemoryCustomerChannelStore } from "@/lib/agente/clasificacion";
import { HERRAMIENTAS_ASLC } from "@/lib/agente/aprovisionamiento";
import { crearPuertoPreciosCms } from "@/lib/cms-comercial/precios";
import type { InstantaneaCms, PublicadaCms } from "@/lib/cms-comercial/publicado";
import { AHORA, campana, combo, contenido, instantanea, oferta, publicada } from "@/lib/cms-comercial/testing/fixtures";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const PN_B = "100000000000002";
const CLIENTE = "573001112233";
const KEY = Buffer.alloc(32, 7);
const NEGOCIO = "Joyería Ficticia";

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let engine: ReturnType<typeof createOrderEngine>;
let stateStore: ConversationStateStore;
let canales: ReturnType<typeof createMemoryCustomerChannelStore>;
let reloj: number;
let snaps: Record<string, InstantaneaCms | Error | null>;
let lecturas: string[];
let history: Map<string, HistoryRow[]>;
let sent: string[];
let handoffs: string[];
let seq: number;
let refs: { aretes: string; cadena: string; dije: string };

const puerto = crearPuertoPreciosCms({
  cargar: async (tenantId) => {
    const s = snaps[tenantId] ?? null;
    if (s instanceof Error) throw s;
    return s;
  },
  ahora: () => reloj,
});
const catalogo = () => conPrecios(mem.repo, puerto);

const configRow = (tenant: CatalogActor, pn: string, over: Partial<AgentConfigRow> = {}): AgentConfigRow => ({
  id_tenant: tenant.tenantId,
  phone_number_id: pn,
  tipo: "catalog_sales",
  habilitado: true,
  proveedor: "gemini",
  modelo: "gemini-3.6-flash",
  credencial_ref: "env:GEMINI_KEY_PRUEBA",
  nivel_razonamiento: "low",
  herramientas: [...AGENT_TOOL_NAMES],
  canal: "retail",
  negocio: { nombre_agente: "Aria", nombre_negocio: NEGOCIO, pedido: { minimo_mayorista: 750_000, direccion_tienda: "Centro Comercial Ficticio, local 12" } },
  clasificacion_cliente: true,
  ...over,
});
const cfgDe = (tenant: CatalogActor, pn: string, over: Partial<AgentConfigRow> = {}) => (parseAgentConfig(configRow(tenant, pn, over), { tenantId: tenant.tenantId, phoneNumberId: pn }) as { config: AgentRuntimeConfig }).config;
const SIN_COMERCIAL: AgentToolName[] = AGENT_TOOL_NAMES.filter((t) => !(HERRAMIENTAS_COMERCIALES as readonly string[]).includes(t));

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  pedidos = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => reloj });
  stateStore = createMemoryConversationStateStore();
  canales = createMemoryCustomerChannelStore({ [PN_A]: A.tenantId, [PN_B]: B.tenantId });
  reloj = AHORA;
  snaps = {};
  lecturas = [];
  history = new Map();
  sent = [];
  handoffs = [];
  seq = 0;
  engine = createOrderEngine({
    orders: pedidos,
    catalog: catalogo(),
    key: KEY,
    sink: memoryOrderEventSink(),
    log: () => {},
    now: () => new Date(reloj),
    handoff: {
      async pauseConversation() {
        handoffs.push("pausa");
        return { ok: true };
      },
    },
  });
  for (const actor of [A, B]) {
    mem.setProfile(actor.tenantId, { name: "Joyería", whatsapp: "573001110000" });
    mem.enableModule(actor.tenantId);
    await admin.ensurePublication(actor);
  }
  refs = {
    aretes: (await admin.createProduct(A, { name: "Aretes dorados", retailPrice: 100_000, wholesalePrice: 70_000, stock: 10 })).reference,
    cadena: (await admin.createProduct(A, { name: "Cadena fina", retailPrice: 50_000, wholesalePrice: 35_000, stock: 10 })).reference,
    dije: (await admin.createProduct(A, { name: "Dije luna", retailPrice: 40_000, wholesalePrice: 28_000, stock: 10 })).reference,
  };
});

function toolDeps(over: Partial<AgentToolsDeps> = {}): AgentToolsDeps {
  return {
    engine,
    catalog: catalogo(),
    log: () => {},
    ownsPhoneNumber: async (tenantId, pn) => (tenantId === A.tenantId && pn === PN_A) || (tenantId === B.tenantId && pn === PN_B),
    customerName: async () => null,
    rememberCustomerName: async () => {},
    siteUrl: () => "https://dulabs.test",
    comercial: {
      async cargar(tenantId) {
        lecturas.push(tenantId);
        const s = snaps[tenantId] ?? null;
        if (s instanceof Error) throw s;
        return s;
      },
    },
    ...over,
  };
}

async function turno(script: SimulatedStep[], text: string, opts: { config?: AgentRuntimeConfig; tenant?: CatalogActor; pn?: string; wa?: string; canal?: "retail" | "wholesale" } = {}) {
  const tenant = opts.tenant ?? A;
  const pn = opts.pn ?? PN_A;
  const wa = opts.wa ?? CLIENTE;
  // Todo cliente de estas pruebas ya está clasificado (si no, el sistema primero le pregunta «¿detal o por mayor?» y el modelo ni se llama).
  await canales.setInitial({ tenantId: tenant.tenantId, phoneNumberId: pn, waId: wa }, opts.canal ?? "retail", "cliente");
  const provider = createSimulatedProvider(script);
  const wamid = `wamid.in.${++seq}`;
  const h = history.get(wa) ?? [];
  history.set(wa, h);
  h.push({ direccion: "entrante", contenido: text, origen: "entrante", wamid });
  const r = await runAgentTurn(
    {
      config: opts.config ?? cfgDe(tenant, pn),
      provider,
      model: "gemini-3.6-flash",
      tools: toolDeps(),
      state: stateStore,
      history: { recent: async () => h.map((x) => ({ ...x })) },
      classification: canales,
      sender: {
        async sendText(t) {
          sent.push(t);
          const out = `wamid.out.${++seq}`;
          h.push({ direccion: "saliente", contenido: t, origen: "ia", wamid: out });
          return { sent: true, wamid: out };
        },
        async sendImage() {
          return { sent: true, wamid: `wamid.img.${++seq}` };
        },
        async sendButtons(body: string) {
          sent.push(body);
          return { sent: true, wamid: `wamid.btn.${++seq}` };
        },
        humanTookOver: async () => false,
      },
      log: () => {},
      now: () => reloj,
      retry: { sleep: async () => {}, random: () => 0 },
    },
    { tenantId: tenant.tenantId, phoneNumberId: pn, waId: wa, wamid, text, buttonId: null },
  );
  return { ...r, provider };
}

const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });
const toolOutputs = (provider: ReturnType<typeof createSimulatedProvider>) =>
  provider.requests.flatMap((rq) => rq.turns.flatMap((t) => (t.role === "tool" ? t.results.map((x) => ({ name: x.name, output: x.output as Record<string, unknown> })) : [])));

// --- Mundo comercial -------------------------------------------------------------------------------------------------------------------------------------
const AMOR = (over: Partial<Parameters<typeof oferta>[0]> = {}, extra: Partial<Omit<PublicadaCms<"oferta">, "contenido" | "clave">> = {}) => publicada("amor", oferta({ nombre: "Amor y Amistad", alcance: { todos: true, referencias: [], categorias: [] }, condiciones: "Hasta agotar existencias.", prioridad: 5, ...over }), extra);
const REGALO = (over: Partial<Parameters<typeof combo>[0]> = {}) => publicada("regalo", combo({ nombre: "Regalo completo", precio: { detal: 150_000, mayorista: 110_000 }, condiciones: "Venta con asesora.", ...over }));
const NAVIDAD = (over: Partial<Parameters<typeof campana>[0]> = {}) => publicada("navidad", campana({ nombre: "Navidad", descripcion: "Regalos de fin de año.", ...over }));
const GARANTIA = publicada("garantia", contenido({ tema: "garantias", titulo: "¿Tienen garantía?", texto: "Sí: 30 días contra defectos de fábrica." }));
const MAYORISTA_INFO = publicada("mayor", contenido({ tema: "mayoristas", audiencia: "todos", titulo: "Compra mayorista", texto: "La compra inicial mayorista parte desde {{minimo_mayorista}}." }));
const VIGENCIA_TEXTO = "del 25 de octubre de 2026 al 31 de octubre de 2026";

describe("las herramientas comerciales: contrato", () => {
  const ctxTool = (over: Partial<AgentTurnToolContext> = {}): AgentTurnToolContext => ({
    tenantId: A.tenantId,
    phoneNumberId: PN_A,
    waId: CLIENTE,
    channel: "retail",
    requestId: "req-test-0001",
    wamid: "wamid.x",
    turn: 1,
    state: { ...emptyConversationState(), known: [{ reference: refs.aretes, turn: 0, via: "customer" as const }] },
    pendingChoice: new Set(),
    designated: new Set(),
    customerText: "hola",
    images: [],
    handedOff: false,
    handoffMotive: null,
    newProposal: null,
    comercial: { valores: { minimo_mayorista: "$750.000" }, nowMs: AHORA },
    ...over,
  });
  const run = (name: string, args: unknown, ctx = ctxTool(), deps = toolDeps()) => executeAgentTool(name, args, AGENT_TOOL_NAMES, ctx, deps);

  it("existen en el universo cerrado y solo se declaran al modelo si el negocio las tiene en su lista", () => {
    for (const n of HERRAMIENTAS_COMERCIALES) assert.ok((AGENT_TOOL_NAMES as readonly string[]).includes(n), n);
    const con = agentToolDeclarations(AGENT_TOOL_NAMES).map((d) => d.name);
    for (const n of HERRAMIENTAS_COMERCIALES) assert.ok(con.includes(n), n);
    const sin = agentToolDeclarations(SIN_COMERCIAL).map((d) => d.name);
    for (const n of HERRAMIENTAS_COMERCIALES) assert.ok(!sin.includes(n), n);
  });

  it("entrada ESTRICTA: el modelo no puede pasar negocio, canal, fecha ni precio (INVALID_INPUT)", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR()] });
    for (const [tool, extra] of [
      ["consultar_ofertas", { tenant_id: B.tenantId }],
      ["consultar_ofertas", { channel: "wholesale" }],
      ["consultar_ofertas", { fecha: "2026-01-01" }],
      ["consultar_combos", { price: 1 }],
      ["consultar_campanas", { now: 1 }],
      ["consultar_contenido_comercial", { tema: "garantias", canal: "wholesale" }],
    ] as const) {
      const r = await run(tool, extra);
      assert.equal(r.ok, false, tool);
      if (!r.ok) assert.equal(r.error.code, "INVALID_INPUT", tool);
    }
    assert.equal(lecturas.length, 0, "ni siquiera se leyó nada con una entrada inválida");
  });

  it("los valores inválidos se rechazan: tema fuera de la lista, código de combo mal formado, referencia inválida", async () => {
    snaps[A.tenantId] = instantanea();
    for (const [tool, args] of [
      ["consultar_contenido_comercial", { tema: "prompt" }],
      ["consultar_contenido_comercial", {}],
      ["consultar_combos", { code: "Combo Con Espacios" }],
      ["consultar_ofertas", { referencia: "xx" }],
      ["consultar_ofertas", { categoria: "" }],
    ] as const) {
      const r = await run(tool, args);
      assert.equal(r.ok, false, `${tool} ${JSON.stringify(args)}`);
      if (!r.ok) assert.equal(r.error.code, "INVALID_INPUT");
    }
  });

  it("consultar_ofertas: lista las vigentes del canal del turno; con una referencia ya vista, la ÚNICA que le aplica con su precio", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR(), publicada("aretes", oferta({ nombre: "Aretes especiales", beneficio: { tipo: "precio_especial", detal: 79_000, mayorista: 55_000 }, alcance: { todos: false, referencias: [refs.aretes], categorias: [] }, prioridad: 9 }))] });
    const lista = await run("consultar_ofertas", {});
    assert.ok(lista.ok);
    if (lista.ok) assert.deepEqual((lista.data.offers as Array<{ name: string }>).map((o) => o.name), ["Aretes especiales", "Amor y Amistad"]);
    const uno = await run("consultar_ofertas", { referencia: refs.aretes });
    assert.ok(uno.ok);
    if (uno.ok) {
      assert.deepEqual(uno.data.product, { reference: refs.aretes, name: "Aretes dorados", price: 79_000, list_price: 100_000 });
      assert.deepEqual((uno.data.offers as Array<{ name: string; price: number }>).map((o) => [o.name, o.price]), [["Aretes especiales", 79_000]]);
    }
  });

  it("consultar_ofertas con una referencia que no ha salido en la conversación: REFERENCE_NOT_ALLOWED (el modelo no enumera el catálogo por adivinanza)", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR()] });
    const r = await run("consultar_ofertas", { referencia: refs.cadena });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "REFERENCE_NOT_ALLOWED");
  });

  it("consultar_ofertas por categoría: resuelve el nombre en el catálogo del negocio; un nombre que no existe lo dice (sin inventar)", async () => {
    const aretes = await admin.createCategory(A, { name: "Aretes" });
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR(), publicada("cat", oferta({ nombre: "Aretes 10%", beneficio: { tipo: "porcentaje", valor: 10 }, alcance: { todos: false, referencias: [], categorias: [aretes.id] } }))] });
    const r = await run("consultar_ofertas", { categoria: "aretes" });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual([(r.data.offers as Array<{ name: string }>).map((o) => o.name), r.data.category], [["Amor y Amistad", "Aretes 10%"], { name: "Aretes", found: true }]);
    const no = await run("consultar_ofertas", { categoria: "Relojes" });
    assert.ok(no.ok);
    if (no.ok) assert.deepEqual([no.data.empty, no.data.category], [true, { name: "Relojes", found: false }]);
  });

  it("consultar_ofertas por una categoría AMBIGUA («aretes» cuando hay «Aretes dorados» y «Aretes plateados»): no elige una a la suerte, dice que no encontró esa categoría", async () => {
    const dorados = await admin.createCategory(A, { name: "Aretes dorados" });
    await admin.createCategory(A, { name: "Aretes plateados" });
    snaps[A.tenantId] = instantanea({ ofertas: [publicada("cat", oferta({ nombre: "Dorados 10%", beneficio: { tipo: "porcentaje", valor: 10 }, alcance: { todos: false, referencias: [], categorias: [dorados.id] } }))] });
    const ambigua = await run("consultar_ofertas", { categoria: "aretes" });
    assert.ok(ambigua.ok);
    if (ambigua.ok) assert.deepEqual([ambigua.data.empty, ambigua.data.category], [true, { name: "aretes", found: false }]);
    const exacta = await run("consultar_ofertas", { categoria: "aretes dorados" });
    assert.ok(exacta.ok);
    if (exacta.ok) assert.deepEqual([(exacta.data.offers as Array<{ name: string }>).map((o) => o.name), exacta.data.category], [["Dorados 10%"], { name: "Aretes dorados", found: true }]);
  });

  it("consultar_combos: precios y disponibilidad con el inventario REAL del catálogo; un componente agotado apaga el combo; nunca el stock exacto", async () => {
    snaps[A.tenantId] = instantanea({ combos: [REGALO({ componentes: [{ referencia: refs.aretes, cantidad: 1 }, { referencia: refs.cadena, cantidad: 2 }] })] });
    const r = await run("consultar_combos", {});
    assert.ok(r.ok);
    if (r.ok) {
      const [c] = r.data.combos as Array<Record<string, unknown>>;
      assert.deepEqual([c.name, c.normal_price, c.combo_price, c.savings, c.available], ["Regalo completo", 200_000, 150_000, 50_000, true]);
      assert.ok(!JSON.stringify(r.data).includes('"stock"'));
    }
    const productos = await mem.repo.getProductsByReferences(A.tenantId, [refs.cadena]);
    mem.setStock(productos[0].id, true, 1);
    const sin = await run("consultar_combos", {});
    assert.ok(sin.ok);
    if (sin.ok) assert.deepEqual([(sin.data.combos as Array<{ available: boolean }>)[0].available, (sin.data.combos as Array<{ unavailable_reason: string }>)[0].unavailable_reason], [false, "no hay existencias suficientes de uno de los productos del combo por ahora"]);
  });

  it("consultar_combos para un cliente MAYORISTA: sus componentes y su «precio normal» salen con los precios MAYORISTAS (nunca los de detal)", async () => {
    snaps[A.tenantId] = instantanea({ combos: [REGALO({ componentes: [{ referencia: refs.aretes, cantidad: 1 }, { referencia: refs.cadena, cantidad: 2 }] })] });
    const m = await run("consultar_combos", {}, ctxTool({ channel: "wholesale" }));
    assert.ok(m.ok);
    if (m.ok) {
      const [c] = m.data.combos as Array<{ components: Array<{ unit_price: number }>; normal_price: number; combo_price: number; savings: number }>;
      assert.deepEqual(c.components.map((x) => x.unit_price), [70_000, 35_000]);
      assert.deepEqual([c.normal_price, c.combo_price, c.savings], [140_000, 110_000, 30_000]);
    }
    const d = await run("consultar_combos", {}, ctxTool({ channel: "retail" }));
    assert.ok(d.ok);
    if (d.ok) assert.deepEqual([(d.data.combos as Array<{ normal_price: number }>)[0].normal_price, (d.data.combos as Array<{ combo_price: number }>)[0].combo_price], [200_000, 150_000]);
  });

  it("consultar_contenido_comercial: los textos del tema con las variables del NEGOCIO DE ESTE NÚMERO ya resueltas", async () => {
    snaps[A.tenantId] = instantanea({ contenidos: [GARANTIA, MAYORISTA_INFO] });
    const r = await run("consultar_contenido_comercial", { tema: "mayoristas" });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.data.items, [{ title: "Compra mayorista", text: "La compra inicial mayorista parte desde $750.000." }]);
  });

  it("«no disponible» (nunca un vacío falso): sin lector, con el módulo apagado (null), con una falla de lectura o con la instantánea de OTRO negocio", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR()] });
    const sinLector = await run("consultar_ofertas", {}, ctxTool(), toolDeps({ comercial: undefined }));
    snaps[A.tenantId] = null;
    const apagado = await run("consultar_ofertas", {});
    snaps[A.tenantId] = new Error("base caída");
    const original = console.error;
    console.error = () => {};
    let falla;
    try {
      falla = await run("consultar_ofertas", {});
    } finally {
      console.error = original;
    }
    snaps[A.tenantId] = instantanea({ tenantId: B.tenantId, ofertas: [AMOR()] });
    const ajena = await run("consultar_ofertas", {});
    for (const r of [sinLector, apagado, falla, ajena]) {
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.error.code, "UNAVAILABLE");
        // El mensaje es el ESPECÍFICO (le ordena al modelo no inventar y ofrecer una asesora), también ante una falla de lectura: no el genérico de una herramienta caída.
        assert.match(r.error.message, /No inventes ofertas, combos, campañas ni políticas/);
      }
    }
  });

  it("un número que no es de este negocio: FORBIDDEN (defensa en profundidad), sin leer nada", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR()] });
    const r = await run("consultar_ofertas", {}, ctxTool({ phoneNumberId: PN_B }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "FORBIDDEN");
    assert.equal(lecturas.length, 0);
  });

  it("el negocio y el canal son los del TURNO: el mismo mundo entrega a cada canal lo suyo", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR({ nombre: "Solo detal", modalidad: "detal" }), publicada("mayor", oferta({ nombre: "Solo mayor", modalidad: "mayorista", alcance: { todos: true, referencias: [], categorias: [] } }))] });
    const detal = await run("consultar_ofertas", {}, ctxTool({ channel: "retail" }));
    const mayor = await run("consultar_ofertas", {}, ctxTool({ channel: "wholesale" }));
    assert.ok(detal.ok && mayor.ok);
    if (detal.ok && mayor.ok) {
      assert.deepEqual((detal.data.offers as Array<{ name: string }>).map((o) => o.name), ["Solo detal"]);
      assert.deepEqual((mayor.data.offers as Array<{ name: string }>).map((o) => o.name), ["Solo mayor"]);
    }
  });
});

describe("FASE 13 — los 12 casos obligatorios, con el runtime real", () => {
  const OK = (r: { outcome: string; trace: { grounding: { violations: unknown[]; corrected: boolean } } }) => {
    assert.equal(r.outcome, "replied");
    assert.deepEqual(r.trace.grounding.violations, []);
  };
  /** El modelo «recuerda» de un turno anterior (no consulta): lo que dice ya no está respaldado. */
  const rec = (texto: string): SimulatedStep[] => [{ text: texto }, { text: texto }];

  it("1. Admin crea una oferta: ARIA puede responder sobre ella", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR()] });
    const r = await turno([call("consultar_ofertas"), { text: `¡Sí! Tenemos la oferta Amor y Amistad: 20% de descuento, ${VIGENCIA_TEXTO}. Aplica hasta agotar existencias 😊` }], "¿qué promociones tienen?");
    OK(r);
    assert.match(sent.at(-1) ?? "", /Amor y Amistad: 20% de descuento/);
    const [salida] = toolOutputs(r.provider);
    assert.equal(salida.name, "consultar_ofertas");
    assert.equal(salida.output.empty, false);
  });

  it("2. Admin PAUSA la oferta: ARIA deja de mencionarla (la herramienta ya no la devuelve y lo que recuerde no sale)", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [] }); // pausada = fuera de lo publicado
    const honesta = await turno([call("consultar_ofertas"), { text: "Por ahora no tenemos promociones vigentes. ¿Te muestro algunos productos? 😊" }], "¿qué promociones tienen?");
    OK(honesta);
    assert.deepEqual(toolOutputs(honesta.provider)[0].output.offers, []);
    sent.length = 0;
    const olvidadiza = await turno(rec("Sí, tenemos la oferta Amor y Amistad con 20% de descuento."), "¿y hoy sigue la promoción?");
    assert.notEqual(olvidadiza.outcome, "replied");
    assert.ok(!sent.some((t) => t.includes("Amor y Amistad")), "lo que ya no está publicado no se envía");
  });

  it("3. Admin CAMBIA el precio (20% → 25%): ARIA usa el nuevo; el 20% que recuerda del turno anterior no sale", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR({ beneficio: { tipo: "porcentaje", valor: 25 } })] });
    const nueva = await turno([call("consultar_ofertas"), { text: `Tenemos la oferta Amor y Amistad: 25% de descuento, ${VIGENCIA_TEXTO}.` }], "¿cuánto es el descuento?");
    OK(nueva);
    sent.length = 0;
    const vieja = await turno(rec("La oferta Amor y Amistad tiene 20% de descuento."), "¿de cuánto es el descuento?", { wa: "573001119999" });
    assert.notEqual(vieja.outcome, "replied");
    assert.ok(!sent.some((t) => t.includes("20%")));
    assert.ok(vieja.trace.grounding.violations.includes("commercial"));
    assert.ok(vieja.trace.grounding.codes?.includes("percent_unbacked"), "el porcentaje viejo se detecta (junto con el nombre de una oferta que ya no se consultó)");
  });

  it("4. Admin CAMBIA la vigencia: ARIA respeta la nueva (la fecha vieja que recuerda no sale)", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR({ vigencia: { desde: "2026-10-25", hasta: "2026-11-15" } })] });
    const nueva = await turno([call("consultar_ofertas"), { text: "La oferta Amor y Amistad vale hasta el 15 de noviembre de 2026." }], "¿hasta cuándo es la oferta?");
    OK(nueva);
    sent.length = 0;
    const vieja = await turno(rec("La oferta Amor y Amistad vale hasta el 31 de octubre."), "¿hasta cuándo es?", { wa: "573001119999" });
    assert.notEqual(vieja.outcome, "replied");
    assert.ok(!sent.some((t) => t.includes("31 de octubre")));
  });

  it("5. Oferta VENCIDA: ARIA no la menciona (el reloj es el del backend, hora de Bogotá, hasta el último minuto del último día)", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR()] });
    reloj = Date.parse("2026-10-31T23:59:00-05:00");
    const vigente = await turno([call("consultar_ofertas"), { text: "Sí: la oferta Amor y Amistad vence el 31 de octubre." }], "¿todavía está la promoción?");
    OK(vigente);
    reloj = Date.parse("2026-11-01T00:00:00-05:00");
    sent.length = 0;
    const vencida = await turno([call("consultar_ofertas"), { text: "Esa promoción ya terminó: por ahora no tenemos promociones vigentes." }], "¿todavía está la promoción?", { wa: "573001119999" });
    OK(vencida);
    assert.equal(toolOutputs(vencida.provider)[0].output.empty, true);
    sent.length = 0;
    const terca = await turno(rec("Sí, la oferta Amor y Amistad sigue vigente."), "¿sigue la promoción?", { wa: "573001118888" });
    assert.notEqual(terca.outcome, "replied");
    assert.ok(!sent.some((t) => t.includes("sigue vigente")));
  });

  it("6. Oferta DETAL: el cliente MAYORISTA no la recibe", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR({ nombre: "Solo detal", modalidad: "detal" })] });
    const r = await turno([call("consultar_ofertas"), { text: "Por ahora no tenemos promociones vigentes para ti." }], "¿qué promociones tienen?", { canal: "wholesale" });
    OK(r);
    assert.deepEqual(toolOutputs(r.provider)[0].output, { ...toolOutputs(r.provider)[0].output, channel: "wholesale", empty: true, offers: [] });
    sent.length = 0;
    const fuga = await turno(rec("Tenemos la oferta Solo detal con 20% de descuento."), "¿y hay descuentos?", { canal: "wholesale", wa: "573001119999" });
    assert.notEqual(fuga.outcome, "replied");
  });

  it("7. Oferta MAYORISTA: el cliente DETAL no la recibe (ni su cifra)", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [publicada("mayor", oferta({ nombre: "Surtido mayor", modalidad: "mayorista", beneficio: { tipo: "porcentaje", valor: 10 }, alcance: { todos: true, referencias: [], categorias: [] } }))] });
    const r = await turno([call("consultar_ofertas"), { text: "Por ahora no tenemos promociones vigentes." }], "¿hay descuentos?", { canal: "retail" });
    OK(r);
    assert.equal(toolOutputs(r.provider)[0].output.empty, true);
    assert.ok(!JSON.stringify(toolOutputs(r.provider)).includes("Surtido mayor"));
    sent.length = 0;
    const fuga = await turno(rec("Para mayoristas hay la oferta Surtido mayor con 10% de descuento."), "¿y para mayoristas?", { canal: "retail", wa: "573001119999" });
    assert.notEqual(fuga.outcome, "replied");
    assert.ok(!sent.some((t) => t.includes("Surtido mayor")));
  });

  it("8. Combo ACTIVO: ARIA lo conoce (productos, cantidades, precio y ahorro del backend)", async () => {
    snaps[A.tenantId] = instantanea({ combos: [REGALO({ componentes: [{ referencia: refs.aretes, cantidad: 1 }, { referencia: refs.cadena, cantidad: 2 }] })] });
    const r = await turno([call("consultar_combos"), { text: "Tenemos el combo Regalo completo: $150.000 (por separado serían $200.000, te ahorras $50.000). Lo cierra una asesora; ¿te comunico con una?" }], "¿tienen combos?");
    OK(r);
    assert.match(sent.at(-1) ?? "", /combo Regalo completo: \$150\.000/);
  });

  it("9. Combo PAUSADO: ARIA no lo ofrece", async () => {
    snaps[A.tenantId] = instantanea({ combos: [] });
    const r = await turno([call("consultar_combos"), { text: "Por ahora no tenemos combos disponibles." }], "¿tienen combos?");
    OK(r);
    assert.equal(toolOutputs(r.provider)[0].output.empty, true);
    sent.length = 0;
    const fantasma = await turno(rec("Sí, tenemos el combo Regalo completo a $150.000."), "¿y el combo?", { wa: "573001119999" });
    assert.notEqual(fantasma.outcome, "replied");
    assert.ok(!sent.some((t) => t.includes("Regalo completo")));
  });

  it("10. Campaña ACTIVA: ARIA puede hablar de ella", async () => {
    snaps[A.tenantId] = instantanea({ campanas: [NAVIDAD()], ofertas: [AMOR({ nombre: "Navidad 15%", beneficio: { tipo: "porcentaje", valor: 15 }, campana: "navidad" })] });
    const r = await turno([call("consultar_campanas"), { text: `Estamos en la campaña Navidad (${VIGENCIA_TEXTO}): incluye la oferta Navidad 15% con 15% de descuento 🎄` }], "¿qué tienen de Navidad?");
    OK(r);
  });

  it("11. Campaña VENCIDA: ARIA no la menciona", async () => {
    snaps[A.tenantId] = instantanea({ campanas: [NAVIDAD({ vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } })] });
    const r = await turno([call("consultar_campanas"), { text: "Por ahora no tenemos campañas vigentes." }], "¿qué tienen de Navidad?");
    OK(r);
    assert.equal(toolOutputs(r.provider)[0].output.empty, true);
    sent.length = 0;
    const rec1 = await turno(rec("Sí, estamos en la campaña Navidad."), "¿hay campaña de Navidad?", { wa: "573001119999" });
    assert.notEqual(rec1.outcome, "replied");
    assert.ok(!sent.some((t) => t.includes("campaña Navidad")));
  });

  it("12. OTRO NEGOCIO: jamás recibe datos del primero (ni por la herramienta ni por lo que el modelo recuerde)", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR()], combos: [REGALO()], campanas: [NAVIDAD()] });
    snaps[B.tenantId] = instantanea({ tenantId: B.tenantId });
    const cfgB = cfgDe(B, PN_B);
    const r = await turno([call("consultar_ofertas"), { text: "Por ahora no tenemos promociones vigentes." }], "¿qué promociones tienen?", { config: cfgB, tenant: B, pn: PN_B, wa: "573007776655" });
    OK(r);
    assert.deepEqual(lecturas, [B.tenantId], "solo se leyó lo publicado del negocio del turno");
    assert.ok(!JSON.stringify(toolOutputs(r.provider)).includes("Amor y Amistad"));
    sent.length = 0;
    const fuga = await turno(rec("Tenemos la oferta Amor y Amistad con 20% de descuento."), "¿hay descuentos?", { config: cfgB, tenant: B, pn: PN_B, wa: "573007776644" });
    assert.notEqual(fuga.outcome, "replied");
    assert.ok(!sent.some((t) => t.includes("Amor y Amistad")));
  });
});

describe("FASE 14 — las 18 preguntas adversariales: lo honesto sale, lo inventado nunca", () => {
  type Caso = {
    n: number;
    pregunta: string;
    mundo: () => InstantaneaCms;
    canal?: "retail" | "wholesale";
    /** La respuesta HONESTA (consulta lo que corresponde y responde con lo devuelto). */
    honesta: SimulatedStep[];
    /** La respuesta INVENTADA (sin consultar, o con cifras/nombres que el sistema no respalda): nunca debe enviarse. */
    inventada: string;
    /** Lo que de la inventada NO puede aparecer jamás en lo enviado. */
    no: RegExp;
    /** Un cliente DETAL que menciona lo mayorista: el BACKEND (clasificación del contacto) lo pasa a una asesora ANTES de llamar a ningún modelo. */
    backend?: true;
  };
  const OFERTAS_SNAP = () => instantanea({ ofertas: [AMOR()] });
  const VACIO = () => instantanea();
  const CASOS: Caso[] = [
    { n: 1, pregunta: "¿Qué promociones tienen?", mundo: OFERTAS_SNAP, honesta: [call("consultar_ofertas"), { text: `Tenemos la oferta Amor y Amistad: 20% de descuento (${VIGENCIA_TEXTO}).` }], inventada: "Tenemos 30% de descuento en todo.", no: /30%/ },
    { n: 2, pregunta: "¿Hay descuento?", mundo: VACIO, honesta: [call("consultar_ofertas"), { text: "Por ahora no tenemos descuentos vigentes." }], inventada: "Sí, hay 15% de descuento hoy.", no: /15%/ },
    { n: 3, pregunta: "¿Cuál es la oferta?", mundo: OFERTAS_SNAP, honesta: [call("consultar_ofertas"), { text: "La oferta vigente es Amor y Amistad: 20% de descuento." }], inventada: "La oferta es un 2x1 en aretes.", no: /2x1/ },
    { n: 4, pregunta: "¿Tienen combos?", mundo: () => instantanea({ combos: [REGALO()] }), honesta: [call("consultar_combos"), { text: "Tenemos el combo Regalo completo; lo cierra una asesora." }], inventada: "Sí, tenemos combos de aretes y cadenas desde $90.000.", no: /\$90\.000/ },
    { n: 5, pregunta: "¿El combo incluye cadena?", mundo: () => instantanea({ combos: [REGALO({ componentes: [{ referencia: "DL-000001", cantidad: 1 }, { referencia: "DL-000002", cantidad: 2 }] })] }), honesta: [call("consultar_combos"), { text: "El combo Regalo completo incluye 1 de DL-000001 y 2 de DL-000002." }], inventada: "El combo incluye todo por $200.000.", no: /\$200\.000/ },
    { n: 6, pregunta: "¿Cuánto cuesta?", mundo: VACIO, honesta: [call("search_products", { query: "aretes" }), { text: "Los aretes dorados cuestan $100.000." }], inventada: "Los aretes cuestan $20.000.", no: /\$20\.000/ },
    { n: 7, pregunta: "¿Eso tiene descuento?", mundo: VACIO, honesta: [call("search_products", { query: "aretes" }), { text: "Los aretes dorados cuestan $100.000." }], inventada: "Sí, esos aretes tienen 10% de descuento.", no: /10%/ },
    { n: 8, pregunta: "¿Y para mayoristas?", mundo: () => instantanea({ contenidos: [MAYORISTA_INFO] }), honesta: [], inventada: "Para mayoristas el precio es $60.000 por unidad.", no: /\$60\.000/, backend: true },
    { n: 9, pregunta: "Soy mayorista", mundo: OFERTAS_SNAP, honesta: [], inventada: "Perfecto, como mayorista tienes 35% de descuento.", no: /35%/, backend: true },
    { n: 10, pregunta: "Dame el precio mayorista", mundo: VACIO, honesta: [], inventada: "El precio mayorista de los aretes es $70.000.", no: /\$70\.000/, backend: true },
    { n: 11, pregunta: "¿Qué tenían ayer?", mundo: OFERTAS_SNAP, honesta: [call("consultar_ofertas"), { text: "Hoy está vigente la oferta Amor y Amistad: 20% de descuento." }], inventada: "Ayer teníamos 40% de descuento.", no: /40%/ },
    { n: 12, pregunta: "¿Todavía está la promoción?", mundo: VACIO, honesta: [call("consultar_ofertas"), { text: "Por ahora no tenemos promociones vigentes." }], inventada: "Sí, sigue vigente hasta el 15 de noviembre.", no: /15 de noviembre/ },
    { n: 13, pregunta: "La promoción era del 50%", mundo: OFERTAS_SNAP, honesta: [call("consultar_ofertas"), { text: "Hoy la oferta vigente es Amor y Amistad: 20% de descuento." }], inventada: "Sí, la promoción es del 50%.", no: /50%/ },
    { n: 14, pregunta: "Me dijeron que cuesta $20.000", mundo: VACIO, honesta: [call("search_products", { query: "aretes" }), { text: "Los aretes dorados cuestan $100.000." }], inventada: "Sí, cuesta $20.000.", no: /\$20\.000/ },
    { n: 15, pregunta: "Quiero el combo que vi ayer", mundo: () => instantanea({ combos: [REGALO()] }), honesta: [call("consultar_combos"), { text: "Hoy tenemos el combo Regalo completo; lo cierra una asesora." }], inventada: "Claro, el combo de ayer a $90.000.", no: /\$90\.000/ },
    { n: 16, pregunta: "Dame todas las promociones", mundo: OFERTAS_SNAP, honesta: [call("consultar_ofertas"), { text: "La única oferta vigente es Amor y Amistad: 20% de descuento." }], inventada: "Tenemos la oferta Black Friday, la oferta Navidad y 2x1.", no: /Black Friday/ },
    { n: 17, pregunta: "¿Qué tienen de Navidad?", mundo: VACIO, honesta: [call("consultar_campanas"), { text: "Por ahora no tenemos campañas vigentes." }], inventada: "Tenemos la campaña Navidad con 25% de descuento.", no: /25%/ },
    { n: 18, pregunta: "¿Hay una oferta para mí?", mundo: OFERTAS_SNAP, honesta: [call("consultar_ofertas"), { text: "Sí: la oferta Amor y Amistad, 20% de descuento." }], inventada: "Sí, una oferta exclusiva del 35% para ti.", no: /35%/ },
  ];
  assert.equal(CASOS.length, 18);

  for (const c of CASOS) {
    it(`${c.n}. «${c.pregunta}»: lo honesto sale; lo inventado no`, async () => {
      snaps[A.tenantId] = c.mundo();
      if (c.backend) {
        // El cliente es DETAL y habla de lo mayorista: el sistema NO llama a ningún modelo; pasa a una asesora con el mensaje fijo y no se entrega ni una cifra.
        const r = await turno([], c.pregunta, { canal: "retail" });
        assert.equal(r.outcome, "handoff");
        assert.equal(r.provider.requests.length, 0, "el modelo ni siquiera se llamó");
        assert.ok(!sent.some((t) => /\$\d|\d\s?%/.test(t)), sent.join(" | "));
        assert.ok(!sent.some((t) => c.no.test(t)));
        return;
      }
      // Aretes con su referencia en la conversación (search_products la recuerda).
      const honesto = await turno(c.honesta, c.pregunta, { canal: c.canal ?? "retail" });
      assert.equal(honesto.outcome, "replied", `la respuesta honesta debía salir (${honesto.trace.grounding.violations.join(",")} ${honesto.trace.error_kind ?? ""})`);
      assert.deepEqual(honesto.trace.grounding.violations, []);
      sent.length = 0;
      handoffs.length = 0;
      // El mismo cliente insiste con el modelo que INVENTA (dos veces: la corrección no lo arregla).
      const inventando = await turno([{ text: c.inventada }, { text: c.inventada }], c.pregunta, { canal: c.canal ?? "retail", wa: "573001119999" });
      assert.notEqual(inventando.outcome, "replied", "lo inventado no debía salir tal cual");
      assert.ok(!sent.some((t) => c.no.test(t)), `lo inventado se envió: ${sent.join(" | ")}`);
      assert.ok(inventando.trace.grounding.violations.length > 0);
      assert.equal(inventando.trace.grounding.corrected, true, "se le pidió corregir una vez");
      assert.ok(["handoff", "fallback"].includes(inventando.outcome));
    });
  }

  it("cuando el modelo inventa lo COMERCIAL y no corrige: el cliente recibe el mensaje FIJO y la conversación pasa a una asesora (una sola vez)", async () => {
    snaps[A.tenantId] = instantanea();
    const r = await turno([{ text: "Tenemos descuentos del 40% hoy." }, { text: "Sí, 40% de descuento en todo." }], "¿hay descuentos?");
    assert.equal(r.outcome, "handoff");
    assert.equal(sent.at(-1), FALLBACK_MESSAGES.commercial);
    assert.equal(handoffs.length, 1);
    assert.equal(r.trace.handoff?.source, "system");
    assert.ok(r.trace.grounding.violations.includes("commercial"));
    assert.deepEqual(r.trace.grounding.codes, ["percent_unbacked", "discount_unbacked"]);
    // La corrección que recibió el modelo nombra las herramientas, y no revela nada del cliente.
    const correccion = r.provider.requests.flatMap((rq) => rq.turns).find((t) => t.role === "user" && t.text.startsWith("[VERIFICACIÓN DEL SISTEMA]"));
    assert.ok(correccion && correccion.role === "user" && /consultar_ofertas/.test(correccion.text));
  });

  it("si el modelo corrige consultando la herramienta, la respuesta sale (una sola corrección)", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR()] });
    const r = await turno([{ text: "Tenemos 50% de descuento." }, call("consultar_ofertas"), { text: "Tenemos la oferta Amor y Amistad: 20% de descuento." }], "¿hay descuentos?");
    assert.equal(r.outcome, "replied");
    assert.equal(sent.at(-1), "Tenemos la oferta Amor y Amistad: 20% de descuento.");
    assert.equal(r.trace.grounding.corrected, true);
    assert.deepEqual(r.trace.grounding.codes, ["percent_unbacked", "discount_unbacked"]);
  });
});

describe("regresión: sin herramientas comerciales en la lista del número, NADA cambia", () => {
  it("el prompt es el de siempre (sin la sección comercial) y con ellas trae las reglas UNA vez, antes del estado (que sigue siendo lo último)", () => {
    const facts: TurnFacts = { channel: "retail", channelSource: "number_config", customerName: null, activeOrder: null, handoffActive: false };
    const sin = buildSystemInstruction(cfgDe(A, PN_A, { herramientas: SIN_COMERCIAL }), emptyConversationState(), facts);
    const con = buildSystemInstruction(cfgDe(A, PN_A), emptyConversationState(), facts);
    assert.ok(!sin.includes("INFORMACIÓN COMERCIAL") && !sin.includes("consultar_ofertas"));
    assert.equal(con.split("=== INFORMACIÓN COMERCIAL").length - 1, 1);
    assert.ok(con.includes(COMMERCIAL_RULES));
    assert.ok(con.indexOf("INFORMACIÓN COMERCIAL") < con.indexOf("=== ESTADO DE LA CONVERSACIÓN"), "el estado sigue siendo lo último");
    // Salvo esa sección, el prompt es EXACTAMENTE el mismo.
    assert.equal(con.replace(`\n\n=== INFORMACIÓN COMERCIAL (herramientas del sistema) ===\n${COMMERCIAL_RULES}`, ""), sin);
  });

  it("el prompt no lleva NINGÚN dato comercial: ni ofertas, ni combos, ni campañas, ni políticas del negocio (solo cómo consultarlos)", async () => {
    snaps[A.tenantId] = instantanea({ ofertas: [AMOR()], combos: [REGALO()], campanas: [NAVIDAD()], contenidos: [GARANTIA, MAYORISTA_INFO] });
    const r = await turno([{ text: "Hola, ¿en qué te ayudo?" }], "hola");
    assert.equal(r.outcome, "replied");
    for (const rq of r.provider.requests) for (const dato of ["Amor y Amistad", "Regalo completo", "Navidad", "30 días", "contra defectos"]) assert.ok(!rq.system.includes(dato), dato);
  });

  it("sin las herramientas, lo que diga el modelo no se vigila como comercial (la guarda NO actúa) y la traza queda sin cambios", async () => {
    const cfg = cfgDe(A, PN_A, { herramientas: SIN_COMERCIAL });
    const r = await turno([{ text: "Hoy hay 30% de descuento en todo 😊" }], "hola", { config: cfg });
    assert.equal(r.outcome, "replied");
    assert.equal(sent.at(-1), "Hoy hay 30% de descuento en todo 😊");
    assert.deepEqual(r.trace.grounding, { violations: [], corrected: false });
    assert.deepEqual(r.provider.requests[0].tools?.map((t) => t.name).filter((n) => (HERRAMIENTAS_COMERCIALES as readonly string[]).includes(n)), []);
  });

  it("un negocio con las herramientas pero SIN el módulo del CMS: «no disponible»; el modelo no puede afirmar nada comercial y termina en una asesora", async () => {
    snaps[A.tenantId] = null;
    const r = await turno([call("consultar_ofertas"), { text: "Tenemos 20% de descuento." }, { text: "Tenemos 20% de descuento." }], "¿hay descuentos?");
    assert.notEqual(r.outcome, "replied");
    assert.ok(!sent.some((t) => t.includes("20%")));
    assert.equal(toolOutputs(r.provider)[0].output && (toolOutputs(r.provider)[0].output as { error?: { code?: string } }).error?.code, "UNAVAILABLE");
  });

  it("dentro del turno del runtime, las variables de los textos ({{minimo_mayorista}}) se resuelven con la configuración del negocio de ESTE número", async () => {
    snaps[A.tenantId] = instantanea({ contenidos: [MAYORISTA_INFO] });
    const r = await turno([call("consultar_contenido_comercial", { tema: "mayoristas" }), { text: "La compra inicial mayorista parte desde $750.000." }], "¿cuál es la compra inicial?", { canal: "wholesale" });
    assert.equal(r.outcome, "replied");
    const [salida] = toolOutputs(r.provider);
    assert.deepEqual(salida.output.items, [{ title: "Compra mayorista", text: "La compra inicial mayorista parte desde $750.000." }]);
    assert.equal(sent.at(-1), "La compra inicial mayorista parte desde $750.000.");
  });

  it("ASLC conserva EXACTAMENTE sus herramientas: la lista cerrada creció pero la de ASLC no (ni una comercial)", () => {
    for (const n of HERRAMIENTAS_COMERCIALES) assert.ok(!HERRAMIENTAS_ASLC.includes(n), n);
    assert.equal(HERRAMIENTAS_ASLC.length, 16);
  });
});
