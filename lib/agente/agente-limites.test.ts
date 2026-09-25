/**
 * Bloque 14 — topes de costo y abuso: se deciden ANTES de gastar una llamada al modelo.
 * Gemini SIMULADO; consumo simulado (la función SQL tiene su prueba SQL).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { createSimulatedProvider } from "@/lib/ia-proveedores/simulado";
import { agentLimitsSchema, createSupabaseAgentConfigStore, parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { createMemoryConversationStateStore } from "@/lib/agente/estado";
import { decideLimits, type UsageSnapshot } from "@/lib/agente/limites";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { FALLBACK_MESSAGES, runAgentTurn } from "@/lib/agente/runtime";

const T = "aaaaaaaa-0000-4000-8000-00000000000a";
const PN = "100000000000001";
const row = (over: Partial<AgentConfigRow> = {}): AgentConfigRow => ({
  id_tenant: T,
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
  ...over,
});
const DEFAULTS = agentLimitsSchema.parse({});
const usage = (u: Partial<UsageSnapshot>): UsageSnapshot => ({ contactMinute: 0, contactDay: 0, tenantTokensDay: 0, ...u });

describe("topes: configuración y decisión", () => {
  it("por defecto 8/min y 300/día por cliente, 20M tokens/día por negocio; configurables y estrictos", () => {
    assert.deepEqual(DEFAULTS, { turnos_por_minuto_cliente: 8, turnos_por_dia_cliente: 300, tokens_por_dia_negocio: 20_000_000 });
    const custom = parseAgentConfig(row({ limites: { turnos_por_minuto_cliente: 4 } }), { tenantId: T, phoneNumberId: PN }) as { kind: "ok"; config: AgentRuntimeConfig };
    assert.equal(custom.config.limits.turnos_por_minuto_cliente, 4);
    assert.equal(custom.config.limits.turnos_por_dia_cliente, 300);
    for (const bad of [{ turnos_por_minuto_cliente: 0 }, { tokens_por_dia_negocio: 10 }, { otro: 1 }]) {
      assert.deepEqual(parseAgentConfig(row({ limites: bad }), { tenantId: T, phoneNumberId: PN }), { kind: "invalid", reason: "limits_invalid" });
    }
    assert.equal(parseAgentConfig(row(), { tenantId: T, phoneNumberId: PN }).kind, "ok", "sin columna (antes de la migración) => por defecto");
  });

  it("decisión: ritmo => silencio; día del cliente o tokens del negocio => asesora; sin medición => normal", () => {
    assert.deepEqual(decideLimits(null, DEFAULTS), { action: "allow" });
    assert.deepEqual(decideLimits(usage({ contactMinute: 7 }), DEFAULTS), { action: "allow" });
    assert.deepEqual(decideLimits(usage({ contactMinute: 8 }), DEFAULTS), { action: "throttle", reason: "contact_minute" });
    assert.deepEqual(decideLimits(usage({ contactDay: 300 }), DEFAULTS), { action: "handoff", reason: "contact_day" });
    assert.deepEqual(decideLimits(usage({ tenantTokensDay: 20_000_000, contactMinute: 99 }), DEFAULTS), { action: "handoff", reason: "tenant_tokens_day" });
  });

  it("lectura de la config tolerante: sin la columna limites el número NO cae a otro bot", async () => {
    const calls: string[] = [];
    const fila = row();
    const fake = {
      from: () => ({
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: async () => {
              calls.push(cols);
              return cols.includes("limites") ? { data: null, error: { code: "42703" } } : { data: fila, error: null };
            },
          }),
        }),
      }),
    };
    const store = createSupabaseAgentConfigStore(fake as never);
    assert.deepEqual(await store.getByPhoneNumber(PN), fila);
    // Bloque 27: primero con checkout_conversacional, luego limites + clasificacion_cliente, luego solo limites, luego sin ninguna.
    assert.equal(calls.length, 4);
    assert.ok(calls[0].includes("checkout_conversacional") && !calls[1].includes("checkout_conversacional") && calls[1].includes("clasificacion_cliente"));
    assert.ok(!calls[2].includes("clasificacion_cliente") && !calls[3].includes("limites"));
  });

  it("Bloque 25: sin la columna clasificacion_cliente se lee con limites (sin clasificación, como antes)", async () => {
    const calls: string[] = [];
    const fila = { ...row(), limites: {} };
    const fake = {
      from: () => ({
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: async () => {
              calls.push(cols);
              return cols.includes("clasificacion_cliente") ? { data: null, error: { code: "PGRST204" } } : { data: fila, error: null };
            },
          }),
        }),
      }),
    };
    const store = createSupabaseAgentConfigStore(fake as never);
    const r = await store.getByPhoneNumber(PN);
    assert.deepEqual(r, fila);
    assert.equal(calls.length, 3);
    const cfg = parseAgentConfig(r, { tenantId: T, phoneNumberId: PN });
    assert.equal(cfg.kind === "ok" && cfg.config.classifyCustomers, false);
    const on = parseAgentConfig({ ...fila, clasificacion_cliente: true }, { tenantId: T, phoneNumberId: PN });
    assert.equal(on.kind === "ok" && on.config.classifyCustomers, true);
  });

  it("Bloque 27: sin la columna checkout_conversacional se lee con clasificación; el checkout queda APAGADO por defecto", async () => {
    const calls: string[] = [];
    const fila = { ...row(), limites: {}, clasificacion_cliente: true };
    const fake = {
      from: () => ({
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: async () => {
              calls.push(cols);
              return cols.includes("checkout_conversacional") ? { data: null, error: { code: "42703" } } : { data: fila, error: null };
            },
          }),
        }),
      }),
    };
    const r = await createSupabaseAgentConfigStore(fake as never).getByPhoneNumber(PN);
    assert.deepEqual(r, fila);
    assert.equal(calls.length, 2);
    const cfg = parseAgentConfig(r, { tenantId: T, phoneNumberId: PN });
    assert.ok(cfg.kind === "ok" && cfg.config.classifyCustomers === true && cfg.config.checkoutEnabled === false);
    const off = parseAgentConfig({ ...fila, checkout_conversacional: false }, { tenantId: T, phoneNumberId: PN });
    assert.equal(off.kind === "ok" && off.config.checkoutEnabled, false);
    const on = parseAgentConfig({ ...fila, checkout_conversacional: true }, { tenantId: T, phoneNumberId: PN });
    assert.equal(on.kind === "ok" && on.config.checkoutEnabled, true);
  });
});

describe("runtime: los topes se aplican antes de llamar al modelo", () => {
  async function turno(snapshot: UsageSnapshot | null) {
    const mem = createInMemoryCatalogRepository();
    mem.enableModule(T);
    const pausas: string[] = [];
    const sent: string[] = [];
    const engine = createOrderEngine({
      orders: createMemoryOrdersRepository(),
      catalog: mem.repo,
      key: Buffer.alloc(32, 6),
      log: () => {},
      handoff: { pauseConversation: async ({ contact }) => (pausas.push(contact.waId), { ok: true }) },
    });
    const provider = createSimulatedProvider([{ text: "Hola, ¿qué buscas?" }]);
    const state = createMemoryConversationStateStore();
    const r = await runAgentTurn(
      {
        config: (parseAgentConfig(row(), { tenantId: T, phoneNumberId: PN }) as { config: AgentRuntimeConfig }).config,
        provider,
        model: "gemini-3.6-flash",
        tools: { engine, catalog: mem.repo, log: () => {}, ownsPhoneNumber: async () => true },
        state,
        history: { recent: async () => [] },
        sender: { sendText: async (t) => (sent.push(t), true), sendImage: async () => true, humanTookOver: async () => false },
        usage: { read: async () => snapshot },
      },
      { tenantId: T, phoneNumberId: PN, waId: "573001112233", wamid: "wamid.l.1", text: "hola" },
    );
    return { r, provider, pausas, sent, state };
  }

  it("dentro de los topes: normal (y la traza registra el consumo)", async () => {
    const { r, provider } = await turno(usage({ contactMinute: 1, contactDay: 10, tenantTokensDay: 5000 }));
    assert.equal(r.outcome, "replied");
    assert.equal(provider.requests.length, 1);
    assert.deepEqual(r.trace.limits, { contact_minute: 1, contact_day: 10, tenant_tokens_day: 5000, decision: "allow" });
  });

  it("ritmo por minuto superado: ni modelo ni respuesta; el mensaje queda como atendido", async () => {
    const { r, provider, sent, state } = await turno(usage({ contactMinute: 8 }));
    assert.equal(r.outcome, "rate_limited");
    assert.equal(provider.requests.length, 0);
    assert.deepEqual(sent, []);
    assert.deepEqual((await state.load({ tenantId: T, phoneNumberId: PN, waId: "573001112233" })).state.recentWamids, ["wamid.l.1"]);
  });

  it("tope del día (cliente o negocio): pasa a una asesora con el mensaje fijo, sin modelo", async () => {
    for (const snap of [usage({ contactDay: 300 }), usage({ tenantTokensDay: 25_000_000 })]) {
      const { r, provider, pausas, sent } = await turno(snap);
      assert.equal(r.outcome, "handoff");
      assert.equal(provider.requests.length, 0);
      assert.deepEqual(pausas, ["573001112233"]);
      assert.deepEqual(sent, [FALLBACK_MESSAGES.handoff]);
      assert.match(r.trace.error_kind ?? "", /^limit_(contact_day|tenant_tokens_day)$/);
    }
  });

  it("si el consumo no se puede medir, el agente sigue (no frena ventas)", async () => {
    const { r } = await turno(null);
    assert.equal(r.outcome, "replied");
    assert.equal(r.trace.limits, null);
  });
});
