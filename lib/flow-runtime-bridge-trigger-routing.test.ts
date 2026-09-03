/**
 * Fase 4.A (Trigger Router → Runtime, autorizado) — integración real,
 * CONSERVADORA: Trigger Router conectado a atenderMensajeConFlowConFallback
 * SOLO para los remitentes/phone_number_id de prueba reservados en
 * lib/flow-routing.ts (TRIGGER_ROUTING_TEST_SENDERS). Cualquier otro
 * remitente (incluida Daniela) sigue exactamente el camino legacy
 * (cliente.flow_id directo), sin ninguna consulta nueva a
 * dulabs_flow_triggers -- ver test 20.
 *
 * Los remitentes de prueba son fijos (match EXACTO contra el allowlist, no
 * un rango) -- una conversación por remitente, para no interferir entre
 * tests (una ejecución activa bloquearía crear otra para el mismo
 * phone_number_id+remitente, ver dulabs_flow_executions_active_conversation_uidx).
 *
 * Mismo patrón que flow-runtime-bridge-escape-hatch.test.ts: tenant/flow
 * DESCARTABLES (nunca datos de Daniela), self-skip sin credenciales de
 * Supabase. dulabs_flows/dulabs_flow_versions quedan huérfanos pero inertes
 * al terminar (mismo motivo ya documentado en flow-runtime-bridge.test.ts:
 * dulabs_flow_versions_guard_immutable no permite DELETE, fuera de alcance
 * de esta fase) -- dulabs_flow_triggers, dulabs_flow_executions,
 * dulabs_pausas_chat y dulabs_clientes_config sí se limpian.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  atenderMensajeConFlowConFallback,
  decidirFallbackDesdeResultado,
  resolverFlowIdConTriggerRouting,
} from "@/lib/flow-runtime-bridge";
import { createFlow, createFlowVersion, publishFlowVersion, createFlowTrigger, archiveFlow } from "@/lib/flow/flow-store";
import { createSupabaseFlowOrchestratorStore } from "@/lib/flow/flow-orchestrator-store-supabase";
import { ORCHESTRATOR_OUTCOMES, type OrchestratorResult } from "@/lib/flow/flow-orchestrator";
import type { FlowDefinition } from "@/lib/flow/types";
import type { ClienteConfig } from "@/lib/supabase";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// Reservados en lib/flow-routing.ts::TRIGGER_ROUTING_TEST_SENDERS -- ÚNICAS
// combinaciones phone_number_id/remitente autorizadas a usar Trigger Router
// hoy. Match EXACTO, no un rango -- un número por test para aislar cada
// conversación.
const PHONE_NUMBER_ID_AUTORIZADO = "test-trigger-routing-suite";
const N = {
  keyword: "573000009001",
  contains: "573000009002",
  startsWith: "573000009003",
  priority: "573000009004",
  noTrigger: "573000009005",
  disabled: "573000009006",
  draft: "573000009007",
  archived: "573000009008",
  noMatch: "573000009009",
  sinFlow: "573000009010",
  activeExecution: "573000009011",
  nuevaConversacion: "573000009012",
  tenantIsolation: "573000009013",
  duplicado: "573000009014",
  versionado: "573000009015",
  hatch: "573000009016",
  runtimeError: "573000009017",
} as const;
// NO está en el allowlist -- debe comportarse exactamente como legacy (test 20).
const REMITENTE_NO_AUTORIZADO = "573001112244";

describe(
  "Fase 4.A — Trigger Router conectado al Runtime (integración real, tenant descartable)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_ID = randomUUID();
    const TENANT_B_ID = randomUUID(); // solo para el test de tenant isolation (14)

    let flowLegacyId: string;
    let flowKeywordId: string;
    let flowContainsId: string;
    let flowStartsWithId: string;
    let flowPriorityLowId: string;
    let flowPriorityHighId: string;
    let flowDisabledId: string;
    let flowDraftId: string;
    let flowArchivedId: string;
    let flowRotoId: string; // start sin transición saliente -- produce engineError real (test 19)
    let flowBId: string; // tenant B (test 14)

    function flowEcoSimple(mensaje: string): FlowDefinition {
      return {
        name: mensaje,
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          { id: "msg", type: "message", config: { text: mensaje } },
          { id: "end", type: "end", config: {} },
        ],
        edges: [
          { id: "e1", source: "start", target: "msg" },
          { id: "e2", source: "msg", target: "end" },
        ],
        variables: [],
      };
    }

    // Aterriza en una pregunta de TEXTO libre -- necesario para los tests de
    // activeExecution (12) y hatches-antes-que-Flow (18), mismo patrón que
    // flow-runtime-bridge-escape-hatch.test.ts.
    function flowConPreguntaAbierta(mensaje: string): FlowDefinition {
      return {
        name: mensaje,
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          { id: "msg", type: "message", config: { text: mensaje } },
          { id: "q", type: "question", config: { text: "¿Algo más?", variableKey: "algoMas", required: false, validation: { kind: "text" } } },
          { id: "end", type: "end", config: {} },
        ],
        edges: [
          { id: "e1", source: "start", target: "msg" },
          { id: "e2", source: "msg", target: "q" },
          { id: "e3", source: "q", target: "end" },
        ],
        variables: [{ key: "algoMas", label: "Algo más", type: "string" }],
      };
    }

    // Nodo start SIN transición saliente -- runFlowEngine falla con
    // TRANSITION_NOT_FOUND (engineError REAL, no mockeado). Ver flow-engine.ts.
    function flowRoto(): FlowDefinition {
      return {
        name: "Flow roto (start sin salida) -- test 19",
        nodes: [{ id: "start", type: "start", config: { triggerType: "first_message" } }],
        edges: [],
        variables: [],
      };
    }

    async function crearYPublicar(tenantId: string, def: FlowDefinition, slug: string): Promise<string> {
      const flow = await createFlow(supabase, { tenantId, slug: `${slug}-${Date.now()}-${randomUUID().slice(0, 8)}`, name: slug });
      const version = await createFlowVersion(supabase, { tenantId, flowId: flow.id, versionNumber: 1, definition: def });
      await publishFlowVersion(supabase, tenantId, flow.id, version.id);
      return flow.id;
    }

    async function crearSinPublicar(tenantId: string, def: FlowDefinition, slug: string): Promise<string> {
      const flow = await createFlow(supabase, { tenantId, slug: `${slug}-${Date.now()}-${randomUUID().slice(0, 8)}`, name: slug });
      await createFlowVersion(supabase, { tenantId, flowId: flow.id, versionNumber: 1, definition: def });
      return flow.id;
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      await supabase.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_ID,
        nombre_negocio: "Fase 4.A Trigger Routing (borrar)",
        whatsapp_business_account_id: `waba-${PHONE_NUMBER_ID_AUTORIZADO}`,
        phone_number_id: PHONE_NUMBER_ID_AUTORIZADO,
        telefono_negocio: "0000000000",
      });

      flowLegacyId = await crearYPublicar(TENANT_ID, flowEcoSimple("[LEGACY] Hola, soy el flow de siempre."), "legacy");
      flowKeywordId = await crearYPublicar(TENANT_ID, flowEcoSimple("[KEYWORD] Bienvenida a ventas."), "keyword");
      flowContainsId = await crearYPublicar(TENANT_ID, flowEcoSimple("[CONTAINS] Info de precios."), "contains");
      flowStartsWithId = await crearYPublicar(TENANT_ID, flowEcoSimple("[STARTS_WITH] Hola robot activado."), "starts-with");
      flowPriorityLowId = await crearYPublicar(TENANT_ID, flowEcoSimple("[PRIORITY_LOW] Oferta genérica."), "priority-low");
      flowPriorityHighId = await crearYPublicar(TENANT_ID, flowConPreguntaAbierta("[PRIORITY_HIGH] Oferta VIP."), "priority-high");
      flowDisabledId = await crearYPublicar(TENANT_ID, flowEcoSimple("[DISABLED] Nunca debería verse."), "disabled");
      flowDraftId = await crearSinPublicar(TENANT_ID, flowEcoSimple("[DRAFT] Nunca debería verse."), "draft");
      flowArchivedId = await crearYPublicar(TENANT_ID, flowEcoSimple("[ARCHIVED] Nunca debería verse."), "archived");
      flowRotoId = await crearYPublicar(TENANT_ID, flowRoto(), "roto");
      flowBId = await crearYPublicar(TENANT_B_ID, flowEcoSimple("[TENANT_B] Esto NUNCA debe responderle al tenant A."), "tenant-b");

      await createFlowTrigger(supabase, { tenantId: TENANT_ID, flowId: flowKeywordId, config: { type: "keyword", keywords: ["ventas"] }, priority: 0 });
      await createFlowTrigger(supabase, { tenantId: TENANT_ID, flowId: flowContainsId, config: { type: "message_contains", keywords: ["precio"] }, priority: 0 });
      await createFlowTrigger(supabase, { tenantId: TENANT_ID, flowId: flowStartsWithId, config: { type: "message_starts_with", keywords: ["hola robot"] }, priority: 0 });
      await createFlowTrigger(supabase, { tenantId: TENANT_ID, flowId: flowPriorityLowId, config: { type: "keyword", keywords: ["oferta"] }, priority: 10 });
      await createFlowTrigger(supabase, { tenantId: TENANT_ID, flowId: flowPriorityHighId, config: { type: "keyword", keywords: ["oferta"] }, priority: 20 });
      await createFlowTrigger(supabase, { tenantId: TENANT_ID, flowId: flowDisabledId, config: { type: "keyword", keywords: ["descuento"] }, priority: 0, enabled: false });
      await createFlowTrigger(supabase, { tenantId: TENANT_ID, flowId: flowDraftId, config: { type: "keyword", keywords: ["borrador"] }, priority: 0 });
      await createFlowTrigger(supabase, { tenantId: TENANT_ID, flowId: flowArchivedId, config: { type: "keyword", keywords: ["archivado"] }, priority: 0 });
      await archiveFlow(supabase, { tenantId: TENANT_ID, flowId: flowArchivedId });
      await createFlowTrigger(supabase, { tenantId: TENANT_B_ID, flowId: flowBId, config: { type: "keyword", keywords: ["ventas"] }, priority: 999 });
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase.from("dulabs_flow_triggers").delete().eq("tenant_id", TENANT_ID);
      await supabase.from("dulabs_flow_triggers").delete().eq("tenant_id", TENANT_B_ID);
      await supabase.from("dulabs_flow_executions").delete().eq("phone_number_id", PHONE_NUMBER_ID_AUTORIZADO);
      await supabase.from("dulabs_flow_executions").delete().eq("telefono_cliente", REMITENTE_NO_AUTORIZADO);
      await supabase.from("dulabs_pausas_chat").delete().eq("phone_number_id", PHONE_NUMBER_ID_AUTORIZADO);
      await supabase.from("dulabs_clientes_config").delete().eq("phone_number_id", PHONE_NUMBER_ID_AUTORIZADO);
    });

    function clienteCon(flowId: string, tenantId = TENANT_ID): ClienteConfig & { flow_activo: true; flow_id: string } {
      return {
        id: `c-4a-${randomUUID().slice(0, 8)}`,
        id_tenant: tenantId,
        phone_number_id: PHONE_NUMBER_ID_AUTORIZADO,
        nombre_negocio: "Fase 4.A Trigger Routing (borrar)",
        flow_activo: true as const,
        flow_id: flowId,
      } as ClienteConfig & { flow_activo: true; flow_id: string };
    }

    async function flowIdDeEjecucion(executionRowId: string): Promise<string> {
      const { data } = await supabase.from("dulabs_flow_executions").select("flow_id").eq("id", executionRowId).maybeSingle();
      return data!.flow_id as string;
    }

    // 1 + 2 — Trigger válido (keyword exacta) -> selecciona el Flow correcto.
    it("1/2. keyword exacta -> Trigger Router selecciona el flow del trigger, no el legacy", async () => {
      const cliente = clienteCon(flowLegacyId);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.keyword, texto: "ventas", wamid: `w-1-${randomUUID()}` });
      assert.equal(r.motivo, "processed_ok");
      assert.equal(await flowIdDeEjecucion(r.result!.executionRowId!), flowKeywordId);
    });

    // 3 — Contains.
    it("3. message_contains -> matchea texto libre que CONTIENE la keyword", async () => {
      const cliente = clienteCon(flowLegacyId);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.contains, texto: "¿cuál es el precio de manicure?", wamid: `w-3-${randomUUID()}` });
      assert.equal(r.motivo, "processed_ok");
      assert.equal(await flowIdDeEjecucion(r.result!.executionRowId!), flowContainsId);
    });

    // 4 — Starts with.
    it("4. message_starts_with -> matchea texto que EMPIEZA con la keyword", async () => {
      const cliente = clienteCon(flowLegacyId);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.startsWith, texto: "hola robot, necesito ayuda", wamid: `w-4-${randomUUID()}` });
      assert.equal(r.motivo, "processed_ok");
      assert.equal(await flowIdDeEjecucion(r.result!.executionRowId!), flowStartsWithId);
    });

    // 5 — Priority (dos flows, mismo trigger keyword, distinta prioridad).
    it("5. dos triggers keyword iguales, distinta prioridad -> gana el de mayor prioridad", async () => {
      const cliente = clienteCon(flowLegacyId);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.priority, texto: "oferta", wamid: `w-5-${randomUUID()}` });
      assert.equal(await flowIdDeEjecucion(r.result!.executionRowId!), flowPriorityHighId, "debe ganar priority=20 sobre priority=10");
    });

    // 6 — No trigger -> fallback legacy.
    it("6. ningún trigger coincide -> fallback a cliente.flow_id legacy", async () => {
      const cliente = clienteCon(flowLegacyId);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.noTrigger, texto: "buenos días, quiero información general", wamid: `w-6-${randomUUID()}` });
      assert.equal(r.motivo, "processed_ok");
      assert.equal(await flowIdDeEjecucion(r.result!.executionRowId!), flowLegacyId);
    });

    // 7 — Trigger disabled -> fallback legacy.
    it("7. trigger disabled -> excluido, fallback a legacy", async () => {
      const cliente = clienteCon(flowLegacyId);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.disabled, texto: "descuento", wamid: `w-7-${randomUUID()}` });
      assert.equal(await flowIdDeEjecucion(r.result!.executionRowId!), flowLegacyId);
    });

    // 8 — Trigger apunta a draft -> fallback legacy.
    it("8. trigger de un flow en DRAFT (nunca publicado) -> excluido, fallback a legacy", async () => {
      const cliente = clienteCon(flowLegacyId);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.draft, texto: "borrador", wamid: `w-8-${randomUUID()}` });
      assert.equal(await flowIdDeEjecucion(r.result!.executionRowId!), flowLegacyId);
    });

    // 9 — Trigger apunta a archived -> fallback legacy.
    it("9. trigger de un flow ARCHIVED -> excluido, fallback a legacy", async () => {
      const cliente = clienteCon(flowLegacyId);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.archived, texto: "archivado", wamid: `w-9-${randomUUID()}` });
      assert.equal(await flowIdDeEjecucion(r.result!.executionRowId!), flowLegacyId);
    });

    // 10 — Trigger existe pero no coincide (mismo caso que 6, con triggers
    // reales configurados en el tenant, ninguno relevante para este texto).
    it("10. hay triggers configurados en el tenant pero ninguno coincide con este texto -> fallback a legacy", async () => {
      const cliente = clienteCon(flowLegacyId);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.noMatch, texto: "xyz texto sin ninguna relación", wamid: `w-10-${randomUUID()}` });
      assert.equal(await flowIdDeEjecucion(r.result!.executionRowId!), flowLegacyId);
    });

    // 11 — No trigger + no legacy flow -> LEGACY (bridge corta ANTES del Orchestrator).
    it("11. ni trigger coincide ni hay flow_id legacy -> sin_flow_configurado, NUNCA toca el Orchestrator", async () => {
      const cliente = clienteCon("" /* sin flow_id legacy */);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.sinFlow, texto: "xyz sin relación con nada", wamid: `w-11-${randomUUID()}` });
      assert.equal(r.handled, false);
      assert.equal(r.motivo, "sin_flow_configurado");
      assert.equal(r.result, undefined, "no debe existir ningún OrchestratorResult -- el Orchestrator nunca se invocó");
      const { data } = await supabase.from("dulabs_flow_executions").select("id").eq("phone_number_id", PHONE_NUMBER_ID_AUTORIZADO).eq("telefono_cliente", N.sinFlow);
      assert.equal(data?.length ?? 0, 0, "no debe haberse creado ninguna ejecución");
    });

    // 12 — Conversación activa -> continúa el Flow actual aunque otro trigger gane.
    it("12. ejecución activa en Flow A -> el siguiente mensaje NUNCA cambia a Flow B aunque su texto matchee otro trigger", async () => {
      const cliente = clienteCon(flowLegacyId);
      const primero = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.activeExecution, texto: "oferta", wamid: `w-12a-${randomUUID()}` });
      const executionRowId = primero.result!.executionRowId!;
      assert.equal(await flowIdDeEjecucion(executionRowId), flowPriorityHighId);

      const { data: filaAntes } = await supabase.from("dulabs_flow_executions").select("status, expected_input").eq("id", executionRowId).maybeSingle();
      assert.equal(filaAntes?.status, "waiting_input", "debe seguir esperando la pregunta abierta del flow de prioridad alta");

      // Este texto matchea el trigger EXACTO de flowKeywordId -- si el Router
      // se consultara acá, ganaría un flow distinto. Debe ignorarse por completo.
      const segundo = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.activeExecution, texto: "ventas", wamid: `w-12b-${randomUUID()}` });
      assert.equal(segundo.result?.executionRowId, executionRowId, "debe seguir siendo la MISMA ejecución, nunca una nueva");
      assert.equal(await flowIdDeEjecucion(executionRowId), flowPriorityHighId, "el flow de la ejecución no debe cambiar jamás mientras está activa");
    });

    // 13 — Nueva conversación (contacto distinto) -> el Router SÍ puede
    // seleccionar un flow distinto del que usó otra conversación.
    it("13. nueva conversación (sin ejecución activa) -> el Router puede seleccionar un flow distinto de otras conversaciones", async () => {
      const cliente = clienteCon(flowLegacyId);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.nuevaConversacion, texto: "ventas", wamid: `w-13-${randomUUID()}` });
      assert.equal(await flowIdDeEjecucion(r.result!.executionRowId!), flowKeywordId);
    });

    // 14 — Tenant isolation.
    it("14. un trigger del tenant B jamás gana el routing de un evento del tenant A, ni con prioridad altísima", async () => {
      const cliente = clienteCon(flowLegacyId, TENANT_ID);
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.tenantIsolation, texto: "ventas", wamid: `w-14-${randomUUID()}` });
      const flowUsado = await flowIdDeEjecucion(r.result!.executionRowId!);
      assert.equal(flowUsado, flowKeywordId, "debe ganar el trigger del tenant A (priority 0), nunca el del tenant B (priority 999)");
      assert.notEqual(flowUsado, flowBId);
    });

    // 15 — Flow inexistente/race -> fallback seguro (verifica que el safety
    // net EXISTENTE de decidirFallbackDesdeResultado -- sin tocar -- sigue
    // aplicando igual a un resultado que pudo haber llegado con un flowId
    // resuelto por el Router. El Router mismo no puede producir un flowId
    // inválido -- ver el reporte de la Fase 2 del audit -- así que esto
    // prueba la RED DE SEGURIDAD, no una condición de carrera forzada.
    it("15. un OrchestratorResult 'rejected' (config inválida) sigue cayendo a fallback seguro sin cambios", () => {
      const resultado: OrchestratorResult = {
        outcome: ORCHESTRATOR_OUTCOMES.REJECTED,
        rejectReason: "flow_not_published",
        effects: [],
        dispatchedEffectIds: [],
      };
      const decision = decidirFallbackDesdeResultado(resultado);
      assert.equal(decision.handled, false);
      assert.equal(decision.motivo, "fallback_a_legacy");
      assert.equal(decision.requiereMarcarFallida, false, "sin executionRowId no hay nada que marcar como fallido");
    });

    // 16 — Evento duplicado -> comportamiento existente intacto.
    //
    // Corrección (autorizada, tras el fallo real observado contra Supabase):
    // el texto DEBE disparar un flow que quede waiting_input tras el primer
    // mensaje (flowPriorityHighId vía el trigger "oferta"), no uno que
    // complete en el mismo turno (flowKeywordId/flowEcoSimple). insertEventIdempotent
    // dedup está scoped a (tenant_id, flow_execution_id, event_id) -- si la
    // primera ejecución ya terminó (status=completed) antes de la segunda
    // llamada, getActiveExecution no la encuentra, y el Orchestrator crea
    // LEGÍTIMAMENTE una ejecución nueva (distinto flow_execution_id), así que
    // el mismo wamid nunca colisiona con nada -- no hay ningún duplicado que
    // detectar, y eso NO es un bug. Con un flow que sigue activo, la segunda
    // llamada cae sobre la MISMA ejecución y sí ejercita la deduplicación real.
    it("16. mismo wamid dos veces (conversación nueva vía Trigger Router, flow que queda activo) -> segunda vez es duplicate_event, sin doble ejecución", async () => {
      const cliente = clienteCon(flowLegacyId);
      const wamid = `w-16-${randomUUID()}`;
      const primero = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.duplicado, texto: "oferta", wamid });
      assert.equal(primero.motivo, "processed_ok");

      // Corrección (autorizada) -- delta, no conteo absoluto: dulabs_flow_executions
      // es append-only (DELETE bloqueado por FK real desde dulabs_flow_events),
      // así que corridas anteriores de esta misma suite contra Supabase real
      // pueden dejar filas de OTRAS conversaciones para este mismo
      // phone_number_id. Lo que este test debe demostrar es que el segundo
      // evento duplicado NO agrega una fila nueva -- no que la tabla esté vacía.
      const { data: antes } = await supabase.from("dulabs_flow_executions").select("id").eq("phone_number_id", PHONE_NUMBER_ID_AUTORIZADO).eq("telefono_cliente", N.duplicado);
      const countAfterFirst = antes?.length ?? 0;

      const segundo = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.duplicado, texto: "oferta", wamid });
      assert.equal(segundo.motivo, "duplicate_event");

      const { data: despues } = await supabase.from("dulabs_flow_executions").select("id").eq("phone_number_id", PHONE_NUMBER_ID_AUTORIZADO).eq("telefono_cliente", N.duplicado);
      const countAfterSecond = despues?.length ?? 0;
      assert.equal(countAfterSecond, countAfterFirst, "el evento duplicado NO debe crear ninguna ejecución nueva (delta debe ser 0)");
    });

    // 17 — Publicación de nueva versión durante conversación activa -> la
    // ejecución existente conserva su versión pinneada.
    it("17. publicar v2 del flow mientras hay una ejecución activa en v1 -> la ejecución sigue en v1", async () => {
      const cliente = clienteCon(flowLegacyId);
      const primero = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.versionado, texto: "oferta", wamid: `w-17a-${randomUUID()}` });
      const executionRowId = primero.result!.executionRowId!;
      const { data: filaV1 } = await supabase.from("dulabs_flow_executions").select("flow_version_id").eq("id", executionRowId).maybeSingle();
      const versionPinneada = filaV1!.flow_version_id as string;

      const v2 = await createFlowVersion(supabase, { tenantId: TENANT_ID, flowId: flowPriorityHighId, versionNumber: 2, definition: flowConPreguntaAbierta("[PRIORITY_HIGH] Oferta VIP v2 -- NO debe verse en esta ejecución.") });
      await publishFlowVersion(supabase, TENANT_ID, flowPriorityHighId, v2.id);

      const segundo = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.versionado, texto: "sin gracias", wamid: `w-17b-${randomUUID()}` });
      assert.equal(segundo.result?.executionRowId, executionRowId);
      const { data: filaDespues } = await supabase.from("dulabs_flow_executions").select("flow_version_id").eq("id", executionRowId).maybeSingle();
      assert.equal(filaDespues?.flow_version_id, versionPinneada, "flow_version_id nunca debe migrar automáticamente");
    });

    // 18 — Hatches Daniela-specific siguen ejecutándose ANTES del Flow (el
    // Trigger Router nunca los intercepta ni los reemplaza).
    it("18. escape hatch sigue interceptando ANTES de llegar al Trigger Router / Orchestrator", async () => {
      const cliente = clienteCon(flowLegacyId);
      const primero = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.hatch, texto: "oferta", wamid: `w-18a-${randomUUID()}` });
      const executionRowId = primero.result!.executionRowId!;
      const { data: filaAntes } = await supabase.from("dulabs_flow_executions").select("status, expected_input").eq("id", executionRowId).maybeSingle();
      assert.equal(filaAntes?.expected_input, "text");

      const segundo = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.hatch, texto: "cancela, quiero hablar con Dani", wamid: `w-18b-${randomUUID()}` });
      assert.equal(segundo.handled, true);
      assert.equal(segundo.motivo, "escape_hatch", "el hatch debe interceptar sin que el Trigger Router participe");
    });

    // 19 — Runtime error real (engineError genuino) -> fallback existente intacto.
    it("19. flow legacy roto (engineError real) -> fallback_a_legacy, registrado, sin cambios en el safety net", async () => {
      const cliente = clienteCon(flowRotoId);
      // Texto sin match de ningún trigger -> cae al flow_id legacy, que está
      // roto a propósito (start sin transición saliente).
      const r = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: N.runtimeError, texto: "xyz sin match alguno", wamid: `w-19-${randomUUID()}` });
      assert.equal(r.handled, false);
      assert.equal(r.motivo, "fallback_a_legacy");
      assert.ok(r.result?.engineError, "debe haber un engineError REAL (TRANSITION_NOT_FOUND)");
    });

    // 20 — Remitente NO autorizado -> comportamiento legacy intacto, CERO
    // interacción con el Trigger Router (ni siquiera para un texto que
    // matchearía un trigger real si el remitente estuviera autorizado).
    it("20. remitente fuera del allowlist de prueba -> nunca consulta el Trigger Router, siempre cliente.flow_id", async () => {
      const cliente = clienteCon(flowLegacyId);
      // "ventas" matchea flowKeywordId -- si el Router se consultara para
      // este remitente, NO usaría flowLegacyId.
      const r1 = await resolverFlowIdConTriggerRouting({
        supabase,
        cliente,
        telefonoCliente: REMITENTE_NO_AUTORIZADO,
        texto: "ventas",
        store: createSupabaseFlowOrchestratorStore(supabase),
      });
      assert.deepEqual(r1, { kind: "usar_flow_id", flowId: flowLegacyId });

      const r2 = await atenderMensajeConFlowConFallback({ supabase, cliente, telefonoCliente: REMITENTE_NO_AUTORIZADO, texto: "ventas", wamid: `w-20-${randomUUID()}` });
      assert.equal(await flowIdDeEjecucion(r2.result!.executionRowId!), flowLegacyId);
    });
  },
);
