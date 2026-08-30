/**
 * Fase 1 (Blocker #2, autorizado) — fallback de seguridad Flow -> LEGACY.
 *
 * Dos capas de prueba:
 * 1. Lógica de decisión PURA (decidirFallbackDesdeResultado) -- sin DB,
 *    cubre A/B/C/E/H/I/J construyendo OrchestratorResult a mano para cada
 *    combinación de outcome/engineError/efectos.
 * 2. Integración real contra Supabase (tenant descartable) -- cubre
 *    D (excepción real), F (cita real creada antes de un fallo posterior,
 *    sin duplicarla) y G/K (ejecución rota queda "failed" y el siguiente
 *    mensaje arranca una ejecución nueva, no queda pegada para siempre).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  atenderMensajeConFlowConFallback,
  decidirFallbackDesdeResultado,
} from "@/lib/flow-runtime-bridge";
import { createFlow, createFlowVersion, publishFlowVersion } from "@/lib/flow/flow-store";
import { citaActivaPara } from "@/lib/especialistas";
import { ORCHESTRATOR_OUTCOMES, type OrchestratorResult } from "@/lib/flow/flow-orchestrator";
import type { FlowDefinition } from "@/lib/flow/types";
import type { ClienteConfig } from "@/lib/supabase";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function baseResult(overrides: Partial<OrchestratorResult>): OrchestratorResult {
  return {
    outcome: ORCHESTRATOR_OUTCOMES.PROCESSED,
    executionRowId: "row-1",
    effects: [],
    dispatchedEffectIds: [],
    ...overrides,
  };
}

const SEND_MESSAGE_EFFECT = {
  type: "send_message" as const,
  nodeId: "msg-x",
  content: { text: "hola" },
  executionId: "exec-1",
  effectId: "eff-msg-1",
};

describe("Fase 1 — decidirFallbackDesdeResultado (lógica pura, sin DB)", () => {
  it("A. processed sin engineError, CON algún mensaje enviado -> handled=true, no requiere marcar fallida", () => {
    const r = decidirFallbackDesdeResultado(
      baseResult({ outcome: ORCHESTRATOR_OUTCOMES.PROCESSED, effects: [SEND_MESSAGE_EFFECT] }),
    );
    assert.equal(r.handled, true);
    assert.equal(r.motivo, "processed_ok");
    assert.equal(r.requiereMarcarFallida, false);
  });

  it("A2 (Blocker #7). processed sin engineError, SIN ningún mensaje enviado -> handled=false, 'sin_intencion_reconocida' (deja pasar a LEGACY, no es un fallo)", () => {
    const r = decidirFallbackDesdeResultado(baseResult({ outcome: ORCHESTRATOR_OUTCOMES.PROCESSED, effects: [] }));
    assert.equal(r.handled, false);
    assert.equal(r.motivo, "sin_intencion_reconocida");
    assert.equal(r.requiereMarcarFallida, false, "no es un fallo real, no hay nada que desenganchar");
  });

  it("B. rejected por configuración (sin executionRowId) sin send_message -> fallback a LEGACY, sin marcar nada fallido", () => {
    const r = decidirFallbackDesdeResultado(
      baseResult({ outcome: ORCHESTRATOR_OUTCOMES.REJECTED, rejectReason: "flow_not_published", executionRowId: undefined }),
    );
    assert.equal(r.handled, false);
    assert.equal(r.motivo, "fallback_a_legacy");
    assert.equal(r.requiereMarcarFallida, false, "un rejected de configuración no tiene fila que marcar");
  });

  it("C. engineError sin send_message -> fallback a LEGACY Y requiere marcar la ejecución como fallida", () => {
    const r = decidirFallbackDesdeResultado(
      baseResult({
        outcome: ORCHESTRATOR_OUTCOMES.PROCESSED,
        engineError: { code: "INVALID_INPUT", message: "servicio_no_manejado", nodeId: "act-consultar" },
        executionRowId: "row-real-1",
      }),
    );
    assert.equal(r.handled, false);
    assert.equal(r.motivo, "fallback_a_legacy");
    assert.equal(r.requiereMarcarFallida, true, "engineError con executionRowId real SÍ hay que desenganchar");
  });

  it("E. engineError CON send_message ya emitido -> NUNCA fallback a LEGACY, aunque haya fallado", () => {
    const r = decidirFallbackDesdeResultado(
      baseResult({
        outcome: ORCHESTRATOR_OUTCOMES.PROCESSED,
        engineError: { code: "INVALID_INPUT", message: "algo falló después de enviar", nodeId: "act-x" },
        effects: [SEND_MESSAGE_EFFECT],
        executionRowId: "row-real-2",
      }),
    );
    assert.equal(r.handled, true, "handled=true significa que el llamador NO debe correr LEGACY encima");
    assert.equal(r.motivo, "send_message_ya_enviado");
    assert.equal(r.requiereMarcarFallida, false, "no se marca fallida en este camino (se documenta, no se desengancha)");
    assert.equal(r.yaEnvioAlgo, true);
  });

  it("H. concurrency_exhausted sin send_message -> fallback a LEGACY y requiere marcar fallida", () => {
    const r = decidirFallbackDesdeResultado(
      baseResult({ outcome: ORCHESTRATOR_OUTCOMES.CONCURRENCY_EXHAUSTED, executionRowId: "row-real-3" }),
    );
    assert.equal(r.handled, false);
    assert.equal(r.requiereMarcarFallida, true);
  });

  it("H2. concurrency_exhausted CON send_message ya emitido -> NUNCA fallback", () => {
    const r = decidirFallbackDesdeResultado(
      baseResult({
        outcome: ORCHESTRATOR_OUTCOMES.CONCURRENCY_EXHAUSTED,
        effects: [SEND_MESSAGE_EFFECT],
        executionRowId: "row-real-4",
      }),
    );
    assert.equal(r.handled, true);
    assert.equal(r.motivo, "send_message_ya_enviado");
  });

  it("I. duplicate_event -> handled=true SIEMPRE, nunca corre LEGACY (es un reintento de Meta, no un fallo)", () => {
    const r = decidirFallbackDesdeResultado(baseResult({ outcome: ORCHESTRATOR_OUTCOMES.DUPLICATE_EVENT }));
    assert.equal(r.handled, true);
    assert.equal(r.motivo, "duplicate_event");
    assert.equal(r.requiereMarcarFallida, false);
  });

  it("J. terminal_no_op -> handled=true, comportamiento definido, sin duplicación", () => {
    const r = decidirFallbackDesdeResultado(baseResult({ outcome: ORCHESTRATOR_OUTCOMES.TERMINAL_NO_OP }));
    assert.equal(r.handled, true);
    assert.equal(r.motivo, "terminal_no_op");
    assert.equal(r.requiereMarcarFallida, false);
  });

  it("rejected con executionRowId real (ej. tenant_mismatch) sin send_message -> fallback permitido, sin marcar fallida (fuera del alcance de este blocker, ver reporte de diseño)", () => {
    const r = decidirFallbackDesdeResultado(
      baseResult({ outcome: ORCHESTRATOR_OUTCOMES.REJECTED, rejectReason: "tenant_mismatch", executionRowId: "row-x" }),
    );
    assert.equal(r.handled, false);
    assert.equal(r.requiereMarcarFallida, false, "solo engineError/concurrency_exhausted marcan fallida, no cualquier rejected");
  });
});

describe(
  "Fase 1 — atenderMensajeConFlowConFallback (integración real, tenant descartable)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_ID = randomUUID();
    const PHONE_NUMBER_ID = `test-blocker2-${Date.now()}`;
    let especialistaId: number;
    let flowRotoId: string;

    // Flow que SIEMPRE falla en un nodo SIN rama de fallo (mismo patrón del
    // Blocker #3, ver auditoría pre-migración): acción con un servicio que
    // no existe -> servicio_no_manejado -> sin edge "failure" -> engineError
    // real, determinístico, sin haber enviado ningún mensaje todavía.
    function flowRoto(): FlowDefinition {
      return {
        name: "Blocker 2 -- flow roto a propósito",
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          {
            id: "act-roto",
            type: "action",
            // categoriaDeServicio() cae a "manos" por defecto para
            // cualquier texto no reconocido (solo detecta "pies"/"pedicure"
            // por regex) -- "pies" es la única forma confiable de no
            // encontrar ninguna especialista en este tenant de prueba
            // (que solo tiene una especialista de "manos"), forzando
            // servicio_no_manejado de verdad.
            config: { actionType: "consultar_disponibilidad_especialista", params: { servicio: "pies", fecha: "2027-04-01" } },
          },
          { id: "end", type: "end", config: {} },
        ],
        edges: [
          { id: "e1", source: "start", target: "act-roto" },
          { id: "e2", source: "act-roto", target: "end" },
        ],
        variables: [],
      };
    }

    // Flow que SÍ agenda una cita real (act-agendar, éxito) y LUEGO se cae
    // en un segundo nodo sin rama de fallo, sin que ningún send_message se
    // haya emitido en ningún momento -- para probar F (cita real creada,
    // sin duplicar) sin mezclarlo con el caso "ya se envió algo" (E).
    function flowAgendaYLuegoFalla(): FlowDefinition {
      return {
        name: "Blocker 2 -- agenda real y luego falla sin enviar nada",
        nodes: [
          { id: "start", type: "start", config: { triggerType: "first_message" } },
          {
            id: "act-agendar",
            type: "action",
            config: {
              actionType: "agendar_cita_especialista",
              params: { servicio: "manos", fecha: "2027-04-02", hora: "10:00", nombreCliente: "Cliente Blocker2" },
            },
          },
          {
            id: "act-roto",
            type: "action",
            config: { actionType: "consultar_disponibilidad_especialista", params: { servicio: "pies", fecha: "2027-04-02" } },
          },
          { id: "end", type: "end", config: {} },
        ],
        edges: [
          { id: "e1", source: "start", target: "act-agendar" },
          { id: "e2", source: "act-agendar", target: "act-roto", sourceHandle: "success" },
          { id: "e3", source: "act-roto", target: "end" },
        ],
        variables: [],
      };
    }

    async function crearYPublicar(def: FlowDefinition, slug: string): Promise<string> {
      const flow = await createFlow(supabase, { tenantId: TENANT_ID, slug: `${slug}-${Date.now()}`, name: slug });
      const version = await createFlowVersion(supabase, { tenantId: TENANT_ID, flowId: flow.id, versionNumber: 1, definition: def });
      await publishFlowVersion(supabase, TENANT_ID, flow.id, version.id);
      return flow.id;
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      await supabase.from("dulabs_clientes_config").insert({
        id_tenant: TENANT_ID,
        nombre_negocio: "Blocker2 (borrar)",
        whatsapp_business_account_id: `waba-${PHONE_NUMBER_ID}`,
        phone_number_id: PHONE_NUMBER_ID,
        telefono_negocio: "0000000000",
      });

      const { data: esp, error } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_ID,
          phone_number_id: PHONE_NUMBER_ID,
          nombre: "Carla",
          numero_whatsapp: "573000000401",
          servicio: "manos",
          duracion_min: 60,
          requiere_aprobacion: false,
          bloquea_horario: true,
          es_general: false,
          activo: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      especialistaId = esp!.id as number;

      flowRotoId = await crearYPublicar(flowRoto(), "blocker2-roto");
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase.from("dulabs_fallos_ia").delete().eq("phone_number_id", PHONE_NUMBER_ID);
      await supabase.from("dulabs_citas_especialista").delete().eq("phone_number_id", PHONE_NUMBER_ID);
      await supabase.from("dulabs_clientes_config").delete().eq("phone_number_id", PHONE_NUMBER_ID);
      if (especialistaId) await supabase.from("dulabs_especialistas").delete().eq("id", especialistaId);
      await supabase.from("dulabs_flow_executions").delete().eq("phone_number_id", PHONE_NUMBER_ID);
    });

    it("D. excepción real (tenantId inválido) -> handled=false, motivo=excepcion_fallback_a_legacy, sin lanzar", async () => {
      const cliente = {
        id: "c-blocker2-d",
        id_tenant: "esto-no-es-un-uuid-valido",
        phone_number_id: PHONE_NUMBER_ID,
        nombre_negocio: "Blocker2 (borrar)",
        flow_activo: true as const,
        flow_id: flowRotoId,
      } as ClienteConfig & { flow_activo: true; flow_id: string };

      const intento = await atenderMensajeConFlowConFallback({
        supabase,
        cliente,
        telefonoCliente: "573002220001",
        texto: "Hola",
        wamid: `wamid-blocker2-d-${randomUUID()}`,
      });

      assert.equal(intento.handled, false);
      assert.equal(intento.motivo, "excepcion_fallback_a_legacy");
      assert.ok(intento.error, "debe conservar el error original para depuración");
    });

    it("G/K. ejecución rota queda 'failed' y el siguiente mensaje arranca una ejecución NUEVA (no queda pegada, no hay loop)", async () => {
      const cliente = {
        id: "c-blocker2-g",
        id_tenant: TENANT_ID,
        phone_number_id: PHONE_NUMBER_ID,
        nombre_negocio: "Blocker2 (borrar)",
        flow_activo: true as const,
        flow_id: flowRotoId,
      } as ClienteConfig & { flow_activo: true; flow_id: string };
      const telefonoCliente = "573002220002";

      // Mensaje 1: cae en el nodo roto, sin haber enviado nada -> fallback permitido.
      const intento1 = await atenderMensajeConFlowConFallback({
        supabase,
        cliente,
        telefonoCliente,
        texto: "Quiero un masaje relajante",
        wamid: `wamid-blocker2-g1-${randomUUID()}`,
      });
      assert.equal(intento1.handled, false);
      assert.equal(intento1.motivo, "fallback_a_legacy");
      assert.ok(intento1.result?.engineError, "debe haber un engineError real");
      const executionRowId1 = intento1.result!.executionRowId!;
      assert.ok(executionRowId1);

      // La fila debe quedar marcada "failed" (no seguir en waiting_effect).
      const { data: fila1 } = await supabase
        .from("dulabs_flow_executions")
        .select("id, status, execution_id")
        .eq("id", executionRowId1)
        .maybeSingle();
      assert.equal(fila1?.status, "failed");

      // Mensaje 2, MISMA conversación: como la ejecución anterior ya no está
      // "activa" (failed no es un status activo), debe arrancar una
      // ejecución NUEVA -- no la misma fila, no el mismo execution_id. Esto
      // es lo que evita el loop: cada mensaje tiene su propio intento
      // limpio, nunca queda reenganchado al mismo estado muerto para
      // siempre. (El flow sigue siendo el mismo flow roto a propósito, así
      // que también falla -- eso es esperado: este blocker no arregla el
      // bug estructural, solo evita que la conversación quede bloqueada.)
      const intento2 = await atenderMensajeConFlowConFallback({
        supabase,
        cliente,
        telefonoCliente,
        texto: "Quiero un masaje relajante otra vez",
        wamid: `wamid-blocker2-g2-${randomUUID()}`,
      });
      assert.equal(intento2.handled, false);
      const executionRowId2 = intento2.result!.executionRowId!;
      assert.notEqual(executionRowId2, executionRowId1, "debe ser una fila de ejecución NUEVA, no la misma reenganchada");

      const { data: fila2 } = await supabase
        .from("dulabs_flow_executions")
        .select("id, status, execution_id")
        .eq("id", executionRowId2)
        .maybeSingle();
      assert.notEqual(fila2?.execution_id, fila1?.execution_id, "execution_id también debe ser distinto (ejecución realmente nueva)");
      assert.equal(fila2?.status, "failed", "también queda marcada failed, lista para un tercer intento limpio");

      // K: en ningún momento atenderMensajeConFlowConFallback invocó nada
      // de LEGACY por su cuenta -- solo devuelve handled=false y es
      // app/webhook-dulabs/route.ts quien decide, en su propio código ya
      // existente, seguir con LEGACY. No hay ninguna ruta de código que
      // vuelva a llamar a Flow desde acá ni desde LEGACY.
    });

    it("F. Flow crea una cita REAL y luego falla sin enviar nada -> fallback permitido, LEGACY vería la cita real (sin duplicarla)", async () => {
      const flowId = await crearYPublicar(flowAgendaYLuegoFalla(), "blocker2-agenda-falla");
      const cliente = {
        id: "c-blocker2-f",
        id_tenant: TENANT_ID,
        phone_number_id: PHONE_NUMBER_ID,
        nombre_negocio: "Blocker2 (borrar)",
        flow_activo: true as const,
        flow_id: flowId,
      } as ClienteConfig & { flow_activo: true; flow_id: string };
      const telefonoCliente = "573002220003";

      const intento = await atenderMensajeConFlowConFallback({
        supabase,
        cliente,
        telefonoCliente,
        texto: "Hola, quiero una cita",
        wamid: `wamid-blocker2-f-${randomUUID()}`,
      });

      assert.equal(intento.handled, false, "no se envió ningún mensaje -> el fallback a LEGACY debe estar permitido");
      assert.equal(intento.motivo, "fallback_a_legacy");
      assert.ok(intento.result?.engineError);
      assert.equal(
        intento.result!.effects.some((e) => e.type === "send_message"),
        false,
        "esta prueba exige específicamente que NO se haya enviado ningún mensaje",
      );

      // La cita SÍ quedó creada de verdad por act-agendar antes del crash.
      const { data: citas } = await supabase
        .from("dulabs_citas_especialista")
        .select("id, estado, especialista_id")
        .eq("phone_number_id", PHONE_NUMBER_ID)
        .eq("telefono_cliente", telefonoCliente);
      assert.equal(citas?.length, 1, "debe existir exactamente UNA cita real, creada por Flow antes del fallo");
      assert.equal(citas?.[0]?.especialista_id, especialistaId);

      // Misma consulta EXACTA que usa LEGACY (especialista-solicitud-ia.ts)
      // antes de decidir su propio toolset -- si esto encuentra la cita
      // real, LEGACY jamás la duplicaría, ofrecería cambiar/cancelar en su
      // lugar. No se invoca la IA real de LEGACY acá (fuera de alcance de
      // este blocker) -- se prueba la garantía real: visibilidad compartida.
      const citaQueVeriaLegacy = await citaActivaPara(supabase, PHONE_NUMBER_ID, telefonoCliente);
      assert.ok(citaQueVeriaLegacy, "LEGACY vería esta cita real antes de ofrecer crear una nueva");
      assert.equal(citaQueVeriaLegacy?.id, citas?.[0]?.id);
    });
  },
);
