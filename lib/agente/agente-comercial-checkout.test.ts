/**
 * BLOQUE 29 · PR 5 — una PREGUNTA COMERCIAL en pleno checkout, con el runtime REAL y un modelo guionizado (ni Supabase, ni Gemini, ni Meta; negocios ficticios):
 *
 *   - la pregunta se responde con las herramientas comerciales (lectura pura) y SOLO con lo que devuelven; el checkout no cambia (mismo paso, mismo carrito, mismo pedido);
 *   - lo que el modelo invente (descuento, vigencia, «no hay») no sale: el cliente recibe el texto neutro del checkout y el paso se repite;
 *   - ninguna herramienta que escribe (carrito, pedido) está disponible durante la pregunta;
 *   - lo que se le dice al cliente es lo mismo que cobra el pedido (la oferta que ARIA cita es la que ya rebajó el total).
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { conPrecios } from "@/lib/catalogo/repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import type { HistoryRow } from "@/lib/agente/contexto";
import { createMemoryConversationStateStore, type ConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import type { AgentToolsDeps } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES, HERRAMIENTAS_COMERCIALES, type AgentToolName } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn } from "@/lib/agente/runtime";
import { createMemoryCustomerChannelStore } from "@/lib/agente/clasificacion";
import { CHECKOUT_MESSAGES } from "@/lib/agente/checkout";
import { crearPuertoPreciosCms } from "@/lib/cms-comercial/precios";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { AHORA, contenido, instantanea, oferta, publicada } from "@/lib/cms-comercial/testing/fixtures";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const PN_A = "100000000000001";
const CLIENTE = "573001112233";
const KEY = Buffer.alloc(32, 7);

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let engine: ReturnType<typeof createOrderEngine>;
let stateStore: ConversationStateStore;
let canales: ReturnType<typeof createMemoryCustomerChannelStore>;
let reloj: number;
let snap: InstantaneaCms | Error | null;
let history: Map<string, HistoryRow[]>;
let sent: string[];
let pausas: string[];
let seq: number;

const puerto = crearPuertoPreciosCms({
  cargar: async () => {
    if (snap instanceof Error) throw snap;
    return snap;
  },
  ahora: () => reloj,
});

const SIN_COMERCIAL: AgentToolName[] = AGENT_TOOL_NAMES.filter((t) => !(HERRAMIENTAS_COMERCIALES as readonly string[]).includes(t));
const configRow = (over: Partial<AgentConfigRow> = {}): AgentConfigRow => ({
  id_tenant: A.tenantId,
  phone_number_id: PN_A,
  tipo: "catalog_sales",
  habilitado: true,
  proveedor: "gemini",
  modelo: "gemini-3.6-flash",
  credencial_ref: "env:GEMINI_KEY_PRUEBA",
  nivel_razonamiento: "low",
  herramientas: [...AGENT_TOOL_NAMES],
  canal: "retail",
  negocio: { nombre_agente: "Aria", nombre_negocio: "Joyería Ficticia" },
  clasificacion_cliente: true,
  checkout_conversacional: true,
  ...over,
});
const cfg = (over: Partial<AgentConfigRow> = {}) => (parseAgentConfig(configRow(over), { tenantId: A.tenantId, phoneNumberId: PN_A }) as { config: AgentRuntimeConfig }).config;

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  pedidos = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => reloj });
  stateStore = createMemoryConversationStateStore();
  canales = createMemoryCustomerChannelStore({ [PN_A]: A.tenantId });
  reloj = AHORA;
  snap = null;
  history = new Map();
  sent = [];
  pausas = [];
  seq = 0;
  engine = createOrderEngine({
    orders: pedidos,
    catalog: conPrecios(mem.repo, puerto),
    key: KEY,
    sink: memoryOrderEventSink(),
    log: () => {},
    now: () => new Date(reloj),
    handoff: {
      async pauseConversation({ contact }) {
        pausas.push(contact.waId);
        return { ok: true };
      },
    },
  });
  mem.setProfile(A.tenantId, { name: "Joyería", whatsapp: "573001110000" });
  mem.enableModule(A.tenantId);
  await admin.ensurePublication(A);
});

function toolDeps(): AgentToolsDeps {
  return {
    engine,
    catalog: conPrecios(mem.repo, puerto),
    log: () => {},
    ownsPhoneNumber: async (tenantId, pn) => tenantId === A.tenantId && pn === PN_A,
    // Nombre confiable: el checkout salta directo a la entrega.
    customerName: async () => "Laura",
    rememberCustomerName: async () => {},
    siteUrl: () => "https://dulabs.test",
    comercial: {
      async cargar() {
        if (snap instanceof Error) throw snap;
        return snap;
      },
    },
  };
}

async function turno(script: SimulatedStep[], text: string, opts: { config?: AgentRuntimeConfig } = {}) {
  await canales.setInitial({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE }, "retail", "cliente");
  const provider = createSimulatedProvider(script);
  const wamid = `wamid.in.${++seq}`;
  const h = history.get(CLIENTE) ?? [];
  history.set(CLIENTE, h);
  h.push({ direccion: "entrante", contenido: text, origen: "entrante", wamid });
  const r = await runAgentTurn(
    {
      config: opts.config ?? cfg(),
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
    { tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE, wamid, text, buttonId: null },
  );
  return { ...r, provider };
}

const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });
const estado = async (): Promise<ConversationState> => (await stateStore.load({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE })).state;
const ultimo = () => sent.at(-1) ?? "";

const AMOR = () => publicada("amor", oferta({ nombre: "Amor y Amistad", alcance: { todos: true, referencias: [], categorias: [] }, condiciones: "Hasta agotar existencias." }));
const GARANTIA = () => publicada("garantia", contenido({ tema: "garantias", titulo: "¿Tienen garantía?", texto: "Sí: 30 días contra defectos de fábrica." }));

/** Un cliente al DETAL con un collar en el carrito y el checkout abierto en la entrega. */
async function enCheckout() {
  const p = await admin.createProduct(A, { name: "Collar", retailPrice: 70_000, wholesalePrice: 40_000, stock: 5 });
  await turno([call("update_cart", { items: [{ reference: p.reference, quantity: 1 }] }), { text: "Listo, lo agregué." }], `quiero 1 ${p.reference}`);
  await turno([call("create_order_request"), { text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "me lo llevo");
  assert.equal((await estado()).checkout?.step, "delivery");
  return p;
}
const pedidoActual = () => pedidos.orders.filter((o) => o.contact?.waId === CLIENTE).at(-1)!;

describe("pregunta comercial durante el checkout", () => {
  it("se responde con la herramienta (lectura pura) y el checkout NO cambia: mismo paso, mismo carrito, mismo pedido", async () => {
    snap = instantanea({ contenidos: [GARANTIA()] });
    await enCheckout();
    const antes = JSON.stringify({ cart: (await estado()).cart, step: (await estado()).checkout?.step, pedido: pedidoActual() });
    const r = await turno([call("consultar_contenido_comercial", { tema: "garantias" }), { text: "Sí: 30 días contra defectos de fábrica." }], "¿tienen garantía?");
    assert.equal(r.trace.checkout?.action, "question");
    assert.equal(r.outcome, "replied");
    assert.ok(r.reply?.includes("Sí: 30 días contra defectos de fábrica."), r.reply ?? "");
    assert.deepEqual(r.trace.tool_calls.map((t) => [t.name, t.result]), [["consultar_contenido_comercial", "ok"]]);
    // El estado, el carrito y el pedido siguen EXACTAMENTE igual.
    assert.equal(JSON.stringify({ cart: (await estado()).cart, step: (await estado()).checkout?.step, pedido: pedidoActual() }), antes);
    assert.equal(pedidoActual().status, "pending_confirmation");
    assert.equal(pausas.length, 0);
    // Y solo con herramientas de lectura: las comerciales sí, las que escriben no.
    const nombres = r.provider.requests[0].tools.map((t) => t.name);
    for (const n of HERRAMIENTAS_COMERCIALES) assert.ok(nombres.includes(n), n);
    for (const n of ["update_cart", "create_order_request", "confirm_order", "request_human"]) assert.ok(!nombres.includes(n), n);
  });

  it("lo que ARIA cita es lo que cobra el pedido: la oferta que dice (20%) es la que ya rebajó el total, y la pregunta no lo toca", async () => {
    snap = instantanea({ ofertas: [AMOR()] });
    await enCheckout();
    const total = pedidoActual().total;
    assert.equal(total, 56_000, "70.000 con el 20% de «Amor y Amistad»");
    const r = await turno([call("consultar_ofertas"), { text: "Tienes la oferta Amor y Amistad: 20% de descuento, y ya está aplicada a tu pedido." }], "¿cuánto es el descuento?");
    assert.equal(r.trace.checkout?.action, "question");
    assert.ok(r.reply?.includes("20% de descuento"), r.reply ?? "");
    assert.equal(pedidoActual().total, total);
    assert.equal(pedidoActual().status, "pending_confirmation");
  });

  it("si el modelo INVENTA un descuento no sale: el cliente recibe el texto neutro del checkout y el paso se repite (sin traspaso, sin tocar el pedido)", async () => {
    snap = instantanea({ ofertas: [AMOR()], contenidos: [GARANTIA()] });
    await enCheckout();
    const total = pedidoActual().total;
    const r = await turno([{ text: "Claro, tenemos 40% de descuento en todo." }], "¿hay algún descuento?");
    assert.equal(r.trace.checkout?.action, "question");
    assert.ok(!sent.some((t) => t.includes("40%")), sent.join(" | "));
    assert.ok(ultimo().includes(CHECKOUT_MESSAGES.questionFallback), ultimo());
    assert.ok(r.trace.grounding.violations.includes("commercial"));
    assert.ok(r.trace.grounding.codes?.includes("percent_unbacked"), JSON.stringify(r.trace.grounding));
    assert.equal((await estado()).checkout?.step, "delivery", "el paso no avanzó ni retrocedió");
    assert.equal(pedidoActual().total, total);
    assert.equal(pausas.length, 0, "una pregunta sin respuesta verificable no pasa sola a una asesora (así lo define el checkout del negocio)");
  });

  // «No hay» solo se puede decir con empty=true. El pedido se arma con la lectura sana; DESPUÉS el módulo se apaga o la lectura falla.
  for (const [caso, mundo] of [
    ["el módulo del CMS no existe para el negocio", null],
    ["la lectura falla", new Error("lectura caída")],
  ] as const) {
    it(`si ${caso} en pleno checkout, la herramienta dice «no disponible» y ARIA NO puede afirmar que no hay ofertas`, async () => {
      snap = instantanea();
      await enCheckout();
      snap = mundo;
      sent.length = 0;
      const r = await turno([call("consultar_ofertas"), { text: "Hoy no tenemos ofertas." }], "¿hay ofertas?");
      assert.equal(r.trace.checkout?.action, "question");
      assert.equal(r.trace.tool_calls[0].result, "UNAVAILABLE");
      assert.ok(!sent.some((t) => t.includes("no tenemos ofertas")), sent.join(" | "));
      assert.ok(ultimo().includes(CHECKOUT_MESSAGES.questionFallback), ultimo());
      assert.ok(r.trace.grounding.codes?.includes("absence_unbacked"), JSON.stringify(r.trace.grounding));
      assert.equal((await estado()).checkout?.step, "delivery");
    });
  }

  it("con la lectura sana y de verdad SIN ofertas (empty=true) sí puede decir que no hay", async () => {
    snap = instantanea();
    await enCheckout();
    const r = await turno([call("consultar_ofertas"), { text: "Por ahora no tenemos ofertas vigentes." }], "¿hay ofertas?");
    assert.equal(r.trace.checkout?.action, "question");
    assert.ok(r.reply?.includes("no tenemos ofertas vigentes"), r.reply ?? "");
    assert.deepEqual(r.trace.grounding, { violations: [], corrected: false });
  });

  it("durante la pregunta ninguna herramienta que escribe está disponible: el carrito y el pedido no se tocan (TOOL_NOT_ALLOWED)", async () => {
    snap = instantanea({ contenidos: [GARANTIA()] });
    const p = await enCheckout();
    const antes = JSON.stringify({ cart: (await estado()).cart, pedido: pedidoActual() });
    const r = await turno([call("update_cart", { items: [{ reference: p.reference, quantity: 5 }] }), call("consultar_contenido_comercial", { tema: "garantias" }), { text: "Sí: 30 días contra defectos de fábrica." }], "¿tienen garantía?");
    assert.equal(r.trace.tool_calls[0].result, "TOOL_NOT_ALLOWED");
    assert.equal(JSON.stringify({ cart: (await estado()).cart, pedido: pedidoActual() }), antes);
    assert.equal(pedidoActual().lines[0].quantity, 1);
  });

  it("sin las herramientas comerciales en la lista del número, la pregunta del checkout queda EXACTAMENTE como antes (ni se declaran ni se vigilan)", async () => {
    snap = instantanea({ ofertas: [AMOR()] });
    const config = cfg({ herramientas: SIN_COMERCIAL });
    const anillo = await admin.createProduct(A, { name: "Anillo", retailPrice: 50_000, stock: 5 });
    await turno([call("update_cart", { items: [{ reference: anillo.reference, quantity: 1 }] }), { text: "Listo." }], `quiero 1 ${anillo.reference}`, { config });
    await turno([call("create_order_request"), { text: "x" }], "me lo llevo", { config });
    assert.equal((await estado()).checkout?.step, "delivery");
    const r = await turno([{ text: "Hoy hay 30% de descuento." }], "¿hay descuento?", { config });
    assert.equal(r.trace.checkout?.action, "question");
    const nombres = r.provider.requests[0].tools.map((t) => t.name);
    for (const n of HERRAMIENTAS_COMERCIALES) assert.ok(!nombres.includes(n), n);
    assert.deepEqual(r.trace.grounding, { violations: [], corrected: false });
  });
});
