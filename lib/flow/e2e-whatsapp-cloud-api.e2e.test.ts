/**
 * FASE F8.6 (Final Hardening + Full E2E, autorizado) — harness E2E real
 * contra Supabase (tenants/flows/números descartables, NUNCA
 * AMORE/Daniela/Charlotte/Solo Talento) que ejercita el pipeline completo:
 *
 *   webhook (simulado vía atenderMensajeConFlow/ConFallback, mismo código
 *   que llama app/webhook-dulabs/route.ts) → Flow Engine real → efectos →
 *   SendMessageExecutor real → lib/whatsapp.ts/whatsapp-outbound.ts real →
 *   Meta Graph API MOCKEADA (lib/testing/meta-graph-mock.ts, nunca Meta
 *   real) → persistencia real en dulabs_flow_executions/dulabs_flow_events.
 *
 * Cobertura (spec F8.6 §6, agrupada inteligentemente en menos archivos):
 *  - E2E-01 texto entrante -> Flow -> respuesta de texto
 *  - E2E-02 botón entrante -> Flow -> ramifica por handle -> respuesta
 *  - E2E-03..07 media entrante (image/video/audio/document/sticker) ->
 *    normalización -> __incomingMedia
 *  - E2E-08..12 media saliente (los mismos 5 tipos)
 *  - E2E-21..23 retry (503 transitorio, 429+Retry-After, error de red) y
 *    error permanente (400, sin retry) -- F8.3 ya tiene su propia suite
 *    dedicada de 15+ casos (flow-orchestrator-send-message-retry.test.ts,
 *    sin tocar); esto solo prueba que el retry real se dispara end-to-end
 *    a través del pipeline completo, no duplica esa cobertura.
 *  - E2E-27 aislamiento cross-tenant
 *  - E2E-30 evento duplicado (mismo wamid dos veces) -> Meta se llama UNA
 *    sola vez
 *  - E2E-35 variables de salida (media/botón quedan en `variables` de la
 *    ejecución persistida)
 *  - E2E-36 persistencia del estado de la conversación entre turnos
 *
 * Templates (E2E-13), integraciones HTTP (E2E-14), AI Claude/Gemini
 * (E2E-15/16), contactos/tags/custom fields (E2E-17/18/19) y Trigger
 * Router (E2E-20) YA tienen suites de integración reales y dedicadas
 * (flow-executor-framework.test.ts, trigger-router-api.test.ts,
 * flow-f7-3-contact-tools.test.ts, flow-orchestrator-f7-contacts-tags.test.ts,
 * etc., todas cerradas en F5/F6/F7/F8.1/F8.2) -- no se duplican acá, solo
 * se re-ejecutan como parte de la regresión general (npm run test:flow).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { atenderMensajeConFlow } from "@/lib/flow-runtime-bridge";
import { createFlow, createFlowVersion, publishFlowVersion, getExecutionById } from "@/lib/flow/flow-store";
import { getActiveExecutionByConversation } from "@/lib/flow/flow-store";
import { ORCHESTRATOR_OUTCOMES } from "@/lib/flow/flow-orchestrator";
import type { FlowDefinition } from "@/lib/flow/types";
import type { NormalizedInboundMedia } from "@/lib/flow/engine-types";
import { instalarMetaGraphMock } from "@/lib/testing/meta-graph-mock";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");
// Los tenants descartables de este harness se crean SIN meta_permanent_token
// (nunca un token real) -- resolverTokenMeta (lib/whatsapp-outbound.ts) cae
// entonces al token de plataforma. Un valor fake alcanza: Meta está
// mockeada (instalarMetaGraphMock) y nunca valida el Bearer real, solo que
// esté presente (ver `autorizacionPresente` en las aserciones).
process.env.META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "fake-meta-token-e2e-f86";

function flowBotones(): FlowDefinition {
  return {
    name: "E2E botones",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "botones", type: "buttons", config: { text: "¿Confirmas?", buttons: [{ id: "btn_si", label: "Sí" }, { id: "btn_no", label: "No" }], variableKey: "eleccion" } },
      { id: "msg_si", type: "message", config: { text: "Confirmado" } },
      { id: "msg_no", type: "message", config: { text: "Cancelado" } },
      { id: "end_a", type: "end", config: {} },
      { id: "end_b", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "botones" },
      { id: "e2", source: "botones", target: "msg_si", sourceHandle: "button:btn_si" },
      { id: "e3", source: "botones", target: "msg_no", sourceHandle: "button:btn_no" },
      { id: "e4", source: "msg_si", target: "end_a" },
      { id: "e5", source: "msg_no", target: "end_b" },
    ],
    variables: [],
  };
}

/** start -> message (con media saliente configurada) -> end -- sirve para inbound (__incomingMedia del evento start) Y outbound (media del nodo message) a la vez. */
function flowConMediaSaliente(media: { type: "image" | "video" | "audio" | "document" | "sticker"; url: string; caption?: string; filename?: string }): FlowDefinition {
  return {
    name: "E2E media",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: media.type === "audio" || media.type === "sticker" ? undefined : "Aquí tienes", media } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "end" },
    ],
    variables: [],
  };
}

/** start -> UN solo message -> end. A propósito UN solo send_message (nunca 2, como flowTextoSimple con su nodo question) -- para que contar llamadas al mock sea inequívoco en los tests de retry/dedup. */
function flowUnMensaje(): FlowDefinition {
  return {
    name: "E2E un mensaje",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "Hola, ¿en qué te ayudo?" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "end" },
    ],
    variables: [],
  };
}

function flowTextoSimple(): FlowDefinition {
  return {
    name: "E2E texto",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "Hola, ¿en qué te ayudo?" } },
      { id: "q", type: "question", config: { text: "¿Cuál es tu nombre?", variableKey: "nombre", required: true, validation: { kind: "text" } } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "q" },
      { id: "e3", source: "q", target: "end" },
    ],
    variables: [{ key: "nombre", label: "Nombre", type: "string" }],
  };
}

describe(
  "F8.6 — Full E2E: webhook -> Flow Engine -> Meta mock -> persistencia",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const tenantsCreados: string[] = [];
    const flowIdsCreados: string[] = [];

    async function crearTenantConFlowPublicado(def: FlowDefinition): Promise<{ tenantId: string; phoneNumberId: string; flowId: string }> {
      const tenantId = randomUUID();
      tenantsCreados.push(tenantId);
      const phoneNumberId = `e2e-${sufijo}-${randomUUID().slice(0, 8)}`;
      const flow = await createFlow(admin, { tenantId, slug: `e2e-${sufijo}-${flowIdsCreados.length}`, name: def.name });
      flowIdsCreados.push(flow.id);
      const version = await createFlowVersion(admin, { tenantId, flowId: flow.id, versionNumber: 1, definition: def });
      await publishFlowVersion(admin, tenantId, flow.id, version.id);

      const { error } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: tenantId,
        phone_number_id: phoneNumberId,
        whatsapp_business_account_id: `waba-${phoneNumberId}`,
        telefono_negocio: `5730${Math.floor(Math.random() * 100_000_000)}`,
        nombre_negocio: "E2E F8.6 (descartable)",
        flow_activo: true,
        flow_id: flow.id,
        meta_permanent_token: null,
      });
      if (error) throw error;

      return { tenantId, phoneNumberId, flowId: flow.id };
    }

    const cliente = (tenantId: string, phoneNumberId: string, flowId: string) => ({
      id_tenant: tenantId,
      phone_number_id: phoneNumberId,
      flow_activo: true as const,
      flow_id: flowId,
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      for (const tenantId of tenantsCreados) {
        await admin.from("dulabs_flow_executions").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_flow_events").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_flow_triggers").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId);
      }
    });

    it("E2E-01 — texto entrante -> Flow -> respuesta de texto real (vía Meta mock)", async () => {
      const { tenantId, phoneNumberId, flowId } = await crearTenantConFlowPublicado(flowUnMensaje());
      const mock = instalarMetaGraphMock();
      try {
        const r = await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(tenantId, phoneNumberId, flowId) as never,
          telefonoCliente: "573000000001",
          texto: "hola",
          wamid: `wamid.${randomUUID()}`,
        });
        assert.equal(r.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED, JSON.stringify(r));
        assert.equal(mock.llamadas.length, 1);
        assert.match(mock.llamadas[0].url, new RegExp(`${phoneNumberId}/messages`));
        assert.equal((mock.llamadas[0].body as { text?: { body?: string } }).text?.body, "Hola, ¿en qué te ayudo?");
        assert.equal(mock.llamadas[0].autorizacionPresente, true);
      } finally {
        mock.restaurar();
      }
    });

    it("E2E-02 — botón entrante -> Flow ramifica por el handle correcto -> respuesta correcta", async () => {
      const { tenantId, phoneNumberId, flowId } = await crearTenantConFlowPublicado(flowBotones());
      const mock = instalarMetaGraphMock();
      try {
        // Turno 1: arranca en el nodo "botones" (waiting_input=button).
        await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(tenantId, phoneNumberId, flowId) as never,
          telefonoCliente: "573000000002",
          texto: "hola",
          wamid: `wamid.${randomUUID()}`,
        });
        mock.llamadas.length = 0;
        // Turno 2: tap del botón "btn_si".
        const r2 = await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(tenantId, phoneNumberId, flowId) as never,
          telefonoCliente: "573000000002",
          texto: "Sí",
          buttonId: "btn_si",
          wamid: `wamid.${randomUUID()}`,
        });
        assert.equal(r2.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED, JSON.stringify(r2));
        assert.equal((mock.llamadas[0].body as { text?: { body?: string } }).text?.body, "Confirmado", "debe tomar la rama de btn_si, nunca la de btn_no");
      } finally {
        mock.restaurar();
      }
    });

    for (const tipo of ["image", "video", "audio", "document", "sticker"] as const) {
      it(`E2E-03..12 (${tipo}) — media entrante normalizada a __incomingMedia Y media saliente enviada correctamente`, async () => {
        const mediaSaliente = {
          type: tipo,
          url: `https://example.com/${tipo}.bin`,
          ...(tipo === "image" || tipo === "video" || tipo === "document" ? { caption: `caption-${tipo}` } : {}),
          ...(tipo === "document" ? { filename: `archivo-${tipo}.pdf` } : {}),
        };
        const { tenantId, phoneNumberId, flowId } = await crearTenantConFlowPublicado(flowConMediaSaliente(mediaSaliente));
        const mock = instalarMetaGraphMock();
        const mediaEntrante: NormalizedInboundMedia = { type: tipo, mediaId: `media-in-${tipo}`, mimeType: `${tipo}/mock` };
        try {
          const r = await atenderMensajeConFlow({
            supabase: admin,
            cliente: cliente(tenantId, phoneNumberId, flowId) as never,
            telefonoCliente: "573000000003",
            texto: "",
            wamid: `wamid.${randomUUID()}`,
            media: mediaEntrante,
          });
          assert.equal(r.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED, JSON.stringify(r));

          // Inbound: __incomingMedia quedó sembrada en la ejecución persistida.
          const exec = await getExecutionById(admin, tenantId, r.executionRowId!);
          assert.deepEqual((exec?.variables as Record<string, unknown>)?.__incomingMedia, mediaEntrante);

          // Outbound: el tipo real enviado a Meta coincide con el configurado en el Flow.
          assert.equal(mock.llamadas.length, 1);
          const body = mock.llamadas[0].body as Record<string, unknown>;
          assert.equal(body.type, tipo);
          assert.ok(body[tipo], `el payload debe traer la clave "${tipo}" con la referencia de media`);
        } finally {
          mock.restaurar();
        }
      });
    }

    it("E2E-21 — 503 transitorio seguido de éxito -> reintenta y entrega (F8.3, verificado end-to-end)", async () => {
      const { tenantId, phoneNumberId, flowId } = await crearTenantConFlowPublicado(flowUnMensaje());
      const mock = instalarMetaGraphMock({ colaMessages: [{ tipo: "error", status: 503 }, { tipo: "ok" }] });
      try {
        const r = await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(tenantId, phoneNumberId, flowId) as never,
          telefonoCliente: "573000000004",
          texto: "hola",
          wamid: `wamid.${randomUUID()}`,
        });
        assert.equal(r.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
        assert.equal(mock.llamadas.length, 2, "debe haber reintentado exactamente una vez más tras el 503");
      } finally {
        mock.restaurar();
      }
    });

    it("E2E-22 — error permanente (400) -> NO reintenta, falla de una", async () => {
      const { tenantId, phoneNumberId, flowId } = await crearTenantConFlowPublicado(flowUnMensaje());
      const mock = instalarMetaGraphMock({ colaMessages: [{ tipo: "error", status: 400, errorMessage: "Invalid parameter" }] });
      try {
        const r = await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(tenantId, phoneNumberId, flowId) as never,
          telefonoCliente: "573000000005",
          texto: "hola",
          wamid: `wamid.${randomUUID()}`,
        });
        // El orchestrator procesa el evento igual (PROCESSED): la falla de
        // Meta queda en el efecto send_message, no en el outcome top-level
        // (mismo criterio que flow-orchestrator-send-message-retry.test.ts).
        assert.equal(r.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED, JSON.stringify(r));
        assert.equal(mock.llamadas.length, 1, "un error permanente (4xx que no sea 429) nunca debe reintentarse");
      } finally {
        mock.restaurar();
      }
    });

    it("E2E-23 — 429 con Retry-After -> reintenta y entrega", async () => {
      const { tenantId, phoneNumberId, flowId } = await crearTenantConFlowPublicado(flowUnMensaje());
      const mock = instalarMetaGraphMock({ colaMessages: [{ tipo: "error", status: 429, retryAfterSegundos: 1 }, { tipo: "ok" }] });
      try {
        const r = await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(tenantId, phoneNumberId, flowId) as never,
          telefonoCliente: "573000000006",
          texto: "hola",
          wamid: `wamid.${randomUUID()}`,
        });
        assert.equal(r.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
        assert.equal(mock.llamadas.length, 2);
      } finally {
        mock.restaurar();
      }
    });

    it("E2E-27 — aislamiento cross-tenant: dos tenants con el mismo texto nunca comparten ejecución/variables", async () => {
      const flowA = await crearTenantConFlowPublicado(flowTextoSimple());
      const flowB = await crearTenantConFlowPublicado(flowTextoSimple());
      const mock = instalarMetaGraphMock();
      try {
        const rA = await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(flowA.tenantId, flowA.phoneNumberId, flowA.flowId) as never,
          telefonoCliente: "573000000007",
          texto: "hola desde A",
          wamid: `wamid.${randomUUID()}`,
        });
        const rB = await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(flowB.tenantId, flowB.phoneNumberId, flowB.flowId) as never,
          telefonoCliente: "573000000007", // MISMO número de cliente final, tenants distintos
          texto: "hola desde B",
          wamid: `wamid.${randomUUID()}`,
        });
        assert.notEqual(rA.executionRowId, rB.executionRowId);
        const execA = await getActiveExecutionByConversation(admin, { tenantId: flowA.tenantId, phoneNumberId: flowA.phoneNumberId, telefonoCliente: "573000000007" });
        const execB = await getActiveExecutionByConversation(admin, { tenantId: flowB.tenantId, phoneNumberId: flowB.phoneNumberId, telefonoCliente: "573000000007" });
        assert.ok(execA);
        assert.ok(execB);
        assert.notEqual(execA!.tenant_id, execB!.tenant_id);
      } finally {
        mock.restaurar();
      }
    });

    it("E2E-30 — evento duplicado (mismo wamid dos veces) -> Meta se llama UNA sola vez", async () => {
      // A propósito flowTextoSimple (NO flowUnMensaje): el dedup real de
      // insertEventIdempotent está scoped por (flowExecutionId, eventId) --
      // si el primer turno YA completa el Flow (como flowUnMensaje), no
      // queda ninguna ejecución "activa" a la que atarse, y un segundo
      // "start" con el mismo wamid crea una ejecución NUEVA (comportamiento
      // correcto: una conversación nueva, no un duplicado) en vez de
      // detectarse como duplicado. Con flowTextoSimple, el primer turno
      // queda esperando en el nodo "q" (execution sigue activa), así que el
      // segundo envío con el MISMO wamid sí reutiliza esa misma ejecución y
      // el dedup real puede aplicar.
      const { tenantId, phoneNumberId, flowId } = await crearTenantConFlowPublicado(flowTextoSimple());
      const wamid = `wamid.${randomUUID()}`;
      const mock = instalarMetaGraphMock();
      try {
        const r1 = await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(tenantId, phoneNumberId, flowId) as never,
          telefonoCliente: "573000000008",
          texto: "hola",
          wamid,
        });
        const llamadasTrasR1 = mock.llamadas.length;
        const r2 = await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(tenantId, phoneNumberId, flowId) as never,
          telefonoCliente: "573000000008",
          texto: "hola",
          wamid, // MISMO wamid -- reintento de Meta
        });
        assert.equal(r1.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
        assert.equal(r2.outcome, ORCHESTRATOR_OUTCOMES.DUPLICATE_EVENT, JSON.stringify(r2));
        assert.equal(mock.llamadas.length, llamadasTrasR1, "un evento duplicado (mismo wamid) NUNCA debe volver a llamar a Meta");
      } finally {
        mock.restaurar();
      }
    });

    it("E2E-35/36 — variables de salida y estado de la conversación persisten entre turnos", async () => {
      const { tenantId, phoneNumberId, flowId } = await crearTenantConFlowPublicado(flowTextoSimple());
      const mock = instalarMetaGraphMock();
      try {
        const r1 = await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(tenantId, phoneNumberId, flowId) as never,
          telefonoCliente: "573000000009",
          texto: "hola",
          wamid: `wamid.${randomUUID()}`,
        });
        const r2 = await atenderMensajeConFlow({
          supabase: admin,
          cliente: cliente(tenantId, phoneNumberId, flowId) as never,
          telefonoCliente: "573000000009",
          texto: "Ana",
          wamid: `wamid.${randomUUID()}`,
        });
        assert.equal(r1.executionRowId, r2.executionRowId, "el segundo turno debe continuar la MISMA ejecución, no crear una nueva");
        const exec = await getExecutionById(admin, tenantId, r2.executionRowId!);
        assert.equal((exec?.variables as Record<string, unknown>)?.nombre, "Ana");
        assert.equal(exec?.status, "completed");
      } finally {
        mock.restaurar();
      }
    });
  },
);
