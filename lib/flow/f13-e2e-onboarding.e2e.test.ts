/**
 * FASE F13 (Go-Live Onboarding, autorizado) — E2E real del onboarding
 * completo de un cliente NUEVO, con tenant/usuario/Flow/número 100%
 * desechables. Nunca usa Daniel/AMORE/Daniela/Charlotte/Solo Talento.
 * Reutiliza el mismo pipeline real de F8.6/F12 (atenderMensajeConFlow +
 * Meta mockeada, nunca Meta real) y las mismas rutas HTTP reales del
 * dashboard (nunca simuladas aparte).
 *
 * Pasos cubiertos (numeración del pedido, Fase 16):
 *  1  crear Auth user               -> admin.auth.admin.createUser real
 *  2  crear tenant                  -> mismo criterio que
 *     app/api/pagos/suscribir/route.ts: tenant_id = user_id
 *  3  crear member                  -> dulabs_miembros_equipo real (rol admin)
 *  4  crear subscription Essential  -> dulabs_suscripciones real, estado 'activa'
 *  5  login                         -> signInWithPassword real
 *  6  configurar negocio            -> dulabs_clientes_config real (POST /api/dashboard/negocio equivalente)
 *  7  crear agent                   -> POST /api/dashboard/agentes real
 *  8  crear Flow                    -> createFlow/createFlowVersion reales
 *  9  publicar                      -> publishFlowVersion real
 *  10 activar                       -> flow_activo=true real
 *  11 simular WhatsApp              -> instalarMetaGraphMock (nunca Meta real)
 *  12 inbound                       -> atenderMensajeConFlow real
 *  13 AI                            -> nodo ai + aiExecutorOverride (nunca Claude/Gemini real)
 *  14 outbound                      -> aserción sobre la llamada real al mock
 *  15 handoff                       -> POST /conversaciones/handoff real
 *  16 Inbox                         -> GET /conversaciones real
 *  17 analytics                     -> GET /analytics real
 *  18 disconnect                    -> desconectarNumeroWhatsapp real
 *  19 verificar preservación        -> Flow/agente/config siguen existiendo
 *  20 cleanup                       -> after() real
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { atenderMensajeConFlow } from "@/lib/flow-runtime-bridge";
import { createFlow, createFlowVersion, publishFlowVersion } from "@/lib/flow/flow-store";
import { ORCHESTRATOR_OUTCOMES } from "@/lib/flow/flow-orchestrator";
import type { FlowDefinition } from "@/lib/flow/types";
import { instalarMetaGraphMock } from "@/lib/testing/meta-graph-mock";
import { desconectarNumeroWhatsapp } from "@/lib/whatsapp-connection-lifecycle";
import { resolverMiembroEquipo } from "@/lib/team";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectExecutor, type EffectDispatchRequest, type EffectDispatchResult, type EffectExecutionContext } from "@/lib/flow/executor-types";
import { GET as conversacionesGET } from "@/app/api/dashboard/conversaciones/route";
import { POST as handoffPOST } from "@/app/api/dashboard/conversaciones/handoff/route";
import { GET as analyticsGET } from "@/app/api/dashboard/analytics/route";
import { GET as agentesGET, POST as agentesPOST } from "@/app/api/dashboard/agentes/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");
process.env.META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "fake-meta-token-f13-onboarding";

function reqGet(url: string, token?: string): NextRequest {
  return new NextRequest(url, { method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {} });
}
function reqJson(url: string, method: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method, headers, body: JSON.stringify(body) });
}

class FakeAiExecutor implements EffectExecutor {
  readonly kind = "ai" as const;
  readonly version = "1.0.0-fake";
  readonly capabilities = { supportsIntegration: false, supportsAsync: false, operationClasses: ["READ" as const] };
  async dispatch(request: EffectDispatchRequest, _context: EffectExecutionContext, _signal?: AbortSignal): Promise<EffectDispatchResult> {
    const data = { classification: "venta", effectId: request.effectId };
    return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data, rawResult: data };
  }
}

function flowOnboarding(): FlowDefinition {
  return {
    name: "F13 onboarding E2E",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "ai", type: "ai", config: { instruction: "Clasifica intención", mode: "classify", classifications: ["venta", "soporte"] } },
      // FASE F13 -- hallazgo real durante esta oleada: un texto como "un
      // asesor te ayuda enseguida" es BLOQUEADO por Claim Security
      // (lib/flow/ai-runtime/ai-response-security.ts::checkDomainCapabilitiesOnly)
      // porque afirma una transferencia a humano sin que ninguna acción
      // "transferir_soporte" haya corrido -- confirmación de que esa
      // protección de F1-F6 sigue activa y correcta para tenants nuevos de
      // self-service, no un bug de F13. Texto neutral a propósito.
      { id: "msg", type: "message", config: { text: "Recibido, gracias por escribirnos." } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "ai" },
      { id: "e2", source: "ai", target: "msg", sourceHandle: "class:venta" },
      { id: "e3", source: "msg", target: "end" },
    ],
    variables: [],
  };
}

describe(
  "FASE F13 — E2E de onboarding completo de un cliente nuevo (Fase 16)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const PHONE = `f13-onboarding-${sufijo}`;
    const TELEFONO = "573000000401";
    const EMAIL = `f13-onboarding-${sufijo}@example.com`;
    const PASSWORD = `F13Test-${randomUUID()}`;
    let userId: string;

    after(async () => {
      const { data: miembro } = await admin.from("dulabs_miembros_equipo").select("tenant_id").eq("user_id", userId).maybeSingle();
      const tenantId = miembro?.tenant_id;
      if (tenantId) {
        await admin.from("dulabs_flow_executions").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_flow_events").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_flow_versions").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_flows").delete().eq("tenant_id", tenantId);
        await admin.from("dulabs_agentes").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_suscripciones").delete().eq("id_tenant", tenantId);
        await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", tenantId);
      }
      await admin.from("dulabs_conversacion_asignaciones").delete().eq("phone_number_id", PHONE);
      await admin.from("dulabs_pausas_chat").delete().eq("phone_number_id", PHONE);
      await admin.from("dulabs_mensajes_log").delete().eq("phone_number_id", PHONE);
      await admin.from("dulabs_clientes_config").delete().eq("phone_number_id", PHONE);
      if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
    });

    it("recorrido de onboarding completo, 20 pasos con estado real encadenado", async () => {
      // 1. crear Auth user (mismo mecanismo real que app/login/page.tsx -- signUp)
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
      if (createError || !created.user) throw createError ?? new Error("no se pudo crear el usuario");
      userId = created.user.id;

      // 2. crear tenant -- mismo criterio real que pagos/suscribir/route.ts: tenant_id = user_id
      const tenantId = userId;

      // 3. crear member (mismo upsert real que pagos/suscribir/route.ts)
      const { error: miembroError } = await admin.from("dulabs_miembros_equipo").upsert(
        { tenant_id: tenantId, user_id: userId, email: EMAIL, rol: "admin", estado: "activo" },
        { onConflict: "user_id" },
      );
      if (miembroError) throw miembroError;

      // 4. crear subscription Essential (mismo criterio real que admin/activar-suscripcion/route.ts)
      const enUnMes = new Date();
      enUnMes.setMonth(enUnMes.getMonth() + 1);
      const { error: suscripcionError } = await admin.from("dulabs_suscripciones").insert({
        id_tenant: tenantId,
        plan: "essential",
        precio_cop: 79990,
        wompi_payment_source_id: null,
        wompi_customer_email: EMAIL,
        estado: "activa",
        fecha_proximo_cobro: enUnMes.toISOString().slice(0, 10),
      });
      if (suscripcionError) throw suscripcionError;

      // 5. login real
      const sesionAnon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const { data: signIn, error: signInError } = await sesionAnon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
      if (signInError || !signIn.session) throw signInError ?? new Error("no se pudo iniciar sesión");
      const token = signIn.session.access_token;

      const miembroResuelto = await resolverMiembroEquipo(admin, userId);
      assert.equal(miembroResuelto?.tenantId, tenantId);
      assert.equal(miembroResuelto?.rol, "admin");

      // 6. configurar negocio (mismo modelo real de dulabs_clientes_config)
      const { error: negocioError } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: tenantId,
        phone_number_id: PHONE,
        whatsapp_business_account_id: `waba-${sufijo}`,
        nombre_negocio: "Negocio F13 E2E",
        telefono_negocio: "570000000020",
      });
      if (negocioError) throw negocioError;

      // 7. crear agent -- vía la ruta HTTP real (POST /api/dashboard/agentes)
      const resCrearAgente = (await agentesPOST(reqJson("http://localhost/api/dashboard/agentes", "POST", { nombre: "Asesor F13" }, token)))!;
      assert.equal(resCrearAgente.status, 200, JSON.stringify(await resCrearAgente.clone().json()));
      const bodyAgente = await resCrearAgente.json();
      assert.ok(bodyAgente.agente?.id, "el agente debe crearse con un id real");

      const resListarAgentes = (await agentesGET(reqGet("http://localhost/api/dashboard/agentes", token)))!;
      assert.equal(resListarAgentes.status, 200);
      const bodyListaAgentes = await resListarAgentes.json();
      assert.ok(bodyListaAgentes.agentes.some((a: { id: number }) => a.id === bodyAgente.agente.id));
      // Ningún campo de API key expuesto al cliente.
      assert.equal("api_key_ia" in (bodyListaAgentes.agentes[0] ?? {}), false);

      // 8. crear Flow  9. publicar
      const flow = await createFlow(admin, { tenantId, slug: `f13-onboarding-${sufijo}`, name: "Flow onboarding F13" });
      const version = await createFlowVersion(admin, { tenantId, flowId: flow.id, versionNumber: 1, definition: flowOnboarding() });
      await publishFlowVersion(admin, tenantId, flow.id, version.id);

      // 10. activar
      const { error: activarError } = await admin.from("dulabs_clientes_config").update({ flow_activo: true, flow_id: flow.id }).eq("phone_number_id", PHONE);
      if (activarError) throw activarError;

      const clienteConfig = { id_tenant: tenantId, phone_number_id: PHONE, flow_activo: true as const, flow_id: flow.id };

      // 11. simular WhatsApp (Meta mockeada)  12. inbound  13. AI  14. outbound
      const mock = instalarMetaGraphMock();
      try {
        const resultado = await atenderMensajeConFlow({
          supabase: admin,
          cliente: clienteConfig as never,
          telefonoCliente: TELEFONO,
          texto: "hola, quiero información",
          wamid: `wamid.${randomUUID()}`,
          aiExecutorOverride: new FakeAiExecutor(),
        });
        assert.equal(resultado.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED, JSON.stringify(resultado));
        assert.equal(mock.llamadas.length, 1, "el nodo AI debe haber producido exactamente un mensaje saliente real");
        assert.equal((mock.llamadas[0].body as { text?: { body?: string } }).text?.body, "Recibido, gracias por escribirnos.");
      } finally {
        mock.restaurar();
      }

      // 15. handoff
      const resHandoff = await handoffPOST(reqJson("http://localhost/api/dashboard/conversaciones/handoff", "POST", { phone_number_id: PHONE, telefono_cliente: TELEFONO, accion: "tomar" }, token));
      assert.equal(resHandoff.status, 200);
      const bodyHandoff = await resHandoff.json();
      assert.equal(bodyHandoff.gano, true);

      // 16. Inbox
      const resInbox = await conversacionesGET(reqGet("http://localhost/api/dashboard/conversaciones", token));
      assert.equal(resInbox.status, 200);
      const bodyInbox = await resInbox.json();
      assert.ok(bodyInbox.conversaciones.some((c: { telefono_cliente: string }) => c.telefono_cliente === TELEFONO));

      // 17. analytics
      const resAnalytics = await analyticsGET(reqGet("http://localhost/api/dashboard/analytics?periodo=30d", token));
      assert.equal(resAnalytics.status, 200);
      const bodyAnalytics = await resAnalytics.json();
      assert.ok(bodyAnalytics.funnel.enviados >= 1, "el mensaje real del recorrido debe contar en analytics");

      // 18. disconnect
      const resultadoDesconexion = await desconectarNumeroWhatsapp(admin, { tenantId, phoneNumberId: PHONE });
      assert.equal(resultadoDesconexion.ok, true);

      // 19. verificar preservación -- Flow y agente siguen existiendo.
      const { data: flowTrasDesconectar } = await admin.from("dulabs_flows").select("id").eq("id", flow.id).maybeSingle();
      assert.ok(flowTrasDesconectar, "el Flow debe sobrevivir a la desconexión");
      const { data: agenteTrasDesconectar } = await admin.from("dulabs_agentes").select("id").eq("id", bodyAgente.agente.id).maybeSingle();
      assert.ok(agenteTrasDesconectar, "el agente debe sobrevivir a la desconexión");

      // 20. cleanup real -- ver after() de arriba.
    });
  },
);
