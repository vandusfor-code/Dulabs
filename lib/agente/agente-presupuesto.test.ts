/**
 * PRESUPUESTO del agente: cuánto pesa lo que se le manda al modelo en cada llamada y cuántas consultas a la base hace un turno. No mide calidad: vigila que NADA crezca sin que alguien lo decida.
 *
 * Cada llamada a Gemini lleva la instrucción de sistema + la declaración de las herramientas + el historial, y un turno típico son 2 llamadas (consulta de herramienta + respuesta): lo que se agregue
 * aquí se paga en CADA mensaje de CADA cliente. Los topes son los valores medidos con ~10 % de holgura: un cambio pequeño no los toca, uno grande obliga a subirlos a propósito (y a explicarlo).
 *
 * Con proveedor SIMULADO y almacenes en memoria: nada toca Gemini ni Supabase.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { buildSystemInstruction, type TurnFacts } from "@/lib/agente/contexto";
import { createMemoryConversationStateStore, emptyConversationState, type ConversationState } from "@/lib/agente/estado";
import { agentToolDeclarations } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES, esHerramientaComercial } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn } from "@/lib/agente/runtime";

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const PN: Record<string, string> = { [A.tenantId]: "100000000000001", [B.tenantId]: "100000000000002" };

// ---------------------------------------------------------------------------
// TOPES (medidos el 2026-11-17; subirlos es una decisión, no un descuido)
// ---------------------------------------------------------------------------

/** Declaración de las 21 herramientas (16 de venta + 4 del CMS + consultar_envio), en bytes de JSON. Medido: 13.108. */
const TOPE_DECLARACIONES_TODAS = 14_400;
/** Las 16 herramientas de venta (sin las del CMS). Medido: 7.898. */
const TOPE_DECLARACIONES_VENTA = 8_700;
/** Lo que suma el parámetro `genero` (solo tiendas que separan Hombre y Mujer). Medido: 362. */
const TOPE_SUMA_GENERO = 450;
/** Instrucción de sistema con la configuración mínima (reglas de la plataforma + estado vacío), en caracteres. Medido: 4.768. */
const TOPE_SISTEMA_BASE = 5_300;
/** Con las herramientas del CMS (sección comercial) y el checkout conversacional (reglas de pedidos). */
const TOPE_SISTEMA_COMPLETO = 9_500;

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let seq = 0;

const configRow = (actor: CatalogActor, over: Partial<AgentConfigRow> = {}): AgentConfigRow => ({
  id_tenant: actor.tenantId,
  phone_number_id: PN[actor.tenantId],
  tipo: "catalog_sales",
  habilitado: true,
  proveedor: "gemini",
  modelo: "gemini-3.6-flash",
  credencial_ref: "env:GEMINI_KEY_DELACOUR",
  nivel_razonamiento: "low",
  herramientas: [...AGENT_TOOL_NAMES],
  canal: "retail",
  negocio: { nombre_agente: "Sofía" },
  ...over,
});
const cfg = (actor: CatalogActor = A, over: Partial<AgentConfigRow> = {}) => (parseAgentConfig(configRow(actor, over), { tenantId: actor.tenantId, phoneNumberId: PN[actor.tenantId] }) as { config: AgentRuntimeConfig }).config;

const facts = (over: Partial<TurnFacts> = {}): TurnFacts => ({
  channel: "retail",
  channelSource: "number_config",
  customerName: null,
  activeOrder: null,
  handoffActive: false,
  replyTo: null,
  selection: { selected: [], needsClarification: false },
  stage: { name: "inicio", guidance: "Saluda y pregunta qué busca." },
  ...over,
});

/** Un turno completo contando cuántas veces se llamó a cada método del repositorio del catálogo. */
async function turnoContado(actor: CatalogActor, script: SimulatedStep[], text: string) {
  const llamadas: Record<string, number> = {};
  const repo = new Proxy(mem.repo, {
    get(target, prop, receiver) {
      const valor = Reflect.get(target, prop, receiver);
      if (typeof valor !== "function") return valor;
      return (...args: unknown[]) => {
        llamadas[String(prop)] = (llamadas[String(prop)] ?? 0) + 1;
        return (valor as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as typeof mem.repo;
  const provider = createSimulatedProvider(script);
  const engine = createOrderEngine({ orders: createMemoryOrdersRepository(), catalog: repo, key: Buffer.alloc(32, 7), log: () => {} });
  const r = await runAgentTurn(
    {
      config: cfg(actor),
      provider,
      model: "gemini-3.6-flash",
      tools: { engine, catalog: repo, log: () => {}, ownsPhoneNumber: async () => true, siteUrl: () => "https://dulabs.test" },
      state: createMemoryConversationStateStore(),
      history: { recent: async () => [] },
      sender: { sendText: async () => true, sendImage: async () => true, humanTookOver: async () => false },
      log: () => {},
      now: () => Date.parse("2026-09-24T15:00:00Z"),
    },
    { tenantId: actor.tenantId, phoneNumberId: PN[actor.tenantId], waId: "573001112233", wamid: `wamid.presupuesto.${++seq}`, text },
  );
  return { ...r, provider, llamadas, total: Object.values(llamadas).reduce((a, b) => a + b, 0) };
}

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  mem.setProfile(A.tenantId, { name: "Delacour", whatsapp: "573001110000" });
  mem.setProfile(B.tenantId, { name: "Otra Joyería", whatsapp: "573009990000" });
  for (const actor of [A, B]) {
    mem.enableModule(actor.tenantId);
    await admin.ensurePublication(actor);
    for (let i = 0; i < 12; i++) await admin.createProduct(actor, { name: `Anillo ${i}`, retailPrice: 20_000, wholesalePrice: null, stock: 5 });
  }
});

describe("lo que se le declara al modelo en cada llamada", () => {
  it("la declaración de las herramientas no crece sin que se decida (todas, solo las de venta y la suma del género)", () => {
    const todas = [...AGENT_TOOL_NAMES];
    const venta = todas.filter((n) => !n.startsWith("consultar_")); // las 16 de venta (sin consultar_envio ni las 4 del CMS)
    const bytes = (xs: unknown) => JSON.stringify(xs).length;
    assert.ok(bytes(agentToolDeclarations(todas)) <= TOPE_DECLARACIONES_TODAS, `todas: ${bytes(agentToolDeclarations(todas))} > ${TOPE_DECLARACIONES_TODAS}`);
    assert.ok(bytes(agentToolDeclarations(venta)) <= TOPE_DECLARACIONES_VENTA, `venta: ${bytes(agentToolDeclarations(venta))} > ${TOPE_DECLARACIONES_VENTA}`);
    const suma = bytes(agentToolDeclarations(todas, { genero: true })) - bytes(agentToolDeclarations(todas));
    assert.ok(suma > 0 && suma <= TOPE_SUMA_GENERO, `el género suma ${suma} bytes (tope ${TOPE_SUMA_GENERO})`);
  });

  it("cada herramienta declarada pesa lo razonable: ninguna pasa de 1.600 bytes (los parámetros y su descripción)", () => {
    for (const d of agentToolDeclarations([...AGENT_TOOL_NAMES], { genero: true })) {
      const bytes = JSON.stringify(d).length;
      assert.ok(bytes <= 1_600, `${d.name} pesa ${bytes} bytes`);
    }
  });

  it("la instrucción de sistema base y la completa (CMS + checkout) no crecen sin que se decida", () => {
    const base = buildSystemInstruction(cfg(A, { herramientas: AGENT_TOOL_NAMES.filter((n) => !esHerramientaComercial(n)) }), emptyConversationState(), facts());
    assert.ok(base.length <= TOPE_SISTEMA_BASE, `base: ${base.length} > ${TOPE_SISTEMA_BASE}`);
    const completa = buildSystemInstruction(cfg(A, { checkout_conversacional: true }), emptyConversationState(), facts());
    assert.ok(completa.length <= TOPE_SISTEMA_COMPLETO, `completa: ${completa.length} > ${TOPE_SISTEMA_COMPLETO}`);
    assert.ok(completa.length > base.length);
  });

  it("todo lo que va ANTES del estado es el mismo texto de un turno al otro (el proveedor puede reutilizarlo): nada dinámico en la parte fija", () => {
    const antes = (s: string) => s.split("=== ESTADO DE LA CONVERSACIÓN")[0];
    const otroEstado: ConversationState = {
      ...emptyConversationState(),
      turn: 7,
      cart: [{ reference: "DL-000001", quantity: 2 }],
      lastShown: [{ reference: "DL-000002", name: "Anillo 2" }],
      failures: 1,
      lastInteractionAt: "2026-09-24T15:00:00.000Z",
    };
    for (const over of [{}, { checkout_conversacional: true }]) {
      const config = cfg(A, over);
      const a = buildSystemInstruction(config, emptyConversationState(), facts());
      const b = buildSystemInstruction(config, otroEstado, facts({ customerName: "Laura", stage: { name: "armando_pedido", guidance: "Ofrece finalizar." }, channel: "wholesale" }));
      assert.notEqual(a, b, "el estado sí cambia");
      assert.equal(antes(a), antes(b), "la parte fija no cambia");
      assert.ok(antes(a).length > 3_000, "y es la parte grande");
    }
  });
});

describe("lo que cuesta un turno de búsqueda (modelo y base)", () => {
  const busqueda: SimulatedStep[] = [{ toolCalls: [{ name: "search_products", args: { query: "anillo" } }] }, { text: "Te muestro opciones." }];

  it("un turno con una búsqueda son 2 llamadas al modelo (consulta + respuesta) y 1 sola ronda de herramientas", async () => {
    const r = await turnoContado(B, busqueda, "anillos");
    assert.equal(r.outcome, "replied");
    assert.equal(r.provider.requests.length, 2);
    assert.equal(r.trace.tool_calls.length, 1);
  });

  it("consultas a la base de un negocio que NO separa Hombre y Mujer: las 4 de siempre + una (la publicación), sin leer piezas de hombre", async () => {
    const r = await turnoContado(B, busqueda, "anillos");
    assert.equal(r.llamadas.listHombreReferences ?? 0, 0);
    assert.equal(r.llamadas.getPublication, 1);
    assert.equal(r.llamadas.searchCatalog, 1);
    assert.equal(r.llamadas.getProductsByReferences, 1, "una consulta por lote, no una por producto");
    assert.equal(r.llamadas.listPrimaryMedia, 1, "las fotos de la página, de una sola vez");
    assert.ok(r.total <= 5, `consultas del turno: ${r.total} ${JSON.stringify(r.llamadas)}`);
  });

  it("en una tienda que separa Hombre y Mujer: UNA lectura más que en otra (las piezas de hombre), una sola vez por turno", async () => {
    const p = await mem.repo.getProductByReference(A.tenantId, "DL-000001");
    mem.setGeneroDirecto(p!.id, "hombre");
    // Dos búsquedas en el mismo turno: la lectura de las piezas de hombre es una sola (memoizada).
    const dos = (genero: boolean): SimulatedStep[] => [{ toolCalls: [{ name: "search_products", args: { query: "anillo", ...(genero ? { genero: "mujer" } : {}) } }, { name: "search_products", args: { query: "anillo" } }] }, { text: "Te muestro opciones." }];
    const conGenero = await turnoContado(A, dos(true), "anillos de mujer");
    const sinGenero = await turnoContado(B, dos(false), "anillos");
    assert.equal(conGenero.llamadas.listHombreReferences, 1, "memoizada: dos búsquedas, una lectura");
    assert.equal(sinGenero.llamadas.listHombreReferences ?? 0, 0);
    assert.equal(conGenero.total - sinGenero.total, 1, `la diferencia es solo esa lectura: ${JSON.stringify(conGenero.llamadas)} vs ${JSON.stringify(sinGenero.llamadas)}`);
  });

  it("las consultas NO crecen con la cantidad de resultados: 1 o 5 productos en la página cuestan lo mismo (nada de N+1)", async () => {
    const uno = await turnoContado(B, [{ toolCalls: [{ name: "search_products", args: { query: "Anillo 3" } }] }, { text: "Esta es." }], "anillo 3");
    const cinco = await turnoContado(B, busqueda, "anillos");
    assert.deepEqual(cinco.llamadas, uno.llamadas);
  });
});
