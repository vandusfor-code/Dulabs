/**
 * FASE F8.6 (Final Hardening + Full E2E, autorizado) — tests de
 * `procesarCambio` (exportada solo para esto, ver comentario en route.ts):
 * cascade multi-tenant completo del webhook, sin el obstáculo de `after()`
 * (que exige un request real de Next.js -- ver webhook-signature-hardening.test.ts).
 *
 * Cobertura: tenant desconocido (E2E-28), número desconectado (Fase 8.5,
 * gate añadido en procesarCambio), aislamiento cross-tenant a nivel del
 * cascade completo, deduplicación LEGACY por wamid (distinta de la
 * deduplicación a nivel Flow ya cubierta en e2e-whatsapp-cloud-api.e2e.test.ts).
 *
 * Tenants/números/mensajes SIEMPRE descartables (randomUUID), NUNCA
 * AMORE/Daniela/Charlotte/Solo Talento. Meta mockeada -- nunca real.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFlow, createFlowVersion, publishFlowVersion } from "@/lib/flow/flow-store";
import type { FlowDefinition } from "@/lib/flow/types";
import { instalarMetaGraphMock } from "@/lib/testing/meta-graph-mock";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");
process.env.META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "fake-meta-token-e2e-f86";
process.env.META_APP_SECRET = process.env.META_APP_SECRET || "test-app-secret-f86";

function flowMinimo(): FlowDefinition {
  return {
    name: "F8.6 procesarCambio hardening",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg", type: "message", config: { text: "Hola" } },
      { id: "q", type: "question", config: { text: "?", variableKey: "r", required: false, validation: { kind: "text" } } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "msg" },
      { id: "e2", source: "msg", target: "q" },
      { id: "e3", source: "q", target: "end" },
    ],
    variables: [],
  };
}

function valueTexto(phoneNumberId: string, telefonoRemitente: string, texto: string, wamid: string) {
  return {
    metadata: { phone_number_id: phoneNumberId, display_phone_number: "573000000000" },
    contacts: [{ wa_id: telefonoRemitente, profile: { name: "Test" } }],
    messages: [{ from: telefonoRemitente, id: wamid, type: "text", text: { body: texto } }],
  };
}

describe(
  "procesarCambio — cascade multi-tenant (hardening F8.6)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const tenantsCreados: string[] = [];
    const phoneNumberIdsCreados: string[] = [];

    async function crearTenantConFlow(overrides?: { estadoConexion?: string }): Promise<{ tenantId: string; phoneNumberId: string; flowId: string }> {
      const tenantId = randomUUID();
      tenantsCreados.push(tenantId);
      const phoneNumberId = `e2e-pc-${sufijo}-${randomUUID().slice(0, 8)}`;
      phoneNumberIdsCreados.push(phoneNumberId);
      const flow = await createFlow(admin, { tenantId, slug: `e2e-pc-${sufijo}-${tenantsCreados.length}`, name: "F8.6" });
      const version = await createFlowVersion(admin, { tenantId, flowId: flow.id, versionNumber: 1, definition: flowMinimo() });
      await publishFlowVersion(admin, tenantId, flow.id, version.id);

      const { error } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: tenantId,
        phone_number_id: phoneNumberId,
        whatsapp_business_account_id: `waba-${phoneNumberId}`,
        telefono_negocio: `5730${Math.floor(Math.random() * 100_000_000)}`,
        nombre_negocio: "E2E F8.6 procesarCambio (descartable)",
        flow_activo: true,
        flow_id: flow.id,
        meta_permanent_token: null,
        ...(overrides?.estadoConexion ? { estado_conexion: overrides.estadoConexion } : {}),
      });
      if (error) throw error;

      // procesarCambio (a diferencia de atenderMensajeConFlow, que se llama
      // directo sin pasar por el cascade LEGACY) sí atraviesa el gate real
      // de cupo mensual de IA (dentroDelCupoIA -> planDelTenant) antes de
      // llegar al bloque Flow -- sin una suscripción activa, el tenant cae a
      // SIN_PLAN (cupo 0) y el mensaje se descarta ahí, nunca por lo que
      // este archivo realmente quiere probar.
      const enUnMes = new Date();
      enUnMes.setMonth(enUnMes.getMonth() + 1);
      const { error: susError } = await admin.from("dulabs_suscripciones").insert({
        id_tenant: tenantId,
        plan: "start",
        estado: "activa",
        precio_cop: 0,
        fecha_proximo_cobro: enUnMes.toISOString().slice(0, 10),
      });
      if (susError) throw susError;

      return { tenantId, phoneNumberId, flowId: flow.id };
    }

    after(async () => {
      if (!HAS_SUPABASE) return;
      for (const tenantId of tenantsCreados) {
        await admin.from("dulabs_mensajes_log").delete().eq("id_tenant", tenantId).select();
        if (phoneNumberIdsCreados.length) {
          await admin.from("dulabs_mensajes_log").delete().in("phone_number_id", phoneNumberIdsCreados);
        }
        await admin.from("dulabs_flow_executions").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_flow_events").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_clientes_config").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId);
      }
    });

    it("1. phone_number_id desconocido (E2E-28) -> no lanza, no llama a Meta, no crea nada", async () => {
      const { procesarCambio } = await import("./route");
      const mock = instalarMetaGraphMock();
      try {
        await assert.doesNotReject(() =>
          procesarCambio(`no-existe-jamas-${randomUUID()}`, valueTexto(`no-existe-jamas-${randomUUID()}`, "573000000010", "hola", `wamid.${randomUUID()}`)),
        );
        assert.equal(mock.llamadas.length, 0);
      } finally {
        mock.restaurar();
      }
    });

    it("2. número con estado_conexion='desconectado' -> ignora el mensaje, cero llamadas a Meta (Fase 8.5)", async () => {
      const { tenantId, phoneNumberId } = await crearTenantConFlow({ estadoConexion: "desconectado" });
      const { procesarCambio } = await import("./route");
      const mock = instalarMetaGraphMock();
      try {
        await procesarCambio(phoneNumberId, valueTexto(phoneNumberId, "573000000011", "hola", `wamid.${randomUUID()}`));
        assert.equal(mock.llamadas.length, 0, "un número desconectado nunca debe intentar responder");
        const { data: ejecs } = await admin.from("dulabs_flow_executions").select("id").eq("tenant_id", tenantId);
        assert.equal(ejecs?.length ?? 0, 0, "tampoco debe crear ninguna ejecución de Flow");
      } finally {
        mock.restaurar();
      }
    });

    it("3. mismo wamid procesado dos veces -> la segunda vez no vuelve a llamar a Meta (dedup real, capa LEGACY/webhook)", async () => {
      const { tenantId, phoneNumberId } = await crearTenantConFlow();
      const { procesarCambio } = await import("./route");
      const wamid = `wamid.${randomUUID()}`;
      const value = valueTexto(phoneNumberId, "573000000012", "hola", wamid);
      const mock = instalarMetaGraphMock();
      try {
        await procesarCambio(phoneNumberId, value);
        const llamadasTrasPrimeraVez = mock.llamadas.length;
        // No se fija un número exacto a propósito: marcarLeidoConTyping
        // también pega contra /messages (marca de lectura, no un envío de
        // Flow), y el Flow mínimo de este archivo manda 2 mensajes propios
        // (nodo "msg" + el prompt del nodo "q") -- lo único que importa acá
        // es que la primera vez SÍ generó actividad real hacia Meta.
        assert.ok(llamadasTrasPrimeraVez > 0, "la primera vez sí debe generar actividad real hacia Meta");
        await procesarCambio(phoneNumberId, value); // MISMO wamid -- reintento de Meta
        assert.equal(mock.llamadas.length, llamadasTrasPrimeraVez, "el reintento con el mismo wamid NUNCA debe generar actividad adicional hacia Meta");
      } finally {
        mock.restaurar();
      }
      void tenantId;
    });

    it("4. aislamiento cross-tenant: procesar el cambio de un tenant nunca crea/toca datos de otro", async () => {
      const a = await crearTenantConFlow();
      const b = await crearTenantConFlow();
      const { procesarCambio } = await import("./route");
      const mock = instalarMetaGraphMock();
      try {
        await procesarCambio(a.phoneNumberId, valueTexto(a.phoneNumberId, "573000000013", "hola desde A", `wamid.${randomUUID()}`));
        const { data: execsB } = await admin.from("dulabs_flow_executions").select("id").eq("tenant_id", b.tenantId);
        assert.equal(execsB?.length ?? 0, 0, "procesar un mensaje del tenant A nunca debe crear una ejecución para el tenant B");
        assert.equal(mock.llamadas[0]?.url.includes(a.phoneNumberId), true, "la respuesta debe salir por el phone_number_id de A, nunca por el de B");
      } finally {
        mock.restaurar();
      }
    });
  },
);
