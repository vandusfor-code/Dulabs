/**
 * Bloque 12 — etapa derivada por el backend, confirmación explícita y selecciones ambiguas
 * ("el otro", "el de arriba", "quiero 3"). Gemini SIMULADO; nada toca Supabase.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { formatCop } from "@/lib/business-agent-quote";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import type { AIGenerateRequest } from "@/lib/ia-proveedores/contrato";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { emptyConversationState, createMemoryConversationStateStore, type ConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import { conversationStage, isExplicitConfirmation } from "@/lib/agente/etapa";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn, type AgentTurnTrace } from "@/lib/agente/runtime";
import { resolveSelection } from "@/lib/agente/seleccion";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const PN_A = "100000000000001";
const CLIENTE = "573001112233";

describe("confirmación explícita (determinista)", () => {
  it("un sí claro confirma", () => {
    for (const t of ["sí", "Sí, confirmo", "dale", "listo!", "ok gracias", "de acuerdo", "confirmo mi pedido", "sí, cómo no", "sí, sin problema", "si, nada más", "Perfecto 👍", "hágale"]) {
      assert.equal(isExplicitConfirmation(t), true, t);
    }
  });

  it("negar, condicionar, cambiar o preguntar NO confirma", () => {
    for (const t of ["no", "sí pero quita uno", "¿cuánto es el envío?", "espera", "mejor cambia la cantidad", "ok y agrega otro", "hola", "gracias", "", "todavía no", "sí, en vez del segundo el tercero"]) {
      assert.equal(isExplicitConfirmation(t), false, t);
    }
  });
});

describe("selección ambigua", () => {
  const dos = [
    { reference: "DL-000001", name: "Dije Luna" },
    { reference: "DL-000002", name: "Dije Sol" },
  ];
  const tres = [...dos, { reference: "DL-000003", name: "Dije Estrella" }];

  it("'el otro': con dos opciones y una ya elegida => la otra; si no, se pregunta", () => {
    assert.deepEqual(resolveSelection("quiero el otro", dos, { previous: ["DL-000001"] }).selected, [{ reference: "DL-000002", via: "position" }]);
    assert.equal(resolveSelection("el otro", dos).needsClarification, true, "sin elección previa no se sabe cuál es 'el otro'");
    assert.equal(resolveSelection("la otra", tres, { previous: ["DL-000001"] }).needsClarification, true, "con tres opciones 'el otro' es ambiguo");
  });

  it("'el de arriba' / 'el anterior' con varias opciones => aclaración", () => {
    for (const t of ["el de arriba", "quiero el anterior", "el de abajo"]) assert.equal(resolveSelection(t, tres).needsClarification, true, t);
  });

  it("'quiero 3' sin producto: con una sola opción es esa; con varias se pregunta; un número dentro de otra frase no cuenta", () => {
    assert.deepEqual(resolveSelection("quiero 3", [dos[0]]).selected, [{ reference: "DL-000001", via: "position" }]);
    const varias = resolveSelection("quiero 3", tres);
    assert.deepEqual([varias.quantityOnly, varias.needsClarification], [true, true]);
    assert.equal(resolveSelection("dame dos unidades", tres).needsClarification, true);
    const pregunta = resolveSelection("¿tienes aretes de 2 cm?", tres);
    assert.deepEqual([pregunta.quantityOnly, pregunta.needsClarification], [false, false]);
    assert.equal(resolveSelection("quiero 3 del segundo", tres).selected[0].reference, "DL-000002");
  });
});

describe("etapa derivada del estado real", () => {
  const base = emptyConversationState();
  const order = (next_step: string, status = "draft") => ({ activeOrder: { next_step, status } as never });
  it("cada etapa sale de hechos, nunca de una etiqueta del modelo", () => {
    assert.equal(conversationStage(base, { activeOrder: null }), "inicio");
    assert.equal(conversationStage({ ...base, lastShown: [{ reference: "DL-000001", name: "x" }] }, { activeOrder: null }), "explorando");
    assert.equal(conversationStage({ ...base, lastShown: [], ambiguity: { references: ["DL-000001", "DL-000002"], createdTurn: 1, presentedTurn: 1 } }, { activeOrder: null }), "eligiendo");
    assert.equal(conversationStage({ ...base, cart: [{ reference: "DL-000001", quantity: 1 }] }, { activeOrder: null }), "armando_pedido");
    assert.equal(conversationStage({ ...base, proposal: { orderId: "DL-ORD-7K2M9Q", confirmationId: "cf_0123456789abcdef", presentedTurn: 2 } }, order("confirm", "pending_confirmation")), "esperando_confirmacion");
    assert.equal(conversationStage({ ...base, proposal: { orderId: "DL-ORD-7K2M9Q", confirmationId: "cf_0123456789abcdef", presentedTurn: null } }, order("resolve_issues")), "pedido_con_problemas");
    assert.equal(conversationStage(base, order("none", "confirmed")), "pedido_confirmado");
  });
});

// ---------------------------------------------------------------------------

describe("runtime: etapa en el contexto y confirmación que decide el backend", () => {
  let mem: ReturnType<typeof createInMemoryCatalogRepository>;
  let admin: ReturnType<typeof createCatalogService>;
  let engine: ReturnType<typeof createOrderEngine>;
  let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
  let stateStore: ConversationStateStore;
  let seq: number;

  const configRow = (): AgentConfigRow => ({
    id_tenant: A.tenantId,
    phone_number_id: PN_A,
    tipo: "catalog_sales",
    habilitado: true,
    proveedor: "gemini",
    modelo: "gemini-3.6-flash",
    credencial_ref: "env:GEMINI_KEY_DELACOUR",
    nivel_razonamiento: null,
    herramientas: [...AGENT_TOOL_NAMES],
    canal: "retail",
    negocio: {},
  });
  const cfg = () => (parseAgentConfig(configRow(), { tenantId: A.tenantId, phoneNumberId: PN_A }) as { config: AgentRuntimeConfig }).config;

  beforeEach(() => {
    mem = createInMemoryCatalogRepository();
    admin = createCatalogService({ repo: mem.repo });
    mem.enableModule(A.tenantId);
    pedidos = createMemoryOrdersRepository();
    engine = createOrderEngine({ orders: pedidos, catalog: mem.repo, key: Buffer.alloc(32, 4), log: () => {} });
    stateStore = createMemoryConversationStateStore();
    seq = 0;
  });

  async function turno(script: SimulatedStep[], text: string) {
    const provider = createSimulatedProvider(script);
    const r = await runAgentTurn(
      {
        config: cfg(),
        provider,
        model: "gemini-3.6-flash",
        tools: { engine, catalog: mem.repo, log: () => {}, ownsPhoneNumber: async () => true },
        state: stateStore,
        history: { recent: async () => [] },
        sender: { sendText: async () => true, sendImage: async () => true, humanTookOver: async () => false },
        log: () => {},
      },
      { tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE, wamid: `wamid.b12.${++seq}`, text },
    );
    return { ...r, provider };
  }
  const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });
  const results = (r: { trace: AgentTurnTrace }) => r.trace.tool_calls.map((t) => t.result);
  const estado = async (): Promise<ConversationState> => (await stateStore.load({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE })).state;
  const hechos = (req: AIGenerateRequest) => JSON.parse(req.system.split("=== ESTADO DE LA CONVERSACIÓN (confiable, lo mantiene el sistema) ===\n")[1]) as { etapa: string; que_hacer_ahora: string; aclaracion_necesaria: boolean };

  it("la etapa avanza con los hechos: inicio -> eligiendo -> armando_pedido -> esperando_confirmacion -> pedido_confirmado", async () => {
    const luna = await admin.createProduct(A, { name: "Arete Luna", retailPrice: 45_000, stock: 5 });
    await admin.createProduct(A, { name: "Arete Sol", retailPrice: 52_000, stock: 5 });
    const r1 = await turno([call("search_products", { query: "aretes" }), { text: "Tengo dos opciones." }], "hola, busco aretes");
    assert.equal(hechos(r1.provider.requests[0]).etapa, "inicio");
    assert.deepEqual(r1.trace.stage, { start: "inicio", end: "eligiendo" });
    const pos = (await estado()).lastShown.findIndex((x) => x.reference === luna.reference) + 1;
    const r2 = await turno([call("update_cart", { items: [{ reference: luna.reference, quantity: 1 }] }), { text: "Agregado." }], `la opción ${pos}`);
    assert.deepEqual(r2.trace.stage, { start: "eligiendo", end: "armando_pedido" });
    const r3 = await turno([call("create_order_request"), { text: `Total: ${formatCop(45_000)}. ¿Confirmas?` }], "hagamos el pedido");
    assert.deepEqual(r3.trace.stage, { start: "armando_pedido", end: "esperando_confirmacion" });
    const s = await estado();
    const r4 = await turno([call("confirm_order", { order_id: s.proposal!.orderId, confirmation_id: s.proposal!.confirmationId }), { text: "¡Confirmado!" }], "sí, confirmo");
    assert.equal(hechos(r4.provider.requests[0]).etapa, "esperando_confirmacion");
    assert.match(hechos(r4.provider.requests[0]).que_hacer_ahora, /sí de forma explícita/);
    assert.deepEqual(results(r4), ["ok"]);
    assert.equal(r4.trace.stage.end, "pedido_confirmado");
  });

  it("'sí pero quita uno': el modelo intenta confirmar y el backend lo impide; el pedido NO se confirma", async () => {
    const luna = await admin.createProduct(A, { name: "Arete Luna", retailPrice: 45_000, stock: 5 });
    await turno([call("resolve_product_by_reference", { reference: luna.reference }), call("update_cart", { items: [{ reference: luna.reference, quantity: 2 }] }), { text: "Agregado." }], `quiero 2 del ${luna.reference}`);
    await turno([call("create_order_request"), { text: `Total: ${formatCop(90_000)}. ¿Confirmas?` }], "pedido");
    const s = await estado();
    const r = await turno(
      [call("confirm_order", { order_id: s.proposal!.orderId, confirmation_id: s.proposal!.confirmationId }), { text: "Claro, ¿dejamos 1 unidad? Te muestro el pedido actualizado." }],
      "sí pero quita uno",
    );
    assert.deepEqual(results(r), ["CONFIRMATION_NOT_EXPLICIT"]);
    assert.notEqual(pedidos.orders[0].status, "confirmed");
    assert.notEqual((await estado()).proposal, null, "la propuesta sigue vigente para cuando confirme");
  });

  it("'quiero 3' con varias opciones abiertas: el backend marca aclaración y el carrito no adivina", async () => {
    await admin.createProduct(A, { name: "Dije Luna", retailPrice: 30_000, stock: 5 });
    await admin.createProduct(A, { name: "Dije Sol", retailPrice: 32_000, stock: 5 });
    await turno([call("search_products", { query: "dije" }), { text: "Dos opciones." }], "quiero un dije");
    const primero = (await estado()).lastShown[0].reference;
    const r = await turno([call("update_cart", { items: [{ reference: primero, quantity: 3 }] }), { text: "¿De cuál de los dos quieres 3?" }], "quiero 3");
    assert.equal(hechos(r.provider.requests[0]).aclaracion_necesaria, true);
    assert.deepEqual(results(r), ["CHOICE_REQUIRED"]);
    assert.deepEqual((await estado()).cart, []);
  });

  it("'el otro' después de elegir uno de dos: el backend sabe cuál es", async () => {
    await admin.createProduct(A, { name: "Dije Luna", retailPrice: 30_000, stock: 5 });
    await admin.createProduct(A, { name: "Dije Sol", retailPrice: 32_000, stock: 5 });
    await turno([call("search_products", { query: "dije" }), { text: "Dos opciones." }], "quiero un dije");
    const [primero, segundo] = (await estado()).lastShown.map((x) => x.reference);
    await turno([call("update_cart", { items: [{ reference: primero, quantity: 1 }] }), { text: "Agregado." }], "el primero");
    const r = await turno([call("update_cart", { items: [{ reference: segundo, quantity: 1 }] }), { text: "Agregué también el otro." }], "y también el otro");
    assert.deepEqual(r.trace.selection, [{ reference: segundo, via: "position" }]);
    assert.deepEqual(results(r), ["ok"]);
  });
});
