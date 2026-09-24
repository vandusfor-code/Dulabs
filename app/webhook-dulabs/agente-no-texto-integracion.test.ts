/**
 * Bloque 23 — el webhook REAL (registrarMensajesEntrantesSincrono + procesarCambio, el mismo
 * código que corre en producción) con mensajes SIN texto hacia el número del agente de la joyería:
 * Supabase EN MEMORIA (PostgREST emulado) y Meta simulado. Nada toca Supabase, Gemini ni Meta.
 *
 *   nota de voz  -> Inbox "[nota de voz]" + aviso fijo por WhatsApp, sin Gemini
 *   imagen       -> Inbox "[imagen] …" + traspaso a una asesora (chat en pausa), sin Gemini
 *   sticker      -> nada (ni Inbox ni respuesta)
 *   número SIN agente (cualquier otro negocio) -> exactamente como antes: nada
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";
process.env.META_ACCESS_TOKEN = "token-meta-de-prueba";
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");
// Referencia de credencial del agente: un valor FICTICIO (el modelo nunca se llama para estos mensajes).
process.env.GEMINI_KEY_PRUEBA_B23 = "clave-ficticia-no-real";

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { instalarMetaGraphMock } from "@/lib/testing/meta-graph-mock";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { NON_TEXT_MESSAGES } from "@/lib/agente/entrada";
import { procesarCambio, registrarMensajesEntrantesSincrono, type MetaChangeValue } from "./route";

const T = "aaaaaaaa-0000-4000-8000-0000000000b2";
const PN = "100000000000923";
const PN_OTRO = "100000000000924";
const CLIENTE = "573001112233";

let db: SupabaseMemoria;
let meta: ReturnType<typeof instalarMetaGraphMock>;

function cambio(pn: string, mensaje: Record<string, unknown>): MetaChangeValue {
  return {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: pn, display_phone_number: "573000000000" },
    contacts: [{ wa_id: CLIENTE, profile: { name: "Cliente" } }],
    messages: [{ from: CLIENTE, timestamp: "1790000000", ...mensaje } as never],
  };
}

async function webhook(pn: string, mensaje: Record<string, unknown>) {
  const v = cambio(pn, mensaje);
  await registrarMensajesEntrantesSincrono(pn, v); // lo que POST hace ANTES de responder 200 a Meta
  await procesarCambio(pn, v, null); // lo que POST hace en after()
}

const enviados = () =>
  meta.llamadas
    .filter((l) => l.url.endsWith("/messages") && (l.body as { type?: string })?.type === "text")
    .map((l) => (l.body as { text: { body: string } }).text.body);
const inbox = (pn = PN) => db.rows("dulabs_mensajes_log").filter((r) => r.phone_number_id === pn && r.direccion === "entrante").map((r) => r.contenido);

describe("webhook real → agente: mensajes sin texto (Bloque 23)", { timeout: 60_000 }, () => {
  before(() => {
    db = installSupabaseMemoria(process.env.SUPABASE_URL);
    meta = instalarMetaGraphMock();
  });
  after(() => {
    meta.restaurar();
    db.uninstall();
  });
  beforeEach(() => {
    for (const t of db.tables.keys()) db.tables.get(t)!.length = 0;
    meta.llamadas.length = 0;
    const base = { id_tenant: T, nombre_negocio: "Joyería de prueba", ia_pausada: false, ia_restringida_a: null, ia_numeros_bloqueados: null, flow_activo: false, flow_id: null };
    db.table("dulabs_clientes_config").push({ ...base, phone_number_id: PN }, { ...base, phone_number_id: PN_OTRO, id_tenant: "bbbbbbbb-0000-4000-8000-0000000000b2" });
    db.table("dulabs_mensajes_log", { unique: [["wamid"]], identity: "id", defaults: () => ({ created_at: new Date().toISOString(), procesado_at: null }) });
    db.table("dulabs_agente_runtime_config").push({
      id_tenant: T,
      phone_number_id: PN,
      tipo: "catalog_sales",
      habilitado: true,
      proveedor: "gemini",
      modelo: "gemini-3.6-flash",
      credencial_ref: "env:GEMINI_KEY_PRUEBA_B23",
      nivel_razonamiento: null,
      herramientas: [...AGENT_TOOL_NAMES],
      canal: "retail",
      negocio: {},
      limites: {},
    });
    // Plan activo con cupo de IA disponible (sin suscripción, el cupo es 0 y la IA calla: otra guarda existente).
    db.table("dulabs_suscripciones").push({ id_tenant: T, estado: "activa", plan: "pro", mensajes_ia_mes_negociado: 1_000 });
    db.table("dulabs_agente_conversaciones");
    db.table("dulabs_pausas_chat", { unique: [["phone_number_id", "telefono_cliente"]] });
    db.table("dulabs_chat_lock", { unique: [["phone_number_id", "telefono_cliente"]], defaults: () => ({ bloqueado_at: new Date().toISOString() }) });
    db.table("dulabs_agente_trazas");
  });

  it("nota de voz: queda en el Inbox con su tipo y recibe el aviso fijo por WhatsApp (una sola vez aunque Meta reintente)", async () => {
    await webhook(PN, { id: "wamid.b23.audio", type: "audio", audio: { id: "media-1", mime_type: "audio/ogg" } });
    assert.deepEqual(inbox(), ["[nota de voz]"]);
    assert.deepEqual(enviados(), [NON_TEXT_MESSAGES.audio]);
    const traza = db.rows("dulabs_agente_trazas").find((t) => t.tipo === "turn");
    assert.deepEqual((traza?.traza as { non_text: unknown }).non_text, { kind: "audio", action: "ask_text" });
    assert.equal((traza?.traza as { rounds: number }).rounds, 0, "Gemini no se llamó");
    // Reintento de Meta del MISMO mensaje: ni otro registro ni otra respuesta.
    await webhook(PN, { id: "wamid.b23.audio", type: "audio", audio: { id: "media-1", mime_type: "audio/ogg" } });
    assert.deepEqual(inbox(), ["[nota de voz]"]);
    assert.equal(enviados().length, 1);
  });

  it("imagen con leyenda: Inbox '[imagen] …', traspaso a una asesora (chat en pausa) con el aviso fijo", async () => {
    await webhook(PN, { id: "wamid.b23.img", type: "image", image: { id: "media-2", caption: "¿tienen este?" } });
    assert.deepEqual(inbox(), ["[imagen] ¿tienen este?"]);
    assert.deepEqual(enviados(), [NON_TEXT_MESSAGES.handoff("image")]);
    assert.equal(db.rows("dulabs_pausas_chat").length, 1, "el chat queda en manos de una asesora");
    const traza = db.rows("dulabs_agente_trazas").find((t) => t.tipo === "turn");
    assert.equal(traza?.resultado, "handoff");
  });

  it("Bloque 24: tras pasar a una asesora, que ella conteste desde el celular (eco) NO acorta la pausa: el agente no vuelve a hablar a los 30 min", async () => {
    await webhook(PN, { id: "wamid.b24.img", type: "image", image: { id: "media-8" } });
    const hasta = () => Date.parse(String(db.rows("dulabs_pausas_chat").find((r) => r.phone_number_id === PN && r.telefono_cliente === CLIENTE)!.pausado_hasta));
    const traspaso = hasta();
    assert.ok(traspaso - Date.now() > 23 * 3600_000, "traspaso del agente: 24 h");
    // La asesora responde desde la app de WhatsApp Business (coexistencia): llega como eco.
    await procesarCambio(PN, { messaging_product: "whatsapp", metadata: { phone_number_id: PN, display_phone_number: "573000000000" }, smb_message_echoes: [{ from: "573000000000", to: CLIENTE, id: "wamid.b24.eco", type: "text", text: { body: "Hola, soy Laura" } } as never] });
    assert.ok(hasta() >= traspaso, "la pausa sigue siendo la del traspaso (24 h), no 30 min");
    assert.ok(db.rows("dulabs_mensajes_log").some((r) => r.wamid === "wamid.b24.eco" && r.origen === "manual"), "la respuesta de la asesora queda en el Inbox");
  });

  // Corrección general autorizada: antes, en un número SIN agente, el eco REEMPLAZABA la pausa por
  // 30 min (un traspaso de 24 h o 30 días quedaba en 30 min y el bot volvía a hablar en un chat atendido por
  // una persona). Ahora tampoco se acorta; se conserva el refresco de seguimiento (pausado_desde /
  // seguimiento_enviado) que usa el cron seguimiento-traspaso.
  it("número SIN agente — el eco de la asesora NUNCA acorta una pausa más larga (y refresca el seguimiento)", async () => {
    db.rows("dulabs_pausas_chat").push({ phone_number_id: PN_OTRO, telefono_cliente: CLIENTE, pausado_hasta: new Date(Date.now() + 24 * 3600_000).toISOString(), pausado_desde: new Date(0).toISOString(), seguimiento_enviado: true });
    await procesarCambio(PN_OTRO, { messaging_product: "whatsapp", metadata: { phone_number_id: PN_OTRO, display_phone_number: "573000000000" }, smb_message_echoes: [{ from: "573000000000", to: CLIENTE, id: "wamid.b24.eco.otro", type: "text", text: { body: "Hola" } } as never] });
    const fila = db.rows("dulabs_pausas_chat").find((r) => r.phone_number_id === PN_OTRO)!;
    assert.ok(Date.parse(String(fila.pausado_hasta)) - Date.now() > 23 * 3600_000, "la pausa de 24 h no se acorta a 30 min");
    assert.equal(fila.seguimiento_enviado, false, "el seguimiento se reinicia como siempre");
    assert.ok(Date.now() - Date.parse(String(fila.pausado_desde)) < 60_000, "pausado_desde = ahora, como siempre");
  });

  it("número SIN agente — sin pausa previa, el eco de la asesora pausa 30 min como siempre", async () => {
    await procesarCambio(PN_OTRO, { messaging_product: "whatsapp", metadata: { phone_number_id: PN_OTRO, display_phone_number: "573000000000" }, smb_message_echoes: [{ from: "573000000000", to: CLIENTE, id: "wamid.b24.eco.nueva", type: "text", text: { body: "Hola" } } as never] });
    const fila = db.rows("dulabs_pausas_chat").find((r) => r.phone_number_id === PN_OTRO)!;
    const restante = Date.parse(String(fila.pausado_hasta)) - Date.now();
    assert.ok(restante > 29 * 60_000 && restante < 31 * 60_000, "30 min");
  });

  it("sticker: ni Inbox ni respuesta (igual que antes)", async () => {
    await webhook(PN, { id: "wamid.b23.sticker", type: "sticker", sticker: { id: "media-3" } });
    assert.deepEqual(inbox(), []);
    assert.deepEqual(enviados(), []);
  });

  it("número SIN agente (cualquier otro negocio): la nota de voz se descarta como siempre — nada cambia fuera del agente", async () => {
    await webhook(PN_OTRO, { id: "wamid.b23.otro", type: "audio", audio: { id: "media-4" } });
    assert.deepEqual(inbox(PN_OTRO), []);
    assert.deepEqual(enviados(), []);
    assert.equal(db.rows("dulabs_agente_trazas").length, 0);
  });

  it("piloto con números autorizados (ia_restringida_a): un número NO autorizado no recibe nada; uno autorizado sí", async () => {
    const fila = db.rows("dulabs_clientes_config").find((r) => r.phone_number_id === PN)!;
    fila.ia_restringida_a = "573009990000";
    await webhook(PN, { id: "wamid.b23.noaut", type: "audio", audio: { id: "media-6" } });
    assert.deepEqual(enviados(), [], "no autorizado: silencio");
    fila.ia_restringida_a = `573009990000, ${CLIENTE}`;
    await webhook(PN, { id: "wamid.b23.aut", type: "audio", audio: { id: "media-7" } });
    assert.deepEqual(enviados(), [NON_TEXT_MESSAGES.audio]);
  });

  it("IA pausada en el número: la nota de voz queda en el Inbox pero NADIE responde (el interruptor manda)", async () => {
    db.rows("dulabs_clientes_config").find((r) => r.phone_number_id === PN)!.ia_pausada = true;
    await webhook(PN, { id: "wamid.b23.pausada", type: "audio", audio: { id: "media-5" } });
    assert.deepEqual(inbox(), ["[nota de voz]"]);
    assert.deepEqual(enviados(), []);
  });
});
