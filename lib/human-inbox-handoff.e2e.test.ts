/**
 * FASE 9 (Human Inbox, autorizado) — el E2E MÁS IMPORTANTE de esta fase
 * (spec F9 §39): el ciclo completo cliente → IA → handoff humano → IA
 * respeta la pausa → agente devuelve a IA → IA vuelve a responder.
 *
 * Reutiliza al máximo infraestructura YA CERRADA:
 *  - procesarCambio (exportada en F8.6 solo para testabilidad directa, sin
 *    tocar la arquitectura del webhook -- ver app/webhook-dulabs/route.ts);
 *  - el Meta mock de F8.6 (lib/testing/meta-graph-mock.ts), nunca Meta real;
 *  - activarPausaChat/liberarPausaChat (lib/pausas-chat.ts) -- el MISMO
 *    mecanismo que atenderMensaje ya consultaba antes de esta fase para el
 *    eco de coexistencia y para el action node "transferir_soporte"; F9 solo
 *    le agrega un disparador explícito desde el Inbox (ver
 *    app/api/dashboard/conversaciones/handoff/route.ts), nunca un mecanismo
 *    paralelo.
 *
 * Tenant/flow/número SIEMPRE descartables (randomUUID). NUNCA
 * AMORE/Daniela/Charlotte/Solo Talento.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFlow, createFlowVersion, publishFlowVersion } from "@/lib/flow/flow-store";
import type { FlowDefinition } from "@/lib/flow/types";
import { instalarMetaGraphMock } from "@/lib/testing/meta-graph-mock";
import { activarPausaChat, liberarPausaChat } from "@/lib/pausas-chat";

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");
process.env.META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "fake-meta-token-f9";
process.env.META_APP_SECRET = process.env.META_APP_SECRET || "test-app-secret-f9";

import { procesarCambio } from "@/app/webhook-dulabs/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const DURACION_TOMAR_MS = 30 * 24 * 60 * 60 * 1000; // mismo valor que app/api/dashboard/conversaciones/handoff/route.ts

function flowSaludo(): FlowDefinition {
  return {
    name: "F9 E2E handoff",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "¡Hola! Soy la IA, ¿en qué te ayudo?" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "end" },
    ],
    variables: [],
  };
}

function valueTexto(phoneNumberId: string, telefonoRemitente: string, texto: string, wamid: string) {
  return {
    metadata: { phone_number_id: phoneNumberId, display_phone_number: "573000000000" },
    contacts: [{ wa_id: telefonoRemitente, profile: { name: "Cliente E2E F9" } }],
    messages: [{ from: telefonoRemitente, id: wamid, type: "text", text: { body: texto } }],
  };
}

describe(
  "F9 — Human Handoff E2E: cliente → IA → toma humana → IA en silencio → devuelto a IA → IA responde de nuevo",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const tenantId = randomUUID();
    const phoneNumberId = `f9-handoff-${sufijo}`;
    const telefonoCliente = "573000000099";

    after(async () => {
      if (!HAS_SUPABASE) return;
      await admin.from("dulabs_mensajes_log").delete().eq("phone_number_id", phoneNumberId);
      await admin.from("dulabs_pausas_chat").delete().eq("phone_number_id", phoneNumberId);
      await admin.from("dulabs_flow_executions").delete().eq("tenant_id", tenantId);
      await admin.from("dulabs_flow_events").delete().eq("tenant_id", tenantId);
      await admin.from("dulabs_conversacion_asignaciones").delete().eq("phone_number_id", phoneNumberId);
      await admin.from("dulabs_conversacion_eventos").delete().eq("phone_number_id", phoneNumberId);
      // Tolera la migración de estado (20260929000000) sin aplicar -- ver
      // lib/conversacion-estado.ts. Si la tabla no existe, delete() sobre
      // ella no lanza (Supabase-js devuelve {error}, no rechaza la promesa),
      // así que ni siquiera hace falta un try/catch acá.
      await admin.from("dulabs_conversacion_estado").delete().eq("phone_number_id", phoneNumberId);
      await admin.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
      await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
      await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId);
      await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId);
    });

    it("ciclo completo", async () => {
      const flow = await createFlow(admin, { tenantId, slug: `f9-handoff-${sufijo}`, name: "F9 handoff" });
      const version = await createFlowVersion(admin, { tenantId, flowId: flow.id, versionNumber: 1, definition: flowSaludo() });
      await publishFlowVersion(admin, tenantId, flow.id, version.id);

      const { error: cfgError } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: tenantId,
        phone_number_id: phoneNumberId,
        whatsapp_business_account_id: `waba-${phoneNumberId}`,
        telefono_negocio: `5730${Math.floor(Math.random() * 100_000_000)}`,
        nombre_negocio: "F9 E2E (descartable)",
        flow_activo: true,
        flow_id: flow.id,
        meta_permanent_token: null,
      });
      assert.equal(cfgError, null, cfgError?.message);

      // Sin esto, dentroDelCupoIA (gate real del cascade, ver F8.6) bloquea
      // TODO antes de llegar al Flow -- lección ya aprendida en la fase anterior.
      const enUnMes = new Date();
      enUnMes.setMonth(enUnMes.getMonth() + 1);
      await admin.from("dulabs_suscripciones").insert({
        id_tenant: tenantId,
        plan: "start",
        estado: "activa",
        precio_cop: 0,
        fecha_proximo_cobro: enUnMes.toISOString().slice(0, 10),
      });

      // --- Paso 1: cliente escribe, la IA responde normalmente ---
      let mock = instalarMetaGraphMock();
      try {
        await procesarCambio(phoneNumberId, valueTexto(phoneNumberId, telefonoCliente, "hola", `wamid.${randomUUID()}`));
        assert.ok(mock.llamadas.length > 0, "la IA debe responder al primer mensaje (Flow activo, sin pausa)");
      } finally {
        mock.restaurar();
      }

      // --- Paso 2: un agente toma la conversación (handoff explícito, mismo mecanismo que POST /api/dashboard/conversaciones/handoff) ---
      const tomada = await activarPausaChat(admin, phoneNumberId, telefonoCliente, DURACION_TOMAR_MS);
      assert.equal(tomada.ok, true);

      // --- Paso 3: el cliente escribe DE NUEVO mientras está en manos de un humano -> la IA NO debe responder ---
      mock = instalarMetaGraphMock();
      try {
        await procesarCambio(phoneNumberId, valueTexto(phoneNumberId, telefonoCliente, "¿siguen ahí?", `wamid.${randomUUID()}`));
        assert.equal(mock.llamadas.length, 0, "con la conversación en manos de un humano, la IA/Flow NUNCA debe responder automáticamente");
      } finally {
        mock.restaurar();
      }

      // El mensaje del cliente SÍ debe quedar registrado (visible en el
      // Inbox) aunque la IA no responda -- "registrar mensaje → actualizar
      // Inbox → NO ejecutar IA" (spec F9 §25), nunca "descartar el mensaje".
      const { data: mensajesRegistrados } = await admin
        .from("dulabs_mensajes_log")
        .select("contenido")
        .eq("phone_number_id", phoneNumberId)
        .eq("telefono_cliente", telefonoCliente)
        .eq("direccion", "entrante")
        .order("created_at", { ascending: true });
      assert.equal(mensajesRegistrados?.length, 2, "ambos mensajes entrantes del cliente deben quedar en el historial, incluso el que la IA ignoró");
      assert.equal(mensajesRegistrados?.[1]?.contenido, "¿siguen ahí?");

      // --- Paso 4: el agente responde manualmente (mismo pipeline de F8, vía enviarTexto -- fuera del alcance de procesarCambio, que nunca debe re-disparar el Flow por un mensaje SALIENTE) ---
      // (No se llama a procesarCambio con un mensaje saliente a propósito:
      // el composer del Inbox llama a enviarTexto directo, ver
      // app/api/dashboard/mensajes/route.ts -- nunca pasa por el webhook
      // entrante, así que estructuralmente no puede re-disparar el Flow.)

      // --- Paso 5: el agente devuelve la conversación a la IA ---
      const liberada = await liberarPausaChat(admin, phoneNumberId, telefonoCliente);
      assert.equal(liberada.ok, true);

      // --- Paso 6: el cliente vuelve a escribir -> la IA responde de nuevo ---
      mock = instalarMetaGraphMock();
      try {
        await procesarCambio(phoneNumberId, valueTexto(phoneNumberId, telefonoCliente, "hola de nuevo", `wamid.${randomUUID()}`));
        assert.ok(mock.llamadas.length > 0, "tras 'Devolver a IA', el Flow debe volver a responder al siguiente mensaje del cliente");
      } finally {
        mock.restaurar();
      }
    });
  },
);
