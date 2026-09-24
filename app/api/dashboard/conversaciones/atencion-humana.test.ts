/**
 * Bloque 17 — el Inbox le dice a la asesora POR QUÉ recibió la conversación, y tomarla detiene
 * al agente. Rutas REALES (lista e handoff) + cableado de PRODUCCIÓN del agente (pausa, estado,
 * trazas) contra un Supabase EN MEMORIA (lib/testing/supabase-rest-memoria.ts): nada toca
 * Supabase real ni Meta. Gemini SIMULADO.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { GET as listaGET } from "./route";
import { POST as handoffPOST } from "./handoff/route";
import { supabaseAdmin } from "@/lib/supabase";
import { chatEnPausaHumana } from "@/lib/pausas-chat";
import { contactRef } from "@/lib/catalogo/pedidos/log";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { supabaseHandoffPort } from "@/lib/catalogo/pedidos/produccion";
import { createSimulatedProvider } from "@/lib/ia-proveedores/simulado";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { createMemoryConversationStateStore } from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn } from "@/lib/agente/runtime";
import { createSupabaseTraceSink, turnRecord } from "@/lib/agente/trazas";
import { INTENCIONES, MOTIVOS_ASESORA, atencionHumanaDe, motivoLegible } from "@/lib/agente/atencion-humana";
import { HANDOFF_MOTIVES } from "@/lib/agente/intencion";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

const TA = "aaaaaaaa-0000-4000-8000-00000000000a";
const TB = "bbbbbbbb-0000-4000-8000-00000000000b";
const PN_A = "100000000000001";
const PN_B = "100000000000002";
const WA = "573001112233";
const DIA = 86_400_000;

let db: SupabaseMemoria;
const ahora = () => new Date().toISOString();

beforeEach(() => {
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  const conFecha = () => ({ created_at: ahora() });
  db.table("dulabs_miembros_equipo").push(
    { id: 1, tenant_id: TA, user_id: "u-admin-a", rol: "admin", estado: "activo", email: "admin@a.test", nombre: "Ana" },
    { id: 2, tenant_id: TA, user_id: "u-agente-a", rol: "agente", estado: "activo", email: "agente@a.test", nombre: "Bea" },
    { id: 3, tenant_id: TA, user_id: "u-lectura-a", rol: "lectura", estado: "activo", email: "lectura@a.test", nombre: "Caro" },
    { id: 4, tenant_id: TB, user_id: "u-agente-b", rol: "agente", estado: "activo", email: "agente@b.test", nombre: "Dani" },
  );
  for (const [token, id] of [["t-admin-a", "u-admin-a"], ["t-agente-a", "u-agente-a"], ["t-lectura-a", "u-lectura-a"], ["t-agente-b", "u-agente-b"], ["t-sin-equipo", "u-nadie"]]) db.user(token, id);
  db.table("dulabs_clientes_config").push(
    { phone_number_id: PN_A, id_tenant: TA, nombre_negocio: "Joyería A" },
    { phone_number_id: PN_B, id_tenant: TB, nombre_negocio: "Joyería B" },
  );
  db.table("dulabs_mensajes_log", { identity: "id", defaults: conFecha }).push(
    { id: 1, phone_number_id: PN_A, telefono_cliente: WA, direccion: "entrante", contenido: "Quiero hablar con una asesora", created_at: ahora() },
    { id: 2, phone_number_id: PN_B, telefono_cliente: WA, direccion: "entrante", contenido: "hola", created_at: ahora() },
  );
  db.table("dulabs_pausas_chat", { identity: "id", unique: [["phone_number_id", "telefono_cliente"]] });
  db.table("dulabs_conversacion_asignaciones", { identity: "id", unique: [["phone_number_id", "telefono_cliente"]] });
  db.table("dulabs_conversacion_eventos", { identity: "id", defaults: conFecha });
  db.table("dulabs_conversacion_estado", { identity: "id", unique: [["phone_number_id", "telefono_cliente"]] });
  db.table("dulabs_etiquetas");
  db.table("dulabs_conversacion_etiquetas");
  db.table("dulabs_agente_trazas", { identity: "id", defaults: conFecha });
});
afterEach(() => db.uninstall());

const lista = (token?: string) =>
  listaGET(new NextRequest("http://localhost/api/dashboard/conversaciones", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
const handoff = (token: string | undefined, body: Record<string, unknown>) =>
  handoffPOST(
    new NextRequest("http://localhost/api/dashboard/conversaciones/handoff", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );
type Fila = { phone_number_id: string; telefono_cliente: string; pausado: boolean; estado: string; asignado_a: unknown; atencion_humana: Record<string, unknown> | null };
async function conversacion(token: string, pn = PN_A): Promise<Fila | undefined> {
  const r = await lista(token);
  assert.equal(r.status, 200);
  const body = (await r.json()) as { conversaciones: Fila[] };
  return body.conversaciones.find((c) => c.phone_number_id === pn && c.telefono_cliente === WA);
}

// ---------------------------------------------------------------- agente con el cableado de producción
const configRow: AgentConfigRow = {
  id_tenant: TA,
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
};
const config = (parseAgentConfig(configRow, { tenantId: TA, phoneNumberId: PN_A }) as { config: AgentRuntimeConfig }).config;
const estadoAgente = createMemoryConversationStateStore();
let seq = 0;

/** Un turno del agente como en producción: pausa/estado/trazas en "Supabase", la barrera humana lee la misma pausa. */
async function turnoAgente(text: string, reply = "Claro, ¿qué buscas?") {
  const supabase = supabaseAdmin();
  const mem = createInMemoryCatalogRepository();
  mem.enableModule(TA);
  const engine = createOrderEngine({ orders: createMemoryOrdersRepository(), catalog: mem.repo, key: Buffer.alloc(32, 6), log: () => {}, handoff: supabaseHandoffPort(supabase) });
  const provider = createSimulatedProvider([{ text: reply }]);
  const sent: string[] = [];
  const r = await runAgentTurn(
    {
      config,
      provider,
      model: "gemini-3.6-flash",
      tools: { engine, catalog: mem.repo, log: () => {}, ownsPhoneNumber: async () => true },
      state: estadoAgente,
      history: { recent: async () => [] },
      sender: { sendText: async (t) => (sent.push(t), true), sendImage: async () => true, humanTookOver: () => chatEnPausaHumana(supabase, PN_A, WA) },
    },
    { tenantId: TA, phoneNumberId: PN_A, waId: WA, wamid: `wamid.b17.${++seq}`, text },
  );
  await createSupabaseTraceSink(supabase).record(turnRecord(r.trace, PN_A));
  return { ...r, provider, sent };
}

const pausaDe = (pn = PN_A) => db.rows("dulabs_pausas_chat").find((p) => p.phone_number_id === pn && p.telefono_cliente === WA);
const diasDePausa = () => (new Date(String(pausaDe()?.pausado_hasta)).getTime() - Date.now()) / DIA;
const estadoDe = () => db.rows("dulabs_conversacion_estado").find((e) => e.phone_number_id === PN_A && e.telefono_cliente === WA)?.estado;

describe("el Inbox muestra por qué la conversación pasó a una asesora", () => {
  it("'Quiero hablar con una asesora' => Atención humana con un motivo claro (sin datos técnicos)", async () => {
    const r = await turnoAgente("Quiero hablar con una asesora");
    assert.equal(r.outcome, "handoff");
    assert.equal(r.provider.requests.length, 0, "sin llamar a Gemini");
    assert.ok(diasDePausa() > 0.9 && diasDePausa() < 1.1, "pausa de 24 h");
    assert.equal(estadoDe(), "pending");

    const c = await conversacion("t-agente-a");
    assert.equal(c?.pausado, true);
    assert.equal(c?.estado, "pending");
    assert.deepEqual(Object.keys(c!.atencion_humana!).sort(), ["desde", "motivo", "origen", "pedido", "texto"]);
    assert.equal(c!.atencion_humana!.texto, "El cliente pidió hablar con una asesora");
    assert.equal(c!.atencion_humana!.motivo, "cliente_pidio_asesora");
    assert.equal(c!.atencion_humana!.origen, "cliente");
    const json = JSON.stringify(c!.atencion_humana);
    for (const prohibido of [WA, contactRef(WA), TA, "customer_request", "handoff", "traza", "wamid"]) assert.ok(!json.includes(prohibido), `no expone ${prohibido}`);
  });

  it("motivo del asistente con el pedido PÚBLICO; nunca el texto libre ni un motivo fuera de la lista", async () => {
    db.rows("dulabs_pausas_chat").push({ id: 99, phone_number_id: PN_A, telefono_cliente: WA, pausado_hasta: new Date(Date.now() + DIA).toISOString() });
    db.rows("dulabs_agente_trazas").push({
      id: 1,
      id_tenant: TA,
      phone_number_id: PN_A,
      contact_ref: contactRef(WA),
      tipo: "turn",
      resultado: "handoff",
      created_at: ahora(),
      traza: { handoff: { source: "model", motive: "complaint" }, order_id: "DL-ORD-7K2M9Q", reason: "dijo que vive en la calle 45" },
    });
    const c = await conversacion("t-admin-a");
    assert.deepEqual({ ...c!.atencion_humana, desde: undefined }, { motivo: "reclamo", texto: "El cliente tiene un reclamo", origen: "asistente", pedido: "DL-ORD-7K2M9Q", desde: undefined });
    assert.ok(!JSON.stringify(c).includes("calle 45"));

    db.rows("dulabs_agente_trazas")[0].traza = { handoff: { source: "model", motive: "<img src=x>" }, order_id: "uuid-interno-1234" };
    const raro = await conversacion("t-admin-a");
    assert.equal(raro!.atencion_humana!.motivo, "sin_detalle");
    assert.equal(raro!.atencion_humana!.pedido, null, "un id que no es el público no se muestra");
  });

  it("una conversación sin traspaso, o que la IA atiende normalmente, no muestra nada", async () => {
    const r = await turnoAgente("hola");
    assert.equal(r.outcome, "replied");
    assert.equal((await conversacion("t-admin-a"))?.atencion_humana, null);
  });
});

describe("tomar la conversación: la IA queda detenida", () => {
  it("la asesora toma: pausa larga, asignada a ella, abierta, evento; Gemini ya no responde", async () => {
    await turnoAgente("Quiero hablar con una asesora");
    const r = await handoff("t-agente-a", { phone_number_id: PN_A, telefono_cliente: WA, accion: "tomar" });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { gano: boolean }).gano, true);
    assert.ok(diasDePausa() > 29, "30 días");
    assert.equal(estadoDe(), "open", "la atiende una persona");
    assert.deepEqual(db.rows("dulabs_conversacion_asignaciones").map((a) => a.miembro_id), [2]);
    assert.deepEqual(db.rows("dulabs_conversacion_eventos").map((e) => [e.tipo, e.miembro_id]), [["asignado", 2]]);
    const c = await conversacion("t-agente-a");
    assert.equal(c!.atencion_humana!.texto, "El cliente pidió hablar con una asesora", "el motivo sigue visible mientras la atiende");

    // El cliente escribe otra vez: el agente NO llama a Gemini ni envía nada.
    const despues = await turnoAgente("¿hola? ¿me ayudan?", "No debería salir");
    assert.equal(despues.outcome, "preempted");
    assert.equal(despues.provider.requests.length, 0);
    assert.deepEqual(despues.sent, []);
  });

  it("devolver a la IA: el motivo desaparece y el agente vuelve a responder", async () => {
    await turnoAgente("Quiero hablar con una asesora");
    await handoff("t-agente-a", { phone_number_id: PN_A, telefono_cliente: WA, accion: "tomar" });
    const r = await handoff("t-agente-a", { phone_number_id: PN_A, telefono_cliente: WA, accion: "devolver_a_ia" });
    assert.equal(r.status, 200);
    assert.equal((await conversacion("t-agente-a"))?.atencion_humana, null);
    const vuelve = await turnoAgente("busco aretes", "Tengo varias opciones.");
    assert.equal(vuelve.outcome, "replied");
  });
});

describe("concurrencia", () => {
  it("dos asesoras toman a la vez: una sola asignación y un solo evento", async () => {
    await turnoAgente("Quiero hablar con una asesora");
    const [r1, r2] = await Promise.all([
      handoff("t-admin-a", { phone_number_id: PN_A, telefono_cliente: WA, accion: "tomar" }),
      handoff("t-agente-a", { phone_number_id: PN_A, telefono_cliente: WA, accion: "tomar" }),
    ]);
    const ganadores = [(await r1.json()) as { gano: boolean }, (await r2.json()) as { gano: boolean }].filter((b) => b.gano);
    assert.equal(ganadores.length, 1);
    assert.equal(db.rows("dulabs_conversacion_asignaciones").length, 1);
    assert.equal(db.rows("dulabs_conversacion_eventos").filter((e) => e.tipo === "asignado").length, 1);
  });

  it("el agente pasa a asesora justo DESPUÉS de que una asesora tomó: no le acorta la pausa ni le cambia el estado", async () => {
    await handoff("t-agente-a", { phone_number_id: PN_A, telefono_cliente: WA, accion: "tomar" });
    db.rows("dulabs_conversacion_estado").push({ id: 50, phone_number_id: PN_A, telefono_cliente: WA, estado: "open", leido_hasta: new Date(0).toISOString() });
    // El agente ya había pasado su barrera (leyó "sin pausa") y ahora pausa: la carrera real.
    const pausa = await supabaseHandoffPort(supabaseAdmin()).pauseConversation({ tenantId: TA, contact: { phoneNumberId: PN_A, waId: WA }, reason: "x" });
    assert.deepEqual(pausa, { ok: true });
    assert.ok(diasDePausa() > 29, "sigue en 30 días");
    assert.equal(estadoDe(), "open");
  });

  it("y al revés (agente primero, asesora después): la pausa pasa a 30 días", async () => {
    await turnoAgente("Quiero hablar con una asesora");
    assert.ok(diasDePausa() < 1.1);
    await handoff("t-agente-a", { phone_number_id: PN_A, telefono_cliente: WA, accion: "tomar" });
    assert.ok(diasDePausa() > 29);
  });

  it("la pausa del agente se extiende si la anterior ya venció, y se crea si la liberaron", async () => {
    db.rows("dulabs_pausas_chat").push({ id: 7, phone_number_id: PN_A, telefono_cliente: WA, pausado_hasta: new Date(Date.now() - DIA).toISOString() });
    await supabaseHandoffPort(supabaseAdmin()).pauseConversation({ tenantId: TA, contact: { phoneNumberId: PN_A, waId: WA }, reason: "x" });
    assert.ok(diasDePausa() > 0.9);
    assert.equal(db.rows("dulabs_pausas_chat").length, 1);
  });
});

describe("seguridad del Inbox", () => {
  it("sin sesión, sesión inválida o sin equipo: no hay lista", async () => {
    assert.equal((await lista()).status, 401);
    assert.equal((await lista("t-falso")).status, 401);
    assert.equal((await lista("t-sin-equipo")).status, 403);
  });

  it("otro negocio: no ve la conversación, no puede tomarla y su traza no se mezcla", async () => {
    await turnoAgente("Quiero hablar con una asesora");
    // Una traza de OTRO negocio con el mismo número y el mismo cliente (no debería existir; prueba el filtro).
    db.rows("dulabs_agente_trazas").push({ id: 500, id_tenant: TB, phone_number_id: PN_A, contact_ref: contactRef(WA), tipo: "turn", resultado: "handoff", created_at: new Date(Date.now() + 1000).toISOString(), traza: { handoff: { source: "model", motive: "complaint" } } });

    assert.equal(await conversacion("t-agente-b", PN_A), undefined, "B no ve la conversación de A");
    const r = await handoff("t-agente-b", { phone_number_id: PN_A, telefono_cliente: WA, accion: "tomar" });
    assert.equal(r.status, 404);
    assert.ok(diasDePausa() < 1.1, "B no cambió la pausa de A");
    assert.equal(db.rows("dulabs_conversacion_asignaciones").length, 0);

    const c = await conversacion("t-admin-a");
    assert.equal(c!.atencion_humana!.motivo, "cliente_pidio_asesora", "A solo ve su traza");
    const consulta = db.requests.filter((q) => q.path === "/rest/v1/dulabs_agente_trazas" && q.method === "GET").at(-1)!;
    assert.equal(consulta.query.get("id_tenant"), `eq.${TA}`);
  });

  it("rol de lectura no puede tomar; faltan datos o acción inválida => 400", async () => {
    assert.equal((await handoff("t-lectura-a", { phone_number_id: PN_A, telefono_cliente: WA, accion: "tomar" })).status, 403);
    assert.equal((await handoff(undefined, { phone_number_id: PN_A, telefono_cliente: WA, accion: "tomar" })).status, 401);
    assert.equal((await handoff("t-agente-a", { phone_number_id: PN_A, accion: "tomar" })).status, 400);
    assert.equal((await handoff("t-agente-a", { phone_number_id: PN_A, telefono_cliente: WA, accion: "borrar" })).status, 400);
    assert.equal(pausaDe(), undefined);
  });
});

describe("migraciones aplicadas / no aplicadas", () => {
  it("sin la tabla de trazas: el Inbox funciona igual, sin motivo", async () => {
    await turnoAgente("Quiero hablar con una asesora");
    db.missing("dulabs_agente_trazas");
    const c = await conversacion("t-admin-a");
    assert.equal(c?.pausado, true);
    assert.equal(c?.atencion_humana, null);
  });

  it("sin la tabla de eventos: el motivo se muestra (manda la pausa)", async () => {
    await turnoAgente("Quiero hablar con una asesora");
    db.missing("dulabs_conversacion_eventos");
    assert.equal((await conversacion("t-admin-a"))!.atencion_humana!.motivo, "cliente_pidio_asesora");
  });

  it("sin la tabla de estado: tomar funciona (la pausa basta)", async () => {
    await turnoAgente("Quiero hablar con una asesora");
    db.missing("dulabs_conversacion_estado");
    assert.equal((await handoff("t-agente-a", { phone_number_id: PN_A, telefono_cliente: WA, accion: "tomar" })).status, 200);
    assert.ok(diasDePausa() > 29);
  });
});

describe("listas cerradas: motivos e intenciones", () => {
  it("cada motivo tiene un texto para una persona (sin jerga técnica) y lo desconocido cae en 'sin detalle'", () => {
    for (const m of [...HANDOFF_MOTIVES, "repeated_failures", "limit_contact_day", "limit_tenant_tokens_day"]) {
      const l = motivoLegible({ source: "model", motive: m });
      assert.notEqual(l.motivo, "sin_detalle", m);
      assert.doesNotMatch(l.texto, /handoff|motive|tool|modelo|gemini|token|traza|null/i, m);
    }
    assert.equal(motivoLegible({ source: "model", motive: "sin_detalle" }).motivo, "sin_detalle");
    assert.equal(motivoLegible({ motive: "__proto__" }).motivo, "sin_detalle");
    assert.equal(motivoLegible(null).origen, "asistente");
  });

  it("regla única de visibilidad", () => {
    const h = { at: "2026-09-24T10:00:00.000Z", handoff: { source: "customer", motive: "customer_request" }, orderId: null };
    assert.ok(atencionHumanaDe({ pausado: true, estado: "open", ultimoHandoff: h, liberadoEn: null }));
    assert.ok(atencionHumanaDe({ pausado: false, estado: "pending", ultimoHandoff: h, liberadoEn: null }), "pendiente aunque la pausa venció");
    assert.equal(atencionHumanaDe({ pausado: false, estado: "open", ultimoHandoff: h, liberadoEn: null }), null, "la IA la atiende");
    assert.equal(atencionHumanaDe({ pausado: true, estado: "closed", ultimoHandoff: h, liberadoEn: null }), null);
    assert.equal(atencionHumanaDe({ pausado: true, estado: "open", ultimoHandoff: h, liberadoEn: "2026-09-24T10:05:00.000Z" }), null, "devuelta a la IA después");
    assert.ok(atencionHumanaDe({ pausado: true, estado: "open", ultimoHandoff: h, liberadoEn: "2026-09-24T09:00:00.000Z" }), "un traspaso nuevo después de devolverla");
    assert.equal(atencionHumanaDe({ pausado: true, estado: "open", ultimoHandoff: null, liberadoEn: null }), null);
  });

  it("el diagnóstico SQL usa EXACTAMENTE las mismas listas", () => {
    const sql = readFileSync("supabase/migrations/20261115000000_dulabs_agente_diagnostico_intencion.sql", "utf8");
    const bloque = (desde: string, hasta: string) => sql.slice(sql.indexOf(desde), sql.indexOf(hasta, sql.indexOf(desde)));
    const pares = (texto: string) => Object.fromEntries([...texto.matchAll(/when '([a-z_]+)' then '([a-z_]+)'/g)].map((m) => [m[1], m[2]]));
    assert.deepEqual(pares(bloque("-- intenciones", "-- motivos")), { ...INTENCIONES });
    const motivosSql = pares(bloque("-- motivos", "case t.traza #>> '{handoff,source}'"));
    const motivosTs = Object.fromEntries(Object.entries(MOTIVOS_ASESORA).filter(([k]) => k !== "sin_detalle").map(([k, v]) => [k, v.codigo]));
    assert.deepEqual(motivosSql, motivosTs);
  });
});
