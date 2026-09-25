/**
 * Pausa por INTERVENCIÓN HUMANA declarada por el flow (runtimePolicy.humanTakeover) sobre los
 * canales REALES: el webhook (procesarCambio: eco de coexistencia + mensajes del cliente) y el
 * envío desde el Inbox (POST /api/dashboard/mensajes). Supabase EN MEMORIA (PostgREST emulado) y
 * Meta simulado: nada toca Supabase, Gemini ni Meta reales.
 *
 *   número con un flow que declara humanTakeover (el de Publi Bordados, 5 h):
 *     eco o Inbox → pausa = ahora + 5 h, nunca menos que la vigente
 *     cliente durante la pausa → queda en el Inbox, CERO respuestas automáticas
 *   número con un flow SIN esa política (cualquier otro negocio) → exactamente lo de siempre
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";
process.env.META_ACCESS_TOKEN = "token-meta-de-prueba";
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { instalarMetaGraphMock } from "@/lib/testing/meta-graph-mock";
import { publibordadosFlow } from "@/lib/flows/publibordados.flow";
import type { FlowDefinition } from "@/lib/flow/types";
import { procesarCambio, registrarMensajesEntrantesSincrono, type MetaChangeValue } from "./route";
import { POST as enviarDesdeInbox } from "@/app/api/dashboard/mensajes/route";

const T_PB = "aaaaaaaa-0000-4000-8000-0000000000c1";
const T_OTRO = "bbbbbbbb-0000-4000-8000-0000000000c2";
const PN_PB = "100000000000931";
const PN_OTRO = "100000000000932";
const CLIENTE = "573004445566";
const DISPLAY = "573000000000";
const HORA = 3_600_000;

function flowSinPolitica(): FlowDefinition {
  return {
    name: "Otro negocio",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [{ id: "e1", source: "start", target: "end" }],
    variables: [],
  };
}

let db: SupabaseMemoria;
let meta: ReturnType<typeof instalarMetaGraphMock>;

const pausa = (pn = PN_PB) => db.rows("dulabs_pausas_chat").find((r) => r.phone_number_id === pn && r.telefono_cliente === CLIENTE);
const horasDePausa = (pn = PN_PB) => {
  const p = pausa(pn);
  return p ? (Date.parse(String(p.pausado_hasta)) - Date.now()) / HORA : null;
};
const fijarPausa = (horas: number, pn = PN_PB) => {
  const hasta = new Date(Date.now() + horas * HORA).toISOString();
  const p = pausa(pn);
  if (p) p.pausado_hasta = hasta;
  else db.rows("dulabs_pausas_chat").push({ phone_number_id: pn, telefono_cliente: CLIENTE, pausado_hasta: hasta, pausado_desde: new Date().toISOString(), seguimiento_enviado: false });
};
const enviadosAMeta = () => meta.llamadas.filter((l) => l.url.endsWith("/messages"));

let n = 0;
async function ecoDeLaAsesora(pn = PN_PB) {
  const id = `wamid.eco.${++n}`;
  await procesarCambio(pn, {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: pn, display_phone_number: DISPLAY },
    smb_message_echoes: [{ from: DISPLAY, to: CLIENTE, id, type: "text", text: { body: "Hola, soy la asesora" } } as never],
  });
  return id;
}

async function mensajeDelCliente(texto: string, pn = PN_PB) {
  const v: MetaChangeValue = {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: pn, display_phone_number: DISPLAY },
    contacts: [{ wa_id: CLIENTE, profile: { name: "Cliente" } }],
    messages: [{ from: CLIENTE, id: `wamid.cli.${++n}`, timestamp: "1790000000", type: "text", text: { body: texto } } as never],
  };
  await registrarMensajesEntrantesSincrono(pn, v);
  await procesarCambio(pn, v, null);
}

async function inbox(pn = PN_PB, token = "t-asesora-pb") {
  return enviarDesdeInbox(
    new NextRequest("http://localhost/api/dashboard/mensajes", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ phone_number_id: pn, telefono_cliente: CLIENTE, texto: "Te escribe tu asesora" }),
    }),
  );
}

describe("pausa por intervención humana (runtimePolicy.humanTakeover) — canales reales", { timeout: 60_000 }, () => {
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
    const base = { nombre_negocio: "Negocio", ia_pausada: false, ia_restringida_a: null, ia_numeros_bloqueados: null, flow_activo: true, mes_actual: null, mensajes_usados_mes: 0 };
    db.table("dulabs_clientes_config").push(
      { ...base, id: 1, id_tenant: T_PB, phone_number_id: PN_PB, flow_id: "flow-pb" },
      { ...base, id: 2, id_tenant: T_OTRO, phone_number_id: PN_OTRO, flow_id: "flow-otro" },
    );
    db.table("dulabs_flows").push(
      { tenant_id: T_PB, id: "flow-pb", slug: "pb", name: "PB", status: "published", published_version_id: "ver-pb" },
      { tenant_id: T_OTRO, id: "flow-otro", slug: "otro", name: "Otro", status: "published", published_version_id: "ver-otro" },
    );
    db.table("dulabs_flow_versions").push(
      { tenant_id: T_PB, id: "ver-pb", flow_id: "flow-pb", version_number: 3, definition_json: publibordadosFlow() },
      { tenant_id: T_OTRO, id: "ver-otro", flow_id: "flow-otro", version_number: 1, definition_json: flowSinPolitica() },
    );
    db.table("dulabs_flow_executions");
    db.table("dulabs_mensajes_log", { unique: [["wamid"]], identity: "id", defaults: () => ({ created_at: new Date().toISOString(), procesado_at: null }) });
    db.table("dulabs_pausas_chat", { unique: [["phone_number_id", "telefono_cliente"]] });
    db.table("dulabs_agente_runtime_config");
    db.table("dulabs_survey_bot_config");
    db.table("dulabs_campaign_leads");
    db.table("dulabs_onboarding_sesiones");
    db.table("dulabs_miembros_equipo").push(
      { id: 1, tenant_id: T_PB, user_id: "u-asesora-pb", rol: "agente", estado: "activo", email: "a@pb.test", nombre: "Asesora" },
      { id: 2, tenant_id: T_OTRO, user_id: "u-asesora-otro", rol: "agente", estado: "activo", email: "a@otro.test", nombre: "Otra" },
    );
    db.user("t-asesora-pb", "u-asesora-pb");
    db.user("t-asesora-otro", "u-asesora-otro");
    db.table("dulabs_conversacion_asignaciones", { identity: "id" });
    db.table("dulabs_conversacion_eventos", { identity: "id" });
    // Ventana de 24 h abierta (el cliente escribió hace poco), requisito del envío desde el Inbox.
    for (const pn of [PN_PB, PN_OTRO]) {
      db.rows("dulabs_mensajes_log").push({ id: 1000 + Number(pn.slice(-1)), phone_number_id: pn, telefono_cliente: CLIENTE, direccion: "entrante", contenido: "hola", created_at: new Date().toISOString() });
    }
  });

  it("eco de la asesora sin pausa previa → pausa de 5 h desde ese momento", async () => {
    await ecoDeLaAsesora();
    const h = horasDePausa()!;
    assert.ok(h > 4.99 && h <= 5, `${h} h`);
  });

  it("eco durante la pausa del traspaso (quedan 3 h) → se renueva a 5 h desde la intervención", async () => {
    fijarPausa(3);
    await ecoDeLaAsesora();
    assert.ok(horasDePausa()! > 4.99);
  });

  it("varios ecos → la expiración siempre avanza; un reintento de Meta del mismo eco no hace nada extra", async () => {
    fijarPausa(1);
    let previo = Date.parse(String(pausa()!.pausado_hasta));
    for (let i = 0; i < 3; i++) {
      const id = await ecoDeLaAsesora();
      const ahora = Date.parse(String(pausa()!.pausado_hasta));
      assert.ok(ahora >= previo, "nunca retrocede");
      previo = ahora;
      // Reintento de Meta del MISMO eco: registrado una sola vez.
      await procesarCambio(PN_PB, { messaging_product: "whatsapp", metadata: { phone_number_id: PN_PB, display_phone_number: DISPLAY }, smb_message_echoes: [{ from: DISPLAY, to: CLIENTE, id, type: "text", text: { body: "Hola, soy la asesora" } } as never] });
      assert.equal(db.rows("dulabs_mensajes_log").filter((r) => r.wamid === id).length, 1);
    }
  });

  it("nunca acorta: con una pausa de 30 días vigente, el eco y el Inbox la dejan en 30 días", async () => {
    fijarPausa(30 * 24);
    await ecoDeLaAsesora();
    assert.ok(horasDePausa()! > 30 * 24 - 0.01);
    assert.equal((await inbox()).status, 200);
    assert.ok(horasDePausa()! > 30 * 24 - 0.01);
  });

  it("envío desde el Inbox → pausa renovada a 5 h desde ese momento (sin pausa previa y con 1 h restante)", async () => {
    assert.equal((await inbox()).status, 200);
    assert.ok(horasDePausa()! > 4.99);
    fijarPausa(1);
    assert.equal((await inbox()).status, 200);
    assert.ok(horasDePausa()! > 4.99);
    assert.equal(enviadosAMeta().length, 2, "el mensaje de la asesora sí sale");
  });

  it("cliente escribe durante la pausa → queda registrado en el Inbox y recibe CERO respuestas automáticas", async () => {
    await ecoDeLaAsesora();
    meta.llamadas.length = 0;
    for (const texto of ["Hola", "menú", "¿me confirmas el precio?"]) await mensajeDelCliente(texto);
    assert.equal(enviadosAMeta().length, 0, "ni flow ni IA responden");
    const entrantes = db.rows("dulabs_mensajes_log").filter((r) => r.phone_number_id === PN_PB && r.direccion === "entrante").map((r) => r.contenido);
    assert.deepEqual(entrantes.slice(-3), ["Hola", "menú", "¿me confirmas el precio?"]);
    assert.equal(db.rows("dulabs_flow_executions").length, 0, "no se inició ninguna ejecución");
  });

  it("otro negocio (flow SIN humanTakeover): el eco sigue siendo de 30 min y el Inbox no toca la pausa, como siempre", async () => {
    await ecoDeLaAsesora(PN_OTRO);
    const h = horasDePausa(PN_OTRO)!;
    assert.ok(h > 0.49 && h <= 0.5, `eco: 30 min (${h} h)`);
    db.rows("dulabs_pausas_chat").length = 0;
    assert.equal((await inbox(PN_OTRO, "t-asesora-otro")).status, 200);
    assert.equal(pausa(PN_OTRO), undefined, "Inbox sin política: no pausa (comportamiento de siempre)");
  });

  it("aislamiento: la intervención en Publi Bordados no crea ni cambia pausas de otro número/tenant", async () => {
    fijarPausa(2, PN_OTRO);
    const otroAntes = pausa(PN_OTRO)!.pausado_hasta;
    await ecoDeLaAsesora();
    assert.equal((await inbox()).status, 200);
    assert.equal(pausa(PN_OTRO)!.pausado_hasta, otroAntes);
    // Y una asesora de OTRO tenant no puede enviar (ni pausar) por el número de PB.
    const ajeno = await inbox(PN_PB, "t-asesora-otro");
    assert.equal(ajeno.status, 404);
  });

  it("número sin flow activo: la política no aplica (eco de 30 min de siempre)", async () => {
    db.rows("dulabs_clientes_config")[0].flow_activo = false;
    await ecoDeLaAsesora();
    const h = horasDePausa()!;
    assert.ok(h > 0.49 && h <= 0.5, `${h} h`);
  });
});
