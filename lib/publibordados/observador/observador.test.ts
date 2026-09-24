/**
 * Publi Bordados — Fase 2A: observador shadow.
 * Supabase EN MEMORIA (lib/testing/supabase-rest-memoria.ts) con el store REAL de Supabase;
 * la RPC dulabs_pb_observar se emula con la misma regla que la SQL (su versión SQL real se prueba
 * en supabase/tests/20261118000000_dulabs_pb_observador.test.sql). Ninguna salida de red: todo
 * fetch fuera de la base en memoria falla. IDs y teléfonos SINTÉTICOS.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-falsa";

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { claveConversacion } from "./clave";
import { extraerObservaciones } from "./extraer";
import { observarCambioPublibordados, observadorPublibordadosActivo, _limpiarCacheObservador } from "./observador";
import { createSupabaseObservadorStore } from "./repositorio";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTRO_TENANT = "22222222-2222-4222-8222-222222222222";
const PID = "pid-sintetico-pb";
const PID_OTRO = "pid-sintetico-otro";
const DISPLAY = "570000000001";
const CLIENTE = "570000000099";
const TEXTO_PRIVADO = "Hola necesito 20 gorras bordadas";
const ON = { PUBLIBORDADOS_ENABLED: "true" };
const T = new Date("2026-09-24T12:00:05.000Z");
const TS_META = String(Math.floor(new Date("2026-09-24T12:00:00.000Z").getTime() / 1000));

let db: SupabaseMemoria;
const fetchOriginal = globalThis.fetch;
const logs: string[] = [];

function change(pid: string, value: Record<string, unknown>, field = "messages") {
  return { field, value: { messaging_product: "whatsapp", metadata: { display_phone_number: DISPLAY, phone_number_id: pid }, ...value } };
}
const msgCliente = (id: string) => ({ from: CLIENTE, id, timestamp: TS_META, type: "text", text: { body: TEXTO_PRIVADO } });
const eco = (id: string) => ({ from: DISPLAY, to: CLIENTE, id, timestamp: TS_META, type: "text", text: { body: "Prueba asesora 001" } });

function deps(extra: Record<string, unknown> = {}) {
  return { env: ON, sinCache: true, log: (l: string) => logs.push(l), ...extra };
}
const obs = () => db.rows("dulabs_pb_observaciones");

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    throw new Error(`RED BLOQUEADA EN PRUEBA: ${String(input)}`);
  }) as typeof fetch;
  db = installSupabaseMemoria();
  db.rpc("dulabs_pb_observar", (args) => {
    // Misma regla que la SQL: solo números con config habilitada del mismo tenant; clave repetida => entregas + 1.
    const res: { clave: string; nueva: boolean }[] = [];
    for (const f of args.p_filas as Record<string, unknown>[]) {
      const ok = db.rows("dulabs_pb_config").some((c) => c.phone_number_id === f.phone_number_id && c.id_tenant === f.id_tenant && c.enabled === true);
      if (!ok) continue;
      const existente = obs().find((o) => o.phone_number_id === f.phone_number_id && o.clave === f.clave);
      if (existente) {
        existente.entregas = Number(existente.entregas) + 1;
        res.push({ clave: String(f.clave), nueva: false });
      } else {
        obs().push({ ...f, entregas: 1, ultima_recepcion_at: f.received_at });
        res.push({ clave: String(f.clave), nueva: true });
      }
    }
    return { data: res };
  });
});
after(() => {
  db.uninstall();
  globalThis.fetch = fetchOriginal;
});
beforeEach(() => {
  for (const t of [...db.tables.keys()]) db.tables.get(t)!.length = 0;
  db.table("dulabs_pb_config", { unique: [["phone_number_id"]] });
  db.table("dulabs_pb_observaciones", { unique: [["phone_number_id", "clave"]] });
  db.table("dulabs_pb_mensajes_enviados", { unique: [["wamid"]] });
  db.table("dulabs_clientes_config", { unique: [["phone_number_id"]] });
  db.table("dulabs_mensajes_log", { unique: [["wamid"]] });
  db.rows("dulabs_clientes_config").push({ phone_number_id: PID, id_tenant: TENANT }, { phone_number_id: PID_OTRO, id_tenant: OTRO_TENANT });
  db.rows("dulabs_pb_config").push({ phone_number_id: PID, id_tenant: TENANT, enabled: true, shadow_mode: true });
  db.requests.length = 0;
  logs.length = 0;
  _limpiarCacheObservador();
});

describe("Observador PB — eventos", () => {
  it("Test 1 · cliente → webhook: registra CLIENT_MESSAGE con tiempos, wamid y clave de conversación", async () => {
    const r = await observarCambioPublibordados(change(PID, { contacts: [{ wa_id: CLIENTE }], messages: [msgCliente("wamid.C1")] }), T, deps());
    assert.equal(r.estado, "observado");
    assert.equal(obs().length, 1);
    const o = obs()[0];
    assert.equal(o.event_type, "CLIENT_MESSAGE");
    assert.equal(o.direction, "entrante");
    assert.equal(o.wamid, "wamid.C1");
    assert.equal(o.remitente, "cliente");
    assert.equal(o.conversation_key, claveConversacion(TENANT, PID, CLIENTE));
    assert.equal(o.event_timestamp, "2026-09-24T12:00:00.000Z");
    assert.equal(o.received_at, T.toISOString());
    assert.equal(o.latencia_ms, 5000);
    assert.equal(o.array_key, "messages");
  });

  it("Test 2 · eco sin registro de envío: HUMAN_MESSAGE_ECHO (candidato HUMAN), y registra el arreglo REAL en que llegó", async () => {
    await observarCambioPublibordados(change(PID, { message_echoes: [eco("wamid.E1")] }, "smb_message_echoes"), T, deps());
    await observarCambioPublibordados(change(PID, { smb_message_echoes: [eco("wamid.E2")] }, "smb_message_echoes"), T, deps());
    await observarCambioPublibordados(change(PID, { messages: [eco("wamid.E3")] }), T, deps());
    const porWamid = new Map(obs().map((o) => [o.wamid, o]));
    for (const [w, arr] of [["wamid.E1", "message_echoes"], ["wamid.E2", "smb_message_echoes"], ["wamid.E3", "messages"]] as const) {
      const o = porWamid.get(w)!;
      assert.equal(o.event_type, "HUMAN_MESSAGE_ECHO", w);
      assert.equal(o.classification, "HUMAN");
      assert.equal(o.evidencia, "wamid_no_registrado");
      assert.equal(o.array_key, arr);
      assert.equal(o.remitente, "negocio");
      assert.equal(o.destinatario, "cliente");
      // Misma conversación que el mensaje del cliente: to del eco = from del cliente.
      assert.equal(o.conversation_key, claveConversacion(TENANT, PID, CLIENTE));
    }
  });

  it("Test 2b · si no se puede consultar el registro de envíos, el eco queda UNKNOWN (no se inventa)", async () => {
    db.missing("dulabs_pb_mensajes_enviados");
    const r = await observarCambioPublibordados(change(PID, { message_echoes: [eco("wamid.E4")] }, "smb_message_echoes"), T, deps());
    assert.equal(r.estado, "observado");
    assert.equal(obs()[0].event_type, "ECHO_UNCLASSIFIED");
    assert.equal(obs()[0].classification, "UNKNOWN");
  });

  it("Test 3 · eco de un wamid enviado por PB: AI_MESSAGE; enviado por otra vía de DuLabs: PLATFORM; su estado queda relacionado", async () => {
    db.rows("dulabs_pb_mensajes_enviados").push({ wamid: "wamid.IA1", phone_number_id: PID, id_tenant: TENANT, conversation_key: claveConversacion(TENANT, PID, CLIENTE) });
    db.rows("dulabs_mensajes_log").push({ wamid: "wamid.INBOX1", phone_number_id: PID, direccion: "saliente", origen: "agente" });
    await observarCambioPublibordados(change(PID, { message_echoes: [eco("wamid.IA1"), eco("wamid.INBOX1")] }, "smb_message_echoes"), T, deps());
    await observarCambioPublibordados(change(PID, { statuses: [{ id: "wamid.IA1", status: "delivered", timestamp: TS_META, recipient_id: CLIENTE }] }), T, deps());
    const porClave = new Map(obs().map((o) => [o.clave, o]));
    assert.equal(porClave.get("echo:wamid.IA1")!.event_type, "AI_MESSAGE");
    assert.equal(porClave.get("echo:wamid.IA1")!.classification, "AI");
    assert.equal(porClave.get("echo:wamid.INBOX1")!.event_type, "PLATFORM_MESSAGE_ECHO");
    const estado = porClave.get("status:wamid.IA1:delivered")!;
    assert.equal(estado.event_type, "STATUS");
    assert.equal((estado.metadata as Record<string, unknown>).origen_envio, "pb");
  });

  it("Test 4 · duplicado: la reentrega del mismo wamid no crea otra fila; suma entregas", async () => {
    const c = change(PID, { messages: [msgCliente("wamid.D1")] });
    const r1 = await observarCambioPublibordados(c, T, deps());
    const r2 = await observarCambioPublibordados(c, T, deps());
    assert.equal(obs().length, 1);
    assert.equal(obs()[0].entregas, 2);
    assert.deepEqual([r1.nuevas, r1.repetidas, r2.nuevas, r2.repetidas], [1, 0, 0, 1]);
  });

  it("Test 4b · estados distintos del mismo wamid son eventos distintos (sent, delivered, read)", async () => {
    for (const s of ["sent", "delivered", "read"]) {
      await observarCambioPublibordados(change(PID, { statuses: [{ id: "wamid.S1", status: s, timestamp: TS_META, recipient_id: CLIENTE }] }), T, deps());
    }
    assert.equal(obs().length, 3);
  });

  it("Test 8 · evento desconocido: se registra como UNKNOWN_EVENT (campo y claves), nunca se descarta en silencio", async () => {
    await observarCambioPublibordados(change(PID, { algo_nuevo: [{ x: 1 }] }, "history"), T, deps());
    await observarCambioPublibordados(change(PID, { messages: [msgCliente("wamid.U1")], errors: [{ code: 1 }] }), T, deps());
    const unk = obs().filter((o) => o.event_type === "UNKNOWN_EVENT");
    assert.equal(unk.length, 2);
    assert.equal(unk[0].source, "history");
    assert.deepEqual((unk[1].metadata as Record<string, unknown>).claves_desconocidas, ["errors"]);
    assert.ok(obs().some((o) => o.wamid === "wamid.U1" && o.event_type === "CLIENT_MESSAGE"), "lo conocido del mismo evento también se registra");
  });

  it("Privacidad · no se guarda texto, teléfono del cliente ni número del negocio en ninguna observación", async () => {
    await observarCambioPublibordados(change(PID, { contacts: [{ wa_id: CLIENTE, profile: { name: "Ana Privada" } }], messages: [msgCliente("wamid.P1")] }), T, deps());
    await observarCambioPublibordados(change(PID, { message_echoes: [eco("wamid.P2")] }, "smb_message_echoes"), T, deps());
    const todo = JSON.stringify(obs());
    for (const privado of [TEXTO_PRIVADO, "Prueba asesora", CLIENTE, DISPLAY, "Ana Privada"]) assert.ok(!todo.includes(privado), `se guardó: ${privado}`);
    assert.equal((obs()[0].metadata as Record<string, unknown>).longitud_texto, TEXTO_PRIVADO.length);
  });
});

describe("Observador PB — aislamiento y fail-safe", () => {
  it("Test 5 · otro tenant / otro número: no activa PB y no escribe nada", async () => {
    const r = await observarCambioPublibordados(change(PID_OTRO, { messages: [msgCliente("wamid.O1")] }), T, deps());
    assert.equal(r.estado, "no_es_pb");
    assert.equal(obs().length, 0);
    assert.ok(!db.requests.some((q) => q.path.includes("dulabs_pb_observar")), "no llamó a la RPC");
  });

  it("Test 5b · config de PB con un tenant distinto al real del número: no observa (identidad)", async () => {
    db.rows("dulabs_pb_config")[0].id_tenant = OTRO_TENANT;
    const r = await observarCambioPublibordados(change(PID, { messages: [msgCliente("wamid.O2")] }), T, deps());
    assert.equal(r.estado, "tenant_no_coincide");
    assert.equal(obs().length, 0);
  });

  it("Test 6 · PB deshabilitado (PUBLIBORDADOS_ENABLED ≠ true): no hace absolutamente nada (cero consultas)", async () => {
    for (const env of [{}, { PUBLIBORDADOS_ENABLED: "false" }, { PUBLIBORDADOS_ENABLED: "TRUE" }, { PUBLIBORDADOS_ENABLED: "1" }]) {
      assert.equal(observadorPublibordadosActivo(env), false);
      const r = await observarCambioPublibordados(change(PID, { messages: [msgCliente("wamid.X")] }), T, deps({ env }));
      assert.equal(r.estado, "inactivo");
    }
    assert.equal(db.requests.length, 0, "no debe tocar la base");
    assert.equal(obs().length, 0);
  });

  it("Test 6b · fila con enabled = false: no observa", async () => {
    db.rows("dulabs_pb_config")[0].enabled = false;
    const r = await observarCambioPublibordados(change(PID, { messages: [msgCliente("wamid.X2")] }), T, deps());
    assert.equal(r.estado, "no_es_pb");
    assert.equal(obs().length, 0);
  });

  it("Test 7 · error del observador (tabla ausente, RPC caída, payload basura): nunca lanza ni rechaza", async () => {
    db.missing("dulabs_pb_config");
    const r1 = await observarCambioPublibordados(change(PID, { messages: [msgCliente("wamid.F1")] }), T, deps());
    assert.equal(r1.estado, "error");
    const store = createSupabaseObservadorStore((await import("@/lib/supabase")).supabaseAdmin());
    const roto = { ...store, guardar: async () => { throw new Error("RPC caída"); } };
    const r2 = await observarCambioPublibordados(change(PID, { messages: [msgCliente("wamid.F2")] }), T, deps({ store: { ...roto, configDe: async () => ({ phoneNumberId: PID, idTenant: TENANT }) } }));
    assert.equal(r2.estado, "error");
    const circular: Record<string, unknown> = {};
    circular.yo = circular;
    const noClonable = { field: "messages", value: { f: () => 1 } };
    for (const basura of [null, undefined, 42, "x", { field: 1, value: [] }, circular, noClonable]) {
      const r = await observarCambioPublibordados(basura, T, deps());
      assert.ok(["no_es_pb", "error"].includes(r.estado), JSON.stringify(r));
    }
    assert.ok(logs.some((l) => l.includes("ERROR")), "el error queda en el log técnico");
  });

  it("Copia síncrona · mutar el evento después de llamar al observador no cambia lo observado", async () => {
    const c = change(PID, { messages: [{ from: CLIENTE, id: "wamid.M1", timestamp: TS_META, type: "button", button: { text: "Sí" } }] });
    const p = observarCambioPublibordados(c, T, deps());
    // El webhook normaliza botones escribiendo mensaje.text (route.ts): no debe afectar la observación.
    ((c.value as unknown as { messages: Record<string, unknown>[] }).messages[0]).text = { body: "Sí" };
    await p;
    assert.equal((obs()[0].metadata as Record<string, unknown>).longitud_texto, undefined);
  });
});

describe("Observador PB — extracción pura", () => {
  it("eco sin 'to' queda sin conversación y marcado", () => {
    const [o] = extraerObservaciones(change(PID, { message_echoes: [{ from: DISPLAY, id: "wamid.T1", type: "text" }] }, "smb_message_echoes"), { idTenant: TENANT, phoneNumberId: PID, recibidoAt: T });
    assert.equal(o.conversation_key, null);
    assert.equal((o.metadata as Record<string, unknown>).sin_destinatario, true);
  });
  it("la misma persona tiene claves distintas en otro número o tenant", () => {
    const a = claveConversacion(TENANT, PID, CLIENTE);
    assert.notEqual(a, claveConversacion(TENANT, PID_OTRO, CLIENTE));
    assert.notEqual(a, claveConversacion(OTRO_TENANT, PID, CLIENTE));
    assert.equal(a, claveConversacion(TENANT.toUpperCase(), PID, `+${CLIENTE}`));
  });
  it("vector compartido con la SQL (dulabs_pb_clave_conversacion)", () => {
    assert.equal(
      claveConversacion("11111111-1111-4111-8111-111111111111", "pid-sintetico-pb", "570000000099"),
      "3095d80adc5e2d06be0fcd76d12ea84f65e310518d5fc1375ba079999b6cde07",
    );
  });
});
