/**
 * Bloque 16 — intención detectada, motivo del traspaso y "quiero hablar con una asesora"
 * decidido por el backend (sin modelo). Gemini SIMULADO; nada toca Supabase ni Meta.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { formatCop } from "@/lib/business-agent-quote";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine, type HumanHandoffPort } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { createMemoryConversationStateStore, type ConversationStateStore } from "@/lib/agente/estado";
import { asksForHuman, detectIntent } from "@/lib/agente/intencion";
import type { UsageSnapshot } from "@/lib/agente/limites";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { FALLBACK_MESSAGES, runAgentTurn } from "@/lib/agente/runtime";
import { sanitizeTurnTrace } from "@/lib/agente/trazas";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const PN = "100000000000001";
const CLIENTE = "573001112233";

const row: AgentConfigRow = {
  id_tenant: A.tenantId,
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
};
const config = (parseAgentConfig(row, { tenantId: A.tenantId, phoneNumberId: PN }) as { config: AgentRuntimeConfig }).config;
const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let state: ConversationStateStore;
let pausas: Array<{ waId: string; reason: string }>;
let sent: string[];
let seq: number;
let tookOver: boolean;
let pauseWorks: boolean;

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  mem.enableModule(A.tenantId);
  admin = createCatalogService({ repo: mem.repo });
  state = createMemoryConversationStateStore();
  pausas = [];
  sent = [];
  seq = 0;
  tookOver = false;
  pauseWorks = true;
});

async function turno(script: SimulatedStep[], text: string, usage?: UsageSnapshot) {
  const handoff: HumanHandoffPort = {
    pauseConversation: async ({ contact, reason }) => {
      if (!pauseWorks) return { ok: false };
      pausas.push({ waId: contact.waId, reason });
      tookOver = true;
      return { ok: true };
    },
  };
  const engine = createOrderEngine({ orders: createMemoryOrdersRepository(), catalog: mem.repo, key: Buffer.alloc(32, 6), log: () => {}, handoff });
  const provider = createSimulatedProvider(script);
  const r = await runAgentTurn(
    {
      config,
      provider,
      model: "gemini-3.6-flash",
      tools: { engine, catalog: mem.repo, log: () => {}, ownsPhoneNumber: async () => true },
      state,
      history: { recent: async () => [] },
      sender: { sendText: async (t) => (sent.push(t), true), sendImage: async () => true, humanTookOver: async () => tookOver },
      ...(usage ? { usage: { read: async () => usage } } : {}),
    },
    { tenantId: A.tenantId, phoneNumberId: PN, waId: CLIENTE, wamid: `wamid.i.${++seq}`, text },
  );
  return { ...r, provider };
}

describe("el cliente pide una persona: lo decide el backend", () => {
  it("frases que SÍ piden una persona y frases que NO", () => {
    for (const t of ["Quiero hablar con una asesora", "pásame con un asesor por favor", "¿me comunicas con alguien?", "asesora", "necesito una persona", "¿me atiende una persona?", "puedo hablar con un humano"]) {
      assert.equal(asksForHuman(t), true, t);
    }
    for (const t of ["¿la asesora me puede enviar fotos?", "quiero ver cómo se ve en una persona", "no quiero hablar con un asesor", "Busco aretes", "Quiero 2 del primero", "Sí, confirmo", "¿tienen asesoras de imagen?"]) {
      assert.equal(asksForHuman(t), false, t);
    }
  });

  it("'Quiero hablar con una asesora': pausa, mensaje fijo, SIN llamar al modelo; luego la asesora tiene el chat", async () => {
    const r = await turno([{ text: "no debería llamarse" }], "Quiero hablar con una asesora");
    assert.equal(r.outcome, "handoff");
    assert.equal(r.provider.requests.length, 0);
    assert.deepEqual(pausas.map((p) => p.waId), [CLIENTE]);
    assert.deepEqual(sent, [FALLBACK_MESSAGES.handoff]);
    assert.deepEqual(r.trace.handoff, { source: "customer", motive: "customer_request" });
    assert.equal(r.trace.intent, "handoff");
    const saved = (await state.load({ tenantId: A.tenantId, phoneNumberId: PN, waId: CLIENTE })).state;
    assert.deepEqual(saved.recentWamids, ["wamid.i.1"]);
    assert.equal(saved.handoffTurn, saved.turn);

    const despues = await turno([{ text: "no debería" }], "¿hola?");
    assert.equal(despues.outcome, "preempted");
    assert.equal(despues.provider.requests.length, 0);
    assert.equal(despues.trace.intent, null);
  });

  it("si la pausa falla, el turno sigue normal (nunca queda el cliente sin respuesta)", async () => {
    pauseWorks = false;
    const r = await turno([{ text: "Disculpa, en este momento no hay asesoras disponibles. ¿Te ayudo yo?" }], "quiero hablar con una asesora");
    assert.equal(r.outcome, "replied");
    assert.equal(r.provider.requests.length, 1);
    assert.equal(r.trace.handoff, null);
  });
});

describe("motivo del traspaso: cerrado, nunca el texto libre", () => {
  it("el modelo declara el motivo; la traza guarda el motivo y no la razón escrita", async () => {
    const r = await turno([call("handoff_to_human", { reason: "Dice que su pedido 123 de la calle 45 llegó roto", motive: "complaint" }), { text: "Te comunico con una asesora." }], "me llegó roto el anillo");
    assert.equal(r.outcome, "handoff");
    assert.deepEqual(r.trace.handoff, { source: "model", motive: "complaint" });
    assert.equal(r.trace.intent, "handoff");
    assert.match(pausas[0].reason, /llegó roto/, "la razón completa sí llega a la pausa / al pedido");
    assert.doesNotMatch(JSON.stringify(sanitizeTurnTrace(r.trace)), /roto|calle/, "pero nunca a la traza");
  });

  it("sin motivo => 'other'; un motivo inventado se rechaza y no hay traspaso", async () => {
    const r = await turno([call("handoff_to_human", { reason: "Algo especial" }), { text: "Te comunico con una asesora." }], "es un pedido corporativo");
    assert.deepEqual(r.trace.handoff, { source: "model", motive: "other" });

    tookOver = false; // otra conversación limpia
    state = createMemoryConversationStateStore();
    const bad = await turno([call("handoff_to_human", { reason: "Algo especial", motive: "vip" }), { text: "¿En qué más te ayudo?" }], "otra cosa");
    assert.equal(bad.trace.tool_calls[0].result, "INVALID_INPUT");
    assert.equal(bad.trace.handoff, null);
  });

  it("tope del día => motivo del sistema", async () => {
    const r = await turno([], "hola", { contactMinute: 0, contactDay: 999, tenantTokensDay: 0 });
    assert.deepEqual(r.trace.handoff, { source: "system", motive: "limit_contact_day" });
  });
});

describe("intención detectada en cada turno de la conversación", () => {
  it("Hola / Busco aretes / Muéstrame más / Algo parecido / precio por referencia / Quiero 2 / Confirmo", async () => {
    const aretes = await admin.createCategory(A, { name: "Aretes" });
    const luna = await admin.createProduct(A, { stock: 5, name: "Aretes Luna", retailPrice: 45_000, categoryId: aretes.id });
    for (let i = 0; i < 6; i++) await admin.createProduct(A, { stock: 5, name: `Aretes Sol ${i}`, retailPrice: 30_000, categoryId: aretes.id });

    assert.equal((await turno([{ text: "¡Hola! ¿Qué estás buscando?" }], "Hola")).trace.intent, "conversation");
    assert.equal((await turno([call("search_products", { query: "aretes" }), { text: "Tengo varias opciones de aretes." }], "Busco aretes")).trace.intent, "search");
    assert.equal((await turno([call("more_products", {}), { text: "Más opciones de aretes." }], "Muéstrame más")).trace.intent, "more_results");
    assert.equal((await turno([call("similar_products", { reference: luna.reference }), { text: "Estos se parecen." }], "Algo parecido a este")).trace.intent, "similar");
    assert.equal(
      (await turno([call("resolve_product_by_reference", { reference: luna.reference }), { text: `${luna.reference}: ${formatCop(45_000)}.` }], `¿Cuánto cuesta el ${luna.reference}?`)).trace.intent,
      "product_detail",
    );
    assert.equal((await turno([call("update_cart", { reference: luna.reference, quantity: 2 }), { text: "Listo, agregué 2." }], "Quiero 2")).trace.intent, "cart");
  });

  it("prioridad: la acción más comprometida define la intención; sin modelo => ninguna", () => {
    assert.equal(detectIntent(["search_products", "update_cart", "create_order_request"], "replied"), "order");
    assert.equal(detectIntent(["validate_order", "confirm_order"], "replied"), "confirm_order");
    assert.equal(detectIntent(["search_products", "request_product_images"], "replied"), "photos");
    assert.equal(detectIntent(["get_catalog_link"], "replied"), "catalog_link");
    assert.equal(detectIntent([], "handoff"), "handoff");
    assert.equal(detectIntent([], "duplicate"), null);
    assert.equal(detectIntent([], "rate_limited"), null);
  });
});
