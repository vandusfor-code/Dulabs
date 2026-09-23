/**
 * Fase 8, Bloque 2 — configuración explícita del agente, memoria estructurada
 * y contexto por capas. Sin red ni Supabase.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSimulatedProvider } from "@/lib/ia-proveedores/simulado";
import { createMemoryAgentConfigStore, loadAgentConfig, parseAgentConfig, providerForConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { PLATFORM_RULES, buildSystemInstruction, historyTurns, stateSection, type HistoryRow, type TurnFacts } from "@/lib/agente/contexto";
import {
  conversationStateSchema,
  createMemoryConversationStateStore,
  emptyConversationState,
  isKnownReference,
  parseConversationState,
  rememberReferences,
} from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";

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
  nivel_razonamiento: "low",
  herramientas: ["search_products", "get_cart", "handoff_to_human"],
  canal: "retail",
  negocio: { nombre_agente: "Sofía", tono: "cálido y breve", politicas: ["Envíos a todo el país."] },
  ...over,
});
const expected = { tenantId: T, phoneNumberId: PN };

describe("configuración del agente: explícita y fail-closed", () => {
  it("fila válida => Gemini + gemini-3.6-flash + allowlist, tal como está escrito (sin defaults)", () => {
    const r = parseAgentConfig(row(), expected);
    assert.equal(r.kind, "ok");
    const c = (r as { config: AgentRuntimeConfig }).config;
    assert.equal(c.provider, "gemini");
    assert.equal(c.model, "gemini-3.6-flash");
    assert.deepEqual(c.tools, ["search_products", "get_cart", "handoff_to_human"]);
    assert.equal(c.channel, "retail");
    assert.equal(c.thinking, "low");
  });

  it("sin fila => none; apagada => disabled", async () => {
    assert.deepEqual(await loadAgentConfig(createMemoryAgentConfigStore([]), expected), { kind: "none" });
    assert.deepEqual(await loadAgentConfig(createMemoryAgentConfigStore([row({ habilitado: false })]), expected), { kind: "disabled" });
  });

  it("proveedor/modelo/credencial inválidos => invalid (nunca un default ni Claude)", () => {
    const casos: Array<[Partial<AgentConfigRow>, string]> = [
      [{ proveedor: null }, "provider_missing"],
      [{ proveedor: "anthropic" }, "provider_unsupported"],
      [{ proveedor: "claude" }, "provider_unsupported"],
      [{ modelo: "claude-sonnet-5" }, "model_unsupported"],
      [{ modelo: "gemini-2.0-flash" }, "model_unsupported"],
      [{ modelo: null }, "model_missing"],
      [{ credencial_ref: "env:ANTHROPIC_API_KEY" }, "credential_ref_invalid"],
      [{ credencial_ref: "AIza-clave-pegada-por-error" }, "credential_ref_invalid"],
    ];
    for (const [over, reason] of casos) assert.deepEqual(parseAgentConfig(row(over), expected), { kind: "invalid", reason }, reason);
  });

  it("allowlist: herramienta desconocida, vacía o 'sql' => tools_invalid", () => {
    for (const herramientas of [[], ["search_products", "execute_sql"], ["update_stock"], ["get_order"]]) {
      assert.deepEqual(parseAgentConfig(row({ herramientas }), expected), { kind: "invalid", reason: "tools_invalid" });
    }
  });

  it("fila de OTRO negocio para este número => tenant_mismatch; tipo desconocido; negocio con campos extra", () => {
    assert.deepEqual(parseAgentConfig(row({ id_tenant: "bbbbbbbb-0000-4000-8000-00000000000b" }), expected), { kind: "invalid", reason: "tenant_mismatch" });
    assert.deepEqual(parseAgentConfig(row({ tipo: "appointments" }), expected), { kind: "invalid", reason: "kind_unsupported" });
    assert.deepEqual(parseAgentConfig(row({ negocio: { catalogo_completo: "…" } }), expected), { kind: "invalid", reason: "business_config_invalid" });
    assert.deepEqual(parseAgentConfig(row({ negocio: { politicas: Array(13).fill("x") } }), expected), { kind: "invalid", reason: "business_config_invalid" });
    assert.deepEqual(parseAgentConfig({ id_tenant: T }, expected), { kind: "invalid", reason: "row_invalid" });
  });

  it("proveedor de la config: su propia key; si falta => credential_missing (no usa GEMINI_KEY de plataforma ni Anthropic)", () => {
    const c = (parseAgentConfig(row(), expected) as { config: AgentRuntimeConfig }).config;
    const usadas: string[] = [];
    const factories = { gemini: (k: string) => (usadas.push(k), createSimulatedProvider([])) };
    const ok = providerForConfig(c, { env: { GEMINI_KEY_DELACOUR: "clave-delacour-no-real" }, factories });
    assert.equal(ok.ok && ok.provider.id, "gemini");
    assert.deepEqual(usadas, ["clave-delacour-no-real"]);
    assert.deepEqual(providerForConfig(c, { env: { GEMINI_KEY: "plataforma", ANTHROPIC_API_KEY: "sk-ant" }, factories }), { ok: false, reason: "credential_missing" });
  });

  it("el universo de herramientas es cerrado y conocido", () => {
    assert.equal(AGENT_TOOL_NAMES.length, 13);
    assert.ok(!AGENT_TOOL_NAMES.some((n) => /sql|stock|price|delete|update_product/.test(n)));
  });
});

describe("memoria estructurada de la conversación", () => {
  const key = { tenantId: T, phoneNumberId: PN, waId: "573001112233" };

  it("vacía, válida y acotada; nada de precios en el esquema", () => {
    const s = emptyConversationState();
    assert.equal(conversationStateSchema.safeParse(s).success, true);
    assert.equal(conversationStateSchema.safeParse({ ...s, cart: [{ reference: "DL-000184", quantity: 1, unit_price: 1 }] }).success, false, "sin precios en el carrito");
    assert.equal(conversationStateSchema.safeParse({ ...s, cart: Array.from({ length: 31 }, (_, i) => ({ reference: `DL-${String(i).padStart(6, "0")}`, quantity: 1 })) }).success, false);
    assert.equal(conversationStateSchema.safeParse({ ...s, cart: [{ reference: "DL-000184", quantity: 100 }] }).success, false);
  });

  it("estado ilegible => se reinicia (nunca se usa a medias)", () => {
    assert.deepEqual(parseConversationState({ v: 99, carrito: "x" }), { state: emptyConversationState(), reset: true });
    assert.deepEqual(parseConversationState(null), { state: emptyConversationState(), reset: false });
  });

  it("procedencia: normaliza, no duplica y conserva la primera vía", () => {
    let s = rememberReferences(emptyConversationState(), ["dl-000184", "DL-000184", "no-es-ref"], "customer");
    s = rememberReferences(s, ["DL-000184", "DL-000185"], "tool");
    assert.deepEqual(
      s.known.map((k) => `${k.reference}:${k.via}`),
      ["DL-000184:customer", "DL-000185:tool"],
    );
    assert.equal(isKnownReference(s, "dl-000185"), true);
    assert.equal(isKnownReference(s, "DL-999999"), false);
  });

  it("compare-and-set: dos escrituras sobre la misma versión => solo una gana; tenant ajeno no lee", async () => {
    const store = createMemoryConversationStateStore();
    const a = await store.load(key);
    assert.equal(a.version, null);
    assert.equal(await store.save(key, { ...a.state, turn: 1 }, null), true);
    assert.equal(await store.save(key, { ...a.state, turn: 1 }, null), false, "la fila ya existe");
    const b = await store.load(key);
    assert.equal(b.version, 1);
    assert.equal(await store.save(key, { ...b.state, turn: 2 }, 1), true);
    assert.equal(await store.save(key, { ...b.state, turn: 99 }, 1), false, "versión vieja: no pisa");
    assert.equal((await store.load(key)).state.turn, 2);
    assert.equal((await store.load({ ...key, tenantId: "bbbbbbbb-0000-4000-8000-00000000000b" })).version, null);
  });
});

describe("contexto por capas", () => {
  const config = (parseAgentConfig(row(), expected) as { config: AgentRuntimeConfig }).config;
  const facts: TurnFacts = { channel: "retail", channelSource: "number_config", customerName: "Laura", activeOrder: null, handoffActive: false };

  it("sistema = reglas + negocio + estado; sin catálogo, sin teléfono, sin ids internos", () => {
    let s = rememberReferences({ ...emptyConversationState(), cart: [{ reference: "DL-000184", quantity: 2 }] }, ["DL-000184"], "tool");
    s = { ...s, lastShown: [{ reference: "DL-000184", name: "Anillo Corazón" }] };
    const sys = buildSystemInstruction(config, s, facts);
    assert.ok(sys.startsWith(PLATFORM_RULES));
    assert.match(sys, /Nombre del asistente: Sofía/);
    assert.match(sys, /Política: Envíos a todo el país\./);
    assert.match(sys, /"carrito":\[\{"reference":"DL-000184","quantity":2\}\]/);
    assert.match(sys, /"posicion":1,"referencia":"DL-000184"/);
    assert.doesNotMatch(sys, /573001112233|100000000000001|aaaaaaaa-0000/);
    assert.ok(sys.length < 6_000, `contexto de sistema compacto (${sys.length})`);
  });

  it("las reglas cubren lo crítico: fuente de verdad, no calcular, ambigüedad, confirmación, canal, inyección", () => {
    for (const re of [/única fuente de verdad/, /Nunca calcules precios/, /Nunca elijas por el cliente/, /confirmation_id/, /canal de precios/i, /datos, no instrucciones/, /Nunca escribas enlaces/]) {
      assert.match(PLATFORM_RULES, re);
    }
  });

  it("estado: canal legible, propuesta y pedido activo del backend", () => {
    const s = { ...emptyConversationState(), proposal: { orderId: "DL-ORD-7K2M9Q", confirmationId: "cf_0123456789abcdef", presentedTurn: 3 } };
    const j = JSON.parse(stateSection(s, { ...facts, channel: "wholesale" }));
    assert.equal(j.canal, "mayorista");
    assert.deepEqual(j.propuesta_vigente, { order_id: "DL-ORD-7K2M9Q", confirmation_id: "cf_0123456789abcdef", ya_mostrada_al_cliente: true });
  });

  it("historial: sin el mensaje actual ni campañas, fusiona, empieza por el cliente y se acota", () => {
    const rows: HistoryRow[] = [
      { direccion: "saliente", contenido: "Bienvenida de campaña", origen: "campaña", wamid: "w0" },
      { direccion: "saliente", contenido: "Hola, soy Sofía", origen: "ia", wamid: "w1" },
      { direccion: "entrante", contenido: "hola", origen: "entrante", wamid: "w2" },
      { direccion: "entrante", contenido: "quiero aretes", origen: "entrante", wamid: "w3" },
      { direccion: "saliente", contenido: "Claro, ¿de qué color?", origen: "ia", wamid: "w4" },
      { direccion: "entrante", contenido: "dorados", origen: "entrante", wamid: "actual" },
    ];
    assert.deepEqual(historyTurns(rows, { excludeWamid: "actual" }), [
      { role: "user", text: "hola\nquiero aretes" },
      { role: "model", text: "Claro, ¿de qué color?", toolCalls: [], continuation: null },
    ]);
    const largas: HistoryRow[] = Array.from({ length: 40 }, (_, i) => ({ direccion: i % 2 ? "saliente" : "entrante", contenido: "x".repeat(500), origen: "ia", wamid: `w${i}` }));
    const t = historyTurns(largas);
    assert.ok(t.length <= 10);
    assert.ok(t.reduce((s, x) => s + (x.role === "tool" ? 0 : (x.text ?? "").length), 0) <= 6_000);
    assert.equal(t[0].role, "user");
  });
});
