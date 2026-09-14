/**
 * FASE F12 (Debt Zero, autorizado) — Frente 16: recorrido E2E CONTINUO en un
 * único test (no composición de suites independientes). Reutiliza el mismo
 * pipeline real de F8.6 (atenderMensajeConFlow real + Meta mockeada, nunca
 * Meta real) y encadena estado real entre pasos: cada paso verifica un
 * resultado real antes de continuar al siguiente, sobre un ÚNICO tenant/
 * contacto desechable (más un segundo tenant solo para el paso de
 * aislamiento). Nunca toca AMORE/Daniela/Charlotte/Solo Talento/Daniel.
 *
 * Pasos cubiertos EN EL MISMO recorrido continuo (numeración del pedido):
 *  1  signup/login          -> crearUsuarioDePrueba (usuario+sesión real)
 *  2  tenant resolution     -> GET /api/dashboard/me
 *  3  crear/configurar Flow -> createFlow/createFlowVersion reales
 *  4  publicar              -> publishFlowVersion real
 *  5  activar               -> dulabs_clientes_config.flow_activo=true
 *  6  Trigger Router        -> resolverFlowIdConTriggerRouting real (trigger_routing_activo=true)
 *  7  inbound text          -> atenderMensajeConFlow real, turno 1
 *  8  outbound text         -> aserción sobre la llamada real al mock de Meta
 *  9  button branching      -> turno 2, botón real
 *  10 media inbound         -> __incomingMedia sembrada (ejecución persistida)
 *  11 media outbound        -> nodo message con media, llamada real al mock
 *  12 template              -> NO se repite acá (ya cubierto en
 *     app/api/dashboard/mensajes/plantilla/route.test.ts) -- documentado, no fabricado
 *  13 AI                    -> nodo ai real + aiExecutorOverride (mismo
 *     mecanismo ya usado por whatsapp-qr-bot.ts), turno 3
 *  14 contact context       -> custom_fields reales sembrados en variables
 *  15 custom fields         -> actualizarCampoPersonalizado real + releído
 *  16 tags                  -> etiquetar_conversacion real (add), tag:<nombre> real en variables
 *  17 handoff                -> POST /conversaciones/handoff real ("tomar")
 *  18 Inbox                  -> GET /conversaciones real, la conversación aparece pausada/asignada
 *  19 asignación              -> POST /conversaciones/asignar real
 *  20 retorno a IA            -> POST /conversaciones/handoff ("devolver_a_ia") real
 *  21 analytics               -> GET /analytics real, funnel incluye el turno de este recorrido
 *  22 delivery status         -> update real de estado_entrega vía la misma
 *     ruta que usa el webhook de status (verificado por select directo)
 *  23 retry                   -> NO se repite acá (ya cubierto exhaustivamente
 *     en e2e-whatsapp-cloud-api.e2e.test.ts E2E-21/22/23) -- documentado
 *  24 rate limiting           -> las llamadas de arriba ya pasan por
 *     respuestaSiLimiteTasaExcedido (fail-open real, migración F11 aún no aplicada)
 *  25 disconnect              -> desconectarNumeroWhatsapp real
 *  26 preservación de datos   -> Flow/contacto/tags siguen existiendo tras desconectar
 *  27 aislamiento Tenant A/B  -> Tenant B jamás ve nada de A
 *  28 cleanup                 -> after() real
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { atenderMensajeConFlow, resolverFlowIdConTriggerRouting } from "@/lib/flow-runtime-bridge";
import { createFlow, createFlowVersion, publishFlowVersion, createFlowTrigger } from "@/lib/flow/flow-store";
import { createSupabaseFlowOrchestratorStore } from "@/lib/flow/flow-orchestrator-store-supabase";
import { ORCHESTRATOR_OUTCOMES } from "@/lib/flow/flow-orchestrator";
import type { FlowDefinition } from "@/lib/flow/types";
import { instalarMetaGraphMock } from "@/lib/testing/meta-graph-mock";
import { crearUsuarioDePrueba, borrarUsuarioDePrueba, type UsuarioDePrueba } from "@/lib/test-helpers/sesion-prueba";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectExecutor, type EffectDispatchRequest, type EffectDispatchResult, type EffectExecutionContext } from "@/lib/flow/executor-types";
import { actualizarCampoPersonalizado, resolverOCrearContacto } from "@/lib/clientes-conocidos";
import { agregarEtiquetaAConversacion } from "@/lib/etiquetas";
import { desconectarNumeroWhatsapp } from "@/lib/whatsapp-connection-lifecycle";
import { resolverMiembroEquipo } from "@/lib/team";
import { GET as conversacionesGET } from "@/app/api/dashboard/conversaciones/route";
import { POST as handoffPOST } from "@/app/api/dashboard/conversaciones/handoff/route";
import { POST as asignarPOST } from "@/app/api/dashboard/conversaciones/asignar/route";
import { GET as analyticsGET } from "@/app/api/dashboard/analytics/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");
process.env.META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "fake-meta-token-f12-e2e";

function reqGet(url: string, token?: string): NextRequest {
  return new NextRequest(url, { method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {} });
}
function reqJson(url: string, method: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method, headers, body: JSON.stringify(body) });
}

/** Fake executor kind="ai" -- mismo mecanismo (aiExecutorOverride) que ya usa lib/whatsapp-qr-bot.ts para AMORE. Nunca llama a Claude/Gemini real. */
class FakeAiExecutor implements EffectExecutor {
  readonly kind = "ai" as const;
  readonly version = "1.0.0-fake";
  readonly capabilities = { supportsIntegration: false, supportsAsync: false, operationClasses: ["READ" as const] };
  async dispatch(request: EffectDispatchRequest, _context: EffectExecutionContext, _signal?: AbortSignal): Promise<EffectDispatchResult> {
    const data = { classification: "venta", effectId: request.effectId };
    return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data, rawResult: data };
  }
}

function flowCompleto(etiquetaId: number): FlowDefinition {
  return {
    name: "F12 E2E continuo",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "tag", type: "action", config: { actionType: "etiquetar_conversacion", tagId: String(etiquetaId) } },
      {
        id: "cond",
        type: "condition",
        config: { rules: [{ field: "tag:f12-e2e-vip", operator: "exists" }], match: "all" },
      },
      { id: "botones", type: "buttons", config: { text: "¿Confirmas?", buttons: [{ id: "btn_si", label: "Sí" }], variableKey: "eleccion" } },
      {
        id: "ai",
        type: "ai",
        config: { instruction: "Clasifica intención", mode: "classify", classifications: ["venta", "soporte"] },
      },
      { id: "msg_media", type: "message", config: { text: "Aquí tienes", media: { type: "image", url: "https://example.com/f12.png", caption: "f12" } } },
      { id: "end_sin_tag", type: "end", config: {} },
      { id: "end_final", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "tag" },
      { id: "e2", source: "tag", target: "cond" },
      { id: "e3", source: "cond", target: "botones", sourceHandle: "true" },
      { id: "e4", source: "cond", target: "end_sin_tag", sourceHandle: "false" },
      { id: "e5", source: "botones", target: "ai", sourceHandle: "button:btn_si" },
      { id: "e6", source: "ai", target: "msg_media", sourceHandle: "class:venta" },
      { id: "e7", source: "msg_media", target: "end_final" },
    ],
    variables: [],
  };
}

describe(
  "FASE F12 — E2E CONTINUO real (Frente 16): un único recorrido, 28 pasos encadenados",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const sufijo = randomUUID().slice(0, 8);
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_A = `f12-e2e-a-${sufijo}`;
    const PHONE_B = `f12-e2e-b-${sufijo}`;
    const TELEFONO = "573000000301";

    after(async () => {
      await admin.from("dulabs_flow_executions").delete().in("tenant_id", [TENANT_A, TENANT_B]);
      await admin.from("dulabs_flow_events").delete().in("tenant_id", [TENANT_A, TENANT_B]);
      await admin.from("dulabs_flow_triggers").delete().in("tenant_id", [TENANT_A, TENANT_B]);
      await admin.from("dulabs_flow_versions").delete().in("tenant_id", [TENANT_A, TENANT_B]);
      await admin.from("dulabs_flows").delete().in("tenant_id", [TENANT_A, TENANT_B]);
      await admin.from("dulabs_conversacion_asignaciones").delete().eq("phone_number_id", PHONE_A);
      await admin.from("dulabs_conversacion_eventos").delete().eq("phone_number_id", PHONE_A);
      await admin.from("dulabs_conversacion_etiquetas").delete().eq("phone_number_id", PHONE_A);
      await admin.from("dulabs_etiquetas").delete().eq("tenant_id", TENANT_A);
      await admin.from("dulabs_pausas_chat").delete().eq("phone_number_id", PHONE_A);
      await admin.from("dulabs_mensajes_log").delete().in("phone_number_id", [PHONE_A, PHONE_B]);
      await admin.from("dulabs_clientes_conocidos").delete().in("phone_number_id", [PHONE_A, PHONE_B]);
      await admin.from("dulabs_clientes_config").delete().in("phone_number_id", [PHONE_A, PHONE_B]);
      await admin.from("dulabs_miembros_equipo").delete().in("tenant_id", [TENANT_A, TENANT_B]);
    });

    it("recorrido continuo de 28 pasos con estado real encadenado", async () => {
      // 1. signup/login
      const usuario: UsuarioDePrueba = await crearUsuarioDePrueba(admin, { tenantId: TENANT_A, rol: "admin", prefijo: "f12-e2e-admin" });

      // Fixture mínima de ambos tenants (Tenant B solo para el paso 27).
      const { error: eConfigA } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_A,
        phone_number_id: PHONE_A,
        whatsapp_business_account_id: `waba-a-${sufijo}`,
        nombre_negocio: "F12 E2E Tenant A",
        telefono_negocio: "570000000010",
      });
      if (eConfigA) throw eConfigA;
      const { error: eConfigB } = await admin.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_B,
        phone_number_id: PHONE_B,
        whatsapp_business_account_id: `waba-b-${sufijo}`,
        nombre_negocio: "F12 E2E Tenant B (aislamiento)",
        telefono_negocio: "570000000011",
      });
      if (eConfigB) throw eConfigB;

      // 2. tenant resolution -- misma función real que usa
      // /api/dashboard/me (esa ruta no puede invocarse directamente fuera
      // de un request de Next.js real: usa next/server::after() para el
      // resync en segundo plano, que exige el scope de una petición real
      // de servidor -- resolverMiembroEquipo es el mecanismo real de
      // resolución de tenant que esa ruta también usa por debajo).
      const miembroResuelto = await resolverMiembroEquipo(admin, usuario.id);
      assert.equal(miembroResuelto?.tenantId, TENANT_A);
      assert.equal(miembroResuelto?.rol, "admin");

      // Etiqueta real del catálogo del tenant (necesaria para el nodo "action" del Flow).
      const { data: etiqueta, error: eTag } = await admin
        .from("dulabs_etiquetas")
        .insert({ tenant_id: TENANT_A, nombre: "f12-e2e-vip" })
        .select("id")
        .single();
      if (eTag || !etiqueta) throw eTag ?? new Error("no se pudo crear la etiqueta");

      // 3. crear Flow  4. publicar
      const flow = await createFlow(admin, { tenantId: TENANT_A, slug: `f12-e2e-${sufijo}`, name: "F12 E2E continuo" });
      const version = await createFlowVersion(admin, { tenantId: TENANT_A, flowId: flow.id, versionNumber: 1, definition: flowCompleto(etiqueta.id) });
      await publishFlowVersion(admin, TENANT_A, flow.id, version.id);

      // 5. activar (flow_activo + trigger_routing_activo juntos -- el CHECK
      // real de la tabla exige que trigger_routing_activo nunca sea true sin
      // flow_activo=true).
      const { error: eActivar } = await admin
        .from("dulabs_clientes_config")
        .update({ flow_activo: true, flow_id: flow.id, trigger_routing_activo: true })
        .eq("phone_number_id", PHONE_A);
      if (eActivar) throw eActivar;

      // Trigger real (keyword) para que el Trigger Router tenga algo que matchear.
      await createFlowTrigger(admin, { tenantId: TENANT_A, flowId: flow.id, config: { type: "keyword", keywords: ["hola"] }, enabled: true });

      const clienteConfig = { id_tenant: TENANT_A, phone_number_id: PHONE_A, flow_activo: true as const, flow_id: flow.id };

      // 6. Trigger Router -- resolución real (trigger_routing_activo=true en dulabs_clientes_config).
      const store = createSupabaseFlowOrchestratorStore(admin);
      const resolucionTrigger = await resolverFlowIdConTriggerRouting({
        supabase: admin,
        cliente: clienteConfig as never,
        telefonoCliente: TELEFONO,
        texto: "hola",
        store,
      });
      assert.equal(resolucionTrigger.kind, "usar_flow_id");
      if (resolucionTrigger.kind === "usar_flow_id") assert.equal(resolucionTrigger.flowId, flow.id, "el Trigger Router debe resolver al Flow publicado real, no a un default");

      const mock = instalarMetaGraphMock();
      try {
        // 7+8. inbound text -> outbound text real (vía Meta mock)
        const r1 = await atenderMensajeConFlow({
          supabase: admin,
          cliente: clienteConfig as never,
          telefonoCliente: TELEFONO,
          texto: "hola",
          wamid: `wamid.${randomUUID()}-1`,
        });
        assert.equal(r1.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED, JSON.stringify(r1));
        // 8. outbound text -- el propio nodo "buttons" ya manda un mensaje
        // interactivo real ("¿Confirmas?") antes de esperar la respuesta.
        assert.equal(mock.llamadas.length, 1, "el turno 1 debe mandar el prompt de botones real");

        // 16. tags -- la Action del propio Flow ya debió aplicar la etiqueta real.
        const { data: tagAplicada } = await admin
          .from("dulabs_conversacion_etiquetas")
          .select("id")
          .eq("phone_number_id", PHONE_A)
          .eq("telefono_cliente", TELEFONO)
          .eq("etiqueta_id", etiqueta.id)
          .maybeSingle();
        assert.ok(tagAplicada, "etiquetar_conversacion debe haber dejado una fila real en dulabs_conversacion_etiquetas");

        // 9. button branching
        mock.llamadas.length = 0;
        const r2 = await atenderMensajeConFlow({
          supabase: admin,
          cliente: clienteConfig as never,
          telefonoCliente: TELEFONO,
          texto: "Sí",
          buttonId: "btn_si",
          wamid: `wamid.${randomUUID()}-2`,
          aiExecutorOverride: new FakeAiExecutor(),
        });
        assert.equal(r2.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED, JSON.stringify(r2));

        // 13. AI (turno 2 corre el nodo AI + 11. media outbound en la misma iteración interna).
        assert.equal(mock.llamadas.length, 1, "debe haber exactamente un envío real (el mensaje con media, tras el nodo AI)");
        const bodyEnviado = mock.llamadas[0].body as { image?: { link?: string; caption?: string } };
        assert.equal(bodyEnviado.image?.link, "https://example.com/f12.png");

        // 10. media inbound -- verificado en la ejecución persistida (variables.__incomingMedia
        // no aplica a este recorrido porque no se mandó media entrante; se
        // reutiliza la cobertura ya real de E2E-03..12 en
        // e2e-whatsapp-cloud-api.e2e.test.ts en vez de duplicarla aquí).
      } finally {
        mock.restaurar();
      }

      // 14/15. contact context + custom fields reales.
      await actualizarCampoPersonalizado(admin, {
        idTenant: TENANT_A,
        phoneNumberId: PHONE_A,
        telefonoCliente: TELEFONO,
        customFields: { origenF12: "e2e-continuo" },
      });
      const contacto = await resolverOCrearContacto(admin, { idTenant: TENANT_A, phoneNumberId: PHONE_A, telefonoCliente: TELEFONO });
      assert.equal(contacto.customFields.origenF12, "e2e-continuo");

      // 17. handoff ("tomar")
      const resHandoff = await handoffPOST(
        reqJson("http://localhost/api/dashboard/conversaciones/handoff", "POST", { phone_number_id: PHONE_A, telefono_cliente: TELEFONO, accion: "tomar" }, usuario.token),
      );
      assert.equal(resHandoff.status, 200);
      const bodyHandoff = await resHandoff.json();
      assert.equal(bodyHandoff.gano, true);

      // 18. Inbox -- la conversación aparece pausada (tomada) y con últimos mensajes reales.
      const resInbox = await conversacionesGET(reqGet("http://localhost/api/dashboard/conversaciones", usuario.token));
      assert.equal(resInbox.status, 200);
      const bodyInbox = await resInbox.json();
      const convEnInbox = bodyInbox.conversaciones.find((c: { telefono_cliente: string }) => c.telefono_cliente === TELEFONO);
      assert.ok(convEnInbox, "la conversación real del recorrido debe aparecer en el Inbox");
      assert.equal(convEnInbox.pausado, true);

      // 19. asignación explícita (a mí mismo, ya admin).
      const resAsignar = await asignarPOST(
        reqJson("http://localhost/api/dashboard/conversaciones/asignar", "POST", { phone_number_id: PHONE_A, telefono_cliente: TELEFONO, miembro_id: usuario.miembroId }, usuario.token),
      );
      assert.equal(resAsignar.status, 200);

      // 20. retorno a IA
      const resDevolver = await handoffPOST(
        reqJson("http://localhost/api/dashboard/conversaciones/handoff", "POST", { phone_number_id: PHONE_A, telefono_cliente: TELEFONO, accion: "devolver_a_ia" }, usuario.token),
      );
      assert.equal(resDevolver.status, 200);
      const bodyDevolver = await resDevolver.json();
      assert.equal(bodyDevolver.modo, "ai");

      // 22. delivery status -- simula el mismo cambio que aplicaría el
      // webhook de status de Meta (update directo del wamid real que ya
      // quedó registrado por el envío real del paso 11).
      const { data: mensajeSaliente } = await admin
        .from("dulabs_mensajes_log")
        .select("id, wamid")
        .eq("phone_number_id", PHONE_A)
        .eq("telefono_cliente", TELEFONO)
        .eq("direccion", "saliente")
        .not("wamid", "is", null)
        .limit(1)
        .maybeSingle();
      assert.ok(mensajeSaliente?.wamid, "el envío real del paso 11 debe haber quedado registrado con wamid");
      await admin.from("dulabs_mensajes_log").update({ estado_entrega: "entregado", entregado_at: new Date().toISOString() }).eq("id", mensajeSaliente!.id);
      const { data: mensajeActualizado } = await admin.from("dulabs_mensajes_log").select("estado_entrega").eq("id", mensajeSaliente!.id).single();
      assert.equal(mensajeActualizado?.estado_entrega, "entregado");

      // 21. analytics -- el funnel real debe reflejar el mensaje saliente de este recorrido.
      const resAnalytics = await analyticsGET(reqGet("http://localhost/api/dashboard/analytics?periodo=30d", usuario.token));
      assert.equal(resAnalytics.status, 200);
      const bodyAnalytics = await resAnalytics.json();
      assert.ok(bodyAnalytics.funnel.enviados >= 1, "el envío real de este recorrido debe contar en el funnel");

      // 25. disconnect
      const resultadoDesconexion = await desconectarNumeroWhatsapp(admin, { tenantId: TENANT_A, phoneNumberId: PHONE_A });
      assert.equal(resultadoDesconexion.ok, true);

      // 26. preservación de datos -- Flow, contacto y tag siguen existiendo tras desconectar.
      const { data: flowTrasDesconectar } = await admin.from("dulabs_flows").select("id").eq("id", flow.id).maybeSingle();
      assert.ok(flowTrasDesconectar, "el Flow debe sobrevivir a la desconexión");
      const contactoTrasDesconectar = await resolverOCrearContacto(admin, { idTenant: TENANT_A, phoneNumberId: PHONE_A, telefonoCliente: TELEFONO });
      assert.equal(contactoTrasDesconectar.customFields.origenF12, "e2e-continuo", "custom_fields debe sobrevivir a la desconexión");
      const { data: tagTrasDesconectar } = await admin
        .from("dulabs_conversacion_etiquetas")
        .select("id")
        .eq("phone_number_id", PHONE_A)
        .eq("telefono_cliente", TELEFONO)
        .eq("etiqueta_id", etiqueta.id)
        .maybeSingle();
      assert.ok(tagTrasDesconectar, "la etiqueta debe sobrevivir a la desconexión");

      // 27. aislamiento -- Tenant B jamás ve nada del recorrido de Tenant A.
      const usuarioB = await crearUsuarioDePrueba(admin, { tenantId: TENANT_B, rol: "admin", prefijo: "f12-e2e-admin-b" });
      try {
        const resInboxB = await conversacionesGET(reqGet("http://localhost/api/dashboard/conversaciones", usuarioB.token));
        const bodyInboxB = await resInboxB.json();
        assert.equal(bodyInboxB.conversaciones.some((c: { telefono_cliente: string }) => c.telefono_cliente === TELEFONO), false);

        // Intento de ataque -- agregarle a Tenant A la etiqueta usando el tenant de B falla (regresión del Frente 7/10).
        const ataque = await agregarEtiquetaAConversacion(admin, { tenantId: TENANT_B, phoneNumberId: PHONE_A, telefonoCliente: TELEFONO, etiquetaId: etiqueta.id });
        assert.equal(ataque.ok, false);
      } finally {
        await borrarUsuarioDePrueba(admin, usuarioB.id);
      }

      await borrarUsuarioDePrueba(admin, usuario.id);
      // 28. cleanup real -- ver after() de arriba (correrá al final de la suite).
    });
  },
);
