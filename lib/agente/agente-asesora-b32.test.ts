/**
 * Bloque 32 — ASESORA "ARIA" (manual de atención de la joyería): personalidad y base de conocimiento
 * OFICIAL en el contexto, bienvenidas FIJAS tras elegir detal / por mayor, ciudad dentro de la
 * dirección, nota de envío, aviso de compra inicial mayorista y textos de pago del negocio.
 * Todo por configuración (`negocio`): un negocio sin ella queda exactamente como antes.
 * Ninguna prueba toca Supabase, Gemini ni Meta. Negocio, clientes y productos ficticios.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import type { HistoryRow } from "@/lib/agente/contexto";
import { createMemoryConversationStateStore, type ConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import type { AgentToolsDeps } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn, type AgentTurnTrace } from "@/lib/agente/runtime";
import { INTENT_MENU, RETAIL_GIFT_BUTTON, START_MESSAGES, WHOLESALE_MENU, createMemoryCustomerChannelStore, resolveStartAction } from "@/lib/agente/clasificacion";
import { CHECKOUT_BUTTONS, CHECKOUT_MESSAGES, wholesaleMinimumBlocked } from "@/lib/agente/checkout";
import { PLATFORM_RULES } from "@/lib/agente/contexto";
import { ciudadEnDireccion } from "@/lib/agente/lenguaje/interpretar";
import { mensajeNotificacion } from "@/lib/catalogo/pedidos/notificaciones";

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
let pausas: string[];
let pausasHasta: string[];
let reloj: number;
let history: Map<string, HistoryRow[]>;
let sent: string[];
let buttons: Array<{ body: string; ids: string[] }>;
let nombreGuardado: string | null;
let nombresRecordados: string[];
let seq: number;

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
  negocio: { nombre_agente: "Sofía", nombre_negocio: NEGOCIO },
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
  canales = createMemoryCustomerChannelStore({ [PN_A]: A.tenantId, [PN_B]: B.tenantId });
  pausas = [];
  pausasHasta = [];
  reloj = Date.parse("2026-09-24T15:00:00Z");
  history = new Map();
  sent = [];
  buttons = [];
  nombreGuardado = null;
  nombresRecordados = [];
  seq = 0;
  engine = createOrderEngine({
    orders: pedidos,
    catalog: mem.repo,
    key: KEY,
    sink: memoryOrderEventSink(),
    log: () => {},
    now: () => new Date(reloj),
    handoff: {
      async pauseConversation({ contact, until }) {
        pausas.push(contact.waId);
        pausasHasta.push(until ?? "estandar");
        return { ok: true };
      },
    },
  });
  for (const actor of [A, B]) {
    mem.setProfile(actor.tenantId, { name: "Joyería", whatsapp: "573001110000" });
    mem.enableModule(actor.tenantId);
    await admin.ensurePublication(actor);
  }
});

async function producto(name: string, retail: number, wholesale: number, stock: number) {
  return admin.createProduct(A, { name, retailPrice: retail, wholesalePrice: wholesale, stock });
}

function toolDeps(): AgentToolsDeps {
  return {
    engine,
    catalog: mem.repo,
    log: () => {},
    ownsPhoneNumber: async (tenantId, pn) => (tenantId === A.tenantId && pn === PN_A) || (tenantId === B.tenantId && pn === PN_B),
    customerName: async () => nombreGuardado,
    rememberCustomerName: async (_k, n) => {
      nombresRecordados.push(n);
    },
    siteUrl: () => "https://dulabs.test",
  };
}

async function turno(script: SimulatedStep[], text: string, opts: { config?: AgentRuntimeConfig; buttonId?: string; waId?: string; wamid?: string } = {}) {
  const provider = createSimulatedProvider(script);
  const waId = opts.waId ?? CLIENTE;
  const wamid = opts.wamid ?? `wamid.in.${++seq}`;
  const h = history.get(waId) ?? [];
  history.set(waId, h);
  h.push({ direccion: "entrante", contenido: text, origen: "entrante", wamid });
  const traces: AgentTurnTrace[] = [];
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
        async sendButtons(body: string, bs: ReadonlyArray<{ id: string; title: string }>) {
          buttons.push({ body, ids: bs.map((b) => b.id) });
          sent.push(body);
          return { sent: true, wamid: `wamid.btn.${++seq}` };
        },
        humanTookOver: async () => false,
      },
      log: (t) => traces.push(t),
      now: () => reloj,
      retry: { sleep: async () => {}, random: () => 0 },
    },
    { tenantId: A.tenantId, phoneNumberId: PN_A, waId, wamid, text, buttonId: opts.buttonId ?? null },
  );
  return { ...r, provider };
}

const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });
const estado = async (waId = CLIENTE): Promise<ConversationState> => (await stateStore.load({ tenantId: A.tenantId, phoneNumberId: PN_A, waId })).state;
const clasificar = (canal: "retail" | "wholesale", waId = CLIENTE) => canales.setInitial({ tenantId: A.tenantId, phoneNumberId: PN_A, waId }, canal, "cliente");
const stockDe = (id: string) => mem.inventory.stockOf(id);
const boton = (grupo: keyof typeof CHECKOUT_BUTTONS, i: number) => CHECKOUT_BUTTONS[grupo][i] as { id: string; title: string };
const tocar = (grupo: keyof typeof CHECKOUT_BUTTONS, i: number, waId = CLIENTE) => turno([], boton(grupo, i).title, { buttonId: boton(grupo, i).id, waId });

/** Carrito con el producto y el MODELO detecta la compra (create_order_request): arranca el checkout. */
async function comprar(ref: string, qty: number, waId = CLIENTE) {
  await turno([call("update_cart", { items: [{ reference: ref, quantity: qty }] }), { text: "Listo, lo agregué." }], `quiero ${qty} ${ref}`, { waId });
  // El texto del modelo nunca se usa: el backend toma el control (este paso no debe consumirse).
  return turno([call("create_order_request"), { text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "me encantan, los quiero", { waId });
}


// ---------------------------------------------------------------------------
// Configuración de la asesora (forma del manual de la joyería; datos ficticios)
// ---------------------------------------------------------------------------

const MINIMO = 750_000;
const ARIA = {
  nombre_agente: "Aria",
  nombre_negocio: NEGOCIO,
  saludo: "¡Hola! ✨ Soy Aria, tu asesora de Joyería Ficticia 💎",
  personalidad: "Cercana, elegante y buena vendedora sin presionar. Primero entiendo qué busca el cliente, luego recomiendo pocas opciones y después le facilito la compra.",
  conocimiento: [
    { tema: "Ubicación", info: "Centro Comercial Ficticio, locales 1 y 2, Ciudad Prueba." },
    { tema: "Mayoristas", info: "La compra inicial mayorista parte de $750.000, sujeta a condiciones vigentes." },
    { tema: "Garantías", info: "Pendiente de definir: no inventes condiciones; pide la pieza, la fecha de compra y fotos, y pasa con una asesora." },
  ],
  inicio: {
    detal: "¡Con mucho gusto! 💖 Cuéntame qué estás buscando: ¿es para ti o para regalar?",
    mayor: "¡Súper! 💎 Si estás buscando surtir tu negocio, estás en el lugar indicado. La compra inicial mayorista parte de $750.000. ¿Ya tienes tu negocio o estás empezando?",
    buscar: "Cuéntame qué pieza buscas 💎 o envíame la foto o la referencia.",
  },
  pedido: {
    pregunta_pago: "¿Cómo deseas pagar? 💎\n🏦 Transferencia: Nequi, Daviplata o cuenta bancaria\n💵 En tienda: tarjeta o Addi",
    nota_envio_domicilio: "Envío por transportadora (aprox. 2 a 5 días). El valor te lo confirmamos según tu ciudad.",
    minimo_mayorista: MINIMO,
    nota_confirmado: "Una asesora te enviará los datos oficiales de pago 💎",
    direccion_tienda: "Centro Comercial Ficticio, locales 1 y 2, Ciudad Prueba",
  },
};
const aria = () => cfg({ negocio: ARIA });
const sinDatos = { nombre: "x", pedido: "DL-ORD-AAAAAA", entrega: "tienda" as const, negocio: null };

describe("B32 · configuración de la asesora (fail-closed)", () => {
  it("la del manual es válida; la de antes (sin campos nuevos) sigue válida", () => {
    assert.equal(parseAgentConfig(configRow({ negocio: ARIA }), { tenantId: A.tenantId, phoneNumberId: PN_A }).kind, "ok");
    assert.equal(parseAgentConfig(configRow(), { tenantId: A.tenantId, phoneNumberId: PN_A }).kind, "ok");
  });

  it("claves desconocidas, textos o listas demasiado largas y números inválidos => config inválida (el agente no corre con datos a medias)", () => {
    const malas: unknown[] = [
      { ...ARIA, inicio: { ...ARIA.inicio, otro: "x" } },
      { ...ARIA, pedido: { ...ARIA.pedido, descuento: 10 } },
      { ...ARIA, conocimiento: Array.from({ length: 41 }, (_, i) => ({ tema: `t${i}`, info: "x" })) },
      { ...ARIA, conocimiento: [{ tema: "x", info: "y".repeat(801) }] },
      { ...ARIA, conocimiento: [{ tema: "x", info: "y", extra: 1 }] },
      { ...ARIA, personalidad: "p".repeat(1501) },
      { ...ARIA, inicio: { mayor: "m".repeat(901) } },
      { ...ARIA, pedido: { minimo_mayorista: -1 } },
      { ...ARIA, pedido: { minimo_mayorista: 1.5 } },
    ];
    for (const negocio of malas) {
      assert.deepEqual(parseAgentConfig(configRow({ negocio }), { tenantId: A.tenantId, phoneNumberId: PN_A }), { kind: "invalid", reason: "business_config_invalid" });
    }
  });
});

describe("B32 · contexto del modelo: personalidad e información oficial", () => {
  it("la instrucción de sistema trae la personalidad, cada tema del conocimiento y la regla de no inventar", async () => {
    await clasificar("retail");
    const r = await turno([{ text: "¡Hola! Estamos en el Centro Comercial Ficticio 💎" }], "¿dónde están ubicados?", { config: aria() });
    const sys = r.provider.requests[0].system;
    assert.match(sys, /Cómo conversas y vendes: Cercana, elegante/);
    assert.match(sys, /INFORMACIÓN OFICIAL DEL NEGOCIO/);
    assert.match(sys, /si algo no está aquí ni en las herramientas, no lo sabes/);
    for (const k of ARIA.conocimiento) assert.ok(sys.includes(`- ${k.tema}: ${k.info}`), k.tema);
    // Lo confiable va en el sistema; nunca en los turnos del cliente.
    assert.ok(!JSON.stringify(r.provider.requests[0].turns).includes("Centro Comercial Ficticio, locales"));
  });

  it("sin conocimiento configurado no aparece la sección; la regla de categorías es de la plataforma", async () => {
    await clasificar("retail");
    const r = await turno([{ text: "hola" }], "hola, ¿qué tal?");
    assert.ok(!r.provider.requests[0].system.includes("INFORMACIÓN OFICIAL DEL NEGOCIO"));
    assert.match(PLATFORM_RULES, /14\. No enumeres de memoria tipos de producto o categorías/);
  });
});

describe("B32 · bienvenidas fijas tras elegir detal / por mayor (sin modelo)", () => {
  it("DETAL con config: el mensaje del negocio + Buscar / Es para regalo / Ver catálogo; sin modelo", async () => {
    await turno([], "hola", { config: aria() });
    const r = await turno([], "🛍️ Compra al detal", { config: aria(), buttonId: "canal_detal" });
    assert.equal(r.trace.start, "intent_menu");
    assert.equal(r.provider.requests.length, 0);
    assert.deepEqual(buttons.at(-1), { body: ARIA.inicio.detal, ids: [INTENT_MENU.buttons[0].id, RETAIL_GIFT_BUTTON.id, INTENT_MENU.buttons[1].id] });
  });

  it("DETAL sin config: el menú de siempre (otros negocios no cambian)", async () => {
    await turno([], "hola");
    await turno([], "🛍️ Compra al detal", { buttonId: "canal_detal" });
    assert.deepEqual(buttons.at(-1), { body: INTENT_MENU.body, ids: INTENT_MENU.buttons.map((b) => b.id) });
  });

  it("POR MAYOR con config: el mensaje del negocio con Ya tengo negocio / Voy a emprender / Ver catálogo; sin modelo", async () => {
    await turno([], "hola", { config: aria() });
    const r = await turno([{ text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "📦 Compra por mayor", { config: aria(), buttonId: "canal_mayor" });
    assert.equal(r.trace.start, "wholesale_welcome");
    assert.equal(r.provider.requests.length, 0, "el modelo no participa");
    assert.deepEqual(buttons.at(-1), { body: ARIA.inicio.mayor, ids: WHOLESALE_MENU.buttons.map((b) => b.id) });
    assert.ok(!sent.includes("TEXTO DEL MODELO QUE NO DEBE SALIR"));
    // "Ver catálogo" del menú mayorista abre el catálogo (mismo botón que el de detal).
    assert.equal(resolveStartAction("📖 Ver catálogo", "accion_catalogo"), "open_catalog");
    // "Ya tengo negocio" no es una acción fija: su texto va al agente (que pregunta con el conocimiento).
    assert.equal(resolveStartAction("🏪 Ya tengo negocio", "mayor_negocio"), null);
  });

  it("POR MAYOR sin config: conversa el modelo, como antes", async () => {
    await turno([], "hola");
    const r = await turno([{ text: "¡Perfecto! ¿Qué buscas?" }], "📦 Compra por mayor", { buttonId: "canal_mayor" });
    assert.notEqual(r.trace.start, "wholesale_welcome");
    assert.equal(r.provider.requests.length, 1);
  });

  it("'Buscar una joya' usa el texto del negocio; sin config, el de siempre", async () => {
    await clasificar("retail");
    await turno([], INTENT_MENU.buttons[0].title, { config: aria(), buttonId: INTENT_MENU.buttons[0].id });
    assert.equal(sent.at(-1), ARIA.inicio.buscar);
    await turno([], INTENT_MENU.buttons[0].title, { buttonId: INTENT_MENU.buttons[0].id });
    assert.equal(sent.at(-1), START_MESSAGES.searchPrompt);
  });

  it("títulos de botón ≤ 20 (Meta)", () => {
    for (const b of [...WHOLESALE_MENU.buttons, RETAIL_GIFT_BUTTON]) assert.ok(b.title.length <= 20, `${b.title} (${b.title.length})`);
  });
});

describe("B32 · ciudad dentro de la dirección", () => {
  it("se separa solo cuando es inequívoca (al final, conocida, no un barrio)", () => {
    assert.deepEqual(ciudadEnDireccion("Cra 24 n 16-54 pasto"), { direccion: "Cra 24 n 16-54", ciudad: "Pasto" });
    assert.deepEqual(ciudadEnDireccion("Calle 5 # 3-2, Ipiales, Nariño"), { direccion: "Calle 5 # 3-2", ciudad: "Ipiales" });
    assert.deepEqual(ciudadEnDireccion("Cll 18 # 25-30 Pasto Nariño Colombia"), { direccion: "Cll 18 # 25-30", ciudad: "Pasto" });
    assert.deepEqual(ciudadEnDireccion("Carrera 7 # 45-10 Bogota D.C."), { direccion: "Carrera 7 # 45-10", ciudad: "Bogotá" });
    assert.deepEqual(ciudadEnDireccion("Calle 10 # 5-20 barrio san juan pasto"), { direccion: "Calle 10 # 5-20 barrio san juan", ciudad: "Pasto" });
    for (const t of ["cra 5 # 3-2 barrio la union", "barrio santa marta casa 3", "Calle 20 # 10-15", "pasto", "Centro comercial Pontevedra", "Calle 10 # 20-30, barrio Centro"]) assert.equal(ciudadEnDireccion(t), null, t);
  });

  it("checkout: 'Cra 24 n 16-54 pasto' => no pregunta la ciudad y el resumen no la repite", async () => {
    const p = await producto("Dije Luna", 27_000, 14_000, 5);
    await clasificar("retail");
    await comprar(p.reference, 1);
    await turno([], "Camila");
    await tocar("delivery", 1);
    await turno([], "Cra 24 n 16-54 pasto");
    assert.equal(sent.at(-1), CHECKOUT_MESSAGES.reference, "salta al paso de la referencia");
    const ck = (await estado()).checkout!;
    assert.deepEqual([ck.address, ck.city], ["Cra 24 n 16-54", "Pasto"]);
    await turno([], "Sin referencia", { buttonId: "checkout_sin_referencia" });
    await tocar("payment", 1);
    assert.ok(sent.at(-1)!.includes("📍 Dirección: Cra 24 n 16-54, Pasto"));
  });

  it("checkout: un barrio con nombre de ciudad => sí pregunta la ciudad (como siempre)", async () => {
    const p = await producto("Dije Sol", 27_000, 14_000, 5);
    await clasificar("retail");
    await comprar(p.reference, 1);
    await turno([], "Camila");
    await tocar("delivery", 1);
    await turno([], "Calle 5 # 3-2 barrio la union");
    assert.equal(sent.at(-1), CHECKOUT_MESSAGES.city);
  });
});

describe("B32 · resumen, pago y confirmación con los textos del negocio", () => {
  it("pregunta de pago del negocio (mismos botones); nota de envío SOLO a domicilio; nota final al confirmar", async () => {
    const p = await producto("Pulsera Girasol", 26_000, 12_500, 5);
    await clasificar("retail");
    await comprar(p.reference, 1);
    const c = aria();
    await turno([], "Camila", { config: c });
    await turno([], boton("delivery", 1).title, { config: c, buttonId: boton("delivery", 1).id });
    await turno([], "Cra 24 n 16-54 pasto", { config: c });
    await turno([], "Sin referencia", { config: c, buttonId: "checkout_sin_referencia" });
    assert.deepEqual(buttons.at(-1), { body: ARIA.pedido.pregunta_pago, ids: CHECKOUT_BUTTONS.payment.map((b) => b.id) });
    await turno([], boton("payment", 1).title, { config: c, buttonId: boton("payment", 1).id });
    const resumen = buttons.at(-1)!.body;
    assert.ok(resumen.includes(`🚚 ${ARIA.pedido.nota_envio_domicilio}`));
    assert.ok(!resumen.includes("compra inicial mayorista"), "detal: sin aviso de mínimo");
    await turno([], boton("summary", 0).title, { config: c, buttonId: boton("summary", 0).id });
    assert.equal(sent.at(-1), CHECKOUT_MESSAGES.confirmed(NEGOCIO, ARIA.pedido.nota_confirmado));
    assert.ok(sent.at(-1)!.includes(ARIA.pedido.nota_confirmado));
  });

  it("recoger en tienda: la dirección de la tienda sale en el resumen y en el mensaje final", async () => {
    const p = await producto("Dije Aurora", 18_000, 10_000, 5);
    await clasificar("retail");
    await comprar(p.reference, 1);
    const c = aria();
    await turno([], "Camila", { config: c });
    await turno([], boton("delivery", 0).title, { config: c, buttonId: boton("delivery", 0).id });
    await turno([], boton("payment", 0).title, { config: c, buttonId: boton("payment", 0).id });
    assert.ok(buttons.at(-1)!.body.includes(`🏬 Entrega: Recoger en tienda\n📍 Dirección de la tienda: ${ARIA.pedido.direccion_tienda}`));
    await turno([], boton("summary", 0).title, { config: c, buttonId: boton("summary", 0).id });
    assert.equal(sent.at(-1), CHECKOUT_MESSAGES.confirmed(NEGOCIO, ARIA.pedido.nota_confirmado, ARIA.pedido.direccion_tienda));
    assert.ok(sent.at(-1)!.includes(`📍 Te esperamos en: ${ARIA.pedido.direccion_tienda}`));
  });

  it("a domicilio: sin la dirección de la tienda (ni en el resumen ni al final)", async () => {
    const p = await producto("Dije Brisa", 18_000, 10_000, 5);
    await clasificar("retail");
    await comprar(p.reference, 1);
    const c = aria();
    await turno([], "Camila", { config: c });
    await turno([], boton("delivery", 1).title, { config: c, buttonId: boton("delivery", 1).id });
    await turno([], "Cra 24 n 16-54 pasto", { config: c });
    await turno([], "Sin referencia", { config: c, buttonId: "checkout_sin_referencia" });
    await turno([], boton("payment", 1).title, { config: c, buttonId: boton("payment", 1).id });
    assert.ok(!buttons.at(-1)!.body.includes("Dirección de la tienda"));
    await turno([], boton("summary", 0).title, { config: c, buttonId: boton("summary", 0).id });
    assert.ok(!sent.at(-1)!.includes("Te esperamos en"));
  });

  it("recoger en tienda: sin nota de envío", async () => {
    const p = await producto("Dije Estrella", 18_000, 10_000, 5);
    await clasificar("retail");
    await comprar(p.reference, 1);
    const c = aria();
    await turno([], "Camila", { config: c });
    await turno([], boton("delivery", 0).title, { config: c, buttonId: boton("delivery", 0).id });
    await turno([], boton("payment", 0).title, { config: c, buttonId: boton("payment", 0).id });
    assert.ok(!buttons.at(-1)!.body.includes("🚚"));
  });

});

describe("B32 · compra inicial mayorista: la PRIMERA compra de un mayorista debe llegar al mínimo", () => {
  /** Carrito + intención de compra con la config de Aria (el checkout arranca en el segundo turno). */
  async function comprarAria(ref: string, qty: number) {
    const c = aria();
    await turno([call("update_cart", { items: [{ reference: ref, quantity: qty }] }), { text: "Listo, lo agregué." }], `quiero ${qty} ${ref}`, { config: c });
    return turno([call("create_order_request"), { text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "lo quiero", { config: c });
  }
  async function hastaResumenAria() {
    const c = aria();
    if ((await estado()).checkout?.step === "name") await turno([], "Camila", { config: c });
    await turno([], boton("delivery", 0).title, { config: c, buttonId: boton("delivery", 0).id });
    return turno([], boton("payment", 1).title, { config: c, buttonId: boton("payment", 1).id });
  }

  it("mensaje: total, mínimo y lo que falta", () => {
    const t = wholesaleMinimumBlocked(47_000, MINIMO);
    assert.match(t, /\$47\.000/);
    assert.match(t, /\$750\.000/);
    assert.match(t, /te faltan \*\$703\.000\*/);
    assert.match(t, /primera compra al por mayor/);
  });

  it("primera compra mayorista de $47.000 => NO arranca el registro; productos al carrito; ningún pedido confirmado", async () => {
    const p = await producto("Pulsera Corazón", 60_000, 47_000, 5);
    await clasificar("wholesale");
    const r = await comprarAria(p.reference, 1);
    assert.equal(r.trace.checkout?.action, "not_confirmed");
    assert.equal(sent.at(-1), wholesaleMinimumBlocked(47_000, MINIMO));
    assert.ok(!sent.includes(CHECKOUT_MESSAGES.askName), "no pide el nombre");
    assert.ok(!sent.includes("TEXTO DEL MODELO QUE NO DEBE SALIR"));
    const st = await estado();
    assert.equal(st.checkout, null);
    assert.deepEqual(st.cart, [{ reference: p.reference, quantity: 1 }], "los productos siguen guardados");
    assert.ok(pedidos.orders.every((o) => o.status !== "confirmed"));
    assert.equal(stockDe(p.id), 5, "no se apartó stock");
  });

  it("primera compra mayorista que llega EXACTO al mínimo => sí arranca el registro", async () => {
    const p = await producto("Set Mayor", 900_000, 375_000, 5);
    await clasificar("wholesale");
    await comprarAria(p.reference, 2);
    assert.equal((await estado()).checkout?.step, "name");
    assert.equal(sent.at(-1), `${CHECKOUT_MESSAGES.intro}\n\n${CHECKOUT_MESSAGES.askName}`);
  });

  it("si baja cantidades en medio del registro y queda por debajo, el resumen NO sale (no se puede confirmar)", async () => {
    const p = await producto("Cadena Mayor", 900_000, 400_000, 5);
    await clasificar("wholesale");
    await comprarAria(p.reference, 2);
    await turno([], "Camila", { config: aria() });
    await turno([], "quita uno", { config: aria() });
    await hastaResumenAria();
    assert.equal(sent.at(-1)!.endsWith(wholesaleMinimumBlocked(400_000, MINIMO)), true, sent.at(-1));
    assert.ok(!buttons.some((b) => b.ids.includes("checkout_confirmar")), "nunca aparece el botón Confirmar");
    assert.equal((await estado()).checkout, null);
  });

  it("un mayorista que YA compró (pedido confirmado) no tiene mínimo en la siguiente compra", async () => {
    const grande = await producto("Set Mayor", 900_000, 400_000, 5);
    const chico = await producto("Dije Pequeño", 20_000, 9_800, 5);
    await clasificar("wholesale");
    await comprarAria(grande.reference, 2);
    await hastaResumenAria();
    await turno([], boton("summary", 0).title, { config: aria(), buttonId: boton("summary", 0).id });
    assert.equal(pedidos.orders.filter((o) => o.status === "confirmed").length, 1, "primera compra de $800.000 registrada");
    pausas.length = 0;
    // Segunda compra, pequeña: arranca normal.
    await stateStore.save({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE }, { ...(await estado()), handoffTurn: null } as ConversationState, (await stateStore.load({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE })).version);
    await comprarAria(chico.reference, 1);
    assert.notEqual((await estado()).checkout, null, "la segunda compra no tiene mínimo");
    assert.ok(!sent.some((t) => t.includes("te faltan")));
  });

  it("detal por debajo del mínimo mayorista => normal (la regla es solo mayorista); sin config => normal", async () => {
    const p = await producto("Dije Luna", 27_000, 14_000, 5);
    await clasificar("retail");
    await comprarAria(p.reference, 1);
    assert.equal((await estado()).checkout?.step, "name");
  });

  it("mayorista sin `minimo_mayorista` configurado => normal (otros negocios)", async () => {
    const p = await producto("Dije Sol", 27_000, 14_000, 5);
    await clasificar("wholesale");
    await comprar(p.reference, 1);
    assert.equal((await estado()).checkout?.step, "name");
  });
});

describe("B32 · aviso de pago recibido (texto del manual)", () => {
  it("agradece y dice que sigue la preparación", () => {
    const t = mensajeNotificacion("pago_recibido", sinDatos);
    assert.match(t, /¡Gracias! Te confirmamos que recibimos el pago/);
    assert.match(t, /Continuamos con la preparación/);
  });
});

describe("B32 · configuración entregada para Delacour (scripts/delacour/aria-negocio.json)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const negocio = JSON.parse(require("node:fs").readFileSync("scripts/delacour/aria-negocio.json", "utf8")) as typeof ARIA;

  it("pasa el esquema estricto (si no, el agente se apagaría) y se llama Aria", () => {
    const r = parseAgentConfig(configRow({ negocio }), { tenantId: A.tenantId, phoneNumberId: PN_A });
    assert.equal(r.kind, "ok");
    assert.equal(negocio.nombre_agente, "Aria");
    assert.equal(negocio.pedido.minimo_mayorista, 750_000);
  });

  it("los mensajes con botones caben en WhatsApp (cuerpo ≤ 1024)", () => {
    for (const body of [negocio.inicio.mayor, negocio.inicio.detal, negocio.pedido.pregunta_pago]) assert.ok(body.length <= 1024, body.slice(0, 30));
  });

  it("nunca incluye información interna ni datos por confirmar (código de precios, cuentas, WhatsApp sin confirmar)", () => {
    const todo = JSON.stringify(negocio);
    for (const prohibido of [/I=1/, /Z=2/, /c[oó]digo interno/i, /318[-\s]?371[-\s]?5860/, /15%/, /\bcuenta\s*(n[°º.]|#|:)/i]) assert.ok(!prohibido.test(todo), String(prohibido));
    // Lo pendiente de definir queda explícito para que el asistente no lo invente.
    for (const tema of ["Horario", "Garantías", "Cambios y devoluciones", "Separar mercancía", "Promociones"]) {
      const k = negocio.conocimiento.find((x) => x.tema === tema);
      assert.ok(k && /(pendiente|no inventes|nunca ofrezcas|no ofrezcas|no prometas)/i.test(k.info), tema);
    }
  });
});

describe("B32 · SQL de configuración (scripts/delacour/aria-config.sql)", () => {
  it("lleva exactamente el JSON validado, solo para la fila de Delacour y conservando las demás claves", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const sql = fs.readFileSync("scripts/delacour/aria-config.sql", "utf8");
    const json = sql.split("$aria$")[1];
    assert.deepEqual(JSON.parse(json), JSON.parse(fs.readFileSync("scripts/delacour/aria-negocio.json", "utf8")));
    assert.match(sql, /set negocio = coalesce\(negocio, '\{\}'::jsonb\) \|\| \$aria\$/);
    assert.equal((sql.match(/where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' and phone_number_id = '1428584886997210'/g) ?? []).length, 2);
    assert.match(sql, /APLICAR SOLO DESPUÉS DEL MERGE/);
  });
});
