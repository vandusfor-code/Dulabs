/**
 * Bloque 34 — CLIENTES REGISTRADOS por el equipo: el asistente ya sabe su nombre y su modalidad desde el
 * primer mensaje ("nunca se olvida"): saludo con su nombre (sin preguntar detal / por mayor) y, si el
 * equipo marcó "ya es cliente", sin el mínimo de la compra inicial mayorista.
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
import { runAgentTurn, saludoConocido, type AgentTurnTrace } from "@/lib/agente/runtime";
import { CHANNEL_QUESTION, createMemoryCustomerChannelStore, intentMenu } from "@/lib/agente/clasificacion";
import { VOCABULARIO_LEGADO } from "@/lib/agente/perfil-negocio";

// Menú de inicio con el vocabulario de DELACOUR (configuración explícita).
const INTENT_MENU = intentMenu(VOCABULARIO_LEGADO);
import { wholesaleMinimumBlocked } from "@/lib/agente/checkout";
import { esSoloSaludo } from "@/lib/agente/lenguaje/interpretar";

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
/** Bloque 34: "ya es cliente" (ficha del equipo); "falla" = no se pudo leer. */
let yaEsCliente: boolean | "falla";

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
  yaEsCliente = false;
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
    customerIsExisting: async () => {
      if (yaEsCliente === "falla") throw new Error("ficha no disponible");
      return yaEsCliente;
    },
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

const MINIMO = 750_000;
const SALUDO_CONOCIDO = "¡Hola, {nombre}! ✨ Soy Aria, tu asesora de Joyería Ficticia. Qué alegría saludarte 💎 ¿Qué estás buscando hoy?";
const ARIA = {
  nombre_agente: "Aria",
  nombre_negocio: NEGOCIO,
  saludo: "¡Hola! ✨ Soy Aria, tu asesora de Joyería Ficticia 💎",
  inicio: {
    detal: "¡Con mucho gusto! 💖 Cuéntame qué estás buscando: ¿es para ti o para regalar?",
    mayor: "¡Súper! 💎 La compra inicial mayorista parte de $750.000. ¿Ya tienes tu negocio o estás empezando?",
    buscar: "Cuéntame qué pieza buscas 💎 o envíame la foto o la referencia.",
    saludo_conocido: SALUDO_CONOCIDO,
  },
  pedido: { minimo_mayorista: MINIMO },
};
const aria = () => cfg({ negocio: ARIA });
/** Lo que hace "Registrar cliente": modalidad por la vía de la asesora + nombre conocido. */
async function registrado(canal: "retail" | "wholesale", nombre: string | null, waId = CLIENTE) {
  await canales.change({ tenantId: A.tenantId, phoneNumberId: PN_A, waId }, { channel: canal, expected: null, memberId: 7, reason: "Registrado por el equipo" });
  nombreGuardado = nombre;
}

describe("B34 · configuración", () => {
  it("`inicio.saludo_conocido` es opcional y acotado (≤ 400); la config sin él sigue válida", () => {
    assert.equal(parseAgentConfig(configRow({ negocio: ARIA }), { tenantId: A.tenantId, phoneNumberId: PN_A }).kind, "ok");
    assert.equal(parseAgentConfig(configRow(), { tenantId: A.tenantId, phoneNumberId: PN_A }).kind, "ok");
    for (const saludo_conocido of ["", "x".repeat(401)]) {
      assert.deepEqual(parseAgentConfig(configRow({ negocio: { ...ARIA, inicio: { ...ARIA.inicio, saludo_conocido } } }), { tenantId: A.tenantId, phoneNumberId: PN_A }), { kind: "invalid", reason: "business_config_invalid" });
    }
  });

  it("saludoConocido: primer nombre; sin nombre (o uno raro) el saludo queda bien escrito", () => {
    assert.equal(saludoConocido(SALUDO_CONOCIDO, "Camila Andrea Pérez"), "¡Hola, Camila! ✨ Soy Aria, tu asesora de Joyería Ficticia. Qué alegría saludarte 💎 ¿Qué estás buscando hoy?");
    for (const n of [null, "", "   ", "C", "12345", "{nombre}", "<b>x</b>"]) {
      assert.equal(saludoConocido(SALUDO_CONOCIDO, n), "¡Hola! ✨ Soy Aria, tu asesora de Joyería Ficticia. Qué alegría saludarte 💎 ¿Qué estás buscando hoy?", String(n));
    }
    assert.equal(saludoConocido("Hola {nombre}, bienvenida", null), "Hola, bienvenida");
    assert.equal(saludoConocido("Hola {nombre}, bienvenida", "María José"), "Hola María, bienvenida");
  });
});

describe("B34 · cliente registrado que escribe por PRIMERA vez", () => {
  it("solo saludos (aunque vengan encadenados) cuentan como saludo; con cualquier otra cosa, no", () => {
    for (const t of ["hola", "Hola buenas tardes", "¡Hola, buenas tardes! ¿cómo estás?", "Buenas", "buenas noches gracias", "holaaa"]) assert.equal(esSoloSaludo(t), true, t);
    for (const t of ["", "hola, ¿tienen dijes?", "hola quiero un anillo", "buenas, soy mayorista", "ok", "detal"]) assert.equal(esSoloSaludo(t), false, t);
  });

  it("'hola' => saludo con su nombre + Buscar / Ver catálogo; NO pregunta detal / por mayor; sin modelo", async () => {
    await registrado("wholesale", "Camila Pérez");
    const r = await turno([{ text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "Hola buenas tardes", { config: aria() });
    assert.equal(r.trace.start, "known_greeting");
    assert.equal(r.trace.classification?.action, "known");
    assert.equal(r.provider.requests.length, 0, "el modelo no participa");
    const esperado = SALUDO_CONOCIDO.replace("{nombre}", "Camila");
    assert.deepEqual(buttons.at(-1), { body: esperado, ids: INTENT_MENU.buttons.map((b) => b.id) });
    assert.equal(sent.length, 1, "un solo mensaje");
    assert.ok(!sent.some((t) => t.includes(CHANNEL_QUESTION.body)), "no pregunta la modalidad");
    assert.deepEqual((await estado()).channel, { value: "wholesale", source: "customer_classification" });
  });

  it("después, 'Buscar una joya' sigue el flujo normal con SU modalidad (mayorista)", async () => {
    await registrado("wholesale", "Camila");
    await turno([], "hola", { config: aria() });
    await turno([], INTENT_MENU.buttons[0].title, { config: aria(), buttonId: INTENT_MENU.buttons[0].id });
    assert.equal(sent.at(-1), ARIA.inicio.buscar);
    assert.equal((await canales.get({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE }))?.channel, "wholesale");
  });

  it("sin nombre guardado: el saludo sin nombre (nunca '{nombre}')", async () => {
    await registrado("retail", null);
    await turno([], "hola", { config: aria() });
    assert.equal(buttons.at(-1)!.body, "¡Hola! ✨ Soy Aria, tu asesora de Joyería Ficticia. Qué alegría saludarte 💎 ¿Qué estás buscando hoy?");
  });

  it("si el primer mensaje trae algo más que un saludo, lo atiende el agente (con su modalidad, sin preguntarla)", async () => {
    await registrado("retail", "Camila");
    const r = await turno([{ text: "¡Claro, Camila! Tenemos dijes." }], "hola, ¿tienen dijes?", { config: aria() });
    assert.notEqual(r.trace.start, "known_greeting");
    assert.equal(r.provider.requests.length, 1);
    assert.equal(sent.at(-1), "¡Claro, Camila! Tenemos dijes.");
    assert.ok(!sent.some((t) => t.includes(CHANNEL_QUESTION.body)));
  });

  it("solo al EMPEZAR la conversación: un 'hola' en medio de la charla lo atiende el agente", async () => {
    await registrado("retail", "Camila");
    await turno([], "hola", { config: aria() });
    const r = await turno([{ text: "¡Hola otra vez!" }], "hola", { config: aria() });
    assert.notEqual(r.trace.start, "known_greeting");
    assert.equal(sent.at(-1), "¡Hola otra vez!");
  });

  it("negocio sin `saludo_conocido` (u otros negocios): exactamente como antes", async () => {
    await registrado("retail", "Camila");
    const r = await turno([{ text: "¡Hola! ¿Qué buscas?" }], "hola");
    assert.notEqual(r.trace.start, "known_greeting");
    assert.equal(r.provider.requests.length, 1);
  });

  it("contacto NO registrado: la pregunta detal / por mayor de siempre (con el saludo del negocio)", async () => {
    const r = await turno([], "hola", { config: aria() });
    assert.equal(r.trace.classification?.action, "asked");
    assert.notEqual(r.trace.start, "known_greeting");
    assert.ok(buttons.at(-1)!.body.startsWith(ARIA.saludo));
  });

  it("con un pedido abierto, el 'hola' lo atiende el agente (puede preguntar por su pedido)", async () => {
    const p = await producto("Dije Luna", 27_000, 14_000, 5);
    await registrado("retail", "Camila");
    await turno([call("update_cart", { items: [{ reference: p.reference, quantity: 1 }] }), { text: "Listo." }], `quiero ${p.reference}`, { config: aria() });
    await turno([call("create_order_request"), { text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "lo quiero", { config: aria() });
    assert.ok(pedidos.orders.some((o) => !["completed", "cancelled", "expired", "rejected"].includes(o.status)), "hay una solicitud abierta");
    // Conversación "nueva" (se reinició el estado) pero con la solicitud abierta.
    const k = { tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE };
    await stateStore.save(k, { ...(await estado()), turn: 0, checkout: null }, (await stateStore.load(k)).version);
    const r = await turno([{ text: "¡Hola Camila! Tu pedido sigue aquí." }], "hola", { config: aria() });
    assert.notEqual(r.trace.start, "known_greeting");
  });
});

describe("B34 · 'ya es cliente': sin el mínimo de la compra inicial mayorista", () => {
  async function comprarAria(ref: string, qty: number) {
    const c = aria();
    await turno([call("update_cart", { items: [{ reference: ref, quantity: qty }] }), { text: "Listo, lo agregué." }], `quiero ${qty} ${ref}`, { config: c });
    return turno([call("create_order_request"), { text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "lo quiero", { config: c });
  }

  it("mayorista registrado como 'ya es cliente' (sin pedidos en el sistema): $47.000 => arranca el registro", async () => {
    const p = await producto("Pulsera Corazón", 60_000, 47_000, 5);
    await registrado("wholesale", "Camila");
    yaEsCliente = true;
    await comprarAria(p.reference, 1);
    assert.notEqual((await estado()).checkout, null);
    assert.ok(!sent.some((t) => t.includes("te faltan")), "sin aviso de mínimo");
  });

  it("mayorista registrado SIN 'ya es cliente': el mínimo aplica como siempre", async () => {
    const p = await producto("Pulsera Corazón", 60_000, 47_000, 5);
    await registrado("wholesale", "Camila");
    const r = await comprarAria(p.reference, 1);
    assert.equal(r.trace.checkout?.action, "not_confirmed");
    assert.equal(sent.at(-1), wholesaleMinimumBlocked(47_000, MINIMO));
    assert.equal((await estado()).checkout, null);
  });

  it("si no se puede leer la ficha, el mínimo aplica (fail-closed)", async () => {
    const p = await producto("Pulsera Corazón", 60_000, 47_000, 5);
    await registrado("wholesale", "Camila");
    yaEsCliente = "falla";
    const r = await comprarAria(p.reference, 1);
    assert.equal(r.trace.checkout?.action, "not_confirmed");
    assert.equal(sent.at(-1), wholesaleMinimumBlocked(47_000, MINIMO));
  });
});

describe("B34 · configuración entregada para Delacour", () => {
  it("aria-negocio.json pasa el esquema estricto con `saludo_conocido` ({nombre}) y el SQL agrega SOLO esa clave, solo en la fila de Delacour", async () => {
    const fs = await import("node:fs");
    const negocio = JSON.parse(fs.readFileSync("scripts/delacour/aria-negocio.json", "utf8")) as typeof ARIA;
    assert.equal(parseAgentConfig(configRow({ negocio }), { tenantId: A.tenantId, phoneNumberId: PN_A }).kind, "ok");
    assert.match(negocio.inicio.saludo_conocido, /\{nombre\}/);
    assert.equal(saludoConocido(negocio.inicio.saludo_conocido, "Camila Pérez"), "¡Hola, Camila! ✨ Soy Aria, tu asesora de Delacour Joyería. Qué alegría saludarte 💎 ¿Qué estás buscando hoy?");
    const sql = fs.readFileSync("scripts/delacour/saludo-conocido.sql", "utf8");
    assert.ok(sql.includes(`$s$${negocio.inicio.saludo_conocido}$s$`), "el mismo texto del JSON");
    assert.match(sql, /jsonb_set\(negocio, '\{inicio,saludo_conocido\}'/);
    assert.equal((sql.match(/where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' and phone_number_id = '1428584886997210'/g) ?? []).length, 3);
    assert.match(sql, /APLICAR SOLO DESPUÉS DEL MERGE/);
  });
});

describe("B34 · conexión en producción (webhook)", () => {
  it("el webhook lee 'ya es cliente' de la ficha del MISMO negocio, número y contacto", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("lib/agente/webhook.ts", "utf8");
    assert.match(src, /customerIsExisting: \(k\) => createSupabaseClientesRepo\(supabase\)\.yaCompro\(k\.tenantId, k\.phoneNumberId, k\.waId\)/);
  });
});
