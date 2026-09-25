/**
 * Bloque 27 — CHECKOUT CONVERSACIONAL de punta a punta en memoria:
 *
 *   intención de compra (modelo: create_order_request, o frase fija) -> nombre -> entrega
 *   -> (domicilio) dirección / ciudad / referencia -> pago -> resumen DEL MOTOR
 *   -> confirmar (reserva atómica + datos del checkout) -> asesora (IA pausada, mensaje fijo).
 *
 * Pruebas A–P, AD–AG del bloque (las de la operación del pedido y el panel están en
 * lib/catalogo/pedidos/pedidos-b27.test.ts). Ninguna prueba toca Supabase, Gemini ni Meta.
 * Negocios, clientes y productos ficticios.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { formatCop } from "@/lib/business-agent-quote";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine, OrderError } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import type { HistoryRow } from "@/lib/agente/contexto";
import { createMemoryConversationStateStore, type ConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import type { AgentToolsDeps } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn, type AgentTurnTrace } from "@/lib/agente/runtime";
import { sanitizeTurnTrace } from "@/lib/agente/trazas";
import { CLASSIFICATION_MESSAGES, createMemoryCustomerChannelStore } from "@/lib/agente/clasificacion";
import {
  CHECKOUT_BUTTONS,
  CHECKOUT_MESSAGES,
  isTrustedName,
  parseCustomerName,
  parseDelivery,
  parsePayment,
  parseSummaryAction,
  wantsCheckout,
} from "@/lib/agente/checkout";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const PN_B = "100000000000002";
const CLIENTE = "573001112233";
const OTRA = "573009998877";
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
const boton = (grupo: keyof typeof CHECKOUT_BUTTONS, i: number) => CHECKOUT_BUTTONS[grupo][i] as { id: string; title: string };
const tocar = (grupo: keyof typeof CHECKOUT_BUTTONS, i: number, waId = CLIENTE) => turno([], boton(grupo, i).title, { buttonId: boton(grupo, i).id, waId });
const stockDe = (id: string) => mem.inventory.stockOf(id);

/** Carrito con el producto y el MODELO detecta la compra (create_order_request): arranca el checkout. */
async function comprar(ref: string, qty: number, waId = CLIENTE) {
  await turno([call("update_cart", { items: [{ reference: ref, quantity: qty }] }), { text: "Listo, lo agregué." }], `quiero ${qty} ${ref}`, { waId });
  // El texto del modelo nunca se usa: el backend toma el control (este paso no debe consumirse).
  return turno([call("create_order_request"), { text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "me encantan, los quiero", { waId });
}

/** Del inicio del checkout al resumen (nombre si falta, entrega, [dirección], pago). */
async function hastaResumen(opts: { entrega: "tienda" | "domicilio"; pago: "pago_en_tienda" | "transferencia"; nombre?: string; waId?: string }) {
  const waId = opts.waId ?? CLIENTE;
  if ((await estado(waId)).checkout?.step === "name") await turno([], opts.nombre ?? "Laura Prueba", { waId });
  await tocar("delivery", opts.entrega === "tienda" ? 0 : 1, waId);
  if (opts.entrega === "domicilio") {
    await turno([], "Calle 10 # 20-30, barrio Centro", { waId });
    await turno([], "Montería", { waId });
    await turno([], "Portón azul", { waId });
  }
  return tocar("payment", opts.pago === "pago_en_tienda" ? 0 : 1, waId);
}

// ---------------------------------------------------------------------------

describe("B27 · lectura determinista (sin modelo)", () => {
  it("nombre: se acepta un nombre; nunca un teléfono, un 'sí' ni un número", () => {
    assert.equal(parseCustomerName("Laura Gómez"), "Laura Gómez");
    assert.equal(parseCustomerName("me llamo María José"), "María José");
    assert.equal(parseCustomerName("A nombre de Ana"), "Ana");
    for (const t of ["3001112233", "+57 300 111 2233", "sí", "ok", "", "a", "Laura123", "domicilio", "hola"]) assert.equal(parseCustomerName(t), null, t);
    assert.equal(isTrustedName("Laura"), true);
    for (const t of ["573001112233", "57 300 111 22 33", "", null, "ok"]) assert.equal(isTrustedName(t), false, String(t));
  });

  it("entrega y pago: botón (id o título exacto) o texto claro; ambiguo => null", () => {
    assert.equal(parseDelivery("🏬 Recoger en tienda"), "tienda");
    assert.equal(parseDelivery("x", "checkout_domicilio"), "domicilio");
    assert.equal(parseDelivery("mejor a domicilio"), "domicilio");
    assert.equal(parseDelivery("paso a recogerlo"), "tienda");
    assert.equal(parseDelivery("no sé"), null);
    assert.equal(parseDelivery("recoger o domicilio"), null);
    assert.equal(parsePayment("🏦 Transferencia"), "transferencia");
    assert.equal(parsePayment("💵 Pago en tienda"), "pago_en_tienda");
    assert.equal(parsePayment("por nequi"), "transferencia");
    assert.equal(parsePayment("como quieras"), null);
    for (const g of Object.values(CHECKOUT_BUTTONS)) for (const b of g) assert.ok(b.title.length <= 20, `Meta: título ≤ 20 (${b.title})`);
  });

  it("resumen: SOLO el botón confirma (id o su título exacto); 'sí', 'confirmo', 'ok', 'dale' NO", () => {
    assert.equal(parseSummaryAction("✅ Confirmar pedido"), "confirm");
    assert.equal(parseSummaryAction("x", "checkout_confirmar"), "confirm");
    assert.equal(parseSummaryAction("✅ Confirmar pedido\n✅ Confirmar pedido"), "confirm", "doble clic en una ráfaga = uno");
    for (const t of ["sí", "Sí", "si", "confirmo", "confirmar", "ok", "dale", "perfecto", "listo", "sí pero quita uno", "sí?", "confirmo y agrega otro", "✅ Confirmar pedido\n❌ Cancelar"]) assert.equal(parseSummaryAction(t), null, t);
    assert.equal(parseSummaryAction("✏️ Modificar pedido"), "modify");
    assert.equal(parseSummaryAction("cancelar"), "cancel");
  });

  it("intención fija de compra: 'quiero comprar', 'finalizar pedido'…; nunca con productos nuevos", () => {
    for (const t of ["quiero comprar", "Finalizar pedido", "quiero hacer el pedido", "me lo llevo", "hola, quiero comprarlo", "cómo pago?"]) assert.equal(wantsCheckout(t), true, t);
    for (const t of ["quiero comprar unos aretes", "hola", "cuánto cuesta el envío", "quiero ver más", ""]) assert.equal(wantsCheckout(t), false, t);
  });
});

describe("B27 · A–D compra completa y nombre", () => {
  it("A. DETAL compra: el modelo solo detecta la intención; el backend conduce y confirma con reserva, datos y asesora", async () => {
    const p = await producto("Anillo Luna", 58_000, 32_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    const r0 = await comprar(p.reference, 2);
    assert.equal(r0.provider.requests.length, 1, "tras crear la propuesta el modelo NO vuelve a hablar");
    assert.ok(!sent.some((t) => t.includes("TEXTO DEL MODELO")), "el texto del modelo nunca sale");
    assert.equal(r0.trace.checkout?.action, "started");
    assert.equal((await estado()).checkout?.step, "delivery", "D: nombre confiable => no se pregunta");
    assert.deepEqual(buttons.at(-1), { body: `${CHECKOUT_MESSAGES.intro}\n\n${CHECKOUT_MESSAGES.delivery}`, ids: ["checkout_tienda", "checkout_domicilio"] });

    await tocar("delivery", 0);
    const r2 = await tocar("payment", 1);
    assert.equal(r2.trace.checkout?.action, "summary");
    const resumen = buttons.at(-1)!;
    assert.deepEqual(resumen.ids, ["checkout_confirmar", "checkout_modificar", "checkout_cancelar"]);
    assert.ok(resumen.body.includes(`${p.name} (${p.reference}) × 2 — ${formatCop(116_000)}`), "línea del motor");
    assert.ok(resumen.body.includes(`*Total: ${formatCop(116_000)}*`));
    assert.ok(resumen.body.includes("A nombre de: Laura") && resumen.body.includes("Recoger en tienda") && resumen.body.includes("Pago: Transferencia"));
    assert.ok(!resumen.body.includes(formatCop(32_000)) && !resumen.body.includes(formatCop(64_000)), "nunca el precio mayorista");
    assert.equal(stockDe(p.id), 5, "el resumen no reserva");

    const r3 = await tocar("summary", 0);
    assert.equal(r3.outcome, "handoff");
    assert.equal(r3.provider.requests.length, 0);
    assert.equal(r3.reply, CHECKOUT_MESSAGES.confirmed(NEGOCIO));
    assert.deepEqual(r3.trace.handoff, { source: "system", motive: "payment_or_delivery" });
    assert.deepEqual(pausas, [CLIENTE], "la IA queda pausada en ESTA conversación");
    const o = pedidos.orders.at(-1)!;
    assert.equal(o.status, "confirmed", "sigue confirmado (la reserva sigue su plazo de 72 h)");
    assert.equal(o.channel, "retail");
    assert.deepEqual(o.checkout, { customerName: "Laura", paymentMethod: "transferencia", paymentStatus: "pendiente", delivery: "tienda", address: null, city: null, deliveryReference: null, stage: "confirmado" });
    assert.equal(o.confirmedAt, new Date(reloj).toISOString());
    assert.equal(o.handoff?.reason, "pedido confirmado");
    assert.equal(stockDe(p.id), 3, "reserva atómica al confirmar");
    assert.equal(pedidos.reservations.filter((x) => x.status === "activa").length, 1);
    assert.equal((await estado()).checkout, null);
    // La traza guarda el paso y la acción, nunca el nombre ni la dirección.
    const saved = JSON.stringify(sanitizeTurnTrace(r3.trace));
    assert.ok(saved.includes('"checkout"') && !saved.includes("Laura"));
    for (const t of sent) assert.ok(!/pago recibido|enviado|completado/i.test(t), `nunca un estado falso: ${t}`);
  });

  it("B. MAYORISTA compra: precios mayoristas en el resumen y el pedido queda mayorista", async () => {
    const p = await producto("Aretes Sol", 52_000, 30_000, 10);
    await clasificar("wholesale");
    nombreGuardado = "Tienda Ficticia";
    await comprar(p.reference, 3);
    await hastaResumen({ entrega: "domicilio", pago: "transferencia" });
    assert.ok(buttons.at(-1)!.body.includes(`*Total: ${formatCop(90_000)}*`));
    assert.ok(!buttons.at(-1)!.body.includes(formatCop(52_000)));
    await tocar("summary", 0);
    const o = pedidos.orders.at(-1)!;
    assert.equal(o.status, "confirmed");
    assert.equal(o.channel, "wholesale");
    assert.equal(o.total, 90_000);
  });

  it("C. sin nombre (o con el teléfono como nombre): se pregunta; un teléfono o 'sí' no sirven; se recuerda el nombre", async () => {
    const p = await producto("Dije Estrella", 40_000, 20_000, 5);
    await clasificar("retail");
    nombreGuardado = CLIENTE; // el contacto se creó con el teléfono como marcador
    await comprar(p.reference, 1);
    assert.equal((await estado()).checkout?.step, "name");
    assert.equal(sent.at(-1), `${CHECKOUT_MESSAGES.intro}\n\n${CHECKOUT_MESSAGES.askName}`);
    const r1 = await turno([], "3001112233");
    assert.equal(r1.reply, CHECKOUT_MESSAGES.askNameAgain);
    await turno([], "sí");
    assert.equal((await estado()).checkout?.step, "name");
    await turno([], "Me llamo Ana María");
    assert.equal((await estado()).checkout?.customerName, "Ana María");
    // Bloque 28: el nombre queda en el pedido en curso; en el contacto SOLO cuando el pedido se confirma.
    assert.deepEqual(nombresRecordados, [], "no se guarda en el contacto antes de confirmar");
    assert.equal((await estado()).checkout?.step, "delivery");
    for (const t of sent) assert.ok(!/tel[eé]fono|empresa|raz[oó]n social|persona natural|detal o/i.test(t), `nunca se pregunta: ${t}`);
    await tocar("delivery", 0);
    await tocar("payment", 0);
    await tocar("summary", 0);
    assert.equal(pedidos.orders.at(-1)!.status, "confirmed");
    assert.deepEqual(nombresRecordados, ["Ana María"], "se guarda al confirmar");
  });

  it("D. nombre existente: no se vuelve a preguntar", async () => {
    const p = await producto("Pulsera", 30_000, 15_000, 5);
    await clasificar("retail");
    nombreGuardado = "Carolina";
    await comprar(p.reference, 1);
    assert.equal((await estado()).checkout?.customerName, "Carolina");
    assert.ok(!sent.some((t) => t.includes(CHECKOUT_MESSAGES.askName)));
  });
});

describe("B27 · E–I entrega y pago", () => {
  it("E. recoger en tienda: ni dirección ni ciudad", async () => {
    const p = await producto("Collar", 70_000, 40_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "pago_en_tienda" });
    assert.ok(!sent.some((t) => t.includes(CHECKOUT_MESSAGES.address)));
    await tocar("summary", 0);
    const c = pedidos.orders.at(-1)!.checkout!;
    assert.equal(c.delivery, "tienda");
    assert.equal(c.address, null);
    assert.equal(c.paymentMethod, "pago_en_tienda", "I. pago en tienda");
  });

  it("F. domicilio: dirección -> ciudad -> referencia (opcional) en ese orden; todo queda en el pedido", async () => {
    const p = await producto("Anillo Sol", 60_000, 35_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await tocar("delivery", 1);
    assert.equal(sent.at(-1), CHECKOUT_MESSAGES.address);
    await turno([], "Calle 10 # 20-30");
    assert.equal(sent.at(-1), CHECKOUT_MESSAGES.city);
    await turno([], "Montería");
    assert.equal(buttons.at(-1)!.body, CHECKOUT_MESSAGES.reference);
    await tocar("reference", 0); // sin referencia
    assert.equal(buttons.at(-1)!.body, CHECKOUT_MESSAGES.payment);
    await tocar("payment", 1);
    const body = buttons.at(-1)!.body;
    assert.ok(body.includes("Domicilio") && body.includes("Calle 10 # 20-30, Montería") && !body.includes("Referencia:"));
    await tocar("summary", 0);
    const c = pedidos.orders.at(-1)!.checkout!;
    assert.deepEqual([c.delivery, c.address, c.city, c.deliveryReference, c.paymentMethod], ["domicilio", "Calle 10 # 20-30", "Montería", null, "transferencia"]);
  });

  it("G. domicilio sin dirección se bloquea (paso, motor y repositorio)", async () => {
    const p = await producto("Tobillera", 25_000, 12_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await tocar("delivery", 1);
    const r = await turno([], "no");
    assert.equal(r.reply, CHECKOUT_MESSAGES.addressAgain);
    assert.equal((await estado()).checkout?.step, "address");
    // El motor tampoco confirma un domicilio sin dirección (aunque alguien lo llame directo).
    const o = pedidos.orders.at(-1)!;
    await assert.rejects(
      engine.confirmOrder({
        tenantId: A.tenantId,
        contact: { phoneNumberId: PN_A, waId: CLIENTE },
        orderId: o.orderId,
        confirmationId: o.confirmation!.id,
        actor: "agent",
        checkout: { customerName: "Laura", paymentMethod: "transferencia", delivery: "domicilio", address: null, city: "Montería", deliveryReference: null },
      }),
      (e: unknown) => e instanceof OrderError && e.code === "INVALID_INPUT",
    );
    assert.equal(pedidos.orders.at(-1)!.status, "pending_confirmation");
    assert.equal(stockDe(p.id), 5);
  });

  it("H. transferencia queda como método; el pago sigue PENDIENTE (elegir método no es pagar)", async () => {
    const p = await producto("Aretes", 45_000, 25_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    await tocar("summary", 0);
    const c = pedidos.orders.at(-1)!.checkout!;
    assert.equal(c.paymentMethod, "transferencia");
    assert.equal(c.paymentStatus, "pendiente");
    assert.equal(c.stage, "confirmado", "confirmado NO es pagado");
  });
});

describe("B27 · J–K modificar y cancelar", () => {
  it("J. modificar: sin confirmar ni reservar; la propuesta se cancela, los productos vuelven a la selección y el resumen viejo ya no confirma", async () => {
    const p = await producto("Anillo", 50_000, 30_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 2);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    const orderId = pedidos.orders.at(-1)!.orderId;
    const r = await tocar("summary", 1);
    assert.equal(r.reply, CHECKOUT_MESSAGES.modify);
    assert.equal(r.trace.checkout?.action, "modified");
    const o = pedidos.orders.find((x) => x.orderId === orderId)!;
    assert.equal(o.status, "cancelled");
    assert.equal(stockDe(p.id), 5, "nada se reservó");
    const s = await estado();
    assert.equal(s.checkout, null);
    assert.deepEqual(s.cart, [{ reference: p.reference, quantity: 2 }], "los productos siguen guardados");
    // El botón del resumen viejo: nunca confirma.
    const r2 = await tocar("summary", 0);
    assert.equal(r2.reply, CHECKOUT_MESSAGES.stale);
    assert.equal(r2.provider.requests.length, 0);
    assert.ok(pedidos.orders.every((x) => x.status !== "confirmed"));
    // Cambia la selección y vuelve a comprar: resumen NUEVO con el total nuevo.
    await turno([call("update_cart", { items: [{ reference: p.reference, quantity: 1 }] }), { text: "Listo." }], `mejor 1 ${p.reference}`);
    const r3 = await turno([], "finalizar pedido");
    assert.equal(r3.provider.requests.length, 0, "frase fija: el backend crea la propuesta sin modelo");
    assert.equal(r3.trace.checkout?.action, "started");
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    assert.ok(buttons.at(-1)!.body.includes(`*Total: ${formatCop(50_000)}*`));
  });

  it("K. cancelar: sin reserva; queda el evento; los productos siguen guardados", async () => {
    const p = await producto("Collar", 80_000, 50_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await tocar("delivery", 1);
    const r = await turno([], "cancelar"); // en cualquier paso
    assert.equal(r.reply, CHECKOUT_MESSAGES.cancelled);
    const o = pedidos.orders.at(-1)!;
    assert.equal(o.status, "cancelled");
    const h = await pedidos.historyFor(A.tenantId, o.id);
    assert.deepEqual(h.at(-1), { type: "order.status_changed", from: "pending_confirmation", to: "cancelled", actor: "system", memberId: null, reason: "checkout_cancelled_by_customer", at: h.at(-1)!.at });
    assert.deepEqual((await estado()).cart, [{ reference: p.reference, quantity: 1 }]);
    assert.equal(stockDe(p.id), 5);
  });
});

describe("B27 · L–P cambios entre el resumen y la confirmación", () => {
  it("L. el precio cambió: NO se confirma; se explica y se muestra el resumen nuevo; confirmar ese sí registra", async () => {
    const p = await producto("Anillo", 50_000, 30_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    const antes = (await estado()).checkout!.summary!.confirmationId;
    await admin.updateProduct(A, p.id, { retailPrice: 55_000 });
    const r = await tocar("summary", 0);
    assert.equal(r.trace.checkout?.action, "resummarized");
    assert.notEqual(pedidos.orders.at(-1)!.status, "confirmed");
    assert.ok(r.reply!.includes("cambió") && r.reply!.includes(formatCop(55_000)) && r.reply!.includes(CHECKOUT_MESSAGES.updatedSummary));
    assert.ok(r.reply!.includes(`*Total: ${formatCop(55_000)}*`));
    assert.equal(stockDe(p.id), 5);
    const despues = (await estado()).checkout!.summary!.confirmationId;
    assert.notEqual(despues, antes, "propuesta nueva");
    await tocar("summary", 0);
    const o = pedidos.orders.at(-1)!;
    assert.equal(o.status, "confirmed");
    assert.equal(o.total, 55_000);
  });

  it("L2. la propuesta se renovó después del resumen: ese resumen ya no confirma; se muestra el vigente", async () => {
    const p = await producto("Anillo", 50_000, 30_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    const mostrado = (await estado()).checkout!.summary!.confirmationId;
    // Pasan 31 min y alguien (otro canal) re-valida: la propuesta vigente ya es otra.
    reloj += 31 * 60_000;
    const o = pedidos.orders.at(-1)!;
    const renovada = await engine.validateOrder({ tenantId: A.tenantId, contact: { phoneNumberId: PN_A, waId: CLIENTE }, orderId: o.orderId, actor: "system" });
    assert.notEqual(renovada.confirmation!.id, mostrado);
    const r = await tocar("summary", 0);
    assert.equal(r.trace.checkout?.action, "summary", "sin intentar confirmar el resumen viejo");
    assert.equal(pedidos.orders.at(-1)!.status, "pending_confirmation");
    assert.ok(r.reply!.includes(CHECKOUT_MESSAGES.updatedSummary));
    assert.equal((await estado()).checkout!.summary!.confirmationId, renovada.confirmation!.id);
  });

  it("M. el stock cambió: NO se confirma; se explica; nada queda reservado; los productos vuelven a la selección", async () => {
    const p = await producto("Dije", 40_000, 20_000, 2);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 2);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    mem.inventory.setStock(p.id, 1);
    const r = await tocar("summary", 0);
    assert.equal(r.trace.checkout?.action, "not_confirmed");
    assert.ok(r.reply!.includes("quedan 1") || r.reply!.includes("1 unidad"), r.reply!);
    assert.ok(r.reply!.includes(CHECKOUT_MESSAGES.notConfirmed));
    assert.ok(pedidos.orders.every((o) => o.status !== "confirmed"));
    assert.equal(stockDe(p.id), 1);
    assert.equal((await estado()).checkout, null);
    assert.deepEqual((await estado()).cart, [{ reference: p.reference, quantity: 2 }]);
  });

  it("N / AG. doble confirmación (dos clics seguidos o en ráfaga): UNA reserva, un pedido", async () => {
    const p = await producto("Aretes", 45_000, 25_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    const r = await turno([], "✅ Confirmar pedido\n✅ Confirmar pedido");
    assert.equal(r.trace.checkout?.action, "confirmed");
    const r2 = await tocar("summary", 0);
    assert.equal(r2.reply, CHECKOUT_MESSAGES.alreadyConfirmed);
    assert.equal(pedidos.orders.filter((o) => o.status === "confirmed").length, 1);
    assert.equal(pedidos.reservations.length, 1);
    assert.equal(stockDe(p.id), 4);
  });

  it("O. dos confirmaciones simultáneas del mismo pedido: una sola reserva", async () => {
    const p = await producto("Aretes", 45_000, 25_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    await Promise.all([tocar("summary", 0), tocar("summary", 0)]);
    assert.equal(pedidos.orders.filter((o) => o.status === "confirmed").length, 1);
    assert.equal(pedidos.reservations.length, 1);
    assert.equal(stockDe(p.id), 4);
  });

  it("P. la última unidad entre dos clientes: una compra; la otra no se confirma y se le explica", async () => {
    const p = await producto("Anillo único", 90_000, 60_000, 1);
    for (const w of [CLIENTE, OTRA]) {
      await clasificar("retail", w);
    }
    nombreGuardado = "Laura";
    await comprar(p.reference, 1, CLIENTE);
    await hastaResumen({ entrega: "tienda", pago: "transferencia", waId: CLIENTE });
    await comprar(p.reference, 1, OTRA);
    await hastaResumen({ entrega: "tienda", pago: "transferencia", waId: OTRA });
    const r1 = await tocar("summary", 0, CLIENTE);
    const r2 = await tocar("summary", 0, OTRA);
    assert.equal(r1.trace.checkout?.action, "confirmed");
    assert.equal(r2.trace.checkout?.action, "not_confirmed");
    assert.ok(r2.reply!.includes(CHECKOUT_MESSAGES.notConfirmed));
    assert.equal(pedidos.orders.filter((o) => o.status === "confirmed").length, 1);
    assert.equal(stockDe(p.id), 0);
  });
});

describe("B27 · AD–AF y barreras", () => {
  it("AD. sin productos no hay checkout: 'quiero comprar' con la selección vacía va al agente normal", async () => {
    await clasificar("retail");
    const r = await turno([{ text: "¿Qué joya te gustaría?" }], "quiero comprar");
    assert.equal(r.trace.checkout, null);
    assert.equal(pedidos.orders.length, 0);
    assert.equal((await estado()).checkout, null);
  });

  it("AE. un cliente al DETAL pide precio mayorista en pleno checkout: asesora, nunca el precio mayorista", async () => {
    const p = await producto("Collar", 70_000, 40_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    const r = await turno([], "¿y al por mayor cuánto sale?");
    assert.equal(r.outcome, "handoff");
    assert.equal(r.reply, CLASSIFICATION_MESSAGES.changeRequested("retail"));
    assert.ok(!sent.some((t) => t.includes(formatCop(40_000))));
    assert.notEqual(pedidos.orders.at(-1)!.status, "confirmed");
  });

  it("AF. la modalidad cambia con el pedido abierto: el pedido de la otra modalidad NUNCA se confirma", async () => {
    const p = await producto("Collar", 70_000, 40_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    await canales.change({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE }, { channel: "wholesale", expected: "retail", memberId: 7, reason: "prueba" });
    const r = await tocar("summary", 0);
    assert.equal(r.outcome, "handoff", "pedido de otra modalidad: asesora");
    assert.notEqual(pedidos.orders.at(-1)!.status, "confirmed");
    assert.equal(stockDe(p.id), 5);
    // Y el motor lo rechaza aunque se le pida directo con la modalidad equivocada (propuesta vigente).
    const q = await producto("Collar 2", 70_000, 40_000, 5);
    const { order: nueva } = await engine.createOrder({ tenantId: A.tenantId, channel: "retail", source: "agent", contact: { phoneNumberId: PN_A, waId: CLIENTE }, items: [{ reference: q.reference, quantity: 1 }], idempotencyKey: "agent:af-directo" });
    await assert.rejects(
      engine.confirmOrder({ tenantId: A.tenantId, contact: { phoneNumberId: PN_A, waId: CLIENTE }, orderId: nueva.orderId, confirmationId: nueva.confirmation!.id, actor: "agent", expectedChannel: "wholesale" }),
      (e: unknown) => e instanceof OrderError && e.code === "CONFIRMATION_MISMATCH",
    );
    assert.equal(stockDe(q.id), 5);
  });

  it("con el checkout encendido el modelo NO puede confirmar (confirm_order no existe para él)", async () => {
    const p = await producto("Anillo", 50_000, 30_000, 5);
    await clasificar("retail");
    await turno([call("update_cart", { items: [{ reference: p.reference, quantity: 1 }] }), { text: "Listo." }], `quiero ${p.reference}`);
    const r = await turno([call("confirm_order", { order_id: "DL-ORD-AAAAAA", confirmation_id: "cf_aaaaaaaaaaaaaaaa" }), { text: "ok" }], "confírmalo tú");
    assert.equal(r.trace.tool_calls[0].result, "TOOL_NOT_ALLOWED");
    assert.ok(!r.provider.requests[0].tools.some((t) => t.name === "confirm_order"));
    assert.ok(r.provider.requests[0].system.includes("=== PEDIDOS (checkout del sistema) ==="));
  });

  it("interruptor APAGADO (por defecto): todo como antes, sin checkout ni botones del checkout", async () => {
    const p = await producto("Anillo", 50_000, 30_000, 5);
    await clasificar("retail");
    const off = cfg({ checkout_conversacional: undefined });
    assert.equal(off.checkoutEnabled, false);
    await turno([call("update_cart", { items: [{ reference: p.reference, quantity: 1 }] }), { text: "Listo." }], `quiero ${p.reference}`, { config: off });
    const r = await turno([call("create_order_request"), (req) => ({ text: `Total ${formatCop(50_000)}. ¿Confirmas?${req ? "" : ""}` })], "quiero comprar", { config: off });
    assert.equal(r.provider.requests.length, 2, "el modelo presenta la propuesta como antes");
    assert.ok(r.provider.requests[0].tools.some((t) => t.name === "confirm_order"));
    assert.ok(!r.provider.requests[0].system.includes("checkout del sistema"));
    assert.equal((await estado()).checkout, null);
    assert.ok(!buttons.some((b) => b.ids.some((id) => id.startsWith("checkout_"))));
  });

  it("Z. aislamiento: la conversación de otro negocio no ve ni confirma el pedido", async () => {
    const p = await producto("Anillo", 50_000, 30_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    const o = pedidos.orders.at(-1)!;
    await assert.rejects(
      engine.confirmOrder({ tenantId: B.tenantId, contact: { phoneNumberId: PN_B, waId: CLIENTE }, orderId: o.orderId, confirmationId: o.confirmation!.id, actor: "agent" }),
      (e: unknown) => e instanceof OrderError && e.code === "NOT_FOUND",
    );
    await assert.rejects(
      engine.cancelProposal({ tenantId: B.tenantId, contact: { phoneNumberId: PN_B, waId: CLIENTE }, orderId: o.orderId, reason: "x" }),
      (e: unknown) => e instanceof OrderError && e.code === "NOT_FOUND",
    );
    assert.equal(pedidos.orders.at(-1)!.status, "pending_confirmation");
  });
});

describe("B27 · auditoría: confirmación inequívoca, cambios, pausa, abandono, fallas e idempotencia", () => {
  it("en el resumen 'sí', 'confirmo', 'ok' y 'dale' NO crean el pedido: se pide el botón; solo el botón confirma", async () => {
    const p = await producto("Anillo", 50_000, 30_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    for (const t of ["sí", "confirmo", "ok", "dale", "Confirmo mi pedido"]) {
      const r = await turno([], t);
      assert.equal(r.provider.requests.length, 0, t);
      assert.ok(r.reply!.startsWith(CHECKOUT_MESSAGES.tapToConfirm), `${t}: ${r.reply}`);
      assert.equal(pedidos.orders.at(-1)!.status, "pending_confirmation", t);
      assert.equal(stockDe(p.id), 5, t);
    }
    const m = await tocar("summary", 1); // Modificar tampoco confirma
    assert.equal(m.trace.checkout?.action, "modified");
    assert.ok(pedidos.orders.every((o) => o.status !== "confirmed"));
    await turno([], "finalizar pedido");
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    assert.equal((await tocar("summary", 0)).trace.checkout?.action, "confirmed");
    assert.equal(pedidos.orders.filter((o) => o.status === "confirmed").length, 1);
  });

  it("el precio cambia MIENTRAS el cliente da sus datos: el resumen sale con el precio nuevo y lo explica (no lo saca del checkout)", async () => {
    const p = await producto("Anillo", 50_000, 30_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await tocar("delivery", 0);
    await admin.updateProduct(A, p.id, { retailPrice: 56_000 });
    const r = await tocar("payment", 1);
    assert.equal(r.trace.checkout?.action, "summary");
    assert.ok(r.reply!.includes("cambió") && r.reply!.includes(CHECKOUT_MESSAGES.updatedSummary), r.reply!);
    assert.ok(r.reply!.includes(`*Total: ${formatCop(56_000)}*`));
    assert.equal((await estado()).checkout?.step, "summary");
    await tocar("summary", 0);
    assert.equal(pedidos.orders.at(-1)!.total, 56_000);
  });

  it("el stock se acaba MIENTRAS da sus datos: no hay resumen falso; se explica y los productos vuelven a la selección", async () => {
    const p = await producto("Dije", 40_000, 20_000, 2);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 2);
    await tocar("delivery", 0);
    mem.inventory.setStock(p.id, 0);
    const r = await tocar("payment", 1);
    assert.equal(r.trace.checkout?.action, "not_confirmed");
    assert.ok(r.reply!.includes(CHECKOUT_MESSAGES.notConfirmed));
    assert.deepEqual((await estado()).cart, [{ reference: p.reference, quantity: 2 }]);
    assert.ok(pedidos.orders.every((o) => o.status !== "confirmed"));
  });

  it("el producto se DESACTIVA antes de confirmar: no se confirma ni se reserva", async () => {
    const p = await producto("Collar", 70_000, 40_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    await admin.updateProduct(A, p.id, { status: "INACTIVE" });
    const r = await tocar("summary", 0);
    assert.notEqual(r.trace.checkout?.action, "confirmed");
    assert.ok(r.reply!.includes(CHECKOUT_MESSAGES.notConfirmed), r.reply!);
    assert.ok(pedidos.orders.every((o) => o.status !== "confirmed"));
    assert.equal(stockDe(p.id), 5);
  });

  it("tras confirmar, la IA queda pausada HASTA QUE UNA PERSONA LA LIBERE (no 24 h)", async () => {
    const p = await producto("Aretes", 45_000, 25_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    await tocar("summary", 0);
    assert.deepEqual(pausasHasta, ["released"]);
    assert.equal(pedidos.orders.at(-1)!.status, "confirmed", "el traspaso no cambia el estado del pedido");
  });

  it("abandono: la propuesta vence (72 h sin cambios) y al volver el cliente recupera sus productos en la selección", async () => {
    const p = await producto("Pulsera", 30_000, 15_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 2);
    await tocar("delivery", 0);
    reloj += 73 * 3_600_000;
    assert.equal(await engine.expireAbandonedOrders({}), 1);
    const r = await turno([{ text: "¡Hola de nuevo! ¿Seguimos con tu pedido?" }], "hola");
    assert.equal((await estado()).checkout, null);
    assert.deepEqual((await estado()).cart, [{ reference: p.reference, quantity: 2 }]);
    assert.equal(r.trace.checkout, null);
  });

  it("timeout DESPUÉS de confirmar en la BD: al cliente nunca se le dice 'listo' ni 'falló'; el siguiente mensaje lo cierra UNA vez", async () => {
    const p = await producto("Aretes", 45_000, 25_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    const real = pedidos.transition.bind(pedidos);
    pedidos.transition = async (input) => {
      const r = await real(input);
      if (input.to === "confirmed") throw new Error("timeout de red (simulado) después de escribir");
      return r;
    };
    const r1 = await tocar("summary", 0);
    pedidos.transition = real;
    assert.equal(r1.reply, CHECKOUT_MESSAGES.pending);
    assert.equal(pedidos.orders.at(-1)!.status, "confirmed", "quedó confirmado en la BD");
    const r2 = await turno([], "¿y mi pedido?");
    assert.equal(r2.trace.checkout?.action, "confirmed");
    assert.equal(r2.reply, CHECKOUT_MESSAGES.confirmed(NEGOCIO));
    assert.equal(pedidos.reservations.length, 1, "una sola reserva");
    assert.equal(stockDe(p.id), 4);
  });

  it("Meta reenvía el MISMO mensaje (mismo wamid): no se procesa dos veces ni confirma dos veces", async () => {
    const p = await producto("Aretes", 45_000, 25_000, 5);
    await clasificar("retail");
    nombreGuardado = "Laura";
    await comprar(p.reference, 1);
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    const b = boton("summary", 0);
    const r1 = await turno([], b.title, { buttonId: b.id, wamid: "wamid.dup.1" });
    const r2 = await turno([], b.title, { buttonId: b.id, wamid: "wamid.dup.1" });
    assert.equal(r1.trace.checkout?.action, "confirmed");
    assert.equal(r2.outcome, "duplicate");
    assert.equal(pedidos.orders.filter((o) => o.status === "confirmed").length, 1);
    assert.equal(pedidos.reservations.length, 1);
    assert.equal(stockDe(p.id), 4);
  });

  it("el cliente no puede imponer un precio: la herramienta rechaza campos de precio y el total sale del catálogo", async () => {
    const p = await producto("Anillo", 50_000, 30_000, 5);
    await clasificar("retail");
    const r = await turno([call("update_cart", { items: [{ reference: p.reference, quantity: 1, unit_price: 1 }] }), { text: "Listo." }], `quiero ${p.reference} a $1`);
    assert.equal(r.trace.tool_calls[0].result, "INVALID_INPUT");
    await turno([call("update_cart", { items: [{ reference: p.reference, quantity: 1 }] }), { text: "Listo." }], `quiero ${p.reference}`);
    nombreGuardado = "Laura";
    await turno([], "finalizar pedido");
    await hastaResumen({ entrega: "tienda", pago: "transferencia" });
    assert.ok(buttons.at(-1)!.body.includes(`*Total: ${formatCop(50_000)}*`));
  });
});
