/**
 * Bloque 28 — LENGUAJE HUMANO: normalizador, léxico declarativo, intérprete y su uso en el checkout.
 *
 *   1. Normalizador (errores, abreviaciones, letras repetidas, emojis).
 *   2. MATRIZ de expresiones humanas reales (≥ 60): entrada · contexto · intención · acción esperada.
 *   3. Conversaciones completas en memoria (motor real + Gemini SIMULADO): una pregunta nunca muta el
 *      checkout, las correcciones cambian el dato correcto, el nombre/dirección no aceptan basura, las
 *      cantidades ambiguas se preguntan, el estado del pedido nunca se inventa, la modalidad no se filtra.
 *
 * Ningún caso toca Supabase, Gemini ni Meta. Negocios, clientes y productos ficticios.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { formatCop } from "@/lib/business-agent-quote";
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
import { CART_CLARIFY, runAgentTurn, type AgentTurnTrace } from "@/lib/agente/runtime";
import { createMemoryCustomerChannelStore, parseChannelChoice } from "@/lib/agente/clasificacion";
import { CHECKOUT_BUTTONS, CHECKOUT_MESSAGES, CHECKOUT_STEP_HINT, parseCustomerName, parseDelivery, parsePayment, wantsCheckout } from "@/lib/agente/checkout";
import { resolveSelection } from "@/lib/agente/seleccion";
import { checkGrounding, emptyEvidence, addOrderStateEvidence } from "@/lib/agente/anclaje";
import { normalizar } from "@/lib/agente/lenguaje/normalizar";
import {
  esPregunta,
  leerCantidad,
  leerCiudad,
  leerCorreccion,
  leerDireccion,
  leerEntrega,
  leerNombre,
  leerPago,
  leerSalida,
  modalidadInicial,
  numerosDelCliente,
  pideQuitar,
  pistasCheckout,
} from "@/lib/agente/lenguaje/interpretar";

// ===========================================================================
// 1. Normalizador
// ===========================================================================

describe("B28 · normalizador", () => {
  const casos: Array<[string, string]> = [
    ["Kiero el PEDIDOOO!! 😍", "quiero el pedido"],
    ["qiero comprar", "quiero comprar"],
    ["keiro", "quiero"],
    ["por mallor", "por mayor"],
    ["mayorr", "mayor"],
    ["domisilio", "domicilio"],
    ["domicilo", "domicilio"],
    ["recojer", "recoger"],
    ["recoger en tiendo", "recoger en tienda"],
    ["transferecia", "transferencia"],
    ["holaaa", "hola"],
    ["siii", "si"],
    ["sii", "si"],
    ["graciasss xfa", "gracias por favor"],
    ["catologo", "catalogo"],
    ["okey", "ok"],
    ["¿Cuánto   VALE?", "cuanto vale"],
    ["llevo", "llevo"],
  ];
  for (const [entrada, esperado] of casos) it(`"${entrada}" → "${esperado}"`, () => assert.equal(normalizar(entrada), esperado));
  it("las letras dobles legítimas se respetan (llevo, carro)", () => {
    assert.equal(normalizar("me llevo el carro"), "me llevo el carro");
  });
});

// ===========================================================================
// 2. MATRIZ de expresiones humanas (entrada · contexto · intención · acción)
// ===========================================================================

type Fila = { entrada: string; contexto: string; intencion: string; accion: string; ok: () => void };
const eq = (a: unknown, b: unknown) => () => assert.deepEqual(a, b);
const TRES = [
  { reference: "DL-000001", name: "Aretes Luna (dorado)" },
  { reference: "DL-000002", name: "Aretes Sol (plateado)" },
  { reference: "DL-000003", name: "Aretes Estrella (rosado)" },
];
const UNO = TRES.slice(0, 1);
const DOS = TRES.slice(0, 2);
const sel = (t: string, shown = TRES, prev: string[] = []) => resolveSelection(t, shown, { previous: prev, lenguaje: true });

const MATRIZ: Fila[] = [
  // --- intención de compra (nivel pedido) ---
  { entrada: "kiero el pedido", contexto: "carrito", intencion: "iniciar_checkout", accion: "checkout", ok: eq(wantsCheckout("kiero el pedido"), true) },
  { entrada: "quiero el pedido", contexto: "carrito", intencion: "iniciar_checkout", accion: "checkout", ok: eq(wantsCheckout("quiero el pedido"), true) },
  { entrada: "quiero hacer el pedido", contexto: "carrito", intencion: "iniciar_checkout", accion: "checkout", ok: eq(wantsCheckout("quiero hacer el pedido"), true) },
  { entrada: "QUIEROOO COMPRAR", contexto: "carrito", intencion: "iniciar_checkout", accion: "checkout", ok: eq(wantsCheckout("QUIEROOO COMPRAR"), true) },
  { entrada: "qiero comprar", contexto: "carrito", intencion: "iniciar_checkout", accion: "checkout", ok: eq(wantsCheckout("qiero comprar"), true) },
  { entrada: "hagamos el pedido", contexto: "carrito", intencion: "iniciar_checkout", accion: "checkout", ok: eq(wantsCheckout("hagamos el pedido"), true) },
  { entrada: "me lo llevo", contexto: "carrito", intencion: "iniciar_checkout", accion: "checkout", ok: eq(wantsCheckout("me lo llevo"), true) },
  { entrada: "cómo hago el pedido", contexto: "carrito", intencion: "iniciar_checkout", accion: "checkout", ok: eq(wantsCheckout("cómo hago el pedido"), true) },
  { entrada: "¿dónde puedo comprar?", contexto: "—", intencion: "consulta", accion: "Gemini responde (no checkout)", ok: eq(wantsCheckout("¿dónde puedo comprar?"), false) },
  { entrada: "quiero comprar unos aretes", contexto: "—", intencion: "buscar", accion: "Gemini busca (no checkout)", ok: eq(wantsCheckout("quiero comprar unos aretes"), false) },
  // --- cantidades ---
  { entrada: "x2", contexto: "producto único", intencion: "cantidad=2", accion: "actualizar", ok: eq(leerCantidad("x2"), { tipo: "fijar", n: 2 }) },
  { entrada: "2x", contexto: "producto único", intencion: "cantidad=2", accion: "actualizar", ok: eq(leerCantidad("2x"), { tipo: "fijar", n: 2 }) },
  { entrada: "2 und", contexto: "producto único", intencion: "cantidad=2", accion: "actualizar", ok: eq(leerCantidad("2 und"), { tipo: "fijar", n: 2 }) },
  { entrada: "2uds", contexto: "producto único", intencion: "cantidad=2", accion: "actualizar", ok: eq(leerCantidad("2uds"), { tipo: "fijar", n: 2 }) },
  { entrada: "dos unidades", contexto: "producto único", intencion: "cantidad=2", accion: "actualizar", ok: eq(leerCantidad("dos unidades"), { tipo: "fijar", n: 2 }) },
  { entrada: "me llevo dos", contexto: "producto único", intencion: "cantidad=2", accion: "actualizar", ok: eq(leerCantidad("me llevo dos"), { tipo: "fijar", n: 2 }) },
  { entrada: "quiero dos de esos", contexto: "producto único", intencion: "cantidad=2", accion: "actualizar", ok: eq(leerCantidad("quiero dos de esos"), { tipo: "fijar", n: 2 }) },
  { entrada: "eran 3", contexto: "producto único", intencion: "cantidad=3", accion: "actualizar", ok: eq(leerCantidad("eran 3"), { tipo: "fijar", n: 3 }) },
  { entrada: "no mejor 3", contexto: "producto único", intencion: "cantidad=3", accion: "actualizar", ok: eq(leerCantidad("no mejor 3"), { tipo: "fijar", n: 3 }) },
  { entrada: "eran 3 no 2", contexto: "producto único", intencion: "cantidad=3", accion: "actualizar", ok: eq(leerCantidad("eran 3 no 2"), { tipo: "fijar", n: 3 }) },
  { entrada: "no, ponme 4", contexto: "producto único", intencion: "cantidad=4", accion: "actualizar", ok: eq(leerCantidad("no, ponme 4"), { tipo: "fijar", n: 4 }) },
  { entrada: "quita uno", contexto: "producto único", intencion: "cantidad-1", accion: "actualizar", ok: eq(leerCantidad("quita uno"), { tipo: "restar", n: 1 }) },
  { entrada: "agrégame otro", contexto: "producto único", intencion: "cantidad+1", accion: "actualizar", ok: eq(leerCantidad("agrégame otro"), { tipo: "sumar", n: 1 }) },
  { entrada: "uno más", contexto: "producto único", intencion: "cantidad+1", accion: "actualizar", ok: eq(leerCantidad("uno más"), { tipo: "sumar", n: 1 }) },
  { entrada: "¿2?", contexto: "—", intencion: "pregunta", accion: "no mutar", ok: eq(leerCantidad("¿2?"), null) },
  { entrada: "quiero dos aretes", contexto: "—", intencion: "buscar/elegir producto", accion: "no es solo cantidad", ok: eq(leerCantidad("quiero dos aretes"), null) },
  { entrada: "eran 3", contexto: "varios productos", intencion: "ambiguo", accion: "preguntar", ok: eq(sel("eran 3").needsClarification, true) },
  { entrada: "x2", contexto: "un producto a la vista", intencion: "cantidad de ese", accion: "seleccionar ese", ok: eq(sel("x2", UNO).selected.map((s) => s.reference), ["DL-000001"]) },
  // --- referencias contextuales ---
  { entrada: "ese", contexto: "un producto", intencion: "seleccionar", accion: "ese", ok: eq(sel("ese", UNO).selected.map((s) => s.reference), ["DL-000001"]) },
  { entrada: "ese", contexto: "varios productos", intencion: "ambiguo", accion: "preguntar", ok: eq(sel("ese").needsClarification, true) },
  { entrada: "el tercero", contexto: "lista de 3", intencion: "posición 3", accion: "seleccionar", ok: eq(sel("el tercero").selected.map((s) => s.reference), ["DL-000003"]) },
  { entrada: "el último", contexto: "lista de 3", intencion: "posición 3", accion: "seleccionar", ok: eq(sel("el último").selected.map((s) => s.reference), ["DL-000003"]) },
  { entrada: "el dorado", contexto: "lista de 3", intencion: "nombre distintivo", accion: "seleccionar", ok: eq(sel("el dorado").selected.map((s) => s.reference), ["DL-000001"]) },
  { entrada: "el otro", contexto: "2 opciones, 1 elegida", intencion: "la otra", accion: "seleccionar", ok: eq(sel("el otro", DOS, ["DL-000001"]).selected.map((s) => s.reference), ["DL-000002"]) },
  { entrada: "los dos", contexto: "2 opciones", intencion: "ambas", accion: "seleccionar ambas", ok: eq(sel("los dos", DOS).selected.map((s) => s.reference), ["DL-000001", "DL-000002"]) },
  { entrada: "los dos", contexto: "3 opciones", intencion: "ambiguo", accion: "no elegir", ok: eq(sel("los dos").selected.length, 0) },
  { entrada: "quita ese", contexto: "carrito", intencion: "quitar", accion: "quitar (si es claro)", ok: eq(pideQuitar("quita ese"), true) },
  { entrada: "borra el primero", contexto: "carrito", intencion: "quitar", accion: "quitar el 1.º", ok: eq(pideQuitar("borra el primero"), true) },
  { entrada: "no quiero", contexto: "—", intencion: "sin objetivo", accion: "no quitar", ok: eq(pideQuitar("no quiero"), false) },
  // --- preguntas (nunca son respuestas) ---
  { entrada: "¿cuánto cuesta el envío?", contexto: "esperando entrega", intencion: "pregunta", accion: "responder + mantener", ok: eq(esPregunta("¿cuánto cuesta el envío?"), true) },
  { entrada: "cuanto demora", contexto: "esperando entrega", intencion: "pregunta", accion: "responder + mantener", ok: eq(esPregunta("cuanto demora"), true) },
  { entrada: "donde queda", contexto: "esperando entrega", intencion: "pregunta", accion: "responder + mantener", ok: eq(esPregunta("donde queda"), true) },
  { entrada: "hay envio gratis", contexto: "esperando entrega", intencion: "pregunta", accion: "responder + mantener", ok: eq(esPregunta("hay envio gratis"), true) },
  { entrada: "¿puedo pagar por transferencia?", contexto: "esperando pago", intencion: "pregunta", accion: "no seleccionar", ok: eq(esPregunta("¿puedo pagar por transferencia?"), true) },
  { entrada: "que me lo manden", contexto: "esperando entrega", intencion: "domicilio", accion: "seleccionar", ok: eq([esPregunta("que me lo manden"), leerEntrega("que me lo manden")], [false, "domicilio"]) },
  // --- entrega ---
  { entrada: "domisilio", contexto: "esperando entrega", intencion: "domicilio", accion: "seleccionar", ok: eq(parseDelivery("domisilio"), "domicilio") },
  { entrada: "quiero que llegue a mi casa", contexto: "esperando entrega", intencion: "domicilio", accion: "seleccionar", ok: eq(parseDelivery("quiero que llegue a mi casa"), "domicilio") },
  { entrada: "voy a recogerlo", contexto: "esperando entrega", intencion: "tienda", accion: "seleccionar", ok: eq(parseDelivery("voy a recogerlo"), "tienda") },
  { entrada: "recojer", contexto: "esperando entrega", intencion: "tienda", accion: "seleccionar", ok: eq(parseDelivery("recojer"), "tienda") },
  { entrada: "recoger en tiendo", contexto: "esperando entrega", intencion: "tienda", accion: "seleccionar", ok: eq(parseDelivery("recoger en tiendo"), "tienda") },
  // --- pago ---
  { entrada: "pago allá", contexto: "esperando pago", intencion: "tienda", accion: "seleccionar", ok: eq(parsePayment("pago allá"), "pago_en_tienda") },
  { entrada: "voy a pagar allá", contexto: "esperando pago", intencion: "tienda", accion: "seleccionar", ok: eq(parsePayment("voy a pagar allá"), "pago_en_tienda") },
  { entrada: "efectivo en tienda", contexto: "esperando pago", intencion: "tienda", accion: "seleccionar", ok: eq(parsePayment("efectivo en tienda"), "pago_en_tienda") },
  { entrada: "te transfiero", contexto: "esperando pago", intencion: "transferencia", accion: "seleccionar", ok: eq(parsePayment("te transfiero"), "transferencia") },
  { entrada: "transferecia", contexto: "esperando pago", intencion: "transferencia", accion: "seleccionar", ok: eq(parsePayment("transferecia"), "transferencia") },
  { entrada: "pago cuando llegue", contexto: "entrega en tienda", intencion: "tienda", accion: "seleccionar", ok: eq(leerPago("pago cuando llegue", "tienda"), "pago_en_tienda") },
  { entrada: "pago cuando llegue", contexto: "domicilio", intencion: "contra entrega (no ofrecido)", accion: "explicar opciones", ok: eq(leerPago("pago cuando llegue", "domicilio"), "no_disponible") },
  // --- correcciones ---
  { entrada: "no, mejor recojo en tienda", contexto: "esperando dirección", intencion: "corrección entrega", accion: "cambiar entrega", ok: eq(leerCorreccion("no, mejor recojo en tienda", "domicilio"), { entrega: "tienda" }) },
  { entrada: "mejor transferencia", contexto: "cualquier paso", intencion: "corrección pago", accion: "cambiar pago", ok: eq(leerCorreccion("mejor transferencia", null), { pago: "transferencia" }) },
  { entrada: "no, pago en tienda", contexto: "cualquier paso", intencion: "corrección pago", accion: "cambiar pago", ok: eq(leerCorreccion("no, pago en tienda", "domicilio"), { pago: "pago_en_tienda" }) },
  { entrada: "perdón, era domicilio", contexto: "cualquier paso", intencion: "corrección entrega", accion: "cambiar entrega", ok: eq(leerCorreccion("perdón, era domicilio", "tienda"), { entrega: "domicilio" }) },
  { entrada: "no, era recoger", contexto: "cualquier paso", intencion: "corrección entrega", accion: "cambiar entrega", ok: eq(leerCorreccion("no, era recoger", "domicilio"), { entrega: "tienda" }) },
  { entrada: "Calle 10 frente a la tienda", contexto: "esperando dirección", intencion: "dirección", accion: "NO es corrección", ok: eq(leerCorreccion("Calle 10 frente a la tienda", "domicilio"), null) },
  // --- nombre ---
  { entrada: "María Fernanda", contexto: "esperando nombre", intencion: "nombre", accion: "guardar en el pedido", ok: eq(parseCustomerName("María Fernanda"), "María Fernanda") },
  { entrada: "Soy Carlos", contexto: "esperando nombre", intencion: "nombre", accion: "guardar", ok: eq(parseCustomerName("Soy Carlos"), "Carlos") },
  { entrada: "es Duvan", contexto: "esperando nombre", intencion: "nombre", accion: "guardar", ok: eq(parseCustomerName("es Duvan"), "Duvan") },
  { entrada: "quiero dos aretes", contexto: "esperando nombre", intencion: "no es nombre", accion: "pedir de nuevo", ok: eq(parseCustomerName("quiero dos aretes"), null) },
  { entrada: "¿cuánto cuesta?", contexto: "esperando nombre", intencion: "pregunta", accion: "no es nombre", ok: eq(parseCustomerName("¿cuánto cuesta?"), null) },
  { entrada: "jajaja", contexto: "esperando nombre", intencion: "risa", accion: "no es nombre", ok: eq(leerNombre("jajaja"), null) },
  { entrada: "Esperanza", contexto: "esperando nombre", intencion: "nombre", accion: "guardar", ok: eq(leerNombre("Esperanza"), "Esperanza") },
  { entrada: "Tienda Mayorista Luna", contexto: "esperando nombre (mayorista)", intencion: "nombre de negocio", accion: "guardar", ok: eq(leerNombre("Tienda Mayorista Luna"), "Tienda Mayorista Luna") && eq(leerCorreccion("Tienda Mayorista Luna", null), null) },
  { entrada: "en tienda", contexto: "esperando nombre", intencion: "entrega", accion: "no es nombre", ok: eq(leerNombre("en tienda"), null) && eq(leerCorreccion("en tienda", null), { entrega: "tienda" }) },
  { entrada: "mayorista", contexto: "esperando nombre", intencion: "modalidad", accion: "no es nombre", ok: eq(leerNombre("mayorista"), null) },
  // --- dirección y ciudad ---
  { entrada: "calle 30 # 12-40", contexto: "esperando dirección", intencion: "dirección", accion: "guardar", ok: eq(leerDireccion("calle 30 # 12-40"), { tipo: "ok", valor: "calle 30 # 12-40" }) },
  { entrada: "mi dirección es Cra 7 # 20-15", contexto: "esperando dirección", intencion: "dirección", accion: "guardar sin prefijo", ok: eq(leerDireccion("mi dirección es Cra 7 # 20-15"), { tipo: "ok", valor: "Cra 7 # 20-15" }) },
  { entrada: "vivo por el centro", contexto: "esperando dirección", intencion: "dirección insuficiente", accion: "pedir la exacta", ok: eq(leerDireccion("vivo por el centro"), { tipo: "vaga" }) },
  { entrada: "te mando la dirección", contexto: "esperando dirección", intencion: "anuncio", accion: "esperar", ok: eq(leerDireccion("te mando la dirección"), { tipo: "anuncio" }) },
  { entrada: "jajaja / ok / espera / quiero ese / mejor tienda", contexto: "esperando dirección", intencion: "no es dirección", accion: "pedir de nuevo", ok: eq(["jajaja", "ok", "espera", "quiero ese", "mejor tienda", "cuánto vale?"].map((t) => leerDireccion(t)), [null, null, null, null, null, null]) },
  { entrada: "en Medellín", contexto: "esperando ciudad", intencion: "ciudad", accion: "guardar", ok: eq(leerCiudad("en Medellín"), "Medellín") },
  // --- salidas / esperas ---
  { entrada: "cancela porfa", contexto: "checkout", intencion: "cancelar", accion: "cancelar registro", ok: eq(leerSalida("cancela porfa"), "cancel") },
  { entrada: "cambié de opinión", contexto: "checkout", intencion: "duda", accion: "preguntar qué cambia", ok: eq(leerSalida("cambié de opinión"), "doubt") },
  { entrada: "me confundí", contexto: "checkout", intencion: "duda", accion: "preguntar qué cambia", ok: eq(leerSalida("me confundí"), "doubt") },
  { entrada: "mejor quiero otro", contexto: "checkout", intencion: "modificar", accion: "volver a la selección", ok: eq(leerSalida("mejor quiero otro"), "modify") },
  // --- varias intenciones en un mensaje ---
  { entrada: "Quiero 3 del primero, domicilio y pago por transferencia", contexto: "al comprar", intencion: "cantidad+entrega+pago", accion: "prellenar entrega y pago", ok: eq(pistasCheckout("Quiero 3 del primero, domicilio y pago por transferencia"), { entrega: "domicilio", pago: "transferencia" }) },
  { entrada: "Soy Laura y quiero comprar el segundo", contexto: "al comprar", intencion: "nombre+compra", accion: "prellenar nombre", ok: eq(pistasCheckout("Soy Laura y quiero comprar el segundo"), { nombre: "Laura" }) },
  { entrada: "Quiero ese, pero antes cuánto cuesta el envío?", contexto: "al comprar", intencion: "pregunta primero", accion: "no prellenar nada", ok: eq(pistasCheckout("Quiero ese, pero antes cuánto cuesta el envío?"), {}) },
  // --- modalidad ---
  { entrada: "soy particular", contexto: "sin clasificar", intencion: "detal", accion: "clasificar detal", ok: eq(modalidadInicial("soy particular"), "retail") },
  { entrada: "es para mí", contexto: "sin clasificar", intencion: "detal", accion: "clasificar detal", ok: eq(modalidadInicial("es para mí"), "retail") },
  { entrada: "mayor", contexto: "sin clasificar", intencion: "mayorista", accion: "clasificar mayorista", ok: eq(modalidadInicial("mayor"), "wholesale") },
  { entrada: "por mallor", contexto: "cualquiera", intencion: "mayorista", accion: "canal pedido (cambio => asesora)", ok: eq(parseChannelChoice("por mallor"), "wholesale") },
  { entrada: "soy empresa / tengo una tienda / vendo joyas", contexto: "sin clasificar", intencion: "no concluyente", accion: "volver a preguntar", ok: eq(["soy empresa", "tengo una tienda", "vendo joyas"].map(modalidadInicial), [null, null, null]) },
];

describe(`B28 · MATRIZ de lenguaje humano (${MATRIZ.length} expresiones)`, () => {
  it("la matriz cubre al menos 60 expresiones", () => assert.ok(MATRIZ.length >= 60, String(MATRIZ.length)));
  for (const f of MATRIZ) it(`${f.entrada} · [${f.contexto}] → ${f.intencion} → ${f.accion}`, f.ok);
});

// ===========================================================================
// 3. Conversaciones completas (motor real en memoria + Gemini simulado)
// ===========================================================================

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const PN_A = "100000000000001";
const CLIENTE = "573001112233";
const NUEVO = "573004445566";
const ASESORA = 7;

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let engine: ReturnType<typeof createOrderEngine>;
let stateStore: ConversationStateStore;
let canales: ReturnType<typeof createMemoryCustomerChannelStore>;
let pausas: string[];
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
  negocio: { nombre_agente: "Sofía", nombre_negocio: "Joyería Ficticia" },
  clasificacion_cliente: true,
  checkout_conversacional: true,
  ...over,
});
const cfg = (over: Partial<AgentConfigRow> = {}) => (parseAgentConfig(configRow(over), { tenantId: A.tenantId, phoneNumberId: PN_A }) as { config: AgentRuntimeConfig }).config;

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  reloj = Date.parse("2026-09-25T15:00:00Z");
  pedidos = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => reloj });
  stateStore = createMemoryConversationStateStore();
  canales = createMemoryCustomerChannelStore({ [PN_A]: A.tenantId });
  pausas = [];
  history = new Map();
  sent = [];
  buttons = [];
  nombreGuardado = "Laura";
  nombresRecordados = [];
  seq = 0;
  engine = createOrderEngine({
    orders: pedidos,
    catalog: mem.repo,
    key: Buffer.alloc(32, 9),
    sink: memoryOrderEventSink(),
    log: () => {},
    now: () => new Date(reloj),
    handoff: {
      async pauseConversation({ contact }) {
        pausas.push(contact.waId);
        return { ok: true };
      },
    },
  });
  mem.setProfile(A.tenantId, { name: "Joyería", whatsapp: "573001110000" });
  mem.enableModule(A.tenantId);
  await admin.ensurePublication(A);
});

const producto = (name: string, retail: number, stock: number) => admin.createProduct(A, { name, retailPrice: retail, wholesalePrice: Math.round(retail / 2), stock });

function toolDeps(): AgentToolsDeps {
  return {
    engine,
    catalog: mem.repo,
    log: () => {},
    ownsPhoneNumber: async (tenantId, pn) => tenantId === A.tenantId && pn === PN_A,
    customerName: async () => nombreGuardado,
    rememberCustomerName: async (_k, n) => {
      nombresRecordados.push(n);
    },
    siteUrl: () => "https://dulabs.test",
  };
}

async function turno(script: SimulatedStep[], text: string, opts: { buttonId?: string; waId?: string; nonText?: { kind: "audio" | "location" | "image" }; config?: AgentRuntimeConfig } = {}) {
  const provider = createSimulatedProvider(script);
  const waId = opts.waId ?? CLIENTE;
  const wamid = `wamid.in.${++seq}`;
  const h = history.get(waId) ?? [];
  history.set(waId, h);
  if (text) h.push({ direccion: "entrante", contenido: text, origen: "entrante", wamid });
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
          h.push({ direccion: "saliente", contenido: t, origen: "ia", wamid: `wamid.out.${++seq}` });
          return { sent: true, wamid: `wamid.out.${seq}` };
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
    { tenantId: A.tenantId, phoneNumberId: PN_A, waId, wamid, text, buttonId: opts.buttonId ?? null, nonText: opts.nonText ?? null },
  );
  return { ...r, provider };
}

const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });
const estado = async (waId = CLIENTE): Promise<ConversationState> => (await stateStore.load({ tenantId: A.tenantId, phoneNumberId: PN_A, waId })).state;
const clasificar = (waId = CLIENTE) => canales.setInitial({ tenantId: A.tenantId, phoneNumberId: PN_A, waId }, "retail", "cliente");
const tocar = (grupo: keyof typeof CHECKOUT_BUTTONS, i: number) => {
  const b = CHECKOUT_BUTTONS[grupo][i] as { id: string; title: string };
  return turno([], b.title, { buttonId: b.id });
};
const ultimo = () => pedidos.orders.at(-1)!;

/** Selección de 1..n productos y el MODELO detecta la compra (create_order_request): arranca el checkout. */
async function comprar(items: Array<{ ref: string; qty: number }>, textoCompra = "me los llevo") {
  await turno([call("update_cart", { items: items.map((i) => ({ reference: i.ref, quantity: i.qty })) }), { text: "Listo." }], `quiero ${items.map((i) => `${i.qty} ${i.ref}`).join(" y ")}`);
  return turno([call("create_order_request"), { text: "NO DEBE SALIR" }], textoCompra);
}

describe("B28 · P0 una PREGUNTA nunca muta el checkout", () => {
  it("'¿Cuánto cuesta el envío?' en la entrega: se responde (solo lectura), la entrega sigue vacía y se repite la pregunta", async () => {
    const p = await producto("Aretes Luna", 45_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    assert.equal((await estado()).checkout?.step, "delivery");
    const r = await turno([{ text: "El costo del domicilio depende de la dirección 📍 y te lo confirma una asesora." }], "¿Cuánto cuesta el envío?");
    const ck = (await estado()).checkout!;
    assert.equal(ck.delivery, null, "no seleccionó domicilio");
    assert.equal(ck.step, "delivery");
    assert.equal(r.trace.checkout?.action, "question");
    assert.ok(buttons.at(-1)!.body.startsWith("El costo del domicilio depende de la dirección"), buttons.at(-1)!.body);
    assert.ok(buttons.at(-1)!.body.endsWith(CHECKOUT_MESSAGES.delivery));
    assert.deepEqual(buttons.at(-1)!.ids, ["checkout_tienda", "checkout_domicilio"]);
    // El modelo solo tuvo herramientas de LECTURA.
    const tools = r.provider.requests[0].tools.map((t) => t.name);
    for (const t of ["update_cart", "create_order_request", "validate_order", "confirm_order", "handoff_to_human"]) assert.ok(!tools.includes(t), `sin ${t}`);
  });

  it("si el modelo intenta escribir en la respuesta lateral: TOOL_NOT_ALLOWED y nada cambia", async () => {
    const p = await producto("Collar Sol", 60_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    const antes = ultimo();
    const r = await turno([call("update_cart", { items: [{ reference: p.reference, quantity: 5 }] }), { text: "Te cuento que sí hacemos envíos." }], "¿hacen envíos a Medellín?");
    assert.equal(r.trace.tool_calls[0].result, "TOOL_NOT_ALLOWED");
    assert.equal(ultimo().orderId, antes.orderId);
    assert.equal(ultimo().lines[0].quantity, 1);
    assert.equal((await estado()).checkout?.step, "delivery");
  });

  it("una respuesta con un dato inventado (monto sin respaldo) NO sale: se dice que una asesora lo confirma", async () => {
    const p = await producto("Pulsera Luna", 30_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await turno([{ text: "El envío cuesta $12.000." }], "cuanto vale el domicilio");
    assert.ok(buttons.at(-1)!.body.startsWith(CHECKOUT_MESSAGES.questionFallback), buttons.at(-1)!.body);
    assert.ok(!sent.some((t) => t.includes("12.000")), "el monto inventado nunca sale");
  });

  it("'¿puedo pagar por transferencia?' en el pago: NO selecciona; luego 'pago allá' sí (tienda)", async () => {
    const p = await producto("Dije Estrella", 40_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await tocar("delivery", 0);
    assert.equal((await estado()).checkout?.step, "payment");
    await turno([{ text: "Sí, puedes pagar por transferencia o en la tienda." }], "¿puedo pagar por transferencia?");
    assert.equal((await estado()).checkout?.paymentMethod, null);
    assert.equal((await estado()).checkout?.step, "payment");
    await turno([], "pago allá");
    assert.equal((await estado()).checkout?.step, "summary");
    assert.ok(sent.at(-1)!.includes("Pago en tienda"));
  });

  it("'catálogo' durante el checkout: se responde (enlace del canal) y el paso sigue", async () => {
    const p = await producto("Anillo Sol", 70_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    const r = await turno([call("get_catalog_link"), { text: "Aquí está: https://dulabs.test/catalogo/joyeria" }], "pasame el catalogo");
    assert.equal(r.trace.checkout?.action, "question");
    assert.equal((await estado()).checkout?.step, "delivery");
  });
});

describe("B28 · P0 correcciones humanas cambian el dato CORRECTO", () => {
  it("dirección → 'No, mejor recojo en tienda': cambia la entrega (no se guarda como dirección) y sigue al pago", async () => {
    const p = await producto("Aretes Sol", 45_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await tocar("delivery", 1);
    assert.equal((await estado()).checkout?.step, "address");
    const r = await turno([], "No, mejor recojo en tienda");
    const ck = (await estado()).checkout!;
    assert.equal(ck.delivery, "tienda");
    assert.equal(ck.address, null);
    assert.equal(ck.step, "payment");
    assert.equal(r.trace.checkout?.action, "corrected");
    assert.ok(buttons.at(-1)!.body.includes("Anotado: *recoger en tienda*"));
  });

  it("resumen → 'mejor pago en tienda': resumen NUEVO con el pago cambiado; 'sí' NO confirma; solo el botón", async () => {
    const p = await producto("Collar Luna", 80_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await tocar("delivery", 0);
    await tocar("payment", 1);
    assert.ok(sent.at(-1)!.includes("Pago: Transferencia"));
    await turno([], "mejor pago en tienda");
    assert.equal((await estado()).checkout?.paymentMethod, "pago_en_tienda");
    assert.ok(sent.at(-1)!.includes("Pago: Pago en tienda"), sent.at(-1));
    for (const t of ["sí", "sii", "dale", "confirmo", "ok"]) {
      await turno([], t);
      assert.equal(sent.at(-1)!.startsWith(CHECKOUT_MESSAGES.tapToConfirm), true, t);
      assert.equal(ultimo().status, "pending_confirmation", `'${t}' no confirma`);
    }
    await tocar("summary", 0);
    assert.equal(ultimo().status, "confirmed");
    assert.equal(ultimo().checkout?.paymentMethod, "pago_en_tienda");
  });

  it("botón de entrega de un mensaje anterior tocado en el pago: corrige la entrega", async () => {
    const p = await producto("Pulsera Sol", 35_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await tocar("delivery", 0);
    assert.equal((await estado()).checkout?.step, "payment");
    await tocar("delivery", 1);
    const ck = (await estado()).checkout!;
    assert.equal(ck.delivery, "domicilio");
    assert.equal(ck.step, "address");
  });

  it("'cambié de opinión' / 'espera': nada cambia; se pregunta qué cambiar o se espera", async () => {
    const p = await producto("Aretes Estrella", 45_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    const antes = (await estado()).checkout!;
    const r1 = await turno([], "cambié de opinión");
    assert.equal(r1.trace.checkout?.action, "doubt");
    const r2 = await turno([], "un momento");
    assert.equal(r2.trace.checkout?.action, "waiting");
    assert.equal(sent.at(-1), CHECKOUT_MESSAGES.waiting);
    assert.deepEqual((await estado()).checkout, antes);
  });

  it("'cancela porfa' en cualquier paso: cancela el registro y los productos vuelven a la selección", async () => {
    const p = await producto("Dije Sol", 25_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 2 }]);
    await turno([], "cancela porfa");
    assert.equal((await estado()).checkout, null);
    assert.deepEqual((await estado()).cart, [{ reference: p.reference, quantity: 2 }]);
    assert.equal(ultimo().status, "cancelled");
  });
});

describe("B28 · P0 nombre y dirección no aceptan basura", () => {
  it("nombre: 'quiero dos aretes' orienta a modificar; '¿cuánto cuesta?' se responde; 'jajaja' se vuelve a pedir; nada se guarda antes de confirmar", async () => {
    nombreGuardado = null;
    const p = await producto("Aretes Luna", 45_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    assert.equal((await estado()).checkout?.step, "name");
    const r1 = await turno([], "quiero dos aretes");
    assert.equal(r1.trace.checkout?.action, "products_via_modify");
    assert.equal((await estado()).checkout?.customerName, null);
    await turno([{ text: "Estos aretes cuestan $45.000." }], "¿cuánto cuesta?");
    assert.equal((await estado()).checkout?.customerName, null);
    await turno([], "jajaja");
    assert.equal(sent.at(-1), CHECKOUT_MESSAGES.askNameAgain);
    await turno([], "María Fernanda");
    assert.equal((await estado()).checkout?.customerName, "María Fernanda");
    assert.deepEqual(nombresRecordados, [], "el nombre no se guarda en el contacto antes de confirmar");
  });

  it("nombre de NEGOCIO ('Tienda La Perla') es un nombre, no 'recoger en tienda'; 'tienda' sola nunca es nombre", async () => {
    nombreGuardado = null;
    const p = await producto("Aretes Sol", 40_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await turno([], "tienda");
    const ck0 = (await estado()).checkout!;
    assert.deepEqual([ck0.customerName, ck0.delivery, ck0.step], [null, "tienda", "name"], "'tienda' en el nombre corrige la entrega, nunca es el nombre");
    await turno([], "Tienda La Perla");
    const ck = (await estado()).checkout!;
    assert.equal(ck.customerName, "Tienda La Perla");
    assert.equal(ck.step, "payment");
  });

  it("tras 'Modificar' el nombre dado NO se vuelve a pedir (se conserva en la conversación) y aún no llega al contacto", async () => {
    nombreGuardado = null;
    const p = await producto("Collar Sol", 50_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await turno([], "Paula Andrea");
    await tocar("delivery", 0);
    await tocar("payment", 1);
    await tocar("summary", 1);
    assert.equal((await estado()).checkout, null);
    assert.equal((await estado()).checkoutName, "Paula Andrea");
    assert.deepEqual(nombresRecordados, []);
    await turno([call("create_order_request"), { text: "NO DEBE SALIR" }], "listo, ya lo quiero");
    const ck = (await estado()).checkout!;
    assert.deepEqual([ck.customerName, ck.step], ["Paula Andrea", "delivery"]);
    await tocar("delivery", 0);
    await tocar("payment", 1);
    await tocar("summary", 0);
    assert.deepEqual(nombresRecordados, ["Paula Andrea"], "al contacto solo al confirmar");
    assert.ok(!("checkoutName" in (await estado())), "se borra al confirmar");
  });

  it("un nombre guardado que no es nombre ('quiero dos aretes' de antes) no se reutiliza: se pregunta", async () => {
    nombreGuardado = "quiero dos aretes";
    const p = await producto("Collar Estrella", 50_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    assert.equal((await estado()).checkout?.step, "name");
  });

  it("dirección: basura se rechaza, 'vivo por el centro' pide la exacta, 'te mando la dirección' espera; la real se guarda", async () => {
    const p = await producto("Pulsera Estrella", 30_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await tocar("delivery", 1);
    for (const t of ["jajaja", "ok", "no"]) {
      await turno([], t);
      assert.equal((await estado()).checkout?.address, null, t);
    }
    await turno([], "vivo por el centro");
    assert.equal(sent.at(-1), CHECKOUT_MESSAGES.addressVague);
    await turno([], "te mando la dirección");
    assert.equal(sent.at(-1), CHECKOUT_MESSAGES.addressAnnounce);
    await turno([], "Calle 30 # 12-40, barrio La Castellana");
    assert.equal((await estado()).checkout?.address, "Calle 30 # 12-40, barrio La Castellana");
    assert.equal((await estado()).checkout?.step, "city");
    await turno([], "quiero ese");
    assert.equal((await estado()).checkout?.city, null);
    await turno([], "Montería");
    assert.equal((await estado()).checkout?.city, "Montería");
  });

  it("domicilio + 'pago cuando llegue': no se ofrece contra entrega; se explican las opciones (nada se elige)", async () => {
    const p = await producto("Anillo Luna", 70_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await tocar("delivery", 1);
    await turno([], "Calle 5 # 3-2");
    await turno([], "Bogotá");
    await tocar("reference", 0);
    await turno([], "pago cuando llegue");
    assert.equal((await estado()).checkout?.paymentMethod, null);
    assert.ok(buttons.at(-1)!.body.startsWith(CHECKOUT_MESSAGES.noCashOnDelivery));
  });
});

describe("B28 · cantidades durante el checkout (sin asumir)", () => {
  it("un solo producto: 'eran 3' rehace la propuesta con 3 (misma entrega y pago) y el resumen muestra el total nuevo", async () => {
    const p = await producto("Aretes Luna", 45_000, 10);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 2 }]);
    await tocar("delivery", 0);
    const viejo = ultimo().orderId;
    const r = await turno([], "eran 3");
    assert.equal(r.trace.checkout?.action, "updated");
    assert.notEqual(ultimo().orderId, viejo);
    assert.equal(pedidos.orders.find((o) => o.orderId === viejo)!.status, "cancelled", "la propuesta vieja se cancela (sin reserva)");
    assert.equal(ultimo().lines[0].quantity, 3);
    assert.equal((await estado()).checkout?.delivery, "tienda", "los datos del checkout se conservan");
    await tocar("payment", 0);
    assert.ok(sent.at(-1)!.includes(formatCop(135_000)), sent.at(-1));
  });

  it("varios productos: 'eran 3' NO asume: pregunta de cuál; '2' aplica al segundo", async () => {
    const a = await producto("Aretes Luna", 45_000, 10);
    const b = await producto("Collar Sol", 60_000, 10);
    await clasificar();
    await comprar([
      { ref: a.reference, qty: 1 },
      { ref: b.reference, qty: 1 },
    ]);
    const r = await turno([], "eran 3");
    assert.equal(r.trace.checkout?.action, "ask_target");
    assert.ok(sent.at(-1)!.startsWith("Claro. ¿De cuál producto quieres 3 unidades?"), sent.at(-1));
    assert.deepEqual(ultimo().lines.map((l) => l.quantity), [1, 1], "nada cambió todavía");
    await turno([], "2");
    const lines = ultimo().lines;
    assert.equal(lines.find((l) => l.reference === b.reference)!.quantity, 3);
    assert.equal(lines.find((l) => l.reference === a.reference)!.quantity, 1);
  });

  it("'quita uno' baja una unidad; con una sola unidad y un solo producto se ofrece cancelar (no se borra solo)", async () => {
    const p = await producto("Dije Luna", 20_000, 10);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 2 }]);
    await turno([], "quita uno");
    assert.equal(ultimo().lines[0].quantity, 1);
    const r = await turno([], "quita uno");
    assert.equal(r.trace.checkout?.action, "only_product");
    assert.deepEqual(buttons.at(-1)!.ids, ["checkout_cancelar"]);
    assert.equal(ultimo().status, "pending_confirmation");
  });

  it("un número suelto en un paso con opciones NO cambia cantidades", async () => {
    const p = await producto("Collar Estrella", 50_000, 10);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    const antes = ultimo().orderId;
    await turno([], "2");
    assert.equal(ultimo().orderId, antes);
    assert.equal((await estado()).checkout?.step, "delivery");
  });

  it("fuera del checkout: 'eran 3' con dos productos en la selección => update_cart CHOICE_REQUIRED (nunca elige por el cliente)", async () => {
    const a = await producto("Aretes Sol", 45_000, 10);
    const b = await producto("Pulsera Sol", 30_000, 10);
    await clasificar();
    await turno([call("update_cart", { items: [{ reference: a.reference, quantity: 1 }, { reference: b.reference, quantity: 1 }] }), { text: "Listo." }], `quiero ${a.reference} y ${b.reference}`);
    const r = await turno([call("update_cart", { items: [{ reference: b.reference, quantity: 3 }] }), { text: "¿De cuál producto quieres 3?" }], "eran 3");
    assert.equal(r.trace.tool_calls[0].result, "CHOICE_REQUIRED");
    assert.deepEqual((await estado()).cart.map((c) => c.quantity), [1, 1]);
  });
});

describe("B28 · varias intenciones al comprar", () => {
  it("'quiero comprar, a domicilio y pago por transferencia': entrega y pago quedan prellenados; resumen y botón siguen siendo obligatorios", async () => {
    const p = await producto("Anillo Estrella", 90_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }], "listo, a domicilio y pago por transferencia");
    const ck = (await estado()).checkout!;
    assert.equal(ck.delivery, "domicilio");
    assert.equal(ck.paymentMethod, "transferencia");
    assert.equal(ck.step, "address");
    await turno([], "Carrera 7 # 20-15");
    await turno([], "Montería");
    await tocar("reference", 0);
    assert.equal((await estado()).checkout?.step, "summary", "el pago ya estaba: va directo al resumen");
    assert.equal(ultimo().status, "pending_confirmation");
  });
});

describe("B28 · mensajes sin texto durante el checkout", () => {
  it("nota de voz: se dice exactamente qué dato falta (sin modelo, sin asesora)", async () => {
    const p = await producto("Aretes Luna", 45_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    const r = await turno([], "", { nonText: { kind: "audio" } });
    assert.equal(r.reply, `Por ahora no puedo escuchar notas de voz 🙏 ${CHECKOUT_STEP_HINT.delivery}`);
    assert.equal(r.provider.requests.length, 0);
    assert.deepEqual(pausas, []);
  });

  it("ubicación en el paso de la dirección: se pide escrita y el checkout sigue (sin asesora)", async () => {
    const p = await producto("Collar Luna", 80_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await tocar("delivery", 1);
    const r = await turno([], "", { nonText: { kind: "location" } });
    assert.equal(r.reply, CHECKOUT_MESSAGES.locationNeedsText);
    assert.deepEqual(pausas, []);
    assert.equal((await estado()).checkout?.step, "address");
  });

  it("foto durante el checkout: como siempre, pasa a una asesora (nunca se identifica un producto adivinando)", async () => {
    const p = await producto("Pulsera Luna", 30_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    const r = await turno([], "", { nonText: { kind: "image" } });
    assert.equal(r.outcome, "handoff");
    assert.deepEqual(pausas, [CLIENTE]);
  });
});

describe("B28 · estado REAL del pedido (nunca inventado)", () => {
  async function confirmado() {
    const p = await producto("Aretes Sol", 45_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await tocar("delivery", 0);
    await tocar("payment", 1);
    await tocar("summary", 0);
    return ultimo();
  }

  it("'¿ya lo enviaron?' con el pedido recién confirmado: 'ya fue enviado' NO sale; el contexto trae el seguimiento real", async () => {
    await confirmado();
    const r = await turno([{ text: "¡Sí! Tu pedido ya fue enviado." }, { text: "Tu pedido ya fue enviado hoy." }], "ya lo enviaron?");
    assert.equal(r.outcome, "fallback");
    assert.ok(!sent.some((t) => /ya fue enviado/.test(t)), "nunca se afirma un envío que no ocurrió");
    assert.ok(r.provider.requests[0].system.includes('"seguimiento":{"etapa":"confirmado (aún no se prepara)","pago":"pago pendiente"'), "el modelo ve el estado real");
  });

  it("con la etapa real 'en preparación' y el pago recibido, el agente PUEDE decirlo", async () => {
    const o = await confirmado();
    await engine.advanceStage({ tenantId: A.tenantId, orderId: o.orderId, from: "confirmado", to: "en_preparacion", memberId: ASESORA });
    await engine.markPaymentReceived({ tenantId: A.tenantId, orderId: o.orderId, memberId: ASESORA });
    const r = await turno([{ text: "Tu pedido está en preparación y tu pago ya fue recibido. 💖" }], "cómo va mi pedido");
    assert.equal(r.outcome, "replied");
    assert.equal(r.reply, "Tu pedido está en preparación y tu pago ya fue recibido. 💖");
  });

  it("anclaje (unitario): enviado / entregado / pagado / preparado exigen respaldo; preguntas y negaciones no cuentan", () => {
    const ev = emptyEvidence();
    for (const t of ["Tu pedido ya fue enviado.", "Ya está entregado.", "Tu pago fue recibido.", "Ya está en preparación.", "Listo, actualicé tu pedido."]) assert.equal(checkGrounding(t, ev).ok, false, t);
    for (const t of ["¿Quieres que te avise cuando sea enviado?", "Aún no ha sido enviado.", "Actualicé tu carrito, ya quedó listo."]) assert.equal(checkGrounding(t, ev).ok, true, t);
    addOrderStateEvidence({ status: "confirmed", tracking: { etapa: "enviado", pago: "recibido", entrega: "domicilio", metodo_pago: "transferencia" } }, ev);
    for (const t of ["Tu pedido ya fue enviado.", "Tu pago fue recibido.", "Ya está en preparación."]) assert.equal(checkGrounding(t, ev).ok, true, t);
    assert.equal(checkGrounding("Ya está entregado.", ev).ok, false);
  });
});

describe("B28 · modalidad (aislada: una frase ambigua nunca la cambia)", () => {
  it("sin clasificar: 'soy particular' => detal; 'tengo una tienda' => se vuelve a preguntar; 'por mallor' => mayorista", async () => {
    await turno([], "hola", { waId: NUEVO });
    await turno([], "tengo una tienda", { waId: NUEVO });
    assert.equal(await canales.get({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: NUEVO }), null);
    await turno([{ text: "¡Perfecto! ¿Qué joya buscas?" }], "soy particular", { waId: NUEVO });
    assert.equal((await canales.get({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: NUEVO }))?.channel, "retail");
    const otro = "573007778899";
    await turno([], "hola", { waId: otro });
    await turno([{ text: "Listo." }], "por mallor", { waId: otro });
    assert.equal((await canales.get({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: otro }))?.channel, "wholesale");
  });

  it("detal pide 'precio x mayor': pasa a una asesora con mensaje fijo; su modalidad NO cambia", async () => {
    await clasificar();
    const r = await turno([], "me das precio x mayor?");
    assert.equal(r.trace.classification?.action, "change_requested");
    assert.equal((await canales.get({ tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE }))?.channel, "retail");
    assert.equal(r.provider.requests.length, 0);
  });
});

describe("B28 · aislamiento: sin checkout conversacional nada de esto aplica", () => {
  it("un número con checkout apagado: '¿cuánto cuesta el envío?' va al agente normal (sin respuesta lateral ni pasos)", async () => {
    await clasificar();
    const r = await turno([{ text: "Te cuento que el envío lo coordina una asesora." }], "¿cuánto cuesta el envío?", { config: cfg({ checkout_conversacional: false }) });
    assert.equal(r.trace.checkout ?? null, null);
    assert.equal(r.reply, "Te cuento que el envío lo coordina una asesora.");
  });
});

// ===========================================================================
// 4. Auditoría final (Bloque 28): frases reales de WhatsApp que fallaban + guardas del carrito
// ===========================================================================

describe("B28 · auditoría final — intérprete", () => {
  it("nombre: ubicación, atributos, posiciones y 'para mi' nunca son un nombre", () => {
    for (const t of ["vivo en Montería", "para mi", "el dorado", "el segundo", "ahorita te la mando"]) assert.equal(leerNombre(t), null, t);
    assert.equal(leerNombre("Juan"), "Juan");
    assert.equal(leerNombre("Tienda La Perla"), "Tienda La Perla");
  });

  it("dirección suficiente vs insuficiente; ciudad con 'vivo en'; 'ahorita te la mando' es un anuncio", () => {
    for (const t of ["calle 20", "es por la 30", "por el centro", "en montería"]) assert.equal(leerDireccion(t)?.tipo, "vaga", t);
    for (const t of ["Calle 20 # 10-15", "Cra 7 20-15 barrio Centro", "Mz 3 casa 5", "Finca La Esperanza, vereda El Tigre", "barrio La Castellana casa 12"]) assert.equal(leerDireccion(t)?.tipo, "ok", t);
    assert.equal(leerDireccion("ahorita te la mando")?.tipo, "anuncio");
    assert.equal(leerCiudad("vivo en Montería"), "Montería");
    assert.equal(leerCiudad("ahorita te la mando"), null);
  });

  it("'y si lo recojo' (sin signo) es pregunta; 'ese x2' y 'ponle otro' son cantidades; 'me arrepentí'/'mejor no' son duda; 'me yebo'", () => {
    assert.equal(esPregunta("y si lo recojo"), true);
    assert.equal(leerCorreccion("y si lo recojo", "domicilio"), null);
    assert.deepEqual(leerCantidad("ese x2"), { tipo: "fijar", n: 2 });
    assert.deepEqual(leerCantidad("ponle otro"), { tipo: "sumar", n: 1 });
    assert.equal(leerSalida("me arrepentí"), "doubt");
    assert.equal(leerSalida("mejor no"), "doubt");
    assert.equal(normalizar("me yebo ese"), "me llevo ese");
    assert.deepEqual([...numerosDelCliente("quiero dos, x3 y 4und")].sort(), [2, 3, 4]);
  });

  it("selección: 'uno de cada uno' = todas; 'el de la foto' solo con UNA foto enviada", () => {
    const shown = [{ reference: "DL-000001", name: "Aretes Luna" }, { reference: "DL-000002", name: "Collar Sol" }];
    const todos = resolveSelection("uno de cada uno", shown, { lenguaje: true });
    assert.equal(resolveSelection("uno de cada uno", shown).all, undefined, "sin la capa de lenguaje, como antes");
    assert.equal(todos.all, true);
    assert.deepEqual(todos.selected.map((x) => x.reference), ["DL-000001", "DL-000002"]);
    assert.deepEqual(resolveSelection("quiero el de la foto", shown, { photoReferences: ["DL-000002"] }).selected.map((x) => x.reference), ["DL-000002"]);
    assert.deepEqual(resolveSelection("quiero el de la foto", shown, { photoReferences: ["DL-000001", "DL-000002"] }).selected, []);
  });
});

describe("B28 · auditoría final — el modelo nunca decide cantidad ni producto por el cliente", () => {
  async function sembrar(parcial: Partial<ConversationState>) {
    const k = { tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE };
    const l = await stateStore.load(k);
    await stateStore.save(k, { ...l.state, ...parcial }, l.version);
  }
  const mostrados = (ps: Array<{ reference: string; name: string }>) => ({
    lastShown: ps.map((p) => ({ reference: p.reference, name: p.name })),
    known: ps.map((p) => ({ reference: p.reference, via: "tool" as const, turn: 0 })),
    ...(ps.length > 1 ? { ambiguity: { references: ps.map((p) => p.reference), createdTurn: 0, presentedTurn: 0 } } : {}),
  });

  it("'ese x2' y el modelo pone 3: QUANTITY_NOT_STATED; el carrito no cambia y se pregunta cuántas (no un 'listo' falso)", async () => {
    const a = await producto("Aretes Luna", 45_000, 10);
    await clasificar();
    await sembrar(mostrados([a]));
    const r = await turno([call("update_cart", { items: [{ reference: a.reference, quantity: 3 }] }), { text: "¡Listo, te agregué 3!" }, { text: "¡Listo, te agregué 3!" }], "ese x2");
    assert.equal(r.trace.tool_calls[0].result, "QUANTITY_NOT_STATED");
    assert.deepEqual((await estado()).cart, []);
    assert.equal(sent.at(-1), CART_CLARIFY.QUANTITY_NOT_STATED);
    assert.ok(!sent.some((t) => /Listo, te agregu/.test(t)), "nunca un 'listo' sin cambio real");
  });

  it("la cantidad puede venir de un mensaje reciente ('necesito 3' y luego la referencia): se acepta", async () => {
    const a = await producto("Collar Luna", 50_000, 10);
    await clasificar();
    await turno([{ text: "¡Claro! ¿Cuál producto te interesa?" }], "necesito 3 unidades");
    const r = await turno([call("update_cart", { items: [{ reference: a.reference, quantity: 3 }] }), { text: "Listo." }], `el ${a.reference}`);
    assert.equal(r.trace.tool_calls[0].result, "ok");
    assert.deepEqual((await estado()).cart.map((c) => c.quantity), [3]);
  });

  it("'uno más' = +1 (no +2); 'los dos' exige agregar los dos (SELECTION_INCOMPLETE)", async () => {
    const a = await producto("Aretes Sol", 45_000, 10);
    const b = await producto("Collar Sol", 60_000, 10);
    await clasificar();
    await sembrar({ ...mostrados([a]), cart: [{ reference: a.reference, quantity: 1 }] });
    const mas = await turno([call("update_cart", { items: [{ reference: a.reference, quantity: 3 }] }), { text: "¿Cuántas?" }], "uno más");
    assert.equal(mas.trace.tool_calls[0].result, "QUANTITY_NOT_STATED");
    await turno([call("update_cart", { items: [{ reference: a.reference, quantity: 2 }] }), { text: "Listo, 2." }], "uno más");
    assert.deepEqual((await estado()).cart.map((c) => c.quantity), [2]);
    await sembrar({ ...mostrados([a, b]), cart: [] });
    const dos = await turno([call("update_cart", { items: [{ reference: a.reference, quantity: 1 }] }), { text: "¿Quieres los dos?" }], "los dos");
    assert.equal(dos.trace.tool_calls[0].result, "SELECTION_INCOMPLETE");
    assert.deepEqual((await estado()).cart, []);
  });

  it("'quiero el de la foto' con UNA foto enviada: ese producto; con la otra opción: CHOICE_REQUIRED y pregunta concreta", async () => {
    const a = await producto("Aretes Mar", 45_000, 10);
    const b = await producto("Collar Mar", 60_000, 10);
    await clasificar();
    await sembrar({ ...mostrados([a, b]), imagesSent: [{ reference: b.reference, turn: 0 }] });
    const mal = await turno([call("update_cart", { items: [{ reference: a.reference, quantity: 1 }] }), { text: "¡Listo!" }, { text: "¡Listo!" }], "quiero el de la foto");
    assert.equal(mal.trace.tool_calls[0].result, "CHOICE_REQUIRED");
    assert.equal(sent.at(-1), CART_CLARIFY.CHOICE_REQUIRED);
    const bien = await turno([call("update_cart", { items: [{ reference: b.reference, quantity: 1 }] }), { text: "¡Listo, el collar!" }], "quiero el de la foto");
    assert.equal(bien.trace.tool_calls[0].result, "ok");
    assert.deepEqual((await estado()).cart.map((c) => c.reference), [b.reference]);
  });

  it("aislamiento: con el checkout conversacional apagado, las guardas nuevas no aplican (como antes)", async () => {
    const a = await producto("Pulsera Mar", 30_000, 10);
    await clasificar();
    await sembrar(mostrados([a]));
    const r = await turno([call("update_cart", { items: [{ reference: a.reference, quantity: 3 }] }), { text: "Listo." }], "ese x2", { config: cfg({ checkout_conversacional: false }) });
    assert.equal(r.trace.tool_calls[0].result, "ok");
  });
});

describe("B28 · auditoría final — estado real, fotos y datos del checkout", () => {
  it("'ya pagué' y el modelo insiste 'ya está pagado': sale el estado REAL (fijo) y nada cambia", async () => {
    const p = await producto("Aretes Río", 45_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await tocar("delivery", 0);
    await tocar("payment", 1);
    await tocar("summary", 0);
    const r = await turno([{ text: "¡Perfecto! Tu pedido ya está pagado ✅" }, { text: "¡Perfecto! Tu pedido ya está pagado ✅" }], "ya pagué");
    assert.ok(r.trace.grounding.violations.includes("order_status"));
    assert.match(sent.at(-1)!, /está confirmado \(aún no se prepara\) y el pago está pendiente de verificación/);
    assert.equal(ultimo().checkout?.paymentStatus, "pendiente");
  });

  it("foto (captura de la dirección) en el paso de la dirección: se pide escrita, sin asesora", async () => {
    const p = await producto("Collar Río", 50_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await tocar("delivery", 1);
    const r = await turno([], "", { nonText: { kind: "image" } });
    assert.equal(r.reply, CHECKOUT_MESSAGES.mediaNeedsText("address"));
    assert.deepEqual(pausas, []);
    assert.equal((await estado()).checkout?.step, "address");
  });

  it("fuera de orden: pide nombre → '¿Cuánto vale?' → 'Juan' → 'pero cuánto cuesta el envío?' → 'vivo en Montería' → 'mejor lo recojo'", async () => {
    nombreGuardado = null;
    const p = await producto("Anillo Río", 80_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await turno([{ text: "Cuesta $80.000 😊" }], "¿Cuánto vale?");
    await turno([], "Juan");
    await turno([{ text: "El domicilio te lo confirma una asesora 😊" }], "pero cuánto cuesta el envío?");
    await turno([], "vivo en Montería");
    await turno([], "mejor lo recojo");
    const ck = (await estado()).checkout!;
    assert.deepEqual([ck.customerName, ck.delivery, ck.address, ck.city, ck.step], ["Juan", "tienda", null, null, "payment"]);
  });

  it("dirección insuficiente ('calle 20') no se guarda; la completa sí", async () => {
    const p = await producto("Dije Río", 25_000, 5);
    await clasificar();
    await comprar([{ ref: p.reference, qty: 1 }]);
    await tocar("delivery", 1);
    await turno([], "calle 20");
    assert.equal(sent.at(-1), CHECKOUT_MESSAGES.addressVague);
    assert.equal((await estado()).checkout?.address, null);
    await turno([], "Calle 20 # 10-15");
    assert.equal((await estado()).checkout?.address, "Calle 20 # 10-15");
  });
});

describe("B28 · regresión de la corrida con Gemini REAL", () => {
  async function sembrar(parcial: Partial<ConversationState>) {
    const k = { tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE };
    const l = await stateStore.load(k);
    await stateStore.save(k, { ...l.state, ...parcial }, l.version);
  }
  const mostrados = (ps: Array<{ reference: string; name: string }>) => ({
    lastShown: ps.map((p) => ({ reference: p.reference, name: p.name })),
    known: ps.map((p) => ({ reference: p.reference, via: "tool" as const, turn: 0 })),
    ...(ps.length > 1 ? { ambiguity: { references: ps.map((p) => p.reference), createdTurn: 0, presentedTurn: 0 } } : {}),
  });

  it("Q04/Q06 'uno más' con A×1: el modelo llama update_cart en bucle (2, 3, 4…) => solo el primer +1 entra (queda A×2)", async () => {
    const a = await producto("Aretes Luna Dorados", 45_000, 10);
    await clasificar();
    await sembrar({ ...mostrados([a]), cart: [{ reference: a.reference, quantity: 1 }] });
    const up = (q: number) => call("update_cart", { items: [{ reference: a.reference, quantity: q }] });
    const r = await turno([up(2), up(3), up(4), { text: "Listo, ya tienes 2." }], "uno más");
    assert.deepEqual(r.trace.tool_calls.map((t) => t.result), ["ok", "QUANTITY_NOT_STATED", "QUANTITY_NOT_STATED"]);
    assert.deepEqual((await estado()).cart.map((c) => c.quantity), [2]);
  });

  it("AM01 'quiero el dorado' con 'Aretes Luna Dorados' y 'Collar Estrella Dorado': ambos son dorados => CHOICE_REQUIRED y se pregunta", async () => {
    const a = await producto("Aretes Luna Dorados", 45_000, 10);
    const b = await producto("Collar Estrella Dorado", 60_000, 10);
    await clasificar();
    await sembrar(mostrados([a, b]));
    const texto = "Agregué el Collar Estrella Dorado a tu carrito.";
    const r = await turno([call("update_cart", { items: [{ reference: b.reference, quantity: 1 }] }), { text: texto }, { text: texto }], "quiero el dorado");
    assert.equal(r.trace.tool_calls[0].result, "CHOICE_REQUIRED");
    assert.deepEqual((await estado()).cart, []);
    assert.equal(sent.at(-1), CART_CLARIFY.CHOICE_REQUIRED);
    // Con una palabra que sí distingue ("el collar"), se resuelve sin preguntar.
    assert.deepEqual(resolveSelection("el collar dorado", mostrados([a, b]).lastShown, { lenguaje: true }).selected.map((x) => x.reference), [b.reference]);
  });

  it("ST03 'ya recibí' => el modelo no puede afirmar 'ya recibiste tu pedido' / 'te llegó' sin respaldo; preguntarlo sí puede", () => {
    const ev = emptyEvidence();
    for (const t of ["¡Qué excelente noticia! Ya recibiste tu pedido.", "Qué bien que te llegó 😊"]) {
      assert.ok(checkGrounding(t, ev).violations.some((v) => v.kind === "order_status"), t);
    }
    assert.ok(checkGrounding("¿Ya recibiste tu pedido?", ev).ok);
  });
});
