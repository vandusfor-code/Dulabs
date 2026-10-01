/**
 * catalog_sales MULTI-NEGOCIO (Fase 1) — perfil EXPLÍCITO por número y aislamiento entre negocios.
 *
 *   1. Esquemas del perfil (vocabulario y opciones del checkout): estrictos, catálogo cerrado de métodos.
 *   2. Paridad: lo que la migración escribe en la fila de Delacour = el comportamiento anterior (PERFIL_LEGADO).
 *   3. Config: columnas ausentes (migración pendiente) => como antes; null => neutral / fail-closed.
 *   4. Delacour no cambia: misma lectura de pagos que el algoritmo anterior, mismo léxico, mismos textos y,
 *      de punta a punta, la MISMA conversación con su perfil explícito que sin las columnas.
 *   5. Neutral: un negocio sin vocabulario nunca habla de joyas.
 *   6. Otro negocio con otros pagos (contra entrega, link de pago; >3 opciones => lista; opción única => no se pregunta).
 *   7. Aislamiento A (perfil de Delacour) ↔ B (tienda genérica): productos, pedidos, clientes, fotos,
 *      conversaciones, configuración y credenciales de Meta.
 *
 * Negocios, clientes y productos FICTICIOS. Ninguna prueba toca Supabase, Gemini ni Meta.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { OrderError, conversationKey, createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { createMemoryAgentConfigStore, parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import type { HistoryRow } from "@/lib/agente/contexto";
import { createMemoryConversationStateStore, type ConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import type { AgentToolsDeps } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { LIST_BUTTON_LABEL, runAgentTurn } from "@/lib/agente/runtime";
import { createMemoryCustomerChannelStore, intentMenu, resolveStartAction, startMessages } from "@/lib/agente/clasificacion";
import { CHECKOUT_BUTTONS, DELIVERY_BUTTONS, PAYMENT_BUTTONS, checkoutOptionTexts, checkoutStepHint } from "@/lib/agente/checkout";
import { stageGuidance } from "@/lib/agente/etapa";
import { createMemoryProductMediaLedger } from "@/lib/agente/medios";
import { leerCorreccion, leerNombre, leerPago, pideProducto } from "@/lib/agente/lenguaje/interpretar";
import { NO_ES_NOMBRE, NOMBRE_COMERCIAL, PAGO, PALABRAS_PRODUCTO } from "@/lib/agente/lenguaje/lexico";
import { normalizar } from "@/lib/agente/lenguaje/normalizar";
import {
  CHECKOUT_OPCIONES_LEGADO,
  VOCABULARIO_LEGADO,
  VOCABULARIO_NEUTRAL,
  checkoutOpcionesSchema,
  pagosPara,
  resolverCheckoutOpciones,
  resolverVocabulario,
  vocabularioSchema,
  type CheckoutOpciones,
} from "@/lib/agente/perfil-negocio";
import { atenderConAgenteSiAplica, type AgentBoundaryDeps } from "@/lib/agente/webhook";
import { resolverTokenMetaAgente, resolverTokenMetaDeNumero } from "@/lib/whatsapp-outbound";
import { cifrarSecreto } from "@/lib/crypto";
import type { DeliveryType } from "@/lib/catalogo/pedidos/contrato";

// A = perfil de Delacour (joyería) | B = tienda genérica ficticia con otros pagos.
const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN_A = "100000000000001";
const PN_B = "100000000000002";
const CLIENTE = "573001112233";

// ---------------------------------------------------------------------------
// Perfil de Delacour TAL COMO LO ESCRIBE LA MIGRACIÓN (no una copia a mano)
// ---------------------------------------------------------------------------
const MIGRACION = readFileSync(join(process.cwd(), "supabase/migrations/20261205000000_dulabs_agente_perfil_negocio.sql"), "utf8");
const bloque = (tag: string) => {
  const m = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(MIGRACION);
  assert.ok(m, `la migración trae el bloque $${tag}$`);
  return JSON.parse(m[1]) as unknown;
};
const VOCABULARIO_MIGRACION = bloque("vocabulario");
const OPCIONES_MIGRACION = bloque("checkout");

/** Tienda genérica: 4 pagos (contra entrega solo con domicilio) => con domicilio son 4 opciones (lista). */
const OPCIONES_B: CheckoutOpciones = {
  entregas: ["tienda", "domicilio"],
  pagos: [{ metodo: "transferencia" }, { metodo: "contra_entrega" }, { metodo: "link_pago" }, { metodo: "pago_en_tienda" }],
};
/** Una sola entrega y un solo pago: no se pregunta ninguno de los dos. */
const OPCIONES_UNICAS: CheckoutOpciones = { entregas: ["domicilio"], pagos: [{ metodo: "contra_entrega" }] };

// ===========================================================================
// 1. Esquemas
// ===========================================================================

describe("Perfil · esquemas estrictos y catálogo cerrado", () => {
  it("el neutral, el legado y el de la migración son válidos", () => {
    assert.ok(vocabularioSchema.safeParse(VOCABULARIO_NEUTRAL).success);
    assert.ok(vocabularioSchema.safeParse(VOCABULARIO_LEGADO).success);
    assert.ok(checkoutOpcionesSchema.safeParse(CHECKOUT_OPCIONES_LEGADO).success);
    assert.ok(checkoutOpcionesSchema.safeParse(OPCIONES_B).success);
    assert.ok(checkoutOpcionesSchema.safeParse(OPCIONES_UNICAS).success);
  });

  it("vocabulario: clave desconocida, palabra sin normalizar o botón > 20 => inválido", () => {
    assert.equal(vocabularioSchema.safeParse({ ...VOCABULARIO_NEUTRAL, extra: 1 }).success, false);
    assert.equal(vocabularioSchema.safeParse({ ...VOCABULARIO_NEUTRAL, no_es_nombre: ["Licuadoras"] }).success, false);
    assert.equal(vocabularioSchema.safeParse({ ...VOCABULARIO_NEUTRAL, no_es_nombre: ["dos palabras"] }).success, false);
    assert.equal(vocabularioSchema.safeParse({ ...VOCABULARIO_NEUTRAL, boton_buscar: "🔎 Buscar un producto ya" }).success, false);
  });

  it("opciones: nunca un método inventado ni una política imposible", () => {
    const malas: unknown[] = [
      { entregas: ["tienda"], pagos: [{ metodo: "efectivo" }] },
      { entregas: ["dron"], pagos: [{ metodo: "transferencia" }] },
      { entregas: ["tienda", "tienda"], pagos: [{ metodo: "transferencia" }] },
      { entregas: ["tienda"], pagos: [{ metodo: "transferencia" }, { metodo: "transferencia" }] },
      { entregas: ["tienda", "domicilio"], pagos: [{ metodo: "contra_entrega", solo_con: ["tienda"] }, { metodo: "transferencia" }] },
      { entregas: ["tienda"], pagos: [{ metodo: "transferencia", solo_con: ["domicilio"] }] },
      // Recoger en tienda sin ningún pago posible (contra entrega es solo domicilio): el checkout no podría terminar.
      { entregas: ["tienda"], pagos: [{ metodo: "contra_entrega" }] },
      { entregas: [], pagos: [{ metodo: "transferencia" }] },
      { entregas: ["tienda"], pagos: [] },
      { entregas: ["tienda"], pagos: [{ metodo: "transferencia" }], otro: true },
    ];
    for (const m of malas) assert.equal(checkoutOpcionesSchema.safeParse(m).success, false, JSON.stringify(m));
  });

  it("pagos por entrega: contra entrega solo con domicilio; sin política, todos", () => {
    assert.deepEqual(pagosPara(OPCIONES_B, "domicilio"), ["transferencia", "contra_entrega", "link_pago", "pago_en_tienda"]);
    assert.deepEqual(pagosPara(OPCIONES_B, "tienda"), ["transferencia", "link_pago", "pago_en_tienda"]);
    assert.deepEqual(pagosPara(CHECKOUT_OPCIONES_LEGADO, "domicilio"), ["pago_en_tienda", "transferencia"]);
    assert.deepEqual(pagosPara(CHECKOUT_OPCIONES_LEGADO, "tienda"), ["pago_en_tienda", "transferencia"]);
  });

  it("columna: ausente => legado (migración pendiente); null => neutral / sin opciones; objeto inválido => inválido", () => {
    assert.deepEqual(resolverVocabulario(undefined), { ok: true, vocabulario: VOCABULARIO_LEGADO, legado: true });
    assert.deepEqual(resolverVocabulario(null), { ok: true, vocabulario: VOCABULARIO_NEUTRAL, legado: false });
    assert.deepEqual(resolverVocabulario({ producto: "x" }), { ok: false });
    assert.deepEqual(resolverCheckoutOpciones(undefined), { ok: true, opciones: CHECKOUT_OPCIONES_LEGADO, legado: true });
    assert.deepEqual(resolverCheckoutOpciones(null), { ok: true, opciones: null, legado: false });
    assert.deepEqual(resolverCheckoutOpciones({ entregas: ["tienda"], pagos: [{ metodo: "bitcoin" }] }), { ok: false });
  });
});

// ===========================================================================
// 2. Paridad migración ↔ comportamiento anterior
// ===========================================================================

describe("Perfil · paridad: la migración escribe en Delacour EXACTAMENTE el comportamiento anterior", () => {
  it("vocabulario y opciones de la migración = PERFIL_LEGADO (y pasan la validación estricta)", () => {
    assert.deepEqual(vocabularioSchema.parse(VOCABULARIO_MIGRACION), VOCABULARIO_LEGADO);
    assert.deepEqual(checkoutOpcionesSchema.parse(OPCIONES_MIGRACION), CHECKOUT_OPCIONES_LEGADO);
  });

  it("solo la fila de Delacour (su negocio Y su número, los mismos del script de su configuración)", () => {
    const aria = readFileSync(join(process.cwd(), "scripts/delacour/aria-config.sql"), "utf8");
    const ids = /id_tenant = '([0-9a-f-]{36})' and phone_number_id = '(\d+)'/.exec(aria)!;
    const updates = MIGRACION.match(/where (?:r\.)?id_tenant = '([0-9a-f-]{36})' and (?:r\.)?phone_number_id = '(\d+)'/g) ?? [];
    assert.equal(updates.length, 3, "vocabulario, opciones y token: tres updates acotados");
    for (const u of updates) assert.ok(u.includes(ids[1]) && u.includes(ids[2]), u);
    // Los updates del perfil nunca pisan una configuración existente.
    assert.match(MIGRACION, /and vocabulario is null;/);
    assert.match(MIGRACION, /and checkout_opciones is null;/);
  });

  it("el CHECK de pedidos admite el catálogo cerrado de la plataforma, nada más", () => {
    const m = /metodo_pago in \(([^)]*)\)\);/.exec(MIGRACION.split("4. Métodos de pago")[1])!;
    assert.deepEqual(m[1].split(",").map((s) => s.trim().replace(/'/g, "")), ["pago_en_tienda", "transferencia", "contra_entrega", "link_pago"]);
  });
});

// ===========================================================================
// 3. Config (fail-closed)
// ===========================================================================

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
  negocio: { nombre_agente: "Sofía", nombre_negocio: "Negocio Ficticio" },
  clasificacion_cliente: true,
  checkout_conversacional: true,
  ...over,
});
const filaDelacour = (over: Partial<AgentConfigRow> = {}) => fila({ vocabulario: VOCABULARIO_MIGRACION, checkout_opciones: OPCIONES_MIGRACION, meta_token_plataforma: true, ...over });
const filaB = (over: Partial<AgentConfigRow> = {}) => fila({ vocabulario: null, checkout_opciones: OPCIONES_B, meta_token_plataforma: false, ...over }, B, PN_B);
const parse = (row: AgentConfigRow) => parseAgentConfig(row, { tenantId: row.id_tenant, phoneNumberId: row.phone_number_id });
const ok = (row: AgentConfigRow) => {
  const r = parse(row);
  assert.equal(r.kind, "ok", JSON.stringify(r));
  return (r as { config: AgentRuntimeConfig }).config;
};

describe("Perfil · configuración del número", () => {
  it("sin las columnas (migración pendiente) => perfil anterior, token de plataforma como antes", () => {
    const c = ok(fila());
    assert.equal(c.legacyProfile, true);
    assert.deepEqual(c.vocabulary, VOCABULARIO_LEGADO);
    assert.deepEqual(c.checkoutOptions, CHECKOUT_OPCIONES_LEGADO);
    assert.equal(c.metaPlatformToken, true);
  });

  it("Delacour con su perfil EXPLÍCITO = el mismo perfil que antes (y ya no es legado)", () => {
    const c = ok(filaDelacour());
    assert.equal(c.legacyProfile, false);
    assert.deepEqual(c.vocabulary, VOCABULARIO_LEGADO);
    assert.deepEqual(c.checkoutOptions, CHECKOUT_OPCIONES_LEGADO);
  });

  it("checkout encendido sin opciones => INVÁLIDA (no se inventa un método); apagado => válida", () => {
    assert.deepEqual(parse(fila({ vocabulario: null, checkout_opciones: null })), { kind: "invalid", reason: "checkout_options_missing" });
    const sinCheckout = ok(fila({ vocabulario: null, checkout_opciones: null, checkout_conversacional: false }));
    assert.equal(sinCheckout.checkoutOptions, null);
    assert.deepEqual(sinCheckout.vocabulary, VOCABULARIO_NEUTRAL);
  });

  it("vocabulario u opciones mal formados => inválida (fail-closed, nunca cae a otro perfil)", () => {
    assert.deepEqual(parse(fila({ vocabulario: { producto: "x" } })), { kind: "invalid", reason: "vocabulary_invalid" });
    assert.deepEqual(parse(fila({ vocabulario: null, checkout_opciones: { entregas: ["tienda"], pagos: [{ metodo: "efectivo" }] } })), { kind: "invalid", reason: "checkout_options_invalid" });
  });

  it("token de la plataforma: solo con autorización explícita de la fila", () => {
    assert.equal(ok(filaB({ meta_token_plataforma: false })).metaPlatformToken, false);
    assert.equal(ok(filaB({ meta_token_plataforma: null })).metaPlatformToken, false);
    assert.equal(ok(filaB({ meta_token_plataforma: true })).metaPlatformToken, true);
  });

  it("el negocio B con su perfil: vocabulario NEUTRAL y SUS pagos (nada de Delacour)", () => {
    const c = ok(filaB());
    assert.deepEqual(c.vocabulary, VOCABULARIO_NEUTRAL);
    assert.deepEqual(c.checkoutOptions, OPCIONES_B);
    assert.doesNotMatch(JSON.stringify(c), /joya|aretes|dijes|Delacour/i);
  });
});

// ===========================================================================
// 4. Delacour no cambia (lenguaje)
// ===========================================================================

/** El algoritmo de leerPago ANTERIOR a la generalización (copia literal), para comparar. */
function leerPagoAnterior(text: string, entrega: DeliveryType | null): "pago_en_tienda" | "transferencia" | "no_disponible" | null {
  const t = normalizar(text);
  if (!t || t.length > 120) return null;
  const alguna = (frases: readonly string[]) => frases.some((f) => ` ${t} `.includes(` ${f} `));
  const transfer = alguna(PAGO.transferencia);
  const segun = alguna(PAGO.segun_entrega);
  const tienda = alguna(PAGO.pago_en_tienda) || (segun && entrega === "tienda");
  if (segun && !transfer && !tienda && entrega === "domicilio") return "no_disponible";
  if (tienda === transfer) return null;
  return tienda ? "pago_en_tienda" : "transferencia";
}

const FRASES_PAGO = [
  "transferencia", "te transfiero", "por nequi", "pago en tienda", "en tienda", "pago allá", "efectivo", "contra entrega", "contraentrega",
  "pago cuando llegue", "cuando llegue", "al recibir", "pago al recoger", "transferencia o en tienda", "contra entrega o transferencia",
  "pago en tienda cuando llegue", "con tarjeta", "link de pago", "pse", "daviplata", "no sé", "", "cuando vaya", "pago presencial",
  "mejor transferencia", "efectivo en tienda cuando llegue", "nequi o efectivo", "tarjeta de crédito", "al llegar pago por transferencia",
];

describe("Delacour · mismo comportamiento con su perfil explícito", () => {
  it("lectura del pago: idéntica al algoritmo anterior en todas las frases y entregas", () => {
    for (const f of FRASES_PAGO) {
      for (const e of [null, "tienda", "domicilio"] as const) {
        assert.equal(leerPago(f, e, CHECKOUT_OPCIONES_LEGADO), leerPagoAnterior(f, e), `"${f}" con ${e}`);
      }
    }
  });

  it("sigue rechazando contra entrega con domicilio, con su texto de siempre", () => {
    assert.equal(leerPago("contra entrega", "domicilio", CHECKOUT_OPCIONES_LEGADO), "no_disponible");
    assert.equal(checkoutOptionTexts(CHECKOUT_OPCIONES_LEGADO).paymentUnavailable("contra_entrega", "domicilio"), "Por ahora no manejamos pago contra entrega 🙏 Puedes pagar por *transferencia* o *en la tienda*.");
    // Ni link de pago ni tarjeta: Delacour no los ofrece (no se reconocen como elegidos).
    assert.equal(leerPago("link de pago", "domicilio", CHECKOUT_OPCIONES_LEGADO), null);
  });

  it("léxico genérico + vocabulario de Delacour = las listas anteriores (nada se perdió ni se agregó)", () => {
    const productoAnterior = ["arete", "aretes", "collar", "collares", "dije", "dijes", "pulsera", "pulseras", "anillo", "anillos", "cadena", "cadenas", "tobillera", "tobilleras", "candonga", "candongas", "joya", "joyas", "producto", "productos", "ese", "esa", "este", "esta", "esos", "esas", "otro producto", "otra joya", "otra cosa", "algo mas"];
    assert.deepEqual(new Set([...PALABRAS_PRODUCTO, ...VOCABULARIO_LEGADO.palabras_producto]), new Set(productoAnterior));
    const joyas = ["arete", "aretes", "collar", "collares", "dije", "dijes", "pulsera", "pulseras", "anillo", "anillos", "cadena", "cadenas", "joya", "joyas"];
    for (const w of joyas) assert.ok(!NO_ES_NOMBRE.has(w) && VOCABULARIO_LEGADO.no_es_nombre.includes(w), w);
    assert.deepEqual(new Set([...NOMBRE_COMERCIAL, ...VOCABULARIO_LEGADO.nombre_comercial]), new Set(["tienda", "local", "mayor", "mayorista", "detal", "joya", "joyas"]));
  });

  it("sigue hablando de joyas: botón, ejemplos, textos de inicio y orientación del modelo", () => {
    const menu = intentMenu(VOCABULARIO_LEGADO);
    assert.equal(menu.buttons[0].title, "🔎 Buscar una joya");
    assert.equal(menu.textFallback, "¡Perfecto! ✨ Escríbeme qué joya buscas (por ejemplo: dijes, aretes dorados…) o escribe *ver catálogo*.");
    assert.equal(menu.writeOrCatalog, "Escríbeme qué joya buscas o escribe *ver catálogo*.");
    const inicio = startMessages(VOCABULARIO_LEGADO);
    assert.equal(inicio.searchPrompt, "Cuéntame qué estás buscando y te ayudo a encontrarlo.\n\nPor ejemplo: dijes, aretes dorados, collar corazón…");
    assert.equal(inicio.catalogUnavailable, "En este momento el catálogo en línea no está disponible. Cuéntame qué joya buscas y te ayudo por aquí.");
    assert.equal(stageGuidance("inicio", VOCABULARIO_LEGADO), "Saluda y entiende qué busca (tipo de joya, color, material, presupuesto) o si prefiere ver el catálogo.");
    assert.equal(resolveStartAction("🔎 Buscar una joya", null, VOCABULARIO_LEGADO), "search_product");
    assert.equal(pideProducto("quiero dos aretes", VOCABULARIO_LEGADO), true);
    assert.equal(leerNombre("quiero dos aretes", VOCABULARIO_LEGADO), null);
    assert.equal(leerNombre("joyas", VOCABULARIO_LEGADO), null);
    assert.equal(leerNombre("Joyas Mary", VOCABULARIO_LEGADO), "Joyas Mary");
  });

  it("textos fijos del checkout de Delacour: los de siempre", () => {
    const t = checkoutOptionTexts(CHECKOUT_OPCIONES_LEGADO);
    assert.equal(t.deliveryFallback, "¿Cómo deseas recibir tu pedido? Respóndeme *recoger en tienda* o *domicilio*.");
    assert.equal(`¿Cómo deseas pagar? ${t.paymentChoices("domicilio")}`, "¿Cómo deseas pagar? Respóndeme *pago en tienda* o *transferencia*.");
    assert.equal(t.doubt, "Claro 😊 ¿Qué quieres cambiar? Puedes escribirme, por ejemplo, *recoger en tienda*, *domicilio*, *transferencia* o *pago en tienda*. Para cambiar cantidades dime cuántas y de cuál producto.");
    assert.equal(checkoutStepHint(CHECKOUT_OPCIONES_LEGADO, "delivery", null), "Escríbeme si prefieres *domicilio* o *recoger en tienda*.");
    assert.equal(checkoutStepHint(CHECKOUT_OPCIONES_LEGADO, "payment", "domicilio"), "Escríbeme si pagas por *transferencia* o *en tienda*.");
    assert.deepEqual([DELIVERY_BUTTONS.tienda, DELIVERY_BUTTONS.domicilio, PAYMENT_BUTTONS.pago_en_tienda, PAYMENT_BUTTONS.transferencia], [
      { id: "checkout_tienda", title: "🏬 Recoger en tienda" },
      { id: "checkout_domicilio", title: "🏠 Domicilio" },
      { id: "checkout_pago_tienda", title: "💵 Pago en tienda" },
      { id: "checkout_transferencia", title: "🏦 Transferencia" },
    ]);
  });
});

// ===========================================================================
// 5. Neutral
// ===========================================================================

describe("Neutral · un negocio sin vocabulario nunca habla de joyas", () => {
  it("botón, textos de inicio y orientación del modelo: 'producto', sin ejemplos inventados", () => {
    const menu = intentMenu(VOCABULARIO_NEUTRAL);
    assert.equal(menu.buttons[0].title, "🔎 Buscar producto");
    assert.ok(menu.buttons.every((b) => b.title.length <= 20));
    assert.equal(menu.textFallback, "¡Perfecto! ✨ Escríbeme qué producto buscas o escribe *ver catálogo*.");
    const inicio = startMessages(VOCABULARIO_NEUTRAL);
    assert.equal(inicio.searchPrompt, "Cuéntame qué estás buscando y te ayudo a encontrarlo.");
    const todo = JSON.stringify([menu, inicio.searchPrompt, inicio.catalogUnavailable, stageGuidance("inicio", VOCABULARIO_NEUTRAL)]);
    assert.doesNotMatch(todo, /joya|aretes|dijes|collar|material/i);
  });

  it("el botón de Delacour no es una acción de otro negocio; el suyo sí", () => {
    assert.equal(resolveStartAction("🔎 Buscar una joya", null, VOCABULARIO_NEUTRAL), null);
    assert.equal(resolveStartAction("🔎 Buscar producto", null, VOCABULARIO_NEUTRAL), "search_product");
  });

  it("las palabras de joyería no son reglas de otro negocio; las genéricas sí", () => {
    assert.equal(pideProducto("quiero dos aretes", VOCABULARIO_NEUTRAL), false);
    assert.equal(pideProducto("quiero otro producto", VOCABULARIO_NEUTRAL), true);
    assert.equal(leerNombre("quiero comprar", VOCABULARIO_NEUTRAL), null);
  });
});

// ===========================================================================
// 6–7. Conversaciones completas (motor real en memoria) y aislamiento
// ===========================================================================

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let engine: ReturnType<typeof createOrderEngine>;
let stateStore: ConversationStateStore;
let canales: ReturnType<typeof createMemoryCustomerChannelStore>;
let history: Map<string, HistoryRow[]>;
let sent: string[];
let menus: Array<{ kind: "botones" | "lista"; body: string; ids: string[]; label?: string }>;
let seq: number;
let reloj: number;

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  reloj = Date.parse("2026-10-01T15:00:00Z");
  pedidos = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => reloj });
  stateStore = createMemoryConversationStateStore();
  canales = createMemoryCustomerChannelStore({ [PN_A]: A.tenantId, [PN_B]: B.tenantId });
  history = new Map();
  sent = [];
  menus = [];
  seq = 0;
  engine = createOrderEngine({
    orders: pedidos,
    catalog: mem.repo,
    key: Buffer.alloc(32, 9),
    sink: memoryOrderEventSink(),
    log: () => {},
    now: () => new Date(reloj),
    handoff: { pauseConversation: async () => ({ ok: true }) },
  });
  for (const actor of [A, B]) {
    mem.setProfile(actor.tenantId, { name: "Negocio", whatsapp: "573001110000" });
    mem.enableModule(actor.tenantId);
    await admin.ensurePublication(actor);
  }
});

const pnDe = (n: CatalogActor) => (n === A ? PN_A : PN_B);

function toolDeps(): AgentToolsDeps {
  return {
    engine,
    catalog: mem.repo,
    log: () => {},
    ownsPhoneNumber: async (tenantId, pn) => (tenantId === A.tenantId && pn === PN_A) || (tenantId === B.tenantId && pn === PN_B),
    customerName: async () => null,
    siteUrl: () => "https://dulabs.test",
  };
}

async function turno(negocio: CatalogActor, config: AgentRuntimeConfig, script: SimulatedStep[], text: string, opts: { buttonId?: string; waId?: string; sinLista?: boolean } = {}) {
  const provider = createSimulatedProvider(script);
  const waId = opts.waId ?? CLIENTE;
  const k = `${negocio.tenantId}|${waId}`;
  const h = history.get(k) ?? [];
  history.set(k, h);
  const wamid = `wamid.in.${++seq}`;
  h.push({ direccion: "entrante", contenido: text, origen: "entrante", wamid });
  const r = await runAgentTurn(
    {
      config,
      provider,
      model: "gemini-3.6-flash",
      tools: toolDeps(),
      state: stateStore,
      history: { recent: async () => h.map((x) => ({ ...x })) },
      classification: canales,
      sender: {
        async sendText(t) {
          sent.push(t);
          return { sent: true, wamid: `wamid.out.${++seq}` };
        },
        async sendImage() {
          return { sent: true, wamid: `wamid.img.${++seq}` };
        },
        async sendButtons(body, bs) {
          menus.push({ kind: "botones", body, ids: bs.map((b) => b.id) });
          sent.push(body);
          return { sent: true, wamid: `wamid.btn.${++seq}` };
        },
        ...(opts.sinLista
          ? {}
          : {
              async sendList(body: string, label: string, rows: ReadonlyArray<{ id: string; title: string }>) {
                menus.push({ kind: "lista", body, ids: rows.map((x) => x.id), label });
                sent.push(body);
                return { sent: true, wamid: `wamid.list.${++seq}` };
              },
            }),
        humanTookOver: async () => false,
      },
      log: () => {},
      now: () => reloj,
      retry: { sleep: async () => {}, random: () => 0 },
    },
    { tenantId: negocio.tenantId, phoneNumberId: pnDe(negocio), waId, wamid, text, buttonId: opts.buttonId ?? null },
  );
  return { ...r, provider };
}

const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });
const estado = async (negocio: CatalogActor, waId = CLIENTE): Promise<ConversationState> => (await stateStore.load({ tenantId: negocio.tenantId, phoneNumberId: pnDe(negocio), waId })).state;

/** Cliente clasificado + producto en el carrito + el MODELO detecta la compra: arranca el checkout. */
async function hastaCheckout(negocio: CatalogActor, config: AgentRuntimeConfig, nombreProducto: string, waId = CLIENTE) {
  await canales.setInitial({ tenantId: negocio.tenantId, phoneNumberId: pnDe(negocio), waId }, "retail", "cliente");
  const p = await admin.createProduct(negocio, { name: nombreProducto, retailPrice: 50_000, wholesalePrice: 40_000, stock: 10 });
  await turno(negocio, config, [call("update_cart", { items: [{ reference: p.reference, quantity: 1 }] }), { text: "Listo." }], `quiero 1 ${p.reference}`, { waId });
  await turno(negocio, config, [call("create_order_request"), { text: "NO DEBE SALIR" }], "lo quiero", { waId });
  return p;
}
const tocar = (negocio: CatalogActor, config: AgentRuntimeConfig, b: { id: string; title: string }, waId = CLIENTE) => turno(negocio, config, [], b.title, { buttonId: b.id, waId });

/** Nombre, domicilio, dirección, ciudad y sin referencia: queda en el paso del pago. */
async function hastaPago(negocio: CatalogActor, config: AgentRuntimeConfig, waId = CLIENTE) {
  await turno(negocio, config, [], "Laura Prueba", { waId });
  await tocar(negocio, config, DELIVERY_BUTTONS.domicilio, waId);
  await turno(negocio, config, [], "Calle 10 # 20-30, barrio Centro", { waId });
  await turno(negocio, config, [], "Montería", { waId });
  await tocar(negocio, config, CHECKOUT_BUTTONS.reference[0], waId);
}

describe("Delacour · la MISMA conversación con su perfil explícito que sin las columnas (antes de la migración)", () => {
  it("transcripción idéntica: pedido, duda, corrección, 'pago cuando llegue' con domicilio, pago y resumen", async () => {
    const correr = async (config: AgentRuntimeConfig, waId: string) => {
      const desde = sent.length;
      const menusDesde = menus.length;
      await hastaCheckout(A, config, `Aretes Luna ${waId}`, waId);
      await turno(A, config, [], "Laura Prueba", { waId });
      await turno(A, config, [], "me equivoqué", { waId });
      await tocar(A, config, DELIVERY_BUTTONS.domicilio, waId);
      await turno(A, config, [], "Calle 10 # 20-30, barrio Centro", { waId });
      await turno(A, config, [], "Montería", { waId });
      await tocar(A, config, CHECKOUT_BUTTONS.reference[0], waId);
      await turno(A, config, [], "pago cuando llegue", { waId });
      await turno(A, config, [], "🚚 Contra entrega", { waId });
      await turno(A, config, [], "mejor recojo en tienda", { waId });
      await turno(A, config, [], "transferencia", { waId });
      const ck = (await estado(A, waId)).checkout;
      const limpiar = (s: string) => s.replace(/DL-ORD-[0-9A-Z]{6}/g, "DL-ORD-X").replace(/Aretes Luna \d+/g, "Aretes Luna").replace(/DL-\d{6,}/g, "DL-X");
      return { textos: sent.slice(desde).map(limpiar), menus: menus.slice(menusDesde).map((m) => ({ ...m, body: limpiar(m.body) })), ck: ck ? { ...ck, orderId: "X", startedTurn: 0, summary: ck.summary ? { ...ck.summary, confirmationId: "X" } : null } : null };
    };
    const antes = await correr(ok(fila()), "573000000001");
    const explicito = await correr(ok(filaDelacour()), "573000000002");
    assert.deepEqual(explicito, antes);
    // Y es el comportamiento de Delacour: nunca acepta contra entrega, siempre ofrece sus dos pagos.
    assert.ok(antes.textos.some((t) => t.startsWith("Por ahora no manejamos pago contra entrega 🙏 Puedes pagar por *transferencia* o *en la tienda*.")));
    assert.ok(antes.menus.every((m) => m.kind === "botones" && m.ids.length <= 3));
    assert.equal(antes.ck?.paymentMethod, "transferencia");
    assert.equal(antes.ck?.delivery, "tienda");
  });
});

describe("Otro negocio · sus pagos (contra entrega, link de pago) y más de 3 opciones => lista", () => {
  it("domicilio: 4 pagos en una LISTA; elige contra entrega; el resumen y el pedido lo registran (nunca 'pagado')", async () => {
    const config = ok(filaB());
    await hastaCheckout(B, config, "Licuadora Turbo");
    await hastaPago(B, config);
    const lista = menus.at(-1)!;
    assert.equal(lista.kind, "lista");
    assert.equal(lista.label, LIST_BUTTON_LABEL);
    assert.deepEqual(lista.ids, ["checkout_transferencia", "checkout_contra_entrega", "checkout_link_pago", "checkout_pago_tienda"]);
    // El buzón guarda el TÍTULO de la fila (sin id): también vale.
    const r = await turno(B, config, [], PAYMENT_BUTTONS.contra_entrega.title);
    assert.equal((await estado(B)).checkout?.paymentMethod, "contra_entrega");
    assert.match(r.reply ?? "", /💳 Pago: Contra entrega/);
    assert.doesNotMatch(sent.join("\n"), /joya|aretes|Delacour/i);
    await tocar(B, config, CHECKOUT_BUTTONS.summary[0]);
    const pedido = pedidos.orders.at(-1)!;
    assert.equal(pedido.status, "confirmed");
    assert.equal(pedido.checkout?.paymentMethod, "contra_entrega");
    assert.equal(pedido.checkout?.paymentStatus, "pendiente");
  });

  it("escrito: 'contra entrega' (domicilio) y 'link de pago' se reconocen SOLO porque este negocio los ofrece", async () => {
    assert.equal(leerPago("contra entrega", "domicilio", OPCIONES_B), "contra_entrega");
    assert.equal(leerPago("pago cuando llegue", "domicilio", OPCIONES_B), "contra_entrega");
    assert.equal(leerPago("con tarjeta", "domicilio", OPCIONES_B), "link_pago");
    assert.equal(leerPago("contra entrega", "tienda", OPCIONES_B), "pago_en_tienda");
    assert.deepEqual(leerCorreccion("mejor contra entrega", "domicilio", OPCIONES_B), { pago: "contra_entrega" });
    assert.equal(leerCorreccion("mejor contra entrega", "domicilio", CHECKOUT_OPCIONES_LEGADO), null);
    const config = ok(filaB());
    await hastaCheckout(B, config, "Licuadora Turbo");
    await hastaPago(B, config);
    // "…link de pago" en el paso del pago es la respuesta (no un pedido del catálogo, aunque diga "link").
    await turno(B, config, [], "quiero pagar con link de pago");
    assert.equal((await estado(B)).checkout?.paymentMethod, "link_pago");
  });

  it("sin lista en el canal: las mismas opciones en texto (nunca un método que no ofrece)", async () => {
    const config = ok(filaB());
    await hastaCheckout(B, config, "Licuadora Turbo");
    await turno(B, config, [], "Laura Prueba");
    await tocar(B, config, DELIVERY_BUTTONS.domicilio);
    await turno(B, config, [], "Calle 10 # 20-30, barrio Centro");
    await turno(B, config, [], "Montería");
    const r = await turno(B, config, [], CHECKOUT_BUTTONS.reference[0].title, { buttonId: CHECKOUT_BUTTONS.reference[0].id, sinLista: true });
    assert.equal(r.reply, "¿Cómo deseas pagar? Respóndeme *transferencia*, *contra entrega*, *link de pago* o *pago en tienda*.");
  });

  it("recoger en tienda: 3 pagos en botones (contra entrega no aplica a esa entrega)", async () => {
    const config = ok(filaB());
    await hastaCheckout(B, config, "Licuadora Turbo");
    await turno(B, config, [], "Laura Prueba");
    await tocar(B, config, DELIVERY_BUTTONS.tienda);
    const m = menus.at(-1)!;
    assert.equal(m.kind, "botones");
    assert.deepEqual(m.ids, ["checkout_transferencia", "checkout_link_pago", "checkout_pago_tienda"]);
    // El botón de contra entrega (de un mensaje viejo) no se anota con recoger en tienda: el backend decide.
    await tocar(B, config, PAYMENT_BUTTONS.contra_entrega);
    assert.equal((await estado(B)).checkout?.paymentMethod, null);
  });

  it("una sola entrega y un solo pago: no se preguntan; el resumen los muestra; corregir a lo que no ofrece => se explica", async () => {
    const config = ok(filaB({ checkout_opciones: OPCIONES_UNICAS }));
    await hastaCheckout(B, config, "Licuadora Turbo");
    await turno(B, config, [], "Laura Prueba");
    assert.equal((await estado(B)).checkout?.step, "address", "sin pregunta de entrega");
    const r = await turno(B, config, [], "mejor recojo en tienda");
    assert.match(r.reply ?? "", /^Por ahora no manejamos recoger en tienda 🙏/);
    assert.equal((await estado(B)).checkout?.delivery, "domicilio");
    await turno(B, config, [], "Calle 10 # 20-30, barrio Centro");
    await turno(B, config, [], "Montería");
    const resumen = await tocar(B, config, CHECKOUT_BUTTONS.reference[0]);
    assert.match(resumen.reply ?? "", /🏠 Entrega: Domicilio[\s\S]*💳 Pago: Contra entrega/);
    assert.ok(!menus.some((m) => m.ids.includes("checkout_contra_entrega")), "nunca se preguntó el pago");
  });
});

describe("Aislamiento · A (perfil de Delacour) ↔ B (tienda genérica)", () => {
  it("productos: la referencia de un negocio no existe en el otro (ni para buscar ni para pedir)", async () => {
    const pa = await admin.createProduct(A, { name: "Aretes Luna", retailPrice: 45_000, wholesalePrice: 30_000, stock: 5 });
    const pb = await admin.createProduct(B, { name: "Licuadora Turbo", retailPrice: 250_000, wholesalePrice: 200_000, stock: 5 });
    // Cada negocio numera sus referencias: la misma referencia en el otro negocio es OTRO producto (el suyo), nunca este.
    const enB = await mem.repo.getProductByReference(B.tenantId, pa.reference);
    const enA = await mem.repo.getProductByReference(A.tenantId, pb.reference);
    assert.ok(!enB || (enB.id !== pa.id && enB.name !== "Aretes Luna"));
    assert.ok(!enA || (enA.id !== pb.id && enA.name !== "Licuadora Turbo"));
    // El agente de B busca lo de A: nada de A llega al modelo de B.
    await canales.setInitial({ tenantId: B.tenantId, phoneNumberId: PN_B, waId: CLIENTE }, "retail", "cliente");
    const r = await turno(B, ok(filaB()), [call("search_products", { query: "Aretes Luna" }), { text: "No lo encontré." }], "tienen aretes luna?");
    assert.ok(r.provider.requests.length >= 2, "el modelo de B sí buscó");
    assert.doesNotMatch(JSON.stringify(r.provider.requests), /Aretes Luna[^"]*45|45\.?000/);
  });

  it("pedidos: B no puede pedir productos de A ni leer los pedidos de A (y al revés)", async () => {
    const pa = await admin.createProduct(A, { name: "Aretes Luna", retailPrice: 45_000, wholesalePrice: 30_000, stock: 5 });
    const contactoA = { phoneNumberId: PN_A, waId: CLIENTE };
    const contactoB = { phoneNumberId: PN_B, waId: CLIENTE };
    const creado = await engine.createOrder({ tenantId: A.tenantId, channel: "retail", source: "agent", contact: contactoA, items: [{ reference: pa.reference, quantity: 1 }], idempotencyKey: conversationKey("agent", contactoA, "a1"), requestId: "r1" });
    await assert.rejects(
      engine.createOrder({ tenantId: B.tenantId, channel: "retail", source: "agent", contact: contactoB, items: [{ reference: pa.reference, quantity: 1 }], idempotencyKey: conversationKey("agent", contactoB, "b1"), requestId: "r2" }),
      (e: unknown) => e instanceof OrderError && e.code === "REFERENCE_NOT_FOUND",
    );
    await assert.rejects(engine.getOrder({ tenantId: B.tenantId, contact: contactoB, orderId: creado.order.orderId }), (e: unknown) => e instanceof OrderError && e.code === "NOT_FOUND");
    await assert.rejects(engine.getOrder({ tenantId: B.tenantId, contact: contactoA, orderId: creado.order.orderId }), (e: unknown) => e instanceof OrderError && e.code === "NOT_FOUND");
  });

  it("clientes y conversaciones: el mismo teléfono de cliente es otra persona en cada negocio", async () => {
    await canales.setInitial({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE }, "wholesale", "cliente");
    assert.equal(await canales.get({ tenantId: B.tenantId, phoneNumberId: PN_B, waId: CLIENTE }), null);
    // B no ve la clasificación del número de A (la lectura filtra por negocio) ni puede escribirla.
    assert.equal(await canales.get({ tenantId: B.tenantId, phoneNumberId: PN_A, waId: CLIENTE }), null);
    await assert.rejects(canales.setInitial({ tenantId: B.tenantId, phoneNumberId: PN_A, waId: CLIENTE }, "retail", "cliente"));
    assert.equal((await canales.get({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE }))?.channel, "wholesale", "A conserva su dato");
    await hastaCheckout(A, ok(filaDelacour()), "Aretes Luna");
    assert.ok((await estado(A)).checkout, "A tiene un checkout en curso");
    assert.equal((await estado(B)).checkout ?? null, null, "B no ve la conversación de A");
  });

  it("fotos: la foto enviada por A no existe para B", async () => {
    const ledger = createMemoryProductMediaLedger();
    const scope = { tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE };
    await ledger.record({ ...scope, wamid: "wamid.HBgMNTczMDAxMTEyMjMzFQIAERgSRkE5", reference: "DL-000184", productId: "p1", channel: "retail", turn: 1 });
    assert.ok(await ledger.findByWamid(scope, "wamid.HBgMNTczMDAxMTEyMjMzFQIAERgSRkE5"));
    assert.equal(await ledger.findByWamid({ ...scope, tenantId: B.tenantId, phoneNumberId: PN_B }, "wamid.HBgMNTczMDAxMTEyMjMzFQIAERgSRkE5"), null);
    assert.equal(await ledger.findByWamid({ ...scope, tenantId: B.tenantId }, "wamid.HBgMNTczMDAxMTEyMjMzFQIAERgSRkE5"), null);
  });

  it("configuración: la fila de A servida para el número de B es INVÁLIDA (nunca el perfil de otro)", () => {
    assert.deepEqual(parseAgentConfig(filaDelacour(), { tenantId: B.tenantId, phoneNumberId: PN_B }), { kind: "invalid", reason: "tenant_mismatch" });
    assert.deepEqual(parseAgentConfig({ ...filaDelacour(), phone_number_id: PN_B }, { tenantId: B.tenantId, phoneNumberId: PN_B }), { kind: "invalid", reason: "tenant_mismatch" });
  });
});

// ===========================================================================
// Fase 0: un negocio con la IA pausada (Aquí Sí Lo Compras) no responde por NINGÚN bot
// ===========================================================================

describe("Fase 0 · IA pausada: el número recibe (Inbox) pero ninguna IA responde, tampoco la legacy (Claude)", () => {
  it("la guarda corta ANTES del agente, del Business Agent, del Flow y de la IA legacy; el registro ocurre antes", () => {
    const src = readFileSync(join(process.cwd(), "app/webhook-dulabs/route.ts"), "utf8").replace(/\r\n/g, "\n");
    const guarda = src.indexOf("if (cliente.ia_pausada) {");
    assert.ok(guarda > 0);
    assert.match(src.slice(guarda, src.indexOf("\n  }\n", guarda) + 4), /^if \(cliente\.ia_pausada\) \{\n\s+console\.log\([^\n]*\);\n\s+return;\n\s*\}$/);
    const atender = src.indexOf("async function atenderMensaje(");
    assert.ok(atender > 0 && atender < guarda, "la guarda está en atenderMensaje");
    for (const ia of [
      "intentarAgenteConversacionalSiAplica(cliente, mensaje, telefonoRemitente, destinoWhatsApp)",
      "intentarBusinessAgentSiAplica(cliente, mensaje, telefonoRemitente)",
      "atenderMensajeConFlowConFallback({",
      "await generarRespuestaIA(",
    ]) {
      const i = src.indexOf(ia, atender);
      assert.ok(i > guarda, `después de la guarda: ${ia}`);
    }
    // El mensaje entrante se registra en el webhook (síncrono) antes de atender: el Inbox lo ve aunque la IA calle.
    const registro = src.indexOf("registrarMensajesEntrantesSincrono(");
    assert.ok(registro > 0);
  });
});

// ===========================================================================
// Credenciales de Meta (fail-closed, sin la de la plataforma salvo autorización explícita)
// ===========================================================================

describe("Credenciales de Meta · tenant A → credencial A; B → B; sin credencial → error controlado", () => {
  const conClave = <T>(fn: () => T): T => {
    const prev = { k: process.env.TOKEN_ENCRYPTION_KEY, m: process.env.META_ACCESS_TOKEN };
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    process.env.META_ACCESS_TOKEN = "TOKEN-DE-LA-PLATAFORMA";
    try {
      return fn();
    } finally {
      if (prev.k === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = prev.k;
      if (prev.m === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = prev.m;
    }
  };

  it("cada negocio usa SU token; sin token y sin autorización => null (nunca META_ACCESS_TOKEN)", () => {
    conClave(() => {
      const a = { meta_permanent_token: cifrarSecreto("TOKEN-A") };
      const b = { meta_permanent_token: cifrarSecreto("TOKEN-B") };
      assert.equal(resolverTokenMetaAgente(a, false), "TOKEN-A");
      assert.equal(resolverTokenMetaAgente(b, false), "TOKEN-B");
      // Con token propio, la autorización de la plataforma no cambia nada: siempre el propio.
      assert.equal(resolverTokenMetaAgente(a, true), "TOKEN-A");
      assert.equal(resolverTokenMetaAgente({ meta_permanent_token: null }, false), null);
      assert.equal(resolverTokenMetaAgente({ meta_permanent_token: null }, true), "TOKEN-DE-LA-PLATAFORMA", "solo con autorización explícita (p. ej. Delacour conectada a mano)");
    });
  });

  it("frontera: número sin credencial => no corre el modelo, no envía nada, no cae a otro bot", async () => {
    const enviados: string[] = [];
    const provider = createSimulatedProvider([{ text: "NO DEBE SALIR" }]);
    const errores: Array<Record<string, unknown>> = [];
    let builds = 0;
    const d: AgentBoundaryDeps = {
      configStore: createMemoryAgentConfigStore([filaB()]),
      env: { GEMINI_KEY_PRUEBA: "k-no-real" },
      factories: { gemini: () => provider },
      logError: (e) => errores.push(e),
      hasMetaCredential: (config) => conClave(() => resolverTokenMetaAgente({ meta_permanent_token: null }, config.metaPlatformToken) !== null),
      build() {
        builds++;
        return null;
      },
    };
    const r = await atenderConAgenteSiAplica({ cliente: { id_tenant: B.tenantId, phone_number_id: PN_B }, waId: CLIENTE, destino: CLIENTE, wamid: "wamid.cred", text: "hola" }, d);
    assert.deepEqual(r, { handled: true, outcome: "invalid_config", reason: "meta_credential_missing" });
    assert.equal(builds, 0);
    assert.equal(provider.requests.length, 0);
    assert.deepEqual(enviados, []);
    assert.equal(errores[0].reason, "meta_credential_missing");
  });

  it("sin la columna (migración pendiente) el número conserva el comportamiento anterior (token de plataforma)", () => {
    assert.equal(ok(fila()).metaPlatformToken, true);
  });

  it("notificaciones de pedidos: un número con agente sigue la política del agente; sin agente, la de siempre", async () => {
    const fake = (r: { data?: unknown; error?: { code: string } | null }) =>
      ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: r.data ?? null, error: r.error ?? null }) }) }) }) }) as never;
    const sinToken = { id_tenant: B.tenantId, phone_number_id: PN_B, meta_permanent_token: null };
    const conToken = (t: string) => ({ ...sinToken, meta_permanent_token: cifrarSecreto(t) });
    const prev = { k: process.env.TOKEN_ENCRYPTION_KEY, m: process.env.META_ACCESS_TOKEN };
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    process.env.META_ACCESS_TOKEN = "TOKEN-DE-LA-PLATAFORMA";
    try {
      // Con agente y sin autorización: nunca la de la plataforma.
      assert.equal(await resolverTokenMetaDeNumero(fake({ data: { id_tenant: B.tenantId, meta_token_plataforma: false } }), sinToken), null);
      assert.equal(await resolverTokenMetaDeNumero(fake({ data: { id_tenant: B.tenantId, meta_token_plataforma: false } }), conToken("TOKEN-B")), "TOKEN-B");
      assert.equal(await resolverTokenMetaDeNumero(fake({ data: { id_tenant: B.tenantId, meta_token_plataforma: true } }), sinToken), "TOKEN-DE-LA-PLATAFORMA");
      // La fila de agente de OTRO negocio para ese número: ninguna credencial.
      assert.equal(await resolverTokenMetaDeNumero(fake({ data: { id_tenant: A.tenantId, meta_token_plataforma: true } }), conToken("TOKEN-B")), null);
      // Sin agente (tienda en línea) o sin la migración: como siempre.
      assert.equal(await resolverTokenMetaDeNumero(fake({ data: null }), sinToken), "TOKEN-DE-LA-PLATAFORMA");
      assert.equal(await resolverTokenMetaDeNumero(fake({ error: { code: "42703" } }), sinToken), "TOKEN-DE-LA-PLATAFORMA");
      // Error al leer: se lanza (el adaptador lo convierte en "sin token": la notificación se omite).
      await assert.rejects(resolverTokenMetaDeNumero(fake({ error: { code: "57014" } }), sinToken));
    } finally {
      if (prev.k === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = prev.k;
      if (prev.m === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = prev.m;
    }
  });
});
