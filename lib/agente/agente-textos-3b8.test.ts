/**
 * FASE 3B.8 — TEXTOS FINALES Y COMUNICACIÓN CON EL CLIENTE (capa de textos y envíos). TODO en memoria; el runtime es el REAL del agente.
 *
 *   1. Aviso obligatorio (3B.4): sigue IDÉNTICO, byte a byte (A).
 *   2. Plantillas y configuración: marcadores cerrados, validación estricta, nada se inventa; configurar textos no enciende el cierre.
 *   3. Envíos (3B.6): tres situaciones distintas (excluida explícitamente / no verificable / error técnico), cada una con el texto del
 *      NEGOCIO o, sin él, el mensaje neutro de siempre; el backend decide el traspaso y el modelo no puede evitarlo ni redactar (J–N).
 *   4. El modelo no cambia textos, ni negocio, ni plantillas por tool calling (I).
 *   5. El motor genérico no trae textos comerciales ni a ninguna persona: eso es configuración del negocio.
 *
 * Los mensajes tras una decisión humana y la respuesta al "sí" están en lib/catalogo/pedidos/mensajes-decision-b38.test.ts.
 * Negocios, ciudades, textos y personas FICTICIOS. Nada toca Supabase, Gemini ni Meta.
 */
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { createMemoryConversationStateStore, type ConversationStateStore } from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES, esHerramientaComercial, type AgentToolName } from "@/lib/agente/nombres-herramientas";
import { executeAgentTool, type AgentToolsDeps, type AgentTurnToolContext } from "@/lib/agente/herramientas";
import { FALLBACK_MESSAGES, runAgentTurn } from "@/lib/agente/runtime";
import { createMemoryCustomerChannelStore } from "@/lib/agente/clasificacion";
import type { HistoryRow } from "@/lib/agente/contexto";
import { ACEPTACION_BUTTONS, ACEPTACION_MESSAGES } from "@/lib/agente/checkout";
import { CHECKOUT_OPCIONES_LEGADO, FUNCIONES_3B_IMPLEMENTADAS, FUNCIONES_FASE_3B, funcionesNoDisponibles, resolverCheckoutOpciones, type CheckoutOpciones, type FuncionFase3B } from "@/lib/agente/perfil-negocio";
import { leerConfigAceptacion } from "@/lib/agente/aceptacion-humana";
import type { EnviosConfig } from "@/lib/agente/envios";
import {
  CLAVES_TEXTO_ENVIO,
  CLAVE_TEXTO_DECISION,
  MARCADORES_PERMITIDOS,
  marcadoresDe,
  motivoParecePersonal,
  plantillaValida,
  renderizarTextoDecision,
  textoDeEnvio,
  usaMotivo,
} from "@/lib/agente/textos-cliente";

// ===========================================================================
// 1. Aviso obligatorio: IDÉNTICO (A)
// ===========================================================================

/** El aviso tal como llegó en el mensaje de la Fase 3B.8 (el mismo que se aprobó en la 3B.4). */
const AVISO = [
  "⚠️ IMPORTANTE ANTES DE ENVIAR SU PEDIDO:",
  "",
  "Por seguridad, actualmente no estamos dejando pedidos en las transportadoras sin reclamar o recibir, ya que hemos tenido pérdidas de mercancía bajo esta modalidad y, adicionalmente, se generan dobles costos de flete.",
  "",
  "Por este motivo, al confirmar su pedido, usted acepta recibirlo y reclamarlo cuando la transportadora lo entregue, RECOMENDAMOS TENER LA DISPONIBILIDAD DEL DINERO.",
  "",
  "📦 El producto se envía tal como se muestra en las fotos y videos, con las mismas características, especificaciones y accesorios ofrecidos en la publicación.",
  "",
  "Por favor, confirme su compra únicamente si está 100% seguro de recibir el pedido. 🙏",
  "",
  "¿Me confirmas por favor que estás 100% seguro de recibirlo?",
].join("\n");
/** SHA-256 fijado en la 3B.4 (calculado APARTE del código): un solo byte distinto rompe la prueba. */
const AVISO_SHA256 = "c0bf58e071859d51d86f2de4f703faa8f95ea866e644386d40eb9d6d1a75179a";
const sha256 = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

/** Archivos de código fuente (sin tests) de la aplicación. */
function fuentes(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const ruta = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (!["node_modules", ".next", ".git", ".claude"].includes(e.name)) fuentes(ruta, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(ruta);
  }
  return out;
}
const FUENTES = ["lib", "app", "components"].flatMap((d) => fuentes(d));
const leerFuente = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("3B.8 · aviso obligatorio: NO se modifica (A)", () => {
  it("A) el texto es el aprobado: 747 bytes, SHA-256 fijado en la 3B.4, párrafos, saltos de línea, emojis y puntuación idénticos", () => {
    assert.equal(Buffer.byteLength(AVISO, "utf8"), 747);
    assert.equal(sha256(AVISO), AVISO_SHA256);
    assert.equal(AVISO.split("\n").length, 11);
    assert.equal(AVISO.split("\n\n").length, 6);
    assert.deepEqual([...AVISO].filter((c) => c.codePointAt(0)! > 0x2000).map((c) => c.codePointAt(0)!.toString(16).toUpperCase()), ["26A0", "FE0F", "1F4E6", "1F64F"]);
    assert.ok(!/[\r\t]/.test(AVISO) && !/ {2}/.test(AVISO) && AVISO.trim() === AVISO && AVISO === AVISO.normalize("NFC"));
    assert.ok(AVISO.endsWith("únicamente si está 100% seguro de recibir el pedido. 🙏\n\n¿Me confirmas por favor que estás 100% seguro de recibirlo?"));
  });

  it("A) la prueba de 3B.4 fija el MISMO SHA-256 (no hay dos versiones del aviso)", () => {
    const f = readFileSync(join(process.cwd(), "lib/agente/agente-checkout-aceptacion.test.ts"), "utf8");
    assert.ok(f.includes(`AVISO_OFICIAL_SHA256 = "${AVISO_SHA256}"`));
  });

  it("A) la configuración (esquema) lo conserva intacto aunque se agreguen los textos de la 3B.8: ni lo recorta ni lo normaliza ni lo reemplaza", () => {
    const r = resolverCheckoutOpciones({ ...OPCIONES_CIERRE, cierre: { ...OPCIONES_CIERRE.cierre, textos: { ...OPCIONES_CIERRE.cierre.textos, aviso: AVISO, aceptado: "Aceptado {pedido}", rechazado: "Rechazado {pedido}: {motivo}", cancelado: "Cancelado {pedido}: {motivo}" } } });
    assert.ok(r.ok);
    const cierre = (r as { opciones: CheckoutOpciones }).opciones.cierre;
    assert.equal(cierre?.modo, "aceptacion_humana");
    if (cierre?.modo === "aceptacion_humana") {
      assert.equal(sha256(cierre.textos.aviso), AVISO_SHA256);
      assert.equal(cierre.textos.aviso, AVISO);
    }
  });

  it("A) el aviso NO vive en el código (solo en la configuración del negocio) y el checkout lo envía tal cual, sin transformarlo", () => {
    assert.deepEqual(FUENTES.filter((f) => leerFuente(f).includes("IMPORTANTE ANTES DE ENVIAR")), [], "ningún archivo de código tiene una copia del aviso");
    const checkout = leerFuente("lib/agente/checkout.ts");
    assert.ok(checkout.includes("io.sendText(cierre.textos.aviso)"), "el checkout envía exactamente cierre.textos.aviso");
    // La capa de la 3B.8 no toca el aviso.
    for (const f of ["lib/agente/textos-cliente.ts", "lib/catalogo/pedidos/mensajes-decision.ts"]) assert.ok(!/textos\.aviso|\.aviso\b/.test(leerFuente(f)), f);
  });
});

// ===========================================================================
// 2. Plantillas y configuración
// ===========================================================================

const CIERRE_BASE = {
  modo: "aceptacion_humana",
  validacion_resumen: "boton_datos_correctos",
  mostrar_numero_pedido: false,
  textos: { aviso: "AVISO DE PRUEBA", tras_aviso_confirma: "Respuesta de prueba" },
  responsable: { miembro_id: 41, respaldo_miembro_id: null, canales: ["panel"] },
  aceptan: "solo_responsable",
  reserva: { tipo: "sin_reserva" },
  vencimiento: { tipo: "sin_vencimiento" },
  reserva_tras_aceptar: { tipo: "plataforma" },
  respuesta_tras_aviso: { si_ya_respondio_persona: "no_responder" },
  pregunta_sin_respuesta: "handoff_inmediato",
} as const;
const OPCIONES_CIERRE = { entregas: ["domicilio"], pagos: [{ metodo: "contra_entrega" }], campos: { nombre_completo: true, telefono: { modo: "requerido", acepta_mismo_whatsapp: true }, departamento: true, barrio: true }, cierre: CIERRE_BASE };
const conTextos = (textos: Record<string, unknown>) => ({ ...OPCIONES_CIERRE, cierre: { ...CIERRE_BASE, textos: { ...CIERRE_BASE.textos, ...textos } } });
const valida = (o: unknown) => resolverCheckoutOpciones(o).ok;

describe("3B.8 · plantillas: marcadores cerrados y validación estricta", () => {
  it("marcadoresDe / plantillaValida: solo {pedido} (y {motivo} en rechazo y cancelación); ninguna llave suelta", () => {
    assert.deepEqual(marcadoresDe("Pedido {pedido}: {motivo}"), ["pedido", "motivo"]);
    assert.ok(plantillaValida("Hola {pedido}", MARCADORES_PERMITIDOS.aceptado));
    assert.ok(!plantillaValida("Hola {motivo}", MARCADORES_PERMITIDOS.aceptado), "la aceptación no lleva motivo");
    assert.ok(plantillaValida("Hola {pedido}: {motivo}", MARCADORES_PERMITIDOS.rechazado));
    for (const mala of ["Hola {nombre}", "Hola {pedido", "Hola pedido}", "Hola {{pedido}}", "{ pedido }", "{}", "{PEDIDO}", "{pedido }"]) assert.ok(!plantillaValida(mala, MARCADORES_PERMITIDOS.rechazado), mala);
    assert.ok(plantillaValida("Texto sin marcadores", []));
    assert.ok(!plantillaValida("Texto {pedido}", []));
  });

  it("usaMotivo: solo si la plantilla lo pide", () => {
    assert.equal(usaMotivo("Pedido {pedido}"), false);
    assert.equal(usaMotivo("Pedido {pedido}: {motivo}"), true);
  });

  it("renderizar: completa {pedido} y {motivo} en UNA pasada; sin motivo utilizable o con uno sensible NO produce texto", () => {
    const P = "DL-ORD-AAAAAA";
    assert.deepEqual(renderizarTextoDecision("aceptado", "Listo {pedido}", { pedido: P, motivo: null }), { ok: true, texto: `Listo ${P}` });
    assert.deepEqual(renderizarTextoDecision("rechazado", "{pedido}: {motivo}.", { pedido: P, motivo: "  sin   stock\ny sin  fecha " }), { ok: true, texto: `${P}: sin stock y sin fecha.` });
    assert.deepEqual(renderizarTextoDecision("rechazado", "{pedido}: {motivo}.", { pedido: P, motivo: "x {pedido} y {motivo}" }), { ok: true, texto: `${P}: x {pedido} y {motivo}.` }, "el motivo no se reinterpreta");
    assert.deepEqual(renderizarTextoDecision("rechazado", "{motivo}", { pedido: P, motivo: null }), { ok: false, motivo: "sin_motivo" });
    assert.deepEqual(renderizarTextoDecision("rechazado", "{motivo}", { pedido: P, motivo: "ab" }), { ok: false, motivo: "sin_motivo" });
    assert.deepEqual(renderizarTextoDecision("rechazado", "{motivo}", { pedido: P, motivo: "x".repeat(301) }), { ok: false, motivo: "sin_motivo" });
    assert.deepEqual(renderizarTextoDecision("rechazado", "{motivo}", { pedido: P, motivo: "cédula 1020345678" }), { ok: false, motivo: "motivo_sensible" });
    assert.deepEqual(renderizarTextoDecision("aceptado", "Hola {motivo}", { pedido: P, motivo: "x" }), { ok: false, motivo: "plantilla_invalida" });
    assert.deepEqual(renderizarTextoDecision("aceptado", "Hola {pedido}", { pedido: "no-es-un-pedido", motivo: null }), { ok: false, motivo: "pedido_invalido" });
    // Sin {motivo} en la plantilla, el motivo (aunque sea sensible) ni se mira ni sale.
    assert.deepEqual(renderizarTextoDecision("rechazado", "Pedido {pedido}", { pedido: P, motivo: "cédula 1020345678" }), { ok: true, texto: `Pedido ${P}` });
  });

  it("motivoParecePersonal: 7+ dígitos seguidos (con separadores) = documento, teléfono o cuenta; números cortos no", () => {
    for (const m of ["1020345678", "1.020.345.678", "300 123 4567", "cuenta 123-4567-89", "tel 3001234567."]) assert.ok(motivoParecePersonal(m), m);
    for (const m of ["son 3 unidades", "talla 38", "pedido DL-ORD-AAAAAA", "100% seguro", "año 2026", "sin stock"]) assert.ok(!motivoParecePersonal(m), m);
  });

  it("las claves están cerradas: aceptar→aceptado, rechazar→rechazado, cancelar→cancelado; y tres textos de envíos", () => {
    assert.deepEqual(CLAVE_TEXTO_DECISION, { aceptar: "aceptado", rechazar: "rechazado", cancelar: "cancelado" });
    assert.deepEqual([...CLAVES_TEXTO_ENVIO], ["sin_cobertura", "cobertura_no_verificable", "error_consulta"]);
  });
});

describe("3B.8 · configuración: textos opcionales, estrictos y sin valores por defecto", () => {
  it("los textos de decisión son OPCIONALES (la configuración de siempre sigue válida) y válidos con marcadores permitidos", () => {
    assert.ok(valida(OPCIONES_CIERRE));
    assert.ok(valida(conTextos({ aceptado: "Aceptado {pedido}" })));
    assert.ok(valida(conTextos({ aceptado: "Aceptado {pedido}", rechazado: "Rechazado {pedido}: {motivo}", cancelado: "Cancelado {pedido}: {motivo}" })));
    assert.ok(valida(conTextos({ rechazado: "Sin marcadores" })));
  });

  it("inválidos: marcador desconocido, {motivo} en la aceptación, llaves sueltas, vacío, espacios en los bordes, demasiado largo, tipos erróneos y claves extra", () => {
    for (const textos of [
      { aceptado: "Hola {nombre}" },
      { aceptado: "Hola {motivo}" },
      { rechazado: "Hola {pedido" },
      { cancelado: "}" },
      { aceptado: "" },
      { aceptado: " con espacio" },
      { rechazado: "con espacio " },
      { aceptado: "x".repeat(501) },
      { aceptado: 5 },
      { aceptado: null },
      { aprobado: "clave que no existe" },
    ]) assert.ok(!valida(conTextos(textos)), JSON.stringify(textos));
  });

  it("textos de envíos: opcionales; sin llaves; ≤300; claves cerradas", () => {
    const con = (textos: unknown) => ({ ...OPCIONES_CIERRE, envios: { ...REGLAS, textos } });
    assert.ok(valida({ ...OPCIONES_CIERRE, envios: REGLAS }));
    assert.ok(valida(con({ sin_cobertura: "No cubrimos esa ciudad.", cobertura_no_verificable: "Una persona lo confirma.", error_consulta: "Hubo un inconveniente." })));
    assert.ok(valida(con({})));
    for (const mala of [{ sin_cobertura: "Con {llaves}" }, { sin_cobertura: "" }, { sin_cobertura: "x".repeat(301) }, { sin_cobertura: " espacio" }, { otra_cosa: "x" }, { error_consulta: 3 }]) assert.ok(!valida(con(mala)), JSON.stringify(mala));
  });

  it("leerConfigAceptacion expone los textos del negocio (o null cuando no los configuró): nunca un texto por defecto", () => {
    const conf = (textos: Record<string, unknown>) => cfgDe(conTextos(textos), true);
    const completo = leerConfigAceptacion(conf({ aceptado: "A {pedido}", rechazado: "R {pedido}: {motivo}", cancelado: "C {pedido}: {motivo}" }));
    assert.deepEqual(completo?.textosDecision, { aceptado: "A {pedido}", rechazado: "R {pedido}: {motivo}", cancelado: "C {pedido}: {motivo}" });
    const vacio = leerConfigAceptacion(conf({}));
    assert.deepEqual(vacio?.textosDecision, { aceptado: null, rechazado: null, cancelado: null });
    assert.equal(vacio?.textoTrasAviso, "Respuesta de prueba", "la respuesta al 'sí' sigue siendo la de la 3B.5");
  });

  it("configurar los textos NO abre ni cierra la compuerta del cierre con aceptación humana: es una constante del código (abierta desde la 3B.9D), no de la configuración", () => {
    // Fixture: la compuerta de ANTES de la 3B.9D (cerrada). Con ella, la misma configuración no era utilizable.
    const CERRADA = { ...FUNCIONES_3B_IMPLEMENTADAS, cierre_aceptacion_humana: false };
    const opciones = (resolverCheckoutOpciones(conTextos({ aceptado: "A {pedido}" })) as { opciones: CheckoutOpciones }).opciones;
    assert.ok(funcionesNoDisponibles(opciones, CERRADA).includes("cierre_aceptacion_humana"));
    assert.ok(!funcionesNoDisponibles(opciones).includes("cierre_aceptacion_humana"), "con la compuerta REAL el cierre ya no bloquea");
    const r = parseAgentConfig(fila(A, PN_A, conTextos({ aceptado: "A {pedido}" }), AGENT_TOOL_NAMES, { checkout_conversacional: true }), { tenantId: A.tenantId, phoneNumberId: PN_A }, { funciones3b: CERRADA });
    assert.notEqual(r.kind, "ok", "con la compuerta de antes la configuración no era utilizable");
  });

  it("textoDeEnvio: el texto del negocio o null (entonces rige el mensaje neutro de siempre)", () => {
    assert.equal(textoDeEnvio(undefined, "sin_cobertura"), null);
    assert.equal(textoDeEnvio(null, "error_consulta"), null);
    assert.equal(textoDeEnvio(REGLAS, "sin_cobertura"), null);
    assert.equal(textoDeEnvio(REGLAS_CON_TEXTOS, "sin_cobertura"), T_SIN_COBERTURA);
    assert.equal(textoDeEnvio(REGLAS_CON_TEXTOS, "cobertura_no_verificable"), T_NO_VERIFICABLE);
    assert.equal(textoDeEnvio(REGLAS_CON_TEXTOS, "error_consulta"), T_ERROR);
  });
});

// ===========================================================================
// 3. Envíos (3B.6): textos del negocio, decisión del backend (J, K, L, M, N)
// ===========================================================================

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" };
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" };
const D: CatalogActor = { tenantId: "dddddddd-0000-4000-8000-00000000000d", userId: "admin-d" };
const PN_A = "100000000000001";
const PN_B = "100000000000002";
const PN_D = "100000000000004";
const CLIENTE = "573001112233";
const OTRO = "573009998877";
const TODAS: Record<FuncionFase3B, boolean> = Object.fromEntries(FUNCIONES_FASE_3B.map((f) => [f, true])) as Record<FuncionFase3B, boolean>;

const T_SIN_COBERTURA = "Por ahora no tenemos cobertura de envío a esa ciudad (texto de prueba del negocio).";
const T_NO_VERIFICABLE = "No tengo confirmado el envío a esa ciudad: una persona del equipo te lo confirma (texto de prueba del negocio).";
const T_ERROR = "Tuvimos un inconveniente técnico al revisar tu envío; escríbenos de nuevo en un momento (texto de prueba del negocio).";
const TEXTO_BOGOTA = "En Bogotá la entrega depende del día y de la transportadora.";
const TEXTO_RESTO = "Normalmente de 2 a 3 días hábiles, según la ciudad y la transportadora.";
const REGLAS: EnviosConfig = {
  cobertura: { tipo: "todo_el_pais_salvo", excluidas: ["san andres"] },
  tiempos: [
    { ciudades: ["bogota"], texto: TEXTO_BOGOTA },
    { ciudades: "resto_con_cobertura", texto: TEXTO_RESTO, dias_habiles: { min: 2, max: 3 } },
  ],
  sin_certeza: "handoff",
  ciudad_desconocida_en_checkout: "handoff",
  envio_gratis: true,
};
const REGLAS_CON_TEXTOS: EnviosConfig = { ...REGLAS, textos: { sin_cobertura: T_SIN_COBERTURA, cobertura_no_verificable: T_NO_VERIFICABLE, error_consulta: T_ERROR } };
/** Otro negocio: lista blanca (una ciudad conocida que no listó es "no verificable") y SUS textos. */
const REGLAS_B: EnviosConfig = {
  cobertura: { tipo: "lista_blanca", ciudades: ["bogota", "medellin"] },
  tiempos: [{ ciudades: "resto_con_cobertura", texto: "De 5 a 7 días hábiles.", dias_habiles: { min: 5, max: 7 } }],
  sin_certeza: "handoff",
  ciudad_desconocida_en_checkout: "handoff",
  textos: { sin_cobertura: "[B] sin cobertura", cobertura_no_verificable: "[B] lo confirma una persona", error_consulta: "[B] error técnico" },
};

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let engine: ReturnType<typeof createOrderEngine>;
let stateStore: ConversationStateStore;
let pausas: Array<{ waId: string; motivo: string }>;
let pausaFalla: boolean;
let sent: string[];
let history: Map<string, HistoryRow[]>;
let reloj: number;
let seq: number;

beforeEach(() => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  reloj = Date.parse("2026-10-02T09:15:00-05:00");
  pedidos = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => reloj });
  stateStore = createMemoryConversationStateStore();
  pausas = [];
  pausaFalla = false;
  sent = [];
  history = new Map();
  seq = 0;
  engine = createOrderEngine({
    orders: pedidos,
    catalog: mem.repo,
    key: Buffer.alloc(32, 8),
    sink: memoryOrderEventSink(),
    log: () => {},
    now: () => new Date(reloj),
    handoff: {
      async pauseConversation({ contact, reason }) {
        if (pausaFalla) return { ok: false };
        pausas.push({ waId: contact.waId, motivo: reason });
        return { ok: true };
      },
    },
  });
  for (const actor of [A, B, D]) {
    mem.setProfile(actor.tenantId, { name: "Tienda", whatsapp: "573001110000" });
    mem.enableModule(actor.tenantId);
  }
});

// Delacour HOY: sin el motor de envíos y sin las herramientas comerciales del CMS (Bloque 29: se le habilitan al activar, no antes).
const TOOLS_DELACOUR: AgentToolName[] = AGENT_TOOL_NAMES.filter((t) => t !== "consultar_envio" && !esHerramientaComercial(t));
function fila(tenant: CatalogActor, pn: string, opciones: unknown, herramientas: readonly AgentToolName[] = AGENT_TOOL_NAMES, extra: Partial<AgentConfigRow> = {}): AgentConfigRow {
  return {
    id_tenant: tenant.tenantId,
    phone_number_id: pn,
    tipo: "catalog_sales",
    habilitado: true,
    proveedor: "gemini",
    modelo: "gemini-3.6-flash",
    credencial_ref: "env:GEMINI_KEY_PRUEBA",
    nivel_razonamiento: "low",
    herramientas: [...herramientas],
    canal: "retail",
    negocio: { nombre_negocio: "Tienda Ficticia" },
    clasificacion_cliente: false,
    checkout_conversacional: false,
    vocabulario: null,
    checkout_opciones: opciones,
    meta_token_plataforma: false,
    ...extra,
  };
}
function cfg(row: AgentConfigRow, opts: { funciones3b?: Record<FuncionFase3B, boolean> } = {}): AgentRuntimeConfig {
  const r = parseAgentConfig(row, { tenantId: row.id_tenant, phoneNumberId: row.phone_number_id }, opts);
  assert.equal(r.kind, "ok", JSON.stringify(r));
  return (r as { config: AgentRuntimeConfig }).config;
}
const cfgDe = (opciones: unknown, checkout = false) => cfg(fila(A, PN_A, opciones, AGENT_TOOL_NAMES, { checkout_conversacional: checkout }), { funciones3b: TODAS });
const opcionesEnvios = (envios: EnviosConfig) => ({ entregas: ["domicilio"], pagos: [{ metodo: "contra_entrega" }], envios });
const cfgA = (envios: EnviosConfig = REGLAS_CON_TEXTOS) => cfg(fila(A, PN_A, opcionesEnvios(envios)));
const cfgB = () => cfg(fila(B, PN_B, opcionesEnvios(REGLAS_B)));
const cfgDelacour = () => cfg(fila(D, PN_D, CHECKOUT_OPCIONES_LEGADO, TOOLS_DELACOUR));

function toolDeps(over: Partial<AgentToolsDeps> = {}): AgentToolsDeps {
  return {
    engine,
    catalog: mem.repo,
    ownsPhoneNumber: async (t, pn) => [[A.tenantId, PN_A], [B.tenantId, PN_B], [D.tenantId, PN_D]].some(([x, y]) => x === t && y === pn),
    customerName: async () => null,
    rememberCustomerName: async () => {},
    siteUrl: () => "https://dulabs.test",
    ...over,
  };
}

async function turno(config: AgentRuntimeConfig, script: SimulatedStep[], text: string, opts: { waId?: string; buttonId?: string } = {}) {
  const provider = createSimulatedProvider(script);
  const waId = opts.waId ?? CLIENTE;
  const wamid = `wamid.in.${++seq}`;
  const h = history.get(waId + config.phoneNumberId) ?? [];
  history.set(waId + config.phoneNumberId, h);
  h.push({ direccion: "entrante", contenido: text, origen: "entrante", wamid });
  const r = await runAgentTurn(
    {
      config,
      provider,
      model: "gemini-3.6-flash",
      tools: toolDeps(),
      state: stateStore,
      history: { recent: async () => h.map((x) => ({ ...x })) },
      classification: createMemoryCustomerChannelStore({ [PN_A]: A.tenantId, [PN_B]: B.tenantId, [PN_D]: D.tenantId }),
      sender: {
        async sendText(t) {
          sent.push(t);
          h.push({ direccion: "saliente", contenido: t, origen: "ia", wamid: `wamid.out.${++seq}` });
          return { sent: true, wamid: `wamid.out.${seq}` };
        },
        async sendImage() {
          return { sent: true, wamid: `wamid.img.${++seq}` };
        },
        async sendButtons(body) {
          sent.push(body);
          return { sent: true, wamid: `wamid.btn.${++seq}` };
        },
        async sendList(body) {
          sent.push(body);
          return { sent: true, wamid: `wamid.list.${++seq}` };
        },
        humanTookOver: async () => false,
      },
      log: () => {},
      now: () => reloj,
      retry: { sleep: async () => {}, random: () => 0 },
    },
    { tenantId: config.tenantId, phoneNumberId: config.phoneNumberId, waId, wamid, text, buttonId: opts.buttonId ?? null },
  );
  return { ...r, provider };
}
const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });

describe("3B.8 · envíos: cada situación con su texto; el backend decide, el modelo no redacta (J, K, L, M, N)", () => {
  it("J) cobertura DESCONOCIDA (ciudad que nadie reconoce): traspaso a una persona con el texto 'no verificable' del negocio; el modelo no escribe nada y NO se afirma que no haya cobertura", async () => {
    const r = await turno(cfgA(), [call("consultar_envio", { city: "Villa Imaginaria" }), { text: "A esa ciudad no llegamos" }], "¿envían a Villa Imaginaria?");
    assert.equal(r.outcome, "handoff");
    assert.deepEqual(sent, [T_NO_VERIFICABLE]);
    assert.equal(r.provider.remaining(), 1, "el modelo no llegó a redactar nada tras la consulta");
    assert.equal(r.trace.shipping?.status, "unknown_city");
    assert.deepEqual(r.trace.handoff, { source: "system", motive: "payment_or_delivery" });
    assert.equal(pausas.length, 1);
    assert.ok(!/no (llegamos|enviamos|cubrimos|tenemos cobertura)/i.test(sent[0]), "una duda no se presenta como 'no hay cobertura'");
  });

  it("J) cobertura sin verificar de una ciudad CONOCIDA (fuera de la lista blanca): también el texto 'no verificable', nunca el de 'sin cobertura'", async () => {
    const r = await turno(cfgA({ ...REGLAS_B, textos: { sin_cobertura: T_SIN_COBERTURA, cobertura_no_verificable: T_NO_VERIFICABLE, error_consulta: T_ERROR } }), [call("consultar_envio", { city: "Cali" }), { text: "Sí llegamos" }], "¿envían a Cali?");
    assert.equal(r.trace.shipping?.status, "coverage_unverified");
    assert.deepEqual(sent, [T_NO_VERIFICABLE]);
    assert.notEqual(sent[0], T_SIN_COBERTURA);
    assert.equal(pausas.length, 1);
  });

  it("J) sin el texto configurado: el mensaje neutro de siempre (3B.6 sin cambios) y nunca el texto de otro negocio", async () => {
    const r = await turno(cfgA(REGLAS), [call("consultar_envio", { city: "Villa Imaginaria" }), { text: "A esa ciudad llega mañana" }], "¿envían a Villa Imaginaria?");
    assert.equal(r.outcome, "handoff");
    assert.deepEqual(sent, [FALLBACK_MESSAGES.handoff]);
    assert.ok(![T_NO_VERIFICABLE, T_SIN_COBERTURA, T_ERROR, "[B] lo confirma una persona"].includes(sent[0]));
  });

  it("K) FUERA de cobertura EXPLÍCITA (excluida por el negocio): responde el BACKEND con el texto 'sin cobertura', tal cual; no hay traspaso ni texto del modelo", async () => {
    const r = await turno(cfgA(), [call("consultar_envio", { city: "San Andrés" }), { text: "MODELO: te lo mando igual en 1 día" }], "¿envían a San Andrés?");
    assert.equal(r.outcome, "replied");
    assert.deepEqual(sent, [T_SIN_COBERTURA]);
    assert.equal(r.provider.remaining(), 1, "el modelo no redactó la respuesta");
    assert.equal(r.trace.shipping?.status, "not_covered");
    assert.equal(r.trace.shipping?.handoff, false);
    assert.equal(pausas.length, 0, "excluida explícitamente no es una duda: no se pasa a una persona");
    assert.ok(!/persona|confirm/i.test(sent[0]), "no se mezcla con 'una persona lo confirma'");
  });

  it("K) sin el texto configurado, la 3B.6 queda EXACTAMENTE igual: el modelo lo dice (respaldado) y el guardián frena lo inventado", async () => {
    const r = await turno(cfgA(REGLAS), [call("consultar_envio", { city: "San Andrés" }), { text: "Por ahora no tenemos cobertura para San Andrés 🙏" }], "¿envían a San Andrés?");
    assert.equal(r.outcome, "replied");
    assert.deepEqual(sent, ["Por ahora no tenemos cobertura para San Andrés 🙏"]);
    sent.length = 0;
    const inventa = await turno(cfgA(REGLAS), [call("consultar_envio", { city: "San Andrés" }), { text: "No tenemos cobertura, pero te llega en 1 día" }, { text: "Por ahora no tenemos cobertura para San Andrés 🙏" }], "¿envían a San Andrés?", { waId: OTRO });
    assert.equal(inventa.trace.grounding.corrected, true);
    assert.deepEqual(sent, ["Por ahora no tenemos cobertura para San Andrés 🙏"]);
  });

  it("L) ERROR técnico (no se pudo avisar a una persona): el texto 'error' del negocio, distinto de los otros dos; sin texto, el mensaje técnico de siempre", async () => {
    pausaFalla = true;
    const r = await turno(cfgA(), [call("consultar_envio", { city: "Villa Imaginaria" }), { text: "Seguro llegamos" }], "¿envían a Villa Imaginaria?");
    assert.equal(r.trace.error_kind, "shipping_handoff_failed");
    assert.deepEqual(sent, [T_ERROR]);
    assert.notEqual(sent[0], T_NO_VERIFICABLE);
    assert.notEqual(sent[0], T_SIN_COBERTURA);
    assert.equal(pausas.length, 0);
    sent.length = 0;
    const sin = await turno(cfgA(REGLAS), [call("consultar_envio", { city: "Villa Imaginaria" }), { text: "Seguro llegamos" }], "¿envían a Villa Imaginaria?", { waId: OTRO });
    assert.equal(sin.trace.error_kind, "shipping_handoff_failed");
    assert.deepEqual(sent, [FALLBACK_MESSAGES.technical]);
  });

  it("L) error de la herramienta (argumento inválido): no produce ningún hecho de envío y lo que el modelo invente no sale; termina en una persona con el texto del negocio", async () => {
    const r = await turno(cfgA(), [call("consultar_envio", { city: "x".repeat(200) }), { text: "Llega en 2 días" }, { text: "Llega en 2 días, seguro" }], "¿cuánto demora?");
    assert.equal(r.trace.tool_calls[0].result, "INVALID_INPUT");
    assert.equal(r.trace.shipping ?? null, null);
    assert.equal(r.outcome, "handoff");
    assert.deepEqual(sent, [T_NO_VERIFICABLE]);
    assert.ok(!sent.some((t) => /2 días/.test(t)));
  });

  it("M) el modelo INVENTA un tiempo tras consultar (insiste aun después de corregirlo): NADA de lo inventado sale; una persona y el texto del negocio", async () => {
    const r = await turno(cfgA(), [call("consultar_envio", { city: "Cali" }), { text: "Te llega mañana sin falta" }, { text: "Mañana mismo, te lo garantizo" }], "¿cuánto demora a Cali?");
    assert.equal(r.outcome, "handoff");
    assert.deepEqual(sent, [T_NO_VERIFICABLE]);
    assert.ok(r.trace.grounding.violations.includes("shipping"));
    assert.ok(!sent.some((t) => /mañana|garantizo/i.test(t)));
    assert.equal(pausas.length, 1);
  });

  it("M) lo respaldado SÍ sale: el rango de días hábiles del negocio, repetido por el modelo, no se bloquea", async () => {
    const r = await turno(cfgA(), [call("consultar_envio", { city: "Cali" }), { text: TEXTO_RESTO }], "¿cuánto demora a Cali?");
    assert.equal(r.outcome, "replied");
    assert.deepEqual(sent, [TEXTO_RESTO]);
  });

  it("N) el modelo intenta SALTARSE el traspaso: tras una consulta no verificable el backend corta ahí; el modelo no puede responder ni evitar el traspaso", async () => {
    const r = await turno(cfgA(), [call("consultar_envio", { city: "Villa Imaginaria" }), { text: "No hay problema, llegamos a todas partes en 2 días" }], "¿envían a Villa Imaginaria?");
    assert.equal(r.provider.remaining(), 1);
    assert.deepEqual(sent, [T_NO_VERIFICABLE]);
    assert.equal(pausas.length, 1);
    assert.deepEqual(r.trace.handoff, { source: "system", motive: "payment_or_delivery" });
  });

  it("N) y sin consultar nada: afirma cobertura, tiempo y transportadora sin respaldo => se corrige una vez; si insiste, el traspaso lo decide el backend y sale el texto del negocio", async () => {
    const r = await turno(cfgA(), [{ text: "¡Claro! Enviamos a todo el país y llega mañana por Servientrega, sin costo 😊" }, { text: "Te llega mañana, te lo garantizo 😊" }], "¿envían a Cali y cuánto demora?");
    assert.equal(r.outcome, "handoff");
    assert.deepEqual(sent, [T_NO_VERIFICABLE]);
    assert.ok(!sent.some((t) => /mañana|servientrega|garantizo/i.test(t)));
    assert.equal(pausas.length, 1);
  });

  it("I) cada negocio con SUS textos: el cliente de ASLC nunca recibe los de otro negocio y viceversa", async () => {
    const a = await turno(cfgA(), [call("consultar_envio", { city: "Villa Imaginaria" })], "¿envían a Villa Imaginaria?", { waId: CLIENTE });
    const b = await turno(cfgB(), [call("consultar_envio", { city: "Villa Imaginaria" })], "¿envían a Villa Imaginaria?", { waId: OTRO });
    assert.equal(a.outcome, "handoff");
    assert.equal(b.outcome, "handoff");
    assert.deepEqual(sent, [T_NO_VERIFICABLE, "[B] lo confirma una persona"]);
    const bExplicita = await turno(cfg(fila(B, PN_B, opcionesEnvios({ ...REGLAS_B, cobertura: { tipo: "todo_el_pais_salvo", excluidas: ["san andres"] } }))), [call("consultar_envio", { city: "San Andrés" })], "¿envían a San Andrés?", { waId: `${OTRO}1` });
    assert.equal(bExplicita.trace.shipping?.status, "not_covered");
    assert.equal(sent.at(-1), "[B] sin cobertura");
    assert.ok(!sent.some((t, i) => i > 0 && t.includes("texto de prueba del negocio")), "ninguno de los textos de ASLC llegó a otro negocio");
  });

  it("I) Delacour (sin reglas de envío ni herramienta) queda EXACTAMENTE igual: su configuración no trae textos de envío y nada cambia", async () => {
    const c = cfgDelacour();
    assert.equal(c.checkoutOptions?.envios, undefined);
    for (const clave of CLAVES_TEXTO_ENVIO) assert.equal(textoDeEnvio(c.checkoutOptions?.envios, clave), null);
    const r = await turno(c, [{ text: "Hola, ¿en qué te ayudo?" }], "hola");
    assert.equal(r.outcome, "replied");
    assert.deepEqual(sent, ["Hola, ¿en qué te ayudo?"]);
  });
});

// ===========================================================================
// Checkout (3B.4/3B.6): la ciudad sin certeza usa el texto del negocio
// ===========================================================================

describe("3B.8 · checkout: ciudad sin certeza de cobertura", () => {
  const OPCIONES_CHECKOUT = (envios: EnviosConfig) => ({
    ...OPCIONES_CIERRE,
    cierre: CIERRE_BASE,
    envios: { ...envios, texto_resumen: "Envío gratis (texto del negocio)" },
  });
  const cfgCheckout = (envios: EnviosConfig) => cfg(fila(A, PN_A, OPCIONES_CHECKOUT(envios), AGENT_TOOL_NAMES, { checkout_conversacional: true }), { funciones3b: TODAS });
  async function hastaCiudad(config: AgentRuntimeConfig, waId: string, ref: string) {
    await turno(config, [call("update_cart", { items: [{ reference: ref, quantity: 1 }] }), { text: "Listo, lo agregué." }], `quiero 1 ${ref}`, { waId });
    await turno(config, [call("create_order_request"), { text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "me lo llevo", { waId });
    await turno(config, [], "Laura Gómez", { waId });
    await turno(config, [], ACEPTACION_BUTTONS.phone[0].title, { waId, buttonId: ACEPTACION_BUTTONS.phone[0].id });
  }

  it("con texto del negocio, la ciudad que no se puede verificar recibe ESE texto (y pasa a una persona); sin él, el mensaje neutro del checkout", async () => {
    const p = await admin.createProduct(A, { name: "Ventilador", retailPrice: 150_000, stock: 5 });
    const con = cfgCheckout(REGLAS_CON_TEXTOS);
    await hastaCiudad(con, CLIENTE, p.reference);
    sent.length = 0;
    await turno(con, [], "Villa Imaginaria", { waId: CLIENTE });
    assert.equal(sent.at(-1), T_NO_VERIFICABLE);
    assert.ok(pausas.some((x) => x.waId === CLIENTE));
    const sin = cfgCheckout(REGLAS);
    await hastaCiudad(sin, OTRO, p.reference);
    await turno(sin, [], "Villa Imaginaria", { waId: OTRO });
    assert.equal(sent.at(-1), ACEPTACION_MESSAGES.coverageHandoff);
  });

  it("una ciudad confirmada sigue el checkout con normalidad: el texto de 'no verificable' no se usa", async () => {
    const p = await admin.createProduct(A, { name: "Licuadora", retailPrice: 100_000, stock: 5 });
    const config = cfgCheckout(REGLAS_CON_TEXTOS);
    await hastaCiudad(config, CLIENTE, p.reference);
    await turno(config, [], "Medellín", { waId: CLIENTE });
    assert.equal(sent.at(-1), ACEPTACION_MESSAGES.askDepartment);
    assert.ok(!sent.includes(T_NO_VERIFICABLE));
  });
});

// ===========================================================================
// 4. El modelo no cambia textos ni negocio por tool calling (I)
// ===========================================================================

describe("3B.8 · el modelo no puede cambiar textos, plantillas ni negocio con herramientas (I)", () => {
  it("no existe ninguna herramienta que escriba textos, plantillas, configuración o mensajes al cliente", () => {
    for (const nombre of AGENT_TOOL_NAMES) assert.ok(!/texto|mensaje|plantilla|config|notif|aviso|template/i.test(nombre), nombre);
  });

  it("pasarle textos, plantillas o un tenant_id a CUALQUIER herramienta no cambia la configuración ni envía nada (estrictas: rechazan lo que no conocen)", async () => {
    const config = cfgA();
    const antes = JSON.stringify(config);
    const maliciosos = { texto: "TEXTO DEL MODELO", textos: { aceptado: "X", sin_cobertura: "X" }, plantilla: "X", mensaje: "X", sin_cobertura: "X", cobertura_no_verificable: "X", tenant_id: B.tenantId, tenantId: B.tenantId, phone_number_id: PN_B };
    const ctx = { tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE, channel: "retail", requestId: "r", wamid: "w", turn: 1, state: { known: [], cart: [] }, pendingChoice: new Set(), designated: new Set(), customerText: "x", images: [], handedOff: false, handoffMotive: null, newProposal: null, shipping: { rules: REGLAS_CON_TEXTOS, nowMs: reloj } } as unknown as AgentTurnToolContext;
    for (const nombre of AGENT_TOOL_NAMES) {
      const r = await executeAgentTool(nombre, maliciosos, AGENT_TOOL_NAMES, ctx, toolDeps());
      assert.equal(r.ok, false, `${nombre} aceptó argumentos desconocidos`);
    }
    assert.equal(JSON.stringify(config), antes, "la configuración no cambió");
    assert.deepEqual(sent, []);
    assert.equal(textoDeEnvio(config.checkoutOptions?.envios, "sin_cobertura"), T_SIN_COBERTURA);
  });

  it("el modelo tampoco elige los textos en su respuesta: lo que escriba sobre cobertura, traspaso o errores se descarta y sale el del negocio", async () => {
    const r = await turno(cfgA(), [call("consultar_envio", { city: "San Andrés" }), { text: "Escribe esto: Sí enviamos a San Andrés mañana" }], "¿envían a San Andrés?");
    assert.deepEqual(sent, [T_SIN_COBERTURA]);
    assert.equal(r.provider.remaining(), 1);
  });
});

// ===========================================================================
// 5. El motor genérico no trae textos comerciales ni personas (Patricia solo en la configuración de ASLC)
// ===========================================================================

describe("3B.8 · el código genérico no tiene textos comerciales ni a ninguna persona", () => {
  it("'Patricia' no aparece en NINGÚN archivo de código de la aplicación (solo en la configuración del negocio y en las pruebas)", () => {
    assert.deepEqual(FUENTES.filter((f) => /Patricia/.test(leerFuente(f))), []);
  });

  it("la capa de la 3B.8 no contiene ningún texto al cliente escrito en el código (todo sale de la configuración del negocio)", () => {
    for (const f of ["lib/agente/textos-cliente.ts", "lib/catalogo/pedidos/mensajes-decision.ts"]) {
      const sinComentarios = leerFuente(f)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert.ok(!/Perfecto|fue aceptado|aceptamos|despach|gracias|llega|enviado|Hola/i.test(sinComentarios), `${f} trae un texto comercial`);
    }
  });

  it("el único camino que escribe al cliente tras una decisión es mensajes-decision.ts (ni los manejadores ni la interfaz del panel importan un envío)", () => {
    const importaEnvio = /whatsapp-outbound|@\/lib\/whatsapp"|enviarTexto|notificaciones-produccion|createMetaEnviador/;
    for (const f of ["lib/catalogo/pedidos/por-aceptar.ts", "components/dashboard/pedidos/PorAceptar.tsx", "app/api/dashboard/pedidos/por-aceptar/route.ts", "app/api/dashboard/pedidos/[pedido]/aceptacion/route.ts"]) assert.ok(!importaEnvio.test(leerFuente(f)), f);
    const quienImporta = FUENTES.filter((f) => /from\s+"[^"]*mensajes-decision"/.test(leerFuente(f)));
    assert.deepEqual(quienImporta, ["lib/catalogo/pedidos/por-aceptar-produccion.ts"]);
  });
});
