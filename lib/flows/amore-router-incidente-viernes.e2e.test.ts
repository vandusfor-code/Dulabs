/**
 * Prueba de extremo a extremo (autorizada) — reproduce la conversación REAL
 * de producción investigada en el diagnóstico forense (AMORE,
 * 2026-09-06 ~18:43 Colombia, execution_id bdd42e60-a83b-488f-8738-9a06784dc1d6
 * / df5f1988-564a-48bb-98b3-4b62ad095196) contra el grafo real
 * (amoreRouterFlow()) y el ExecutionOrchestrator real, con executores
 * simulados para resolver_escenario/Nylas/Gemini que reproducen EXACTAMENTE
 * los payloads observados en dulabs_flow_effects. Prueba las DOS correcciones
 * juntas:
 *
 * 1. buildAIRequest ahora prioriza "mensajeActual" sobre el fallback
 *    __firstMessageText -- el turno "Quiero una cita" ya no ve el texto de
 *    una conversación de prueba anterior ("...para el día viernes").
 * 2. ai-generar-respuesta ahora tiene una rama aiFailure (q-ia-fallback) --
 *    cuando Gemini afirma una reserva sin evidencia (Claim Security
 *    rechaza, igual que en producción) y el retry (MAX_AI_DISPATCH_ATTEMPTS)
 *    se agota, el turno de todos modos ENVÍA un mensaje honesto y preserva
 *    agendamiento/servicio/fecha/datosIA -- nunca termina en engineError.
 *
 * Sin esa rama, este último turno terminaba en engineError sin enviar nada,
 * lo que en producción real (whatsapp-qr-bot.ts: MAX_INTENTOS) hacía que se
 * cerrara la ejecución y se reintentara el mismo mensaje con un "start"
 * limpio, sin ningún contexto -- el bug reportado ("Por ahora no cuento con
 * esa información de AMORE...").
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import {
  createExecutionOrchestrator,
  ORCHESTRATOR_OUTCOMES,
  type ConversationKey,
  type FlowOrchestratorStore,
} from "@/lib/flow/flow-orchestrator";
import { createTestEffectExecutorFramework } from "@/lib/flow/executor-factory";
import { buildAIRequest } from "@/lib/flow/claude/claude-context-builder";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest, type EffectExecutor } from "@/lib/flow/executor-types";
import { amoreRouterFlow } from "@/lib/flows/amore-router.flow";
import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowExecutionRow } from "@/lib/flow/flow-store-types";
import { engineStateToExecutionUpdate } from "@/lib/flow/flow-store-types";
import type { FlowEngineState } from "@/lib/flow/engine-types";

const TENANT = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f"; // AMORE
const CONV: ConversationKey = { phoneNumberId: "whatsapp-qr:ed6ae77f-8a0c-483e-a5d9-8ede68eca50f", telefonoCliente: "573148127388" };
const SERVICIO_DIPPING = "1c7d139b-44b6-447b-b6ee-3307d1d57204";

function buildInMemoryStore(flow: FlowDefinition) {
  let row: FlowExecutionRow | null = null;
  const effects = new Map<string, { status: string; applied?: Record<string, unknown> }>();

  const store = {
    getActiveExecution: async () => row,
    getExecutionById: async () => row,
    getFlow: async () =>
      ({ tenant_id: TENANT, id: "flow-1", slug: "s", name: "n", status: "published", published_version_id: "fv-1" }) as never,
    getFlowVersion: async () => ({ tenant_id: TENANT, id: "fv-1", flow_id: "flow-1", version_number: 10, definition_json: flow }) as never,
    createExecution: async (input: { executionId: string; initialState: FlowEngineState }) => {
      row = {
        tenant_id: TENANT,
        id: "row-1",
        flow_id: "flow-1",
        flow_version_id: "fv-1",
        execution_id: input.executionId,
        phone_number_id: CONV.phoneNumberId,
        telefono_cliente: CONV.telefonoCliente,
        status: input.initialState.status,
        current_node_id: input.initialState.currentNodeId,
        variables: input.initialState.variables,
        expected_input: null,
        pending_effect: null,
        exports: input.initialState.exports,
        metadata: input.initialState.metadata,
        state_version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      } as FlowExecutionRow;
      return { created: true, row };
    },
    saveExecutionState: async (_t: string, _id: string, state: FlowEngineState, expectedVersion: number) => {
      if (!row) throw new Error("no row");
      if (row.state_version !== expectedVersion) throw new Error("cas conflict");
      row = { ...row, ...engineStateToExecutionUpdate(state), state_version: expectedVersion + 1 };
      return { stateVersion: row.state_version };
    },
    insertEventIdempotent: async () => ({ inserted: true }),
    insertEffectIdempotent: async (input: { effectId: string; nodeId: string }) => {
      if (effects.has(input.effectId)) return { inserted: false };
      effects.set(input.effectId, { status: "pending" });
      return { inserted: true };
    },
    getEffectByEffectId: async (_t: string, _e: string, effectId: string) => {
      const fx = effects.get(effectId);
      if (!fx) return null;
      return {
        tenant_id: TENANT, id: 1, flow_execution_id: "row-1", effect_id: effectId, node_id: "?",
        kind: "?", status: fx.status === "succeeded" ? "succeeded" : "failed",
        result_payload_applied: fx.applied ?? null, result_payload_raw: fx.applied ?? null,
        integration_id: null, created_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
      } as never;
    },
    resolveEffectResult: async (input: { effectId: string; status: "succeeded" | "failed"; resultPayloadApplied?: Record<string, unknown> }) => {
      const fx = effects.get(input.effectId)!;
      fx.status = input.status;
      fx.applied = input.resultPayloadApplied;
      return {
        ok: true,
        row: {
          tenant_id: TENANT, id: 1, flow_execution_id: "row-1", effect_id: input.effectId, node_id: "?",
          kind: "?", status: input.status === "succeeded" ? "succeeded" : "failed",
          result_payload_applied: input.resultPayloadApplied ?? null,
          result_payload_raw: input.resultPayloadApplied ?? null,
          integration_id: null, created_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
        } as never,
      };
    },
    recordNodeTransition: async () => {},
  };
  return { store: store as unknown as FlowOrchestratorStore, getRow: () => row };
}

const sendMessageExecutor: EffectExecutor = {
  kind: "send_message",
  version: "test",
  capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: [] },
  async dispatch(request) {
    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data: { delivered: true, nodeId: request.nodeId },
      appliedResult: { delivered: true, nodeId: request.nodeId },
    };
  },
};

/** Simula resolver_escenario (internal-action-executor.ts) + buscar_disponibilidad_nylas, con los MISMOS payloads observados en producción. */
function buildAccionExecutor(): { executor: EffectExecutor; buscarDisponibilidadCallCount: () => number } {
  let buscarDisponibilidadCalls = 0;
  const executor: EffectExecutor = {
    kind: "action",
    version: "test",
    capabilities: { supportsIntegration: false, supportsAsync: false, operationClasses: ["CRITICAL"] },
    async dispatch(request: EffectDispatchRequest) {
      const actionType = request.action?.actionType;

      if (actionType === "buscar_disponibilidad_nylas") {
        buscarDisponibilidadCalls += 1;
        const data = {
          modo: "ai",
          instruccionIA:
            "Presenta con naturalidad las opciones REALES de datosIA (profesional + hora) para que la clienta ELIJA una -- nunca inventes ni ofrezcas una hora que no esté ahí. Estos horarios son DISPONIBILIDAD real, todavía NO existe ninguna cita creada.",
          datosIA: [{ profesional: "Cristal", hora: "15:00" }],
          agendamiento: {
            servicioId: SERVICIO_DIPPING,
            servicioNombre: "Dipping",
            duracionMin: 120,
            fechaISO: "2026-09-11",
            opcionesOfrecidas: [{ especialistaId: 1263, especialistaNombre: "Cristal", horaTexto: "15:00" }],
          },
          disponibilidadConsultada: true,
        };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      }

      // resolver_escenario -- payload real (request.payload) trae mensajeActual/__firstMessageText,
      // el mock reproduce EXACTAMENTE las 4 respuestas reales de producción.
      const mensajeActual = request.payload.mensajeActual as string | undefined;
      const esPrimerTurno = request.payload.mensajeActual === undefined;

      if (esPrimerTurno) {
        // Turno "Hola" -- primer mensaje real de la ejecución.
        const data = {
          modo: "deterministic",
          escenarioCodigo: "001_saludo",
          respuestaTexto: "¡Hola! 💗 Qué lindo tenerte por aquí. Cuéntame, ¿en qué puedo ayudarte?",
          agendamiento: null,
          esPrimerTurno: true,
          instruccionIA: "",
          datosIA: [],
        };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      }

      if (mensajeActual === "Quiero una cita") {
        const data = {
          modo: "ai",
          escenarioCodigo: "070_agendamiento",
          agendamiento: {},
          esPrimerTurno: false,
          instruccionIA:
            "La clienta quiere agendar una cita pero todavía no dijo qué servicio. Pregúntale amablemente qué servicio desea, UNA sola pregunta, sin listar el catálogo completo.",
          respuestaTexto: "",
          datosIA: [],
        };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      }

      if (mensajeActual === "Quiero un dipping") {
        const data = {
          modo: "catalog",
          escenarioCodigo: "028_servicio_info",
          agendamiento: { servicioId: SERVICIO_DIPPING, servicioNombre: "Dipping", duracionMin: 120 },
          esPrimerTurno: false,
          instruccionIA: "",
          respuestaTexto: "Te cuento ✨ El Dipping cuesta $60.000 y dura aproximadamente 2 h.",
          datosIA: [],
        };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      }

      if (mensajeActual === "Ok, me gustaría para el día viernes") {
        const data = {
          modo: "agendar_buscar_disponibilidad",
          escenarioCodigo: "000_fallback",
          agendamiento: { fechaISO: "2026-09-11", servicioId: SERVICIO_DIPPING, servicioNombre: "Dipping", duracionMin: 120 },
          esPrimerTurno: false,
          instruccionIA: "",
          respuestaTexto: "",
          datosIA: [],
        };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      }

      // Turno posterior al fallback (confirma que la conversación sigue con
      // normalidad, sin haber perdido el agendamiento en curso).
      const data = {
        modo: "agendar_buscar_disponibilidad",
        escenarioCodigo: "000_fallback",
        agendamiento: { fechaISO: "2026-09-11", servicioId: SERVICIO_DIPPING, servicioNombre: "Dipping", duracionMin: 120 },
        esPrimerTurno: false,
        instruccionIA: "",
        respuestaTexto: "",
        datosIA: [],
      };
      return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
    },
  };
  return { executor, buscarDisponibilidadCallCount: () => buscarDisponibilidadCalls };
}

/**
 * Simula Gemini usando el MISMO buildAIRequest real que usa GeminiExecutor --
 * así la prueba verifica de punta a punta que el fix de "mensajeActual" llega
 * realmente hasta donde se decide el userMessage.
 */
function buildAiExecutor(params: { textoParaSegundoTurno: string; textoAgendamiento: string[] }): { executor: EffectExecutor; agendamientoCallCount: () => number } {
  let agendamientoCalls = 0;
  const executor: EffectExecutor = {
    kind: "ai",
    version: "test",
    capabilities: { supportsIntegration: false, supportsAsync: true, operationClasses: [] },
    async dispatch(request: EffectDispatchRequest) {
      const ai = buildAIRequest({ request, ai: request.ai!, model: "gemini-test" });

      // Turno "Quiero una cita" -- el fix de mensajeActual debe hacer que
      // ai.userMessage sea el mensaje REAL de este turno, nunca el
      // __firstMessageText de una conversación de prueba anterior.
      if (ai.userMessage === "Quiero una cita") {
        const data = { responseText: params.textoParaSegundoTurno, __textProvenance: "AI_GENERATED_TEXT" };
        return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
      }

      // Turno de disponibilidad -- reproduce el fallo real: Gemini afirma una
      // reserva sin evidencia en TODOS los intentos (persistente), para
      // probar que el retry se agota y la rama aiFailure actúa como red de
      // seguridad.
      const texto = params.textoAgendamiento[agendamientoCalls] ?? params.textoAgendamiento[params.textoAgendamiento.length - 1]!;
      agendamientoCalls += 1;
      const data = { responseText: texto, __textProvenance: "AI_GENERATED_TEXT" };
      return { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data, appliedResult: data };
    },
  };
  return { executor, agendamientoCallCount: () => agendamientoCalls };
}

describe("AMORE — incidente real 2026-09-06 18:43 (reproducción de punta a punta con las 2 correcciones)", () => {
  it("turno por turno: Hola / Quiero una cita (sin 'viernes') / Quiero un dipping / disponibilidad con fallo persistente de IA -> mensaje honesto, contexto preservado", async () => {
    const flow = amoreRouterFlow();
    const { store, getRow } = buildInMemoryStore(flow);
    const { executor: accion, buscarDisponibilidadCallCount } = buildAccionExecutor();
    const { executor: ai, agendamientoCallCount } = buildAiExecutor({
      textoParaSegundoTurno: "¡Claro que sí! 💗 ¿Qué servicio te gustaría realizarte?",
      // Ambos intentos del retry afirman una reserva sin evidencia -- Claim
      // Security (real, sin mock) debe rechazar los dos.
      textoAgendamiento: [
        "¡Listo! Tu cita quedó reservada y confirmada el viernes a las 3pm con Cristal 💗",
        "Ya te dejé agendada la cita del viernes a las 3pm con Cristal 💗",
      ],
    });

    const orchestrator = createExecutionOrchestrator({
      store,
      engine: { createFlowEngineState, runFlowEngine },
      effectFramework: createTestEffectExecutorFramework({ executors: [accion, ai, sendMessageExecutor] }),
    });

    async function turno(texto: string, eventId: string, tipo: "start" | "text" = "text") {
      return orchestrator.process({
        tenantId: TENANT,
        conversation: CONV,
        flowId: "flow-1",
        eventId,
        eventType: "message",
        payload: { text: texto },
        engineEvent: tipo === "start" ? { type: "start", text: texto } : { type: "text", text: texto },
        receivedAt: new Date().toISOString(),
      });
    }

    // A. "Hola"
    const rA = await turno("Hola", "wamid-A", "start");
    assert.equal(rA.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    assert.equal(rA.engineError, undefined);
    const msgA = rA.effects.find((e) => e.type === "send_message");
    assert.ok(msgA && msgA.type === "send_message");
    assert.match(String(msgA!.content.text), /Hola/);

    // B. "Quiero una cita" -- NO debe mencionar "viernes" (fix de mensajeActual).
    const rB = await turno("Quiero una cita", "wamid-B");
    assert.equal(rB.engineError, undefined);
    const msgB = rB.effects.find((e) => e.type === "send_message" && e.nodeId === "ai-generar-respuesta");
    assert.ok(msgB && msgB.type === "send_message", "debe responder vía ai-generar-respuesta (modo=ai)");
    assert.doesNotMatch(String(msgB!.content.text), /viernes/i, "el fix de mensajeActual debe impedir la contaminación con el primer mensaje");
    assert.match(String(msgB!.content.text), /servicio/i);

    // C. "Quiero un dipping"
    const rC = await turno("Quiero un dipping", "wamid-C");
    assert.equal(rC.engineError, undefined);
    const msgC = rC.effects.find((e) => e.type === "send_message");
    assert.match(String((msgC as { content: { text?: string } }).content.text), /Dipping.*\$60\.000/);

    // D. "Ok, me gustaría para el día viernes" -- disponibilidad real +
    // fallo PERSISTENTE de Claim Security (ambos intentos del retry fallan).
    const rD = await turno("Ok, me gustaría para el día viernes", "wamid-D");

    assert.equal(buscarDisponibilidadCallCount(), 1, "Nylas debe consultarse UNA sola vez");
    assert.equal(agendamientoCallCount(), 2, "el retry debe agotar sus 2 intentos configurados");

    // LA CORRECCIÓN CLAVE: ya NO hay engineError -- la rama aiFailure envía
    // un mensaje honesto en vez de tumbar el turno completo.
    assert.equal(rD.engineError, undefined, "con la rama aiFailure, el turno ya NO debe terminar en engineError");
    assert.equal(rD.outcome, ORCHESTRATOR_OUTCOMES.PROCESSED);
    const msgD = rD.effects.find((e) => e.type === "send_message" && e.nodeId === "q-ia-fallback");
    assert.ok(msgD && msgD.type === "send_message", "debe enviarse el mensaje honesto de q-ia-fallback");
    assert.doesNotMatch(String((msgD as { content: { text?: string } }).content.text), /reservad|confirmad|agendad/i);

    // EL CONTEXTO SE PRESERVA -- servicio/fecha/datosIA siguen en la fila
    // real, la MISMA ejecución sigue viva (nunca se cerró ni se creó una
    // ejecución nueva "en blanco").
    const row = getRow();
    assert.ok(row, "debe seguir siendo la MISMA ejecución (una sola fila en todo el store)");
    assert.equal(row!.status, "waiting_input", "la ejecución sigue activa, nunca 'failed'");
    assert.equal(row!.current_node_id, "q-ia-fallback");
    const agendamiento = row!.variables.agendamiento as Record<string, unknown> | undefined;
    assert.equal(agendamiento?.servicioId, SERVICIO_DIPPING, "servicio debe permanecer");
    assert.equal(agendamiento?.fechaISO, "2026-09-11", "fecha debe permanecer");

    // Y la conversación puede seguir con normalidad en el turno siguiente,
    // sin haber perdido nada -- confirma que no quedó "colgada".
    const rE = await turno("sí, esa hora me sirve", "wamid-E");
    assert.equal(rE.engineError, undefined);
  });
});
