/**
 * Ofertas del CMS en el motor de pedidos y en ARIA: el precio que paga el cliente en WhatsApp es el MISMO que ve en la tienda, la compra inicial mayorista se mide
 * sobre el valor FINAL (después de descuentos), el pedido guarda la evidencia de la oferta y las herramientas de ARIA solo muestran las ofertas del canal de la
 * conversación. Todo con el motor real y el agente simulado: ni Supabase, ni Gemini, ni Meta. Negocio, clientes y productos ficticios.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { conPrecios } from "@/lib/catalogo/repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { runAgentTool, type AgentToolDeps } from "@/lib/catalogo/pedidos/herramientas";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { publicView } from "@/lib/catalogo/pedidos/contrato";
import { createResolucionCatalogo } from "@/lib/catalogo/resolucion";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import type { HistoryRow } from "@/lib/agente/contexto";
import { createMemoryConversationStateStore, type ConversationStateStore } from "@/lib/agente/estado";
import type { AgentToolsDeps } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn } from "@/lib/agente/runtime";
import { createMemoryCustomerChannelStore, intentMenu } from "@/lib/agente/clasificacion";
import { CHECKOUT_MESSAGES, checkoutButtons, wholesaleMinimumBlocked } from "@/lib/agente/checkout";
import { PERFIL_LEGADO } from "@/lib/agente/perfil-negocio";
import { crearPuertoPreciosCms } from "@/lib/cms-comercial/precios";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { AHORA, instantanea, oferta, publicada } from "@/lib/cms-comercial/testing/fixtures";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const PN_B = "100000000000002";
const CLIENTE = "573001112233";
const KEY = Buffer.alloc(32, 7);
const NEGOCIO = "Joyería Ficticia";
const MINIMO = 750_000;
void intentMenu;

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let engine: ReturnType<typeof createOrderEngine>;
let stateStore: ConversationStateStore;
let canales: ReturnType<typeof createMemoryCustomerChannelStore>;
let reloj: number;
let snaps: Record<string, InstantaneaCms | Error | null>;
let history: Map<string, HistoryRow[]>;
let sent: string[];
let buttons: Array<{ body: string; ids: string[] }>;
let seq: number;

const puerto = crearPuertoPreciosCms({
  cargar: async (tenantId) => {
    const s = snaps[tenantId] ?? null;
    if (s instanceof Error) throw s;
    return s;
  },
  ahora: () => reloj,
});
/** El catálogo con los precios efectivos: lo mismo que cablea producción. */
const catalogo = () => conPrecios(mem.repo, puerto);

const CHECKOUT_BUTTONS = checkoutButtons(PERFIL_LEGADO.opciones);

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
const aria = () =>
  cfg({
    negocio: {
      nombre_agente: "Aria",
      nombre_negocio: NEGOCIO,
      pedido: {
        pregunta_pago: "¿Cómo deseas pagar? 💎\n🏦 Transferencia\n💵 En tienda",
        nota_envio_domicilio: "Envío por transportadora.",
        minimo_mayorista: MINIMO,
        nota_confirmado: "Una asesora te enviará los datos de pago 💎",
        direccion_tienda: "Centro Comercial Ficticio, locales 1 y 2",
      },
    },
  });

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  pedidos = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => reloj });
  stateStore = createMemoryConversationStateStore();
  canales = createMemoryCustomerChannelStore({ [PN_A]: A.tenantId, [PN_B]: B.tenantId });
  reloj = AHORA;
  snaps = {};
  history = new Map();
  sent = [];
  buttons = [];
  seq = 0;
  engine = createOrderEngine({
    orders: pedidos,
    catalog: catalogo(),
    key: KEY,
    sink: memoryOrderEventSink(),
    log: () => {},
    now: () => new Date(reloj),
    handoff: { async pauseConversation() { return { ok: true }; } },
  });
  for (const actor of [A, B]) {
    mem.setProfile(actor.tenantId, { name: "Joyería", whatsapp: "573001110000" });
    mem.enableModule(actor.tenantId);
    await admin.ensurePublication(actor);
  }
});

const producto = (name: string, retail: number, wholesale: number | null, stock: number, actor = A) => admin.createProduct(actor, { name, retailPrice: retail, wholesalePrice: wholesale, stock });
const ofertaSobre = (refs: string[], over: Parameters<typeof oferta>[0] = {}) => publicada("temporada", oferta({ alcance: { todos: false, referencias: refs, categorias: [] }, ...over }));

function toolDeps(): AgentToolsDeps {
  return {
    engine,
    catalog: catalogo(),
    log: () => {},
    ownsPhoneNumber: async (tenantId, pn) => (tenantId === A.tenantId && pn === PN_A) || (tenantId === B.tenantId && pn === PN_B),
    customerName: async () => null,
    rememberCustomerName: async () => {},
    siteUrl: () => "https://dulabs.test",
  };
}

async function turno(script: SimulatedStep[], text: string, opts: { config?: AgentRuntimeConfig; buttonId?: string } = {}) {
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
        async sendButtons(body: string, bs: ReadonlyArray<{ id: string; title: string }>) {
          buttons.push({ body, ids: bs.map((b) => b.id) });
          sent.push(body);
          return { sent: true, wamid: `wamid.btn.${++seq}` };
        },
        humanTookOver: async () => false,
      },
      log: () => {},
      now: () => reloj,
      retry: { sleep: async () => {}, random: () => 0 },
    },
    { tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE, wamid, text, buttonId: opts.buttonId ?? null },
  );
  return { ...r, provider };
}

const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });
const estado = async () => (await stateStore.load({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE })).state;
const clasificar = (canal: "retail" | "wholesale") => canales.setInitial({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE }, canal, "cliente");
const boton = (grupo: keyof typeof CHECKOUT_BUTTONS, i: number) => CHECKOUT_BUTTONS[grupo][i] as { id: string; title: string };

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

const ctx = (over: Partial<Parameters<typeof runAgentTool>[2]> = {}) => ({ tenantId: A.tenantId, channel: "retail" as const, conversation: { phoneNumberId: PN_A, waId: CLIENTE }, requestId: "req-test-0001", ...over });
const deps = (): AgentToolDeps => ({ engine, catalog: catalogo(), ownsPhoneNumber: async () => true });
function ok<T = Record<string, unknown>>(r: Awaited<ReturnType<typeof runAgentTool>>): T {
  assert.equal(r.ok, true, r.ok ? "" : `${r.error.code}: ${r.error.message}`);
  return (r as { ok: true; data: T }).data;
}

describe("la compra inicial mayorista se mide sobre el valor FINAL, después de descuentos", () => {
  it("un pedido que sin la oferta llegaría al mínimo ($800.000) y CON la oferta mayorista del 20% queda en $640.000 NO arranca el registro", async () => {
    const p = await producto("Set Mayor", 900_000, 400_000, 5);
    snaps[A.tenantId] = instantanea({ ofertas: [ofertaSobre([p.reference], { modalidad: "mayorista", beneficio: { tipo: "porcentaje", valor: 20 } })] });
    await clasificar("wholesale");
    const r = await comprarAria(p.reference, 2);
    assert.equal(r.trace.checkout?.action, "not_confirmed");
    assert.equal(sent.at(-1), wholesaleMinimumBlocked(640_000, MINIMO), "el mensaje usa el valor final, no el de lista");
    assert.match(sent.at(-1)!, /te faltan \*\$110\.000\*/);
    assert.ok(!sent.includes(CHECKOUT_MESSAGES.askName));
    assert.equal((await estado()).checkout, null);
  });

  it("el mismo pedido SIN oferta (o con una oferta DETAL, que el mayorista no recibe) llega a $800.000 y sí arranca", async () => {
    const p = await producto("Set Mayor", 900_000, 400_000, 5);
    await clasificar("wholesale");
    await comprarAria(p.reference, 2);
    assert.equal((await estado()).checkout?.step, "name");

    // Otro cliente mayorista con una oferta solo detal: su precio no cambia.
    const q = await producto("Set Mayor 2", 900_000, 400_000, 5);
    snaps[A.tenantId] = instantanea({ ofertas: [ofertaSobre([q.reference], { modalidad: "detal", beneficio: { tipo: "porcentaje", valor: 50 } })] });
    const resueltos = await createResolucionCatalogo({ repo: catalogo() }).resolverReferencias(A.tenantId, [q.reference]);
    assert.equal(resueltos.items[0].prices.wholesale, 400_000);
  });

  it("justo en el mínimo con oferta ($750.000 finales) SÍ arranca", async () => {
    const p = await producto("Pieza Mayor", 1_000_000, 500_000, 9);
    // Precio especial mayorista de 250.000 por pieza: 3 × 250.000 = 750.000 exactos.
    snaps[A.tenantId] = instantanea({ ofertas: [ofertaSobre([p.reference], { modalidad: "mayorista", beneficio: { tipo: "precio_especial", mayorista: 250_000 } })] });
    await clasificar("wholesale");
    await comprarAria(p.reference, 3);
    assert.equal((await estado()).checkout?.step, "name", "750.000 exactos: llega al mínimo");
  });

  it("un peso por debajo del mínimo con la oferta ($749.997 finales) NO arranca", async () => {
    const p = await producto("Pieza Mayor", 1_000_000, 500_000, 9);
    snaps[A.tenantId] = instantanea({ ofertas: [ofertaSobre([p.reference], { modalidad: "mayorista", beneficio: { tipo: "precio_especial", mayorista: 249_999 } })] });
    await clasificar("wholesale");
    await comprarAria(p.reference, 3);
    assert.equal(sent.at(-1), wholesaleMinimumBlocked(749_997, MINIMO));
    assert.equal((await estado()).checkout, null);
  });

  it("si la oferta mayorista aparece EN MEDIO del registro, el resumen se vuelve a validar con el valor final y, por debajo del mínimo, NO se puede confirmar", async () => {
    const p = await producto("Cadena Mayor", 900_000, 400_000, 5);
    await clasificar("wholesale");
    await comprarAria(p.reference, 2); // 800.000: arranca
    assert.equal((await estado()).checkout?.step, "name");
    await turno([], "Camila", { config: aria() });
    snaps[A.tenantId] = instantanea({ ofertas: [ofertaSobre([p.reference], { modalidad: "mayorista", beneficio: { tipo: "porcentaje", valor: 20 } })] });
    await hastaResumenAria();
    assert.ok(sent.at(-1)!.endsWith(wholesaleMinimumBlocked(640_000, MINIMO)), sent.at(-1));
    assert.ok(!buttons.some((b) => b.ids.includes("checkout_confirmar")), "nunca aparece el botón Confirmar");
  });
});

describe("el motor de pedidos y ARIA cobran lo que ve el cliente", () => {
  it("create_order (WhatsApp): el precio unitario es el de la oferta, el total y la confirmación también, y la línea guarda la evidencia", async () => {
    const p = await producto("Aretes", 100_000, null, 10);
    const q = await producto("Cadena", 50_000, null, 10);
    snaps[A.tenantId] = instantanea({ ofertas: [ofertaSobre([p.reference], { nombre: "Amor y Amistad" })] });
    const d = ok<ReturnType<typeof publicView> & { next_step: string }>(
      await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 2 }, { reference: q.reference, quantity: 1 }], idempotency_key: "pedido-ofertas-01" }, ctx(), deps()),
    );
    assert.deepEqual(
      d.lines.map((l) => [l.reference, l.unit_price, l.subtotal, l.list_price, l.offer]),
      [[p.reference, 80_000, 160_000, 100_000, "Amor y Amistad"], [q.reference, 50_000, 50_000, undefined, undefined]],
    );
    assert.equal(d.total, 210_000);
    assert.equal(d.confirmation?.total, 210_000);
    const guardado = pedidos.orders[0];
    assert.deepEqual(guardado.lines[0].offer, { key: "temporada", name: "Amor y Amistad", version: 1 });
    assert.equal(guardado.lines[0].listPrice, 100_000);
    assert.ok(!("offer" in guardado.lines[1]));
  });

  it("create_order MAYORISTA: la línea guarda la oferta MAYORISTA con su precio de lista mayorista (nunca la del detal); sin oferta mayorista no guarda ninguna evidencia", async () => {
    const p = await producto("Aretes", 100_000, 70_000, 10);
    snaps[A.tenantId] = instantanea({
      ofertas: [
        ofertaSobre([p.reference], { nombre: "Amor y Amistad", modalidad: "detal", beneficio: { tipo: "porcentaje", valor: 20 } }),
        publicada("mayoristas", oferta({ nombre: "Surtido mayor", modalidad: "mayorista", alcance: { todos: false, referencias: [p.reference], categorias: [] }, beneficio: { tipo: "porcentaje", valor: 10 } })),
      ],
    });
    const d = ok<ReturnType<typeof publicView>>(await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 2 }], idempotency_key: "pedido-ofertas-may" }, ctx({ channel: "wholesale" }), deps()));
    assert.deepEqual([d.lines[0].unit_price, d.lines[0].list_price, d.lines[0].offer], [63_000, 70_000, "Surtido mayor"]);
    assert.deepEqual(pedidos.orders[0].lines[0].offer, { key: "mayoristas", name: "Surtido mayor", version: 1 });
    assert.equal(pedidos.orders[0].lines[0].listPrice, 70_000);

    // Con SOLO la oferta del detal, el pedido mayorista no lleva ninguna evidencia: ni su precio ni su nombre.
    snaps[A.tenantId] = instantanea({ ofertas: [ofertaSobre([p.reference], { nombre: "Amor y Amistad", modalidad: "detal", beneficio: { tipo: "porcentaje", valor: 20 } })] });
    const sin = ok<ReturnType<typeof publicView>>(await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 1 }], idempotency_key: "pedido-ofertas-may2" }, ctx({ channel: "wholesale", conversation: { phoneNumberId: PN_A, waId: "573009998877" } }), deps()));
    assert.equal(sin.lines[0].unit_price, 70_000);
    assert.ok(!("list_price" in sin.lines[0]) && !("offer" in sin.lines[0]));
    assert.ok(!("offer" in pedidos.orders[1].lines[0]) && !("listPrice" in pedidos.orders[1].lines[0]));
  });

  it("la solicitud que viene de la tienda se guarda con la evidencia de la oferta (precio de lista y oferta con su versión); la línea sin oferta queda como siempre", async () => {
    const guardada = await engine.recordCatalogRequest({
      tenantId: A.tenantId,
      channel: "retail",
      lines: [
        { reference: "DL-000001", productName: "Aretes", quantity: 2, unitPrice: 80_000, subtotal: 160_000, listPrice: 100_000, offer: { key: "temporada", name: "Amor y Amistad", version: 1 } },
        { reference: "DL-000002", productName: "Cadena", quantity: 1, unitPrice: 50_000, subtotal: 50_000 },
      ],
      idempotencyKey: "solicitud-catalogo-0001",
      orderIdFor: () => "DL-ORD-7F42KQ",
    });
    assert.ok(guardada);
    assert.deepEqual(guardada.lines[0].offer, { key: "temporada", name: "Amor y Amistad", version: 1 });
    assert.equal(guardada.lines[0].listPrice, 100_000);
    assert.ok(!("offer" in guardada.lines[1]) && !("listPrice" in guardada.lines[1]));
    assert.equal(guardada.total, 210_000);
    assert.deepEqual(pedidos.orders[0].lines, guardada.lines, "lo que quedó guardado es lo mismo");
  });

  it("si la oferta termina antes de confirmar, el motor lo detecta (price_changed) y NO confirma con el precio viejo", async () => {
    const p = await producto("Aretes", 100_000, null, 10);
    snaps[A.tenantId] = instantanea({ ofertas: [ofertaSobre([p.reference])] });
    const creado = ok<ReturnType<typeof publicView>>(await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 1 }], idempotency_key: "pedido-ofertas-02" }, ctx(), deps()));
    assert.equal(creado.total, 80_000);
    snaps[A.tenantId] = instantanea(); // la administradora pausa la oferta
    const validado = ok<ReturnType<typeof publicView>>(await runAgentTool("validate_order", { order_id: creado.order_id }, ctx(), deps()));
    assert.equal(validado.status, "draft", "vuelve a borrador: el cliente debe ver el precio nuevo");
    assert.ok(validado.issues.some((i) => i.code === "price_changed" && /80\.000/.test(i.message) && /100\.000/.test(i.message)));
    const revalidado = ok<ReturnType<typeof publicView>>(await runAgentTool("validate_order", { order_id: creado.order_id }, ctx(), deps()));
    assert.equal(revalidado.total, 100_000, "la propuesta nueva sale al precio vigente");
    assert.ok(!("list_price" in revalidado.lines[0]), "sin oferta ya no hay evidencia");
  });

  it("las herramientas de catálogo muestran el precio efectivo y la oferta SOLO del canal de la conversación", async () => {
    const p = await producto("Aretes", 100_000, 70_000, 10);
    snaps[A.tenantId] = instantanea({
      ofertas: [
        ofertaSobre([p.reference], { nombre: "Amor y Amistad", modalidad: "detal", beneficio: { tipo: "porcentaje", valor: 20 } }),
        publicada("mayoristas", oferta({ nombre: "Surtido mayor", modalidad: "mayorista", alcance: { todos: false, referencias: [p.reference], categorias: [] }, beneficio: { tipo: "porcentaje", valor: 10 } })),
      ],
    });
    const detal = ok<{ candidates: Array<Record<string, unknown>> }>(await runAgentTool("search_products", { query: "Aretes" }, ctx(), deps()));
    assert.equal(detal.candidates[0].unit_price, 80_000);
    assert.equal(detal.candidates[0].list_price, 100_000);
    assert.deepEqual(detal.candidates[0].offer, { name: "Amor y Amistad", benefit: "20% de descuento", valid_until: "hasta el 31 de octubre de 2026", conditions: null });
    const texto = JSON.stringify(detal);
    assert.ok(!texto.includes("Surtido mayor") && !texto.includes("63000") && !texto.includes("70000"), "ni la oferta ni el precio mayorista salen al detal");

    const mayor = ok<{ candidates: Array<Record<string, unknown>> }>(await runAgentTool("search_products", { query: "Aretes" }, ctx({ channel: "wholesale" }), deps()));
    assert.equal(mayor.candidates[0].unit_price, 63_000);
    assert.equal(mayor.candidates[0].list_price, 70_000);
    assert.equal((mayor.candidates[0].offer as { name: string }).name, "Surtido mayor");
    assert.ok(!JSON.stringify(mayor).includes("Amor y Amistad"), "la oferta detal no sale al mayorista");
  });

  it("sin ofertas la vista del producto es EXACTAMENTE la de siempre (sin propiedades nuevas)", async () => {
    const p = await producto("Aretes", 100_000, 70_000, 10);
    snaps[A.tenantId] = instantanea();
    const r = ok<{ candidates: Array<Record<string, unknown>> }>(await runAgentTool("search_products", { query: "Aretes" }, ctx(), deps()));
    assert.deepEqual(Object.keys(r.candidates[0]).sort(), ["availability", "category", "color", "currency", "description", "material", "max_quantity", "name", "reference", "unit_price"].sort());
    assert.equal(r.candidates[0].unit_price, 100_000);
    void p;
  });

  it("FALLA CERRADO: con el negocio usando ofertas y sin poder verificarlas, el agente NO arma un pedido con un precio sin verificar", async () => {
    const p = await producto("Aretes", 100_000, null, 10);
    snaps[A.tenantId] = new Error("base de datos caída");
    const r = await runAgentTool("create_order", { items: [{ reference: p.reference, quantity: 1 }], idempotency_key: "pedido-ofertas-03" }, ctx(), deps());
    assert.equal(r.ok, false);
    assert.equal(pedidos.orders.length, 0, "no se guardó ningún pedido");
  });

  it("AISLAMIENTO: las ofertas de un negocio no cambian los precios de otro aunque compartan la misma referencia", async () => {
    const pa = await producto("Aretes A", 100_000, null, 10);
    const pb = await producto("Aretes B", 100_000, null, 10, B);
    assert.equal(pa.reference, pb.reference);
    snaps[A.tenantId] = instantanea({ ofertas: [ofertaSobre([pa.reference])] });
    snaps[B.tenantId] = instantanea({ tenantId: B.tenantId });
    const a = await createResolucionCatalogo({ repo: catalogo() }).resolverReferencias(A.tenantId, [pa.reference]);
    const b = await createResolucionCatalogo({ repo: catalogo() }).resolverReferencias(B.tenantId, [pb.reference]);
    assert.equal(a.items[0].prices.retail, 80_000);
    assert.equal(b.items[0].prices.retail, 100_000);
    assert.ok(!("offers" in b.items[0]));
  });

  it("con el módulo apagado la resolución es IDÉNTICA a la de un catálogo sin precios efectivos", async () => {
    const p = await producto("Aretes", 100_000, 70_000, 10);
    snaps[A.tenantId] = null;
    const con = await createResolucionCatalogo({ repo: catalogo() }).resolverReferencias(A.tenantId, [p.reference]);
    const sin = await createResolucionCatalogo({ repo: mem.repo }).resolverReferencias(A.tenantId, [p.reference]);
    assert.deepEqual(con, sin);
  });
});
