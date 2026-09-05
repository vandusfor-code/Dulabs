/**
 * Chats AMORE (autorizado) — integración REAL contra Supabase (tenants
 * descartables, randomUUID, nunca AMORE/Daniela/Solo Talento reales) de
 * persistirMensajeEntrante: la ruta de TEXTO (entrante y saliente), que es
 * la única testeable sin una sesión real de Baileys -- el camino de audio
 * llama a downloadMediaMessage(msg,...), que requiere un mensaje cifrado
 * real de WhatsApp para descifrar; no hay forma honesta de fabricar eso en
 * una prueba automatizada, así que ese camino se deja documentado como
 * pendiente de verificación manual (ver el reporte final), no fingido con
 * un mock que no probaría nada real.
 *
 * Si la migración 20260911000000_chats_whatsapp.sql todavía no se ha
 * corrido, el `before()` lo detecta y todo el archivo se salta con un
 * mensaje claro.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WAMessage } from "@whiskeysockets/baileys";
import { persistirMensajeEntrante } from "./persistir-mensaje.js";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function mensajeTexto(params: { jid: string; texto: string; fromMe?: boolean; id?: string; pushName?: string; remoteJidAlt?: string }): WAMessage {
  return {
    key: { remoteJid: params.jid, remoteJidAlt: params.remoteJidAlt, fromMe: params.fromMe ?? false, id: params.id ?? randomUUID() },
    message: { conversation: params.texto },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: params.pushName,
  } as unknown as WAMessage;
}

describe(
  "persistirMensajeEntrante — camino de texto, integración real",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    let migracionLista = false;
    const tenantsCreados: string[] = [];
    const flowsCreados: string[] = [];

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const sonda = await supabase.from("dulabs_chat_conversaciones").select("id").limit(1);
      migracionLista = !sonda.error;
    });

    after(async () => {
      if (!HAS_SUPABASE || !migracionLista) return;
      if (tenantsCreados.length > 0) await supabase.from("dulabs_chat_conversaciones").delete().in("id_tenant", tenantsCreados);
      if (flowsCreados.length > 0) await supabase.from("dulabs_flows").delete().in("id", flowsCreados);
    });

    function nuevoTenant(): string {
      const id = randomUUID();
      tenantsCreados.push(id);
      return id;
    }

    async function conversacionDe(idTenant: string, telefono: string) {
      const { data } = await supabase
        .from("dulabs_chat_conversaciones")
        .select("*")
        .eq("id_tenant", idTenant)
        .eq("telefono", telefono)
        .maybeSingle();
      return data;
    }

    it("1/22. mensaje entrante nuevo crea la conversación (nace 'requiere_atencion', no_leidos=1)", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      const jid = "573000000001@s.whatsapp.net";
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid, texto: "Hola, quiero una cita", pushName: "María" }));

      const conv = await conversacionDe(idTenant, "573000000001");
      assert.ok(conv);
      assert.equal(conv!.estado, "requiere_atencion");
      assert.equal(conv!.no_leidos, 1);
      assert.equal(conv!.nombre_visible, "María");
      assert.equal(conv!.ultimo_mensaje, "Hola, quiero una cita");
    });

    it("4. no_leidos se acumula con cada mensaje entrante sucesivo", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      const jid = "573000000002@s.whatsapp.net";
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid, texto: "Uno" }));
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid, texto: "Dos" }));
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid, texto: "Tres" }));

      const conv = await conversacionDe(idTenant, "573000000002");
      assert.equal(conv!.no_leidos, 3);
      assert.equal(conv!.ultimo_mensaje, "Tres");
    });

    it("bug real (envío del bot con timeout de 30s): un JID de multi-dispositivo (\":26\") guarda el teléfono limpio, sin el id de dispositivo pegado", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid: "573000000009:26@s.whatsapp.net", texto: "Hola" }));
      const conv = await conversacionDe(idTenant, "573000000009");
      assert.ok(conv, "debe guardar el teléfono real (573000000009), no uno con el id de dispositivo pegado");
    });

    it("bug real (sistema LID de WhatsApp): remoteJid es un @lid opaco -- se usa remoteJidAlt para guardar el teléfono real", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      await persistirMensajeEntrante(
        supabase,
        idTenant,
        mensajeTexto({ jid: "108563905147109@lid", remoteJidAlt: "573000000099@s.whatsapp.net", texto: "Hola" })
      );
      const conv = await conversacionDe(idTenant, "573000000099");
      assert.ok(conv, "debe guardar el teléfono real de remoteJidAlt, no el LID opaco de remoteJid");
      const convLid = await conversacionDe(idTenant, "108563905147109");
      assert.equal(convLid, null, "nunca debe guardar el LID como si fuera un teléfono");
    });

    it("un mensaje saliente (fromMe) nunca incrementa no_leidos", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      const jid = "573000000003@s.whatsapp.net";
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid, texto: "Hola" }));
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid, texto: "¡Hola! ¿En qué te ayudo?", fromMe: true }));

      const conv = await conversacionDe(idTenant, "573000000003");
      assert.equal(conv!.no_leidos, 1);
      assert.equal(conv!.ultimo_mensaje, "¡Hola! ¿En qué te ayudo?");
    });

    it("3. ordena por última actividad -- la más reciente queda primero", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid: "573000000004@s.whatsapp.net", texto: "A" }));
      await new Promise((r) => setTimeout(r, 20));
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid: "573000000005@s.whatsapp.net", texto: "B" }));

      const { data } = await supabase
        .from("dulabs_chat_conversaciones")
        .select("telefono")
        .eq("id_tenant", idTenant)
        .order("ultima_actividad", { ascending: false });
      assert.equal(data![0]!.telefono, "573000000005");
    });

    it("una conversación en 'automatico' se queda en 'automatico' al recibir un mensaje nuevo (el bot real la sigue atendiendo)", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      const jid = "573000000006@s.whatsapp.net";
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid, texto: "Primero" }));
      await supabase.from("dulabs_chat_conversaciones").update({ estado: "automatico" }).eq("id_tenant", idTenant).eq("telefono", "573000000006");

      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid, texto: "Segundo" }));
      const conv = await conversacionDe(idTenant, "573000000006");
      assert.equal(conv!.estado, "automatico");
    });

    it("una conversación NUEVA nace en 'automatico' si el tenant tiene un flow publicado", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      const { data: flow } = await supabase
        .from("dulabs_flows")
        .insert({ tenant_id: idTenant, slug: `prueba-${idTenant}`, name: "Prueba", status: "published" })
        .select("id")
        .single();
      flowsCreados.push(flow!.id as string);

      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid: "573000000010@s.whatsapp.net", texto: "Hola" }));
      const conv = await conversacionDe(idTenant, "573000000010");
      assert.equal(conv!.estado, "automatico");
    });

    it("una conversación NUEVA nace en 'requiere_atencion' si el tenant NO tiene ningún flow publicado", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid: "573000000011@s.whatsapp.net", texto: "Hola" }));
      const conv = await conversacionDe(idTenant, "573000000011");
      assert.equal(conv!.estado, "requiere_atencion");
    });

    it("una conversación en 'manual' NO cambia de estado sola al recibir un mensaje", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      const jid = "573000000007@s.whatsapp.net";
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid, texto: "Primero" }));
      await supabase.from("dulabs_chat_conversaciones").update({ estado: "manual" }).eq("id_tenant", idTenant).eq("telefono", "573000000007");

      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid, texto: "Segundo" }));
      const conv = await conversacionDe(idTenant, "573000000007");
      assert.equal(conv!.estado, "manual");
    });

    it("14. aislamiento por tenant: un tenant nunca ve la conversación de otro con el mismo teléfono", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenantA = nuevoTenant();
      const idTenantB = nuevoTenant();
      const jid = "573000000008@s.whatsapp.net";
      await persistirMensajeEntrante(supabase, idTenantA, mensajeTexto({ jid, texto: "Mensaje para A" }));
      await persistirMensajeEntrante(supabase, idTenantB, mensajeTexto({ jid, texto: "Mensaje para B" }));

      const convA = await conversacionDe(idTenantA, "573000000008");
      const convB = await conversacionDe(idTenantB, "573000000008");
      assert.equal(convA!.ultimo_mensaje, "Mensaje para A");
      assert.equal(convB!.ultimo_mensaje, "Mensaje para B");
      assert.notEqual(convA!.id, convB!.id);
    });

    it("grupos (@g.us) y estados (status@broadcast) se ignoran, nunca crean conversación", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid: "123456-group@g.us", texto: "Hola grupo" }));
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid: "status@broadcast", texto: "Estado" }));

      const { data } = await supabase.from("dulabs_chat_conversaciones").select("id").eq("id_tenant", idTenant);
      assert.equal(data!.length, 0);
    });

    it("9/12/13. inserta el mensaje real con dirección/estado/whatsapp_message_id correctos", async (t) => {
      if (!migracionLista) return t.skip("falta la migración 20260911000000_chats_whatsapp.sql");
      const idTenant = nuevoTenant();
      const jid = "573000000009@s.whatsapp.net";
      await persistirMensajeEntrante(supabase, idTenant, mensajeTexto({ jid, texto: "Hola", id: "WA-MSG-1" }));

      const conv = await conversacionDe(idTenant, "573000000009");
      const { data: mensajes } = await supabase
        .from("dulabs_chat_mensajes")
        .select("*")
        .eq("conversacion_id", conv!.id);
      assert.equal(mensajes!.length, 1);
      assert.equal(mensajes![0]!.direccion, "entrante");
      assert.equal(mensajes![0]!.tipo, "texto");
      assert.equal(mensajes![0]!.texto, "Hola");
      assert.equal(mensajes![0]!.whatsapp_message_id, "WA-MSG-1");
      assert.equal(mensajes![0]!.estado, "enviado");
      assert.equal(mensajes![0]!.id_tenant, idTenant);
    });
  }
);
