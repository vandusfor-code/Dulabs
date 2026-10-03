/**
 * FASE 3B.4 — CHECKOUT CON ACEPTACIÓN DEL NEGOCIO (perfil tipo Aquí Sí Lo Compras) de punta a punta en
 * memoria, por el runtime REAL del agente:
 *
 *   producto(s) → nombre completo → teléfono → ciudad → departamento → [domicilio: dirección y barrio |
 *   oficina (solo si el cliente la pide): oficina y documento] → pago (contra entrega) → resumen →
 *   "Datos correctos" → aviso obligatorio EXACTO → PENDIENTE DE ACEPTACIÓN (nunca una venta).
 *
 * Además: el documento nunca va en claro ni al modelo, la negativa al documento pasa a una persona, el
 * aislamiento entre negocios y el checkout de siempre (Delacour) sin cambios.
 *
 * Negocios, clientes, productos y políticas FICTICIOS (las políticas pendientes del negocio se fijan aquí
 * solo como valores de prueba). El aviso es el texto oficial que el negocio entregó. Nada toca Supabase,
 * Gemini ni Meta.
 */
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { DOCUMENTO_OCULTO, type HistoryRow } from "@/lib/agente/contexto";
import { createMemoryConversationStateStore, type ConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import type { AgentToolsDeps } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn } from "@/lib/agente/runtime";
import { createMemoryCustomerChannelStore } from "@/lib/agente/clasificacion";
import { ACEPTACION_BUTTONS, ACEPTACION_MESSAGES, CHECKOUT_BUTTONS, leerTelefono, niegaDocumento, parseResumenAceptacion, pideOficina } from "@/lib/agente/checkout";
import { CHECKOUT_OPCIONES_LEGADO, FUNCIONES_FASE_3B, checkoutOpcionesSchema, type FuncionFase3B } from "@/lib/agente/perfil-negocio";
import { leerDepartamento } from "@/lib/agente/lenguaje/departamentos";
import { cifrarSecreto, descifrarSecreto } from "@/lib/crypto";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const PN_B = "100000000000002";
const CLIENTE = "573001112233";
const OTRA = "573009998877";
const DOC = "1.020.345.678";

/** Texto oficial del aviso (Fase 3B.4), tal cual lo entregó el negocio. */
const AVISO =
  "⚠️ IMPORTANTE ANTES DE ENVIAR SU PEDIDO:\n\n" +
  "Por seguridad, actualmente no estamos dejando pedidos en las transportadoras sin reclamar o recibir, ya que hemos tenido pérdidas de mercancía bajo esta modalidad y, adicionalmente, se generan dobles costos de flete.\n\n" +
  "Por este motivo, al confirmar su pedido, usted acepta recibirlo y reclamarlo cuando la transportadora lo entregue, RECOMENDAMOS TENER LA DISPONIBILIDAD DEL DINERO.\n\n" +
  "📦 El producto se envía tal como se muestra en las fotos y videos, con las mismas características, especificaciones y accesorios ofrecidos en la publicación.\n\n" +
  "Por favor, confirme su compra únicamente si está 100% seguro de recibir el pedido. 🙏\n\n" +
  "¿Me confirmas por favor que estás 100% seguro de recibirlo?";

/** Perfil tipo Aquí Sí Lo Compras: reglas confirmadas + decisiones de esta fase (D1–D4). Lo pendiente: valores DE PRUEBA. */
const OPCIONES_ASLC = {
  entregas: ["domicilio", "oficina_transportadora"],
  pagos: [{ metodo: "contra_entrega" }],
  campos: { nombre_completo: true, telefono: { modo: "requerido", acepta_mismo_whatsapp: true }, departamento: true, barrio: true },
  oficina: {
    transportadora: "Interrapidísimo",
    oferta: "solo_si_cliente_pide",
    pide_direccion: false,
    pide_barrio: false,
    seleccion: { tipo: "texto_libre" },
    documento: { modo: "requerido", tipos: "sin_especificar", retencion: { tipo: "sin_borrado_automatico" }, si_se_niega: "handoff" },
  },
  cierre: {
    modo: "aceptacion_humana",
    validacion_resumen: "boton_datos_correctos",
    mostrar_numero_pedido: false,
    textos: { aviso: AVISO, tras_aviso_confirma: "Respuesta de prueba tras el aviso 😊" },
    responsable: { miembro_id: 41, respaldo_miembro_id: null, canales: ["panel"] },
    aceptan: "solo_responsable",
    reserva: { tipo: "sin_reserva" },
    vencimiento: { tipo: "sin_vencimiento" },
    reserva_tras_aceptar: { tipo: "plataforma" },
    respuesta_tras_aviso: { si_ya_respondio_persona: "no_responder" },
    pregunta_sin_respuesta: "seguir_checkout",
  },
};
/** Las pruebas encienden explícitamente lo que en producción sigue bloqueado (cierre con aceptación: falta 3B.5 y 3B.7). */
const TODAS = Object.fromEntries(FUNCIONES_FASE_3B.map((f) => [f, true])) as Record<FuncionFase3B, boolean>;

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let engine: ReturnType<typeof createOrderEngine>;
let stateStore: ConversationStateStore;
let canales: ReturnType<typeof createMemoryCustomerChannelStore>;
let pausas: Array<{ waId: string; until: string }>;
let reloj: number;
let history: Map<string, HistoryRow[]>;
let sent: string[];
let menus: Array<{ body: string; ids: string[]; kind: "buttons" | "list" }>;
let llamadas: { confirmOrder: number; submitForAcceptance: number };
let providers: Array<ReturnType<typeof createSimulatedProvider>>;
let seq: number;
/** Cierre 3B.4: todo lo que "sale" del sistema durante una prueba (para demostrar lo que NUNCA debe salir). */
let sink: ReturnType<typeof memoryOrderEventSink>;
let trazas: unknown[];
let registros: unknown[];
let consola: string[];
/** Lo que el checkout le entrega al motor en submitForAcceptance (para probar que el documento llega solo sellado). */
let entregadosAlMotor: unknown[];
const consolaOriginal = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };

const fila = (over: Partial<AgentConfigRow> = {}, negocio: CatalogActor = A, pn = PN_A): AgentConfigRow => ({
  id_tenant: negocio.tenantId,
  phone_number_id: pn,
  tipo: "catalog_sales",
  habilitado: true,
  proveedor: "gemini",
  modelo: "gemini-3.6-flash",
  credencial_ref: "env:GEMINI_KEY_PRUEBA",
  nivel_razonamiento: "low",
  herramientas: [...AGENT_TOOL_NAMES],
  canal: "retail",
  negocio: { nombre_agente: "Asistente", nombre_negocio: "Tienda Ficticia", pedido: { nota_envio_domicilio: "Envío GRATIS" } },
  clasificacion_cliente: false,
  checkout_conversacional: true,
  vocabulario: null,
  checkout_opciones: OPCIONES_ASLC,
  meta_token_plataforma: false,
  ...over,
});
const cfg = (row: AgentConfigRow = fila()) => {
  const r = parseAgentConfig(row, { tenantId: row.id_tenant, phoneNumberId: row.phone_number_id }, { funciones3b: TODAS });
  assert.equal(r.kind, "ok", JSON.stringify(r));
  return (r as { config: AgentRuntimeConfig }).config;
};
/** Delacour (B): el perfil de siempre, por la configuración de producción (sin encender nada). */
const cfgDelacour = () => {
  const row = fila({ checkout_opciones: CHECKOUT_OPCIONES_LEGADO, negocio: { nombre_negocio: "Joyería Ficticia" } }, B, PN_B);
  const r = parseAgentConfig(row, { tenantId: B.tenantId, phoneNumberId: PN_B });
  assert.equal(r.kind, "ok", JSON.stringify(r));
  return (r as { config: AgentRuntimeConfig }).config;
};

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  reloj = Date.parse("2026-10-02T15:00:00Z");
  pedidos = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => reloj });
  stateStore = createMemoryConversationStateStore();
  canales = createMemoryCustomerChannelStore({ [PN_A]: A.tenantId, [PN_B]: B.tenantId });
  pausas = [];
  history = new Map();
  sent = [];
  menus = [];
  providers = [];
  seq = 0;
  sink = memoryOrderEventSink();
  trazas = [];
  registros = [];
  consola = [];
  for (const nivel of ["log", "info", "warn", "error", "debug"] as const) console[nivel] = (...args: unknown[]) => void consola.push(JSON.stringify(args));
  engine = createOrderEngine({
    orders: pedidos,
    catalog: mem.repo,
    key: Buffer.alloc(32, 7),
    sink,
    log: (entry) => void registros.push(entry),
    now: () => new Date(reloj),
    documentCipher: { encrypt: cifrarSecreto },
    handoff: {
      async pauseConversation({ contact, until }) {
        pausas.push({ waId: contact.waId, until: until ?? "estandar" });
        return { ok: true };
      },
    },
  });
  // Espías: el checkout con aceptación NUNCA confirma una venta.
  llamadas = { confirmOrder: 0, submitForAcceptance: 0 };
  const confirmOrder = engine.confirmOrder;
  const submitForAcceptance = engine.submitForAcceptance;
  engine.confirmOrder = async (i) => {
    llamadas.confirmOrder++;
    return confirmOrder(i);
  };
  entregadosAlMotor = [];
  engine.submitForAcceptance = async (i) => {
    llamadas.submitForAcceptance++;
    entregadosAlMotor.push(structuredClone(i));
    return submitForAcceptance(i);
  };
  for (const actor of [A, B]) {
    mem.setProfile(actor.tenantId, { name: "Tienda", whatsapp: "573001110000" });
    mem.enableModule(actor.tenantId);
    await admin.ensurePublication(actor);
  }
});

afterEach(() => {
  Object.assign(console, consolaOriginal);
});

function toolDeps(over: Partial<AgentToolsDeps> = {}): AgentToolsDeps {
  return {
    engine,
    catalog: mem.repo,
    ownsPhoneNumber: async (tenantId, pn) => (tenantId === A.tenantId && pn === PN_A) || (tenantId === B.tenantId && pn === PN_B),
    customerName: async () => null,
    rememberCustomerName: async () => {},
    siteUrl: () => "https://dulabs.test",
    documentCipher: { encrypt: cifrarSecreto },
    ...over,
  };
}

async function turno(script: SimulatedStep[], text: string, opts: { config?: AgentRuntimeConfig; buttonId?: string; waId?: string; actor?: CatalogActor; pn?: string; tools?: Partial<AgentToolsDeps> } = {}) {
  const provider = createSimulatedProvider(script);
  providers.push(provider);
  const waId = opts.waId ?? CLIENTE;
  const wamid = `wamid.in.${++seq}`;
  const h = history.get(waId) ?? [];
  history.set(waId, h);
  h.push({ direccion: "entrante", contenido: text, origen: "entrante", wamid });
  const r = await runAgentTurn(
    {
      config: opts.config ?? cfg(),
      provider,
      model: "gemini-3.6-flash",
      tools: toolDeps(opts.tools),
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
          menus.push({ body, ids: bs.map((b) => b.id), kind: "buttons" });
          sent.push(body);
          return { sent: true, wamid: `wamid.btn.${++seq}` };
        },
        async sendList(body: string, _label: string, bs: ReadonlyArray<{ id: string; title: string }>) {
          menus.push({ body, ids: bs.map((b) => b.id), kind: "list" });
          sent.push(body);
          return { sent: true, wamid: `wamid.list.${++seq}` };
        },
        humanTookOver: async () => false,
      },
      log: (t) => void trazas.push(t),
      now: () => reloj,
      retry: { sleep: async () => {}, random: () => 0 },
    },
    { tenantId: (opts.actor ?? A).tenantId, phoneNumberId: opts.pn ?? PN_A, waId, wamid, text, buttonId: opts.buttonId ?? null },
  );
  return { ...r, provider, wamid };
}

const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });
const estado = async (waId = CLIENTE, actor = A, pn = PN_A): Promise<ConversationState> => (await stateStore.load({ tenantId: actor.tenantId, phoneNumberId: pn, waId })).state;
const ultimo = () => sent.at(-1) ?? "";
const paso = async (waId = CLIENTE) => (await estado(waId)).checkout?.step ?? null;
const pedidoDe = (waId = CLIENTE) => pedidos.orders.filter((o) => o.contact?.waId === waId).at(-1)!;

async function producto(name: string, precio: number, stock: number, actor = A) {
  return admin.createProduct(actor, { name, retailPrice: precio, stock });
}

/** Carrito y el MODELO detecta la compra (create_order_request): arranca el checkout. */
async function comprar(ref: string, qty: number, opts: { waId?: string; config?: AgentRuntimeConfig; actor?: CatalogActor; pn?: string } = {}) {
  await turno([call("update_cart", { items: [{ reference: ref, quantity: qty }] }), { text: "Listo, lo agregué." }], `quiero ${qty} ${ref}`, opts);
  return turno([call("create_order_request"), { text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "me lo llevo", opts);
}

/** Datos hasta el paso de la entrega (nombre completo, teléfono "este mismo", ciudad, departamento). */
async function datosBasicos(waId = CLIENTE) {
  await turno([], "Laura Gómez", { waId });
  await turno([], ACEPTACION_BUTTONS.phone[0].title, { waId, buttonId: ACEPTACION_BUTTONS.phone[0].id });
  await turno([], "Bogotá", { waId });
  await turno([], "Cundinamarca", { waId });
}

async function hastaResumenDomicilio(ref: string, waId = CLIENTE) {
  await comprar(ref, 1, { waId });
  await datosBasicos(waId);
  await turno([], "Calle 10 # 20-30", { waId });
  return turno([], "Chapinero", { waId });
}

const datosCorrectos = (waId = CLIENTE) => turno([], ACEPTACION_BUTTONS.summary[0].title, { waId, buttonId: ACEPTACION_BUTTONS.summary[0].id });

// ===========================================================================
// Lectura determinista (sin modelo)
// ===========================================================================

describe("3B.4 · lectura determinista", () => {
  it("teléfono: 'este mismo' (y su botón) => el WhatsApp; otro celular válido; inválido => se vuelve a pedir", () => {
    const op = { aceptaMismo: true, waId: CLIENTE };
    for (const t of ["este mismo", "el mismo", "Este mismo número", "este número", "al que te escribo"]) assert.deepEqual(leerTelefono(t, op), { telefono: CLIENTE }, t);
    assert.deepEqual(leerTelefono("x", { ...op, buttonId: "checkout_mismo_numero" }), { telefono: CLIENTE });
    assert.deepEqual(leerTelefono("310 555 1234", op), { telefono: "573105551234" });
    assert.deepEqual(leerTelefono("+57 320 111 2222", op), { telefono: "573201112222" });
    for (const t of ["12345", "abc", "0123456789"]) assert.deepEqual(leerTelefono(t, op), { error: "invalido" }, t);
    assert.deepEqual(leerTelefono("este mismo", { ...op, aceptaMismo: false }), { error: "escribelo" });
  });

  it("departamento: oficial o alias => nombre oficial; lo demás => null (nunca se adivina)", () => {
    assert.equal(leerDepartamento("valle"), "Valle del Cauca");
    assert.equal(leerDepartamento("Bogotá D.C."), "Bogotá D.C.");
    assert.equal(leerDepartamento("es la guajira"), "La Guajira");
    assert.equal(leerDepartamento("departamento de Antioquia"), "Antioquia");
    assert.equal(leerDepartamento("san andres"), "San Andrés, Providencia y Santa Catalina");
    for (const t of ["Narnia", "Medellín", "", "Texas"]) assert.equal(leerDepartamento(t), null, t);
  });

  it("oficina: solo si el cliente la pide (nunca 'oficina 301' de una dirección)", () => {
    const o = checkoutOpcionesSchema.parse(OPCIONES_ASLC);
    for (const t of ["lo reclamo en la oficina de Interrapidísimo", "por interrapidisimo", "quiero recogerlo en la oficina", "envíenlo a la oficina", "en oficina"]) assert.equal(pideOficina(t, o), true, t);
    for (const t of ["Carrera 7 # 12-34 oficina 301", "a domicilio", "Chapinero", "trabajo en una oficina"]) assert.equal(pideOficina(t, o), false, t);
  });

  it("documento: negarse o no tenerlo => true; un número no", () => {
    for (const t of ["no", "no te lo voy a dar", "prefiero no", "no quiero dar mi cédula", "no tengo cédula", "no comparto eso"]) assert.equal(niegaDocumento(t), true, t);
    for (const t of [DOC, "CC 1020345678", "mi cédula es 1020345678"]) assert.equal(niegaDocumento(t), false, t);
  });

  it("resumen: 'Datos correctos' / 'corregir' / 'cancelar'; un 'sí' a secas no es nada", () => {
    assert.equal(parseResumenAceptacion("x", "checkout_datos_correctos"), "ok");
    assert.equal(parseResumenAceptacion("✅ Datos correctos"), "ok");
    assert.equal(parseResumenAceptacion("mis datos están correctos"), "ok");
    assert.equal(parseResumenAceptacion("✏️ Corregir dato"), "fix");
    assert.equal(parseResumenAceptacion("quiero corregir un dato"), "fix");
    assert.equal(parseResumenAceptacion("cancelar"), "cancel");
    for (const t of ["sí", "ok", "dale", "confirmo", "¿están correctos?", "✅ Confirmar pedido"]) assert.equal(parseResumenAceptacion(t), null, t);
    for (const b of [...ACEPTACION_BUTTONS.phone, ...ACEPTACION_BUTTONS.summary]) assert.ok([...b.title].length <= 20, `Meta: título ≤ 20 (${b.title})`);
  });
});

// ===========================================================================
// Flujo completo
// ===========================================================================

describe("3B.4 · checkout completo a domicilio", () => {
  it("producto → nombre completo → teléfono → ciudad → departamento → dirección → barrio → resumen completo (sin preguntar pago)", async () => {
    const p = await producto("Licuadora 3 velocidades", 189_900, 5);
    await comprar(p.reference, 2);
    assert.equal(ultimo(), `${ACEPTACION_MESSAGES.intro}\n\n${ACEPTACION_MESSAGES.askName}`);
    // Un solo nombre no basta (nombre completo).
    await turno([], "Laura");
    assert.equal(ultimo(), ACEPTACION_MESSAGES.askNameAgain);
    assert.equal(await paso(), "name");
    await turno([], "Laura Gómez");
    assert.equal(await paso(), "phone");
    assert.deepEqual(menus.at(-1)?.ids, ["checkout_mismo_numero"]);
    await turno([], ACEPTACION_BUTTONS.phone[0].title, { buttonId: "checkout_mismo_numero" });
    assert.equal(ultimo(), ACEPTACION_MESSAGES.askCity);
    await turno([], "Bogotá");
    assert.equal(ultimo(), ACEPTACION_MESSAGES.askDepartment);
    await turno([], "Cundinamarca");
    // Entrega: domicilio (la oficina no se ofrece si no la pide): pasa directo a la dirección.
    assert.equal(await paso(), "address");
    assert.ok(!sent.some((s) => /oficina/i.test(s)), "nunca se ofrece la oficina sin pedirla");
    await turno([], "Calle 10 # 20-30");
    assert.equal(ultimo(), ACEPTACION_MESSAGES.askNeighborhood);
    await turno([], "Chapinero");
    const st = await estado();
    assert.equal(st.checkout?.step, "summary");
    assert.equal(st.checkout?.paymentMethod, "contra_entrega", "único pago: no se pregunta");
    const resumen = menus.at(-1)!;
    assert.deepEqual(resumen.ids, ["checkout_datos_correctos", "checkout_corregir", "checkout_cancelar"]);
    for (const linea of [
      "📋 *Resumen de tu pedido*",
      `• Licuadora 3 velocidades (${p.reference}) × 2 — $379.800`,
      "*Total: $379.800*",
      "👤 Nombre: Laura Gómez",
      "📱 Teléfono: 300 111 2233",
      "📍 Ciudad: Bogotá, Cundinamarca",
      "🏠 Entrega: Domicilio",
      "🏡 Dirección: Calle 10 # 20-30",
      "🏘️ Barrio: Chapinero",
      "💳 Pago: Contra entrega",
      "🚚 Envío GRATIS",
    ]) assert.ok(resumen.body.includes(linea), `falta en el resumen: ${linea}\n${resumen.body}`);
    assert.ok(!resumen.body.includes("DL-ORD-"), "D14 (prueba): sin número de pedido");
    assert.ok(!/confirmad|apartad|reservad/i.test(resumen.body), "el resumen no dice que sea una venta");
    assert.equal(llamadas.confirmOrder, 0);
  });

  it("'Datos correctos' => pedido PENDIENTE DE ACEPTACIÓN + aviso EXACTO (sin botones) + la IA calla", async () => {
    const p = await producto("Licuadora", 100_000, 5);
    await hastaResumenDomicilio(p.reference);
    const menusAntes = menus.length;
    const r = await datosCorrectos();
    // Aviso byte a byte, solo, como texto (sin botones).
    assert.equal(ultimo(), AVISO);
    assert.equal(Buffer.compare(Buffer.from(ultimo(), "utf8"), Buffer.from(AVISO, "utf8")), 0, "byte a byte");
    assert.equal(menus.length, menusAntes, "el aviso no lleva botones");
    // Pedido: pendiente de aceptación con TODOS los datos; nada de venta.
    const o = pedidoDe();
    assert.equal(o.status, "pending_acceptance");
    assert.equal(o.confirmedAt, null, "sin confirmado_at");
    const venta = o.checkout as { stage?: string; paymentStatus?: string } | null;
    assert.equal(venta?.stage, undefined, "sin etapa");
    assert.equal(venta?.paymentStatus, undefined, "sin estado de pago");
    assert.equal(o.checkout, null, "sin datos de venta");
    assert.deepEqual(
      { ...o.acceptance, noticeSentAt: o.acceptance?.noticeSentAt ? "registrado" : null },
      {
        customerName: "Laura Gómez",
        paymentMethod: "contra_entrega",
        delivery: "domicilio",
        address: "Calle 10 # 20-30",
        city: "Bogotá",
        deliveryReference: null,
        contactPhone: CLIENTE,
        department: "Cundinamarca",
        neighborhood: "Chapinero",
        carrierOffice: null,
        noticeSentAt: "registrado",
        customerReplyAt: null,
        reservationMinutes: null,
        expiresAt: null,
      },
    );
    assert.equal(llamadas.submitForAcceptance, 1);
    assert.equal(llamadas.confirmOrder, 0, "nunca confirmOrder");
    assert.equal(pedidos.reservations.length, 0, "sin reserva (política de prueba: sin reserva)");
    assert.equal(mem.inventory.stockOf(p.id), 5, "el stock no se toca");
    assert.equal(await engine.hasPurchase({ tenantId: A.tenantId, contact: { phoneNumberId: PN_A, waId: CLIENTE } }), false, "no cuenta como compra");
    // Historial del pedido: el envío a aceptación y el aviso; ningún "confirmed".
    const hist = pedidos.history.filter((h) => h.orderId === o.id).map((h) => [h.entry.type, h.entry.to]);
    assert.ok(hist.some(([t, to]) => t === "order.status_changed" && to === "pending_acceptance"));
    assert.ok(hist.some(([t]) => t === "order.acceptance_notice_sent"));
    assert.ok(!hist.some(([, to]) => to === "confirmed"));
    // La IA calla en esta conversación (traspaso existente; asignar a la responsable es 3B.5).
    assert.deepEqual(pausas.at(-1), { waId: CLIENTE, until: "released" });
    assert.equal(r.outcome, "handoff");
    const st = await estado();
    assert.equal(st.checkout, null);
    assert.equal(st.cart.length, 0);
  });

  it("'sí' frente al resumen no envía nada: pide el botón de datos correctos", async () => {
    const p = await producto("Licuadora", 100_000, 5);
    await hastaResumenDomicilio(p.reference);
    await turno([], "sí");
    assert.ok(ultimo().startsWith(ACEPTACION_MESSAGES.tapDataOk));
    assert.equal(pedidoDe().status, "pending_confirmation");
    assert.equal(llamadas.submitForAcceptance, 0);
  });

  it("un barrio con números ('20 de Julio') nunca se lee como cantidad", async () => {
    const p = await producto("Licuadora", 100_000, 50);
    await comprar(p.reference, 1);
    await datosBasicos();
    await turno([], "Calle 10 # 20-30");
    await turno([], "20 de Julio");
    const st = await estado();
    assert.equal(st.checkout?.neighborhood, "20 de Julio");
    assert.equal(pedidoDe().lines[0].quantity, 1);
  });
});

describe("3B.4 · teléfono, departamento y barrio", () => {
  it("otro número válido; inválido => se vuelve a pedir", async () => {
    const p = await producto("Licuadora", 100_000, 5);
    await comprar(p.reference, 1);
    await turno([], "Laura Gómez");
    await turno([], "12345");
    assert.equal(ultimo(), ACEPTACION_MESSAGES.phoneAgain);
    assert.equal(await paso(), "phone");
    await turno([], "310 555 1234");
    assert.equal((await estado()).checkout?.phone, "573105551234");
  });

  it("departamento inválido => se vuelve a pedir; 'Ciudad, Departamento' llena los dos", async () => {
    const p = await producto("Licuadora", 100_000, 5);
    await comprar(p.reference, 1);
    await turno([], "Laura Gómez");
    await turno([], "este mismo");
    await turno([], "Bogotá");
    await turno([], "Narnia");
    assert.equal(ultimo(), ACEPTACION_MESSAGES.departmentAgain);
    assert.equal(await paso(), "department");
    await turno([], "valle");
    assert.equal((await estado()).checkout?.department, "Valle del Cauca");

    await comprar(p.reference, 1, { waId: OTRA });
    await turno([], "Ana Ruiz", { waId: OTRA });
    await turno([], "este mismo", { waId: OTRA });
    await turno([], "Medellín, Antioquia", { waId: OTRA });
    const st = await estado(OTRA);
    assert.equal(st.checkout?.city, "Medellín");
    assert.equal(st.checkout?.department, "Antioquia");
    assert.equal(st.checkout?.step, "address");
  });

  it("barrio vacío o 'no tengo' => se vuelve a pedir", async () => {
    const p = await producto("Licuadora", 100_000, 5);
    await comprar(p.reference, 1);
    await datosBasicos();
    await turno([], "Calle 10 # 20-30");
    await turno([], "no tengo");
    assert.equal(ultimo(), ACEPTACION_MESSAGES.neighborhoodAgain);
    assert.equal(await paso(), "neighborhood");
  });
});

describe("3B.4 · oficina de Interrapidísimo y documento", () => {
  async function hastaDocumento(ref: string, waId = CLIENTE) {
    await comprar(ref, 1, { waId });
    await datosBasicos(waId);
    // En el paso de la dirección el cliente PIDE la oficina.
    await turno([], "mejor lo reclamo en la oficina de Interrapidísimo", { waId });
    assert.equal((await estado(waId)).checkout?.delivery, "oficina_transportadora");
    assert.equal(ultimo(), `${ACEPTACION_MESSAGES.officeNoted("Interrapidísimo")}\n\n${ACEPTACION_MESSAGES.askOffice("Interrapidísimo")}`);
    await turno([], "Oficina Centro, calle 13", { waId });
    assert.equal(ultimo(), ACEPTACION_MESSAGES.askDocument);
  }

  it("checkout completo en oficina: oficina como texto, documento SELLADO (cifrado), resumen enmascarado y pendiente de aceptación", async () => {
    const p = await producto("Ventilador", 150_000, 5);
    await hastaDocumento(p.reference);
    const docTurn = await turno([], DOC);
    const st = await estado();
    assert.equal(st.checkout?.step, "summary");
    assert.equal(st.checkout?.office, "Oficina Centro, calle 13");
    assert.equal(st.checkout?.address, null, "con oficina no se pide dirección (D2)");
    assert.equal(st.checkout?.document?.last4, "5678");
    assert.equal(st.checkout?.document?.type, "no_especificado", "D4: sin tipo inventado");
    assert.equal(descifrarSecreto(st.checkout!.document!.cipherText), "1020345678");
    assert.ok(!JSON.stringify(st).includes("1020345678") && !JSON.stringify(st).includes(DOC), "el estado nunca guarda el número en claro");
    assert.deepEqual(st.documentoWamids, [docTurn.wamid]);
    const resumen = menus.at(-1)!.body;
    for (const linea of ["📦 Entrega: reclamar en una oficina de Interrapidísimo", "🏢 Oficina: Oficina Centro, calle 13", "🪪 Documento: •••• 5678", "💳 Pago: Contra entrega"]) assert.ok(resumen.includes(linea), `${linea}\n${resumen}`);
    assert.ok(!resumen.includes("1020345678") && !resumen.includes(DOC));
    await datosCorrectos();
    assert.equal(ultimo(), AVISO);
    const o = pedidoDe();
    assert.equal(o.status, "pending_acceptance");
    assert.equal(o.acceptance?.delivery, "oficina_transportadora");
    assert.equal(o.acceptance?.carrierOffice, "Oficina Centro, calle 13");
    assert.equal(pedidos.documents.length, 1);
    assert.equal(descifrarSecreto(pedidos.documents[0].cipherText), "1020345678");
    assert.deepEqual(await engine.acceptanceDocument(A.tenantId, o), { type: "no_especificado", masked: "•••• 5678" });
    assert.equal(llamadas.confirmOrder, 0);
  });

  it("el documento nunca va al modelo: el mensaje se oculta del historial y los números de una pregunta se tapan", async () => {
    const p = await producto("Ventilador", 150_000, 5);
    await hastaDocumento(p.reference);
    // Pregunta con números en el paso del documento: el modelo responde (solo lectura) sin ver los números.
    const q = await turno([{ text: "Lo pedimos para que puedas reclamar en la oficina." }], `¿para qué necesitan mi cédula ${DOC}?`);
    await turno([], DOC);
    // Después, otra pregunta en el resumen: el historial que ve el modelo tiene el documento OCULTO.
    const q2 = await turno([{ text: "El envío es gratis." }], "¿el envío tiene costo?");
    assert.equal(q2.provider.requests.length, 1, "la pregunta la respondió el modelo (y no se leyó como cambio de entrega)");
    assert.equal((await estado()).checkout?.delivery, "oficina_transportadora");
    const vistos = JSON.stringify([...q.provider.requests, ...q2.provider.requests]);
    assert.ok(!vistos.includes("1020345678") && !vistos.includes(DOC) && !vistos.includes("020.345"), "ningún prompt lleva el documento");
    assert.ok(vistos.includes(DOCUMENTO_OCULTO), "el mensaje aparece como [documento de identidad]");
  });

  it("negarse a dar el documento => pasa a una persona; el checkout NO sigue ni registra nada", async () => {
    const p = await producto("Ventilador", 150_000, 5);
    await hastaDocumento(p.reference);
    const r = await turno([], "no, prefiero no dar mi cédula");
    assert.equal(ultimo(), ACEPTACION_MESSAGES.documentRefused);
    assert.equal(r.outcome, "handoff");
    assert.deepEqual(pausas.at(-1), { waId: CLIENTE, until: "released" });
    assert.equal(pedidoDe().status, "pending_confirmation", "no se envió a aceptación");
    assert.equal(llamadas.submitForAcceptance, 0);
    assert.equal(pedidos.documents.length, 0);
    assert.equal((await estado()).checkout?.step, "document", "no avanzó");
  });

  it("sin cifrador, el documento nunca se guarda en claro: pasa a una persona", async () => {
    const p = await producto("Ventilador", 150_000, 5);
    await hastaDocumento(p.reference);
    await turno([], DOC, { tools: { documentCipher: undefined } });
    assert.equal(ultimo(), ACEPTACION_MESSAGES.documentUnavailable);
    assert.equal((await estado()).checkout?.document, undefined);
    assert.equal(pedidos.documents.length, 0);
  });

  it("volver a domicilio quita la oficina y el documento", async () => {
    const p = await producto("Ventilador", 150_000, 5);
    await hastaDocumento(p.reference);
    await turno([], DOC);
    await turno([], "✏️ Corregir dato", { buttonId: "checkout_corregir" });
    await turno([], "mejor a domicilio");
    const st = await estado();
    assert.equal(st.checkout?.delivery, "domicilio");
    assert.equal(st.checkout?.office, undefined);
    assert.equal(st.checkout?.document, undefined);
    assert.equal(st.checkout?.step, "address");
  });
});

describe("3B.4 · pago solo contra entrega", () => {
  it("Nequi o transferencia: se dice que no, sin datos de cuentas; el pago sigue en contra entrega", async () => {
    const p = await producto("Licuadora", 100_000, 5);
    await comprar(p.reference, 1);
    await turno([], "Laura Gómez");
    for (const t of ["puedo pagar por nequi", "te hago una transferencia"]) {
      await turno([], t);
      assert.ok(ultimo().includes("Por ahora no manejamos pago por transferencia") && ultimo().includes("*contra entrega*"), ultimo());
      assert.ok(!/cuenta|bancolombia|daviplata|nequi \d/i.test(ultimo()));
    }
    assert.equal((await estado()).checkout?.paymentMethod, "contra_entrega");
  });
});

describe("3B.4 · corregir y cancelar desde el resumen", () => {
  it("'Corregir dato' => lista de los datos de ESTE checkout => se cambia el barrio => resumen NUEVO", async () => {
    const p = await producto("Licuadora", 100_000, 5);
    await hastaResumenDomicilio(p.reference);
    await turno([], "✏️ Corregir dato", { buttonId: "checkout_corregir" });
    const lista = menus.at(-1)!;
    assert.equal(lista.kind, "list");
    assert.deepEqual(lista.ids, ["checkout_corregir_nombre", "checkout_corregir_telefono", "checkout_corregir_ciudad", "checkout_corregir_departamento", "checkout_corregir_direccion", "checkout_corregir_barrio", "checkout_corregir_productos"]);
    await turno([], "Barrio", { buttonId: "checkout_corregir_barrio" });
    assert.equal(ultimo(), ACEPTACION_MESSAGES.askNeighborhood);
    await turno([], "Usaquén");
    assert.equal(await paso(), "summary");
    assert.ok(menus.at(-1)!.body.includes("🏘️ Barrio: Usaquén"));
    assert.equal(llamadas.submitForAcceptance, 0, "corregir no envía nada");
  });

  it("'Cancelar' => la propuesta se cancela; nada queda pendiente ni apartado", async () => {
    const p = await producto("Licuadora", 100_000, 5);
    await hastaResumenDomicilio(p.reference);
    await turno([], "❌ Cancelar", { buttonId: "checkout_cancelar" });
    assert.equal(pedidoDe().status, "cancelled");
    assert.equal(llamadas.submitForAcceptance, 0);
    assert.equal((await estado()).checkout, null);
  });
});

describe("3B.4 · seguridad del estado", () => {
  it("un botón viejo después del envío no confirma ni repite nada", async () => {
    const p = await producto("Licuadora", 100_000, 5);
    await hastaResumenDomicilio(p.reference);
    await datosCorrectos();
    const antes = sent.length;
    // (si la pausa no hubiera quedado) otro clic: solo se informa; el pedido sigue pendiente.
    await turno([], ACEPTACION_BUTTONS.summary[0].title, { buttonId: ACEPTACION_BUTTONS.summary[0].id });
    assert.equal(pedidoDe().status, "pending_acceptance");
    assert.equal(llamadas.submitForAcceptance, 1);
    assert.equal(llamadas.confirmOrder, 0);
    assert.ok(sent.length <= antes + 1);
    assert.ok(!sent.slice(antes).includes(AVISO), "el aviso no se repite");
  });

  it("en PRODUCCIÓN el cierre con aceptación sigue bloqueado (faltan 3B.5 y 3B.7): la configuración es inválida", () => {
    const row = fila();
    assert.deepEqual(parseAgentConfig(row, { tenantId: A.tenantId, phoneNumberId: PN_A }), { kind: "invalid", reason: "checkout_feature_unavailable" });
  });
});

describe("3B.4 · aislamiento entre negocios", () => {
  it("el negocio B (perfil de siempre) no ve el pedido pendiente de A ni su documento; su checkout es el de siempre", async () => {
    const p = await producto("Ventilador", 150_000, 5);
    await comprar(p.reference, 1);
    await datosBasicos();
    await turno([], "lo reclamo en la oficina de Interrapidísimo");
    await turno([], "Oficina Centro");
    await turno([], DOC);
    await datosCorrectos();
    const o = pedidoDe();
    assert.equal(o.status, "pending_acceptance");
    assert.equal(await pedidos.getByOrderId(B.tenantId, o.orderId), null);
    assert.equal(await pedidos.documentFor!(B.tenantId, o.id), null);
    assert.equal(await engine.acceptanceDocument(B.tenantId, o), null);
    // B: su producto y su checkout de siempre (con el MISMO cliente).
    const pb = await producto("Anillo", 80_000, 3, B);
    await comprar(pb.reference, 1, { config: cfgDelacour(), actor: B, pn: PN_B });
    const stB = await estado(CLIENTE, B, PN_B);
    assert.equal(stB.checkout?.step, "name");
    assert.ok(ultimo().includes("¿A nombre de quién registramos tu pedido?"), "B pregunta como siempre");
    assert.equal(stB.documentoWamids, undefined, "nada de A en el estado de B");
    // El catálogo de A no existe para B: con el prefijo por defecto (DL) ambos tienen un DL-000001, y para B
    // esa referencia es SU producto, nunca el de A (por eso el prefijo propio del negocio va antes del catálogo).
    assert.equal(pb.reference, p.reference, "mismo texto de referencia en dos negocios (prefijo por defecto)");
    const deB = await engine.createOrder({ tenantId: B.tenantId, channel: "retail", source: "agent", contact: { phoneNumberId: PN_B, waId: OTRA }, items: [{ reference: p.reference, quantity: 1 }], idempotencyKey: "agent:aislamiento-b" });
    assert.equal(deB.order.lines[0].productName, "Anillo");
    assert.notEqual(deB.order.lines[0].productName, "Ventilador");
  });
});

describe("3B.4 · Delacour sigue exactamente igual", () => {
  it("checkout de siempre: nombre → entrega → dirección → ciudad → referencia → pago → 'Confirmar pedido' => confirmOrder y venta confirmada", async () => {
    const pb = await producto("Anillo", 80_000, 3, B);
    const opts = { config: cfgDelacour(), actor: B, pn: PN_B };
    await comprar(pb.reference, 1, opts);
    await turno([], "Laura Gómez", opts);
    await turno([], "🏠 Domicilio", { ...opts, buttonId: "checkout_domicilio" });
    await turno([], "Calle 10 # 20-30", opts);
    await turno([], "Montería", opts);
    await turno([], "Sin referencia", { ...opts, buttonId: "checkout_sin_referencia" });
    await turno([], "🏦 Transferencia", { ...opts, buttonId: "checkout_transferencia" });
    assert.deepEqual(menus.at(-1)?.ids, CHECKOUT_BUTTONS.summary.map((b) => b.id));
    await turno([], "✅ Confirmar pedido", { ...opts, buttonId: "checkout_confirmar" });
    const o = pedidos.orders.find((x) => x.businessId === B.tenantId)!;
    assert.equal(o.status, "confirmed");
    assert.equal(o.checkout?.stage, "confirmado");
    assert.equal(o.acceptance, undefined);
    assert.equal(llamadas.confirmOrder, 1);
    assert.equal(llamadas.submitForAcceptance, 0);
    assert.ok(!sent.includes(AVISO));
    assert.ok(sent.some((s) => s.startsWith("✅ Tu pedido quedó registrado correctamente.")));
  });
});

// ===========================================================================
// CIERRE Y CONGELAMIENTO de la Fase 3B.4
//   1) el aviso obligatorio: texto OFICIAL, byte a byte;
//   2) pending_acceptance NO es una venta (domicilio y oficina);
//   3) el documento de identidad: sellado y nunca visible (estado, modelo, trazas, logs, eventos);
//   4) aislamiento: nada de Delacour llega a un negocio con aceptación, y Delacour sigue igual.
// ===========================================================================

/** SHA-256 (UTF-8) del texto oficial del aviso, calculado APARTE del código: cualquier cambio de un solo byte rompe la prueba. */
const AVISO_OFICIAL_SHA256 = "c0bf58e071859d51d86f2de4f703faa8f95ea866e644386d40eb9d6d1a75179a";
const AVISO_PARRAFOS = [
  "⚠️ IMPORTANTE ANTES DE ENVIAR SU PEDIDO:",
  "Por seguridad, actualmente no estamos dejando pedidos en las transportadoras sin reclamar o recibir, ya que hemos tenido pérdidas de mercancía bajo esta modalidad y, adicionalmente, se generan dobles costos de flete.",
  "Por este motivo, al confirmar su pedido, usted acepta recibirlo y reclamarlo cuando la transportadora lo entregue, RECOMENDAMOS TENER LA DISPONIBILIDAD DEL DINERO.",
  "📦 El producto se envía tal como se muestra en las fotos y videos, con las mismas características, especificaciones y accesorios ofrecidos en la publicación.",
  "Por favor, confirme su compra únicamente si está 100% seguro de recibir el pedido. 🙏",
  "¿Me confirmas por favor que estás 100% seguro de recibirlo?",
];
const sha256 = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
/** Fragmentos del documento de prueba (completo, sin puntos y por trozos) que JAMÁS pueden aparecer fuera del dato cifrado. */
const SECRETOS_DOC = ["1.020.345.678", "1020345678", "020.345", "020345", "345.678", "345678"];
const sinSecretos = (que: unknown, donde: string) => {
  const s = typeof que === "string" ? que : JSON.stringify(que);
  for (const x of SECRETOS_DOC) assert.ok(!s.includes(x), `${donde}: aparece "${x}"`);
};

/** Checkout completo en OFICINA (el cliente la pide) hasta dejar el pedido pendiente de aceptación. */
async function flujoOficinaCompleto(ref: string, waId = CLIENTE) {
  await comprar(ref, 1, { waId });
  await datosBasicos(waId);
  await turno([], "mejor lo reclamo en la oficina de Interrapidísimo", { waId });
  await turno([], "Oficina Centro, calle 13", { waId });
  const q = await turno([{ text: "Lo pedimos para que puedas reclamar en la oficina." }], `¿para qué necesitan mi cédula ${DOC}?`, { waId });
  const docTurn = await turno([], DOC, { waId });
  const q2 = await turno([{ text: "El envío es gratis." }], "¿el envío tiene costo?", { waId });
  const fin = await datosCorrectos(waId);
  return { q, docTurn, q2, fin };
}

describe("3B.4 cierre · aviso obligatorio: texto oficial byte a byte", () => {
  it("el texto configurado ES el oficial ('recibir el pedido'): párrafos, saltos de línea, espacios, emojis, puntuación y mayúsculas", () => {
    assert.deepEqual(AVISO.split("\n\n"), AVISO_PARRAFOS);
    assert.equal(Buffer.byteLength(AVISO, "utf8"), 747);
    assert.equal(sha256(AVISO), AVISO_OFICIAL_SHA256);
    assert.ok(AVISO.startsWith("⚠️ IMPORTANTE ANTES DE ENVIAR SU PEDIDO:\n\nPor seguridad, actualmente"));
    assert.ok(AVISO.endsWith("únicamente si está 100% seguro de recibir el pedido. 🙏\n\n¿Me confirmas por favor que estás 100% seguro de recibirlo?"));
    assert.ok(!AVISO.includes("recibirlo. 🙏"), "la versión equivocada ('seguro de recibirlo. 🙏') no existe");
    assert.equal(AVISO.split("recibir el pedido").length - 1, 1);
    assert.ok(AVISO.includes("RECOMENDAMOS TENER LA DISPONIBILIDAD DEL DINERO."));
    // Emojis exactos: ⚠ + selector de variación, 📦, 🙏.
    assert.deepEqual([...AVISO].filter((c) => c.codePointAt(0)! > 0x2000).map((c) => c.codePointAt(0)!.toString(16).toUpperCase()), ["26A0", "FE0F", "1F4E6", "1F64F"]);
    // Sin retornos de carro, tabuladores, dobles espacios, espacios en los bordes; tildes compuestas (NFC); 6 párrafos / 11 líneas.
    assert.ok(!/[\r\t]/.test(AVISO) && !/ {2}/.test(AVISO) && AVISO.trim() === AVISO && AVISO === AVISO.normalize("NFC"));
    assert.equal(AVISO.split("\n").length, 11);
  });

  it("la configuración lo conserva intacto (ni lo recorta ni lo normaliza)", () => {
    const cierre = cfg().checkoutOptions?.cierre;
    assert.ok(cierre && cierre.modo === "aceptacion_humana");
    assert.equal(Buffer.compare(Buffer.from(cierre.textos.aviso, "utf8"), Buffer.from(AVISO, "utf8")), 0);
    assert.equal(sha256(cierre.textos.aviso), AVISO_OFICIAL_SHA256);
    const equivocado = AVISO.replace("de recibir el pedido. 🙏", "de recibirlo. 🙏");
    assert.notEqual(equivocado, AVISO);
    assert.notEqual(sha256(equivocado), AVISO_OFICIAL_SHA256, "la versión equivocada se distingue");
  });

  it("lo que se ENVÍA al cliente (domicilio y oficina) es ese texto, byte a byte, UNA vez por pedido, como texto y sin el modelo", async () => {
    const p = await producto("Licuadora", 100_000, 5);
    await hastaResumenDomicilio(p.reference);
    const a = await datosCorrectos();
    const avisosA = sent.filter((s) => s.includes("IMPORTANTE ANTES DE ENVIAR SU PEDIDO"));
    assert.equal(avisosA.length, 1);
    assert.equal(Buffer.compare(Buffer.from(avisosA[0], "utf8"), Buffer.from(AVISO, "utf8")), 0);
    assert.equal(sha256(avisosA[0]), AVISO_OFICIAL_SHA256);
    assert.equal(a.provider.requests.length, 0, "el aviso lo envía el backend: el modelo no participa");
    const q = await producto("Ventilador", 150_000, 5);
    const { fin } = await flujoOficinaCompleto(q.reference, OTRA);
    const avisos = sent.filter((s) => s.includes("IMPORTANTE ANTES DE ENVIAR SU PEDIDO"));
    assert.equal(avisos.length, 2, "uno por pedido");
    assert.equal(Buffer.compare(Buffer.from(avisos[1], "utf8"), Buffer.from(AVISO, "utf8")), 0);
    assert.equal(fin.provider.requests.length, 0);
    assert.ok(menus.every((m) => !m.body.includes("IMPORTANTE ANTES DE ENVIAR")), "ni botones ni lista llevan el aviso (solo texto)");
  });
});

describe("3B.4 cierre · pending_acceptance NO es una venta", () => {
  async function garantias(waId: string, productId: string, stockInicial: number) {
    const o = pedidoDe(waId);
    assert.equal(o.status, "pending_acceptance");
    assert.equal(llamadas.confirmOrder, 0, "no llama a confirmOrder");
    assert.equal(o.confirmedAt, null, "sin confirmed_at");
    assert.equal(o.checkout, null, "sin datos de venta: ni etapa ni estado de pago");
    assert.equal(pedidos.reservations.length, 0, "sin reserva (la política de prueba no aparta stock)");
    assert.equal(mem.inventory.stockOf(productId), stockInicial, "el stock no se toca");
    assert.equal(await engine.hasPurchase({ tenantId: A.tenantId, contact: { phoneNumberId: PN_A, waId } }), false, "no cuenta como compra ni venta");
    // Eventos (cola del sistema y bandeja de salida del repositorio): ninguno es de venta confirmada.
    const eventos = [...sink.events, ...pedidos.events];
    assert.ok(eventos.length > 0 && eventos.some((e) => e.transition?.to === "pending_acceptance"));
    for (const e of eventos) {
      assert.notEqual(e.order.status, "confirmed", `evento ${e.event_type} con pedido confirmado`);
      assert.ok(!["confirmed", "completed"].includes(e.transition?.to ?? ""), `evento ${e.event_type} a ${e.transition?.to}`);
    }
    // Historial del pedido y operaciones del motor: nada de confirmación, etapa ni pago.
    assert.ok(!pedidos.history.filter((h) => h.orderId === o.id).some((h) => ["confirmed", "completed"].includes(String(h.entry.to))));
    const ops = registros.map((r) => (r as { operation: string }).operation);
    for (const prohibida of ["confirm_order", "accept_order", "advance_stage", "payment_received"]) assert.ok(!ops.includes(prohibida), prohibida);
    assert.ok(ops.includes("submit_for_acceptance"));
  }

  it("domicilio: checkout completo → resumen → datos correctos → aviso → pending_acceptance, sin ninguna señal de venta", async () => {
    const p = await producto("Licuadora", 100_000, 5);
    await hastaResumenDomicilio(p.reference);
    await datosCorrectos();
    await garantias(CLIENTE, p.id, 5);
  });

  it("oficina: lo mismo (con documento sellado), sin ninguna señal de venta", async () => {
    const p = await producto("Ventilador", 150_000, 5);
    await flujoOficinaCompleto(p.reference);
    await garantias(CLIENTE, p.id, 5);
  });
});

describe("3B.4 cierre · documento de identidad", () => {
  it("se sella al instante; el motor recibe SOLO lo sellado; y no sale a ningún lado: estado, modelo, trazas, registros, consola, eventos, historial", async () => {
    const p = await producto("Ventilador", 150_000, 5);
    await comprar(p.reference, 1);
    await datosBasicos();
    await turno([], "mejor lo reclamo en la oficina de Interrapidísimo");
    await turno([], "Oficina Centro, calle 13");
    const q = await turno([{ text: "Lo pedimos para que puedas reclamar en la oficina." }], `¿para qué necesitan mi cédula ${DOC}?`);
    // 1) Sellado en el MISMO turno en que llega: el estado solo tiene {tipo, cifrado, últimos 4}.
    const docTurn = await turno([], DOC);
    const st = await estado();
    assert.deepEqual(Object.keys(st.checkout!.document!).sort(), ["cipherText", "last4", "type"]);
    assert.match(st.checkout!.document!.cipherText, /^v1:/);
    assert.equal(descifrarSecreto(st.checkout!.document!.cipherText), "1020345678");
    assert.equal(st.checkout!.document!.last4, "5678");
    sinSecretos(st, "estado de la conversación");
    assert.equal(docTurn.provider.requests.length, 0, "el turno del documento no usa el modelo");
    // 2) Después, otra pregunta (el modelo responde) y el cierre del pedido.
    const q2 = await turno([{ text: "El envío es gratis." }], "¿el envío tiene costo?");
    await datosCorrectos();
    // 3) Al motor llega SOLO la representación segura (sellada), nunca el número.
    assert.equal(entregadosAlMotor.length, 1);
    const entrega = entregadosAlMotor[0] as { document?: { type: string; sealed?: { cipherText: string; last4: string }; number?: string } };
    assert.ok(entrega.document?.sealed, "documento sellado");
    assert.ok(!("number" in entrega.document!), "sin número en claro");
    assert.match(entrega.document!.sealed!.cipherText, /^v1:/);
    assert.equal(entrega.document!.type, "no_especificado");
    sinSecretos(entrega, "entrada del motor");
    // 4) Lo guardado: solo cifrado + últimos 4 (y se descifra a lo que escribió el cliente).
    assert.equal(pedidos.documents.length, 1);
    assert.match(pedidos.documents[0].cipherText, /^v1:/);
    assert.equal(descifrarSecreto(pedidos.documents[0].cipherText), "1020345678");
    assert.equal(pedidos.documents[0].last4, "5678");
    sinSecretos({ ...pedidos.documents[0], cipherText: "[cifrado]" }, "documento guardado");
    // 5) Nada más lo contiene: pedidos, historial, eventos, prompts (Gemini), trazas, registros y consola.
    sinSecretos(pedidos.orders, "pedidos");
    sinSecretos(pedidos.history, "historial del pedido");
    sinSecretos(pedidos.events, "bandeja de eventos");
    sinSecretos(sink.events, "eventos publicados");
    sinSecretos(providers.flatMap((x) => x.requests), "lo enviado al modelo (Gemini)");
    assert.ok(JSON.stringify([...q.provider.requests, ...q2.provider.requests]).includes(DOCUMENTO_OCULTO), "el modelo solo ve [documento de identidad]");
    sinSecretos(trazas, "trazas del agente");
    sinSecretos(registros, "registros del motor");
    sinSecretos(consola, "consola (logs)");
    // 6) Se muestra enmascarado donde corresponde: resumen y panel (solo los últimos 4).
    assert.ok(menus.some((m) => m.body.includes("🪪 Documento: •••• 5678")));
    sinSecretos(menus.map((m) => m.body), "resumen enviado al cliente");
    sinSecretos(sent, "mensajes enviados al cliente");
    assert.deepEqual(await engine.acceptanceDocument(A.tenantId, pedidoDe()), { type: "no_especificado", masked: "•••• 5678" });
  });

  it("(control) la captura NO es vacía: si el documento se escribiera en la consola, en un registro o en una traza, la prueba lo detecta", () => {
    console.error("control 1020345678");
    assert.throws(() => sinSecretos(consola, "control consola"));
    registros.push({ operation: "control", nota: DOC });
    assert.throws(() => sinSecretos(registros, "control registros"));
    trazas.push({ texto: "mi cédula es 1020345678" });
    assert.throws(() => sinSecretos(trazas, "control trazas"));
  });

  it("si el cliente se niega, ni se pide otra vez ni se guarda nada: pasa a una persona (sin documento en ningún lado)", async () => {
    const p = await producto("Ventilador", 150_000, 5);
    await comprar(p.reference, 1);
    await datosBasicos();
    await turno([], "mejor lo reclamo en la oficina de Interrapidísimo");
    await turno([], "Oficina Centro, calle 13");
    await turno([], "no, prefiero no dar mi cédula");
    assert.equal(pedidos.documents.length, 0);
    assert.equal((await estado()).checkout?.document, undefined);
    assert.equal(llamadas.submitForAcceptance, 0);
    sinSecretos([trazas, registros, consola], "negativa");
  });
});

describe("3B.4 cierre · aislamiento: un negocio con aceptación jamás usa nada de Delacour", () => {
  it("ningún código de 3B.4 trae datos de un negocio concreto (nombres, transportadora, responsable)", () => {
    for (const f of ["lib/agente/checkout.ts", "lib/agente/lenguaje/departamentos.ts", "lib/catalogo/pedidos/documento.ts", "lib/agente/responsable.ts", "lib/agente/estado.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      assert.doesNotMatch(src, /aqu[ií] s[ií] lo compras|interrapid|patricia|delacour|\baslc\b/i, f);
    }
  });

  it("catálogo, producto, precio y stock: lo que solo existe en B no existe para A; la referencia compartida es el producto de A", async () => {
    const pa = await producto("Ventilador", 150_000, 5);
    const pb1 = await producto("Anillo", 80_000, 3, B);
    const pb2 = await producto("Collar", 95_000, 2, B);
    assert.equal(pb1.reference, pa.reference, "mismo texto de referencia en dos negocios (prefijo por defecto)");
    // A pide la referencia que SOLO existe en B: no entra al carrito.
    await turno([call("update_cart", { items: [{ reference: pb2.reference, quantity: 1 }] }), { text: "No encuentro esa referencia." }], `quiero ${pb2.reference}`);
    assert.equal((await estado()).cart.length, 0, "el producto de B no entra al carrito de A");
    // La referencia compartida resuelve a SU producto (nombre y precio de A).
    await comprar(pa.reference, 1);
    const o = pedidoDe();
    assert.equal(o.lines[0].productName, "Ventilador");
    assert.equal(o.lines[0].unitPrice, 150_000);
    assert.equal(mem.inventory.stockOf(pb1.id), 3, "el stock de B no se toca");
    assert.equal(mem.inventory.stockOf(pb2.id), 2, "el stock de B no se toca");
    const visto = JSON.stringify([sent, providers.flatMap((x) => x.requests)]);
    assert.ok(!visto.includes("Anillo") && !visto.includes("Collar"), "ni el cliente ni el modelo de A ven el catálogo de B");
  });

  it("configuración y credencial: lo de A no sirve para el número de B (ni al revés); el runtime se niega sin llamar al proveedor", async () => {
    assert.deepEqual(parseAgentConfig(fila(), { tenantId: B.tenantId, phoneNumberId: PN_B }, { funciones3b: TODAS }), { kind: "invalid", reason: "tenant_mismatch" });
    const filaB = fila({ credencial_ref: "env:GEMINI_KEY_DE_B" }, B, PN_B);
    assert.deepEqual(parseAgentConfig(filaB, { tenantId: A.tenantId, phoneNumberId: PN_A }, { funciones3b: TODAS }), { kind: "invalid", reason: "tenant_mismatch" });
    const r = await turno([{ text: "NO DEBE SALIR" }], "hola", { config: cfg(), actor: B, pn: PN_B });
    assert.equal(r.outcome, "fallback");
    assert.equal(sent.length, 0);
    assert.equal(r.provider.requests.length, 0);
  });

  it("pedido: la compra confirmada del MISMO cliente en B no cuenta en A, y el pendiente de A no existe para B; Delacour sigue pidiendo lo de siempre", async () => {
    // B (perfil de siempre): checkout completo y confirmado.
    const pb = await producto("Anillo", 80_000, 3, B);
    const ob = { config: cfgDelacour(), actor: B, pn: PN_B };
    await comprar(pb.reference, 1, ob);
    await turno([], "Laura Gómez", ob);
    await turno([], "🏠 Domicilio", { ...ob, buttonId: "checkout_domicilio" });
    await turno([], "Calle 10 # 20-30", ob);
    await turno([], "Montería", ob);
    await turno([], "Sin referencia", { ...ob, buttonId: "checkout_sin_referencia" });
    await turno([], "🏦 Transferencia", { ...ob, buttonId: "checkout_transferencia" });
    await turno([], "✅ Confirmar pedido", { ...ob, buttonId: "checkout_confirmar" });
    assert.equal(llamadas.confirmOrder, 1);
    assert.ok(!sent.includes(AVISO), "el aviso de A nunca sale en el checkout de B");
    assert.ok(!sent.some((s) => /documento|departamento|barrio|c[eé]dula|interrapid/i.test(s)), "B no pregunta nada del perfil con aceptación");
    // A: el mismo cliente, su propio pedido pendiente.
    const pa = await producto("Ventilador", 150_000, 5);
    await hastaResumenDomicilio(pa.reference);
    await datosCorrectos();
    const oa = pedidoDe();
    assert.equal(oa.status, "pending_acceptance");
    assert.equal(await engine.hasPurchase({ tenantId: A.tenantId, contact: { phoneNumberId: PN_A, waId: CLIENTE } }), false, "la compra de B no cuenta en A");
    assert.equal(await engine.hasPurchase({ tenantId: B.tenantId, contact: { phoneNumberId: PN_B, waId: CLIENTE } }), true);
    assert.equal(await pedidos.getByOrderId(B.tenantId, oa.orderId), null, "B no ve el pedido de A");
    assert.equal(pedidos.orders.filter((x) => x.businessId === B.tenantId && x.status === "pending_acceptance").length, 0);
    assert.equal(pedidos.orders.filter((x) => x.businessId === A.tenantId && x.status === "confirmed").length, 0);
    assert.equal(llamadas.confirmOrder, 1, "solo la de B (Delacour) confirmó; la de A nunca");
  });
});
