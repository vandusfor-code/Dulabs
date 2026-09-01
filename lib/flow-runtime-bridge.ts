/**
 * Fase 0 (autorizado) — puente entre el webhook de WhatsApp y el motor Flow.
 *
 * Aislado en su propio archivo a propósito: el diff sobre
 * app/webhook-dulabs/route.ts queda mínimo (una llamada condicional, gateada
 * por debeUsarFlow()), y toda la lógica nueva de Flow vive acá, donde se
 * puede revisar/testear sin tocar el archivo que sirve tráfico real de
 * TODOS los tenants, incluida Daniela en LEGACY.
 *
 * No reimplementa nada del Orchestrator: arma el evento normalizado y lo
 * pasa a ExecutionOrchestrator.process(), que ya se encarga de
 * crear/reanudar la ejecución, correr el engine, aplicar
 * filterClaimSecuredEffects/applyAiResponseClaimSecurity (seguridad ya
 * auditada, sin tocar) y despachar los efectos reales (incluido el envío
 * real de WhatsApp vía SendMessageExecutor).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { ClienteConfig } from "@/lib/supabase";
import { debeUsarFlowParaRemitente } from "@/lib/flow-routing";
import {
  createExecutionOrchestrator,
  ORCHESTRATOR_OUTCOMES,
  type OrchestratorResult,
} from "@/lib/flow/flow-orchestrator";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { createSupabaseFlowOrchestratorStore } from "@/lib/flow/flow-orchestrator-store-supabase";
import { createDefaultEffectExecutorFramework } from "@/lib/flow/executor-factory";
import { getIntegrationById, getIntegrationCredentials } from "@/lib/flow/flow-store";
import type { SendMessageDeps } from "@/lib/flow/executors/send-message-executor";
import type { FlowEngineEvent } from "@/lib/flow/engine-types";
import { executionRowToEngineState } from "@/lib/flow/flow-store-types";
import type { FlowOrchestratorStore } from "@/lib/flow/orchestrator-types";
import { registrarFalloIA } from "@/lib/alertas";

/**
 * true si este mensaje debe atenderse por Flow. Delega en
 * debeUsarFlowParaRemitente (lib/flow-routing.ts): exige flow_activo/flow_id
 * (gate original, sin modificar) Y, si hay una lista de prueba configurada
 * para este phone_number_id (lib/flow-test-senders.ts), que telefonoRemitente
 * esté en ella. Sin lista configurada, se comporta igual que el gate
 * original — esto es una restricción ADICIONAL de prueba, nunca una forma
 * de entrar a Flow que el gate original no permitiera.
 */
export function debeAtenderConFlow(
  cliente: Pick<ClienteConfig, "flow_activo" | "flow_id" | "phone_number_id">,
  telefonoRemitente: string,
): boolean {
  return debeUsarFlowParaRemitente(cliente, telefonoRemitente);
}

/**
 * Procesa un mensaje de texto entrante a través del motor Flow real.
 * `eventId` debe ser el wamid del mensaje de Meta -- es lo que hace
 * idempotente el procesamiento ante un reintento del webhook, igual que ya
 * lo es para LEGACY (dulabs_mensajes_log.wamid).
 */
export async function atenderMensajeConFlow(params: {
  supabase: SupabaseClient;
  cliente: ClienteConfig & { flow_activo: true; flow_id: string };
  telefonoCliente: string;
  texto: string;
  wamid: string;
  /**
   * ID estable del botón (interactive.button_reply.id). Se usa SOLO si la
   * ejecución activa espera un botón. El texto visible sigue viajando en
   * `texto` para inbox / LEGACY / NLU.
   */
  buttonId?: string;
  /** Solo para tests — inyecta el envío de WhatsApp sin tocar la red real. */
  sendMessageDepsOverride?: Partial<SendMessageDeps>;
}): Promise<OrchestratorResult> {
  const store = createSupabaseFlowOrchestratorStore(params.supabase);
  const orchestrator = createExecutionOrchestrator({
    store,
    engine: { createFlowEngineState, runFlowEngine },
    effectFramework: createDefaultEffectExecutorFramework({
      supabase: params.supabase,
      store: {
        getIntegrationById: (tenantId, integrationId) =>
          getIntegrationById(params.supabase, tenantId, integrationId),
        getIntegrationCredentials: (tenantId, integrationId) =>
          getIntegrationCredentials(params.supabase, tenantId, integrationId),
      },
      registryOverrides: params.sendMessageDepsOverride
        ? { sendMessageDeps: params.sendMessageDepsOverride }
        : undefined,
    }),
  });

  // flow-engine.ts distingue el evento "start" (arranca una ejecución nueva
  // desde el nodo start) del evento "text" (SOLO válido si el estado ya está
  // waiting_input/expectedInput="text", es decir, respondiendo un nodo
  // question/ai ya en pausa). El orchestrator acepta "text" como disparador
  // legítimo para CREAR una ejecución (isLegitimateStartTrigger), pero el
  // engine igual la rechaza con INVALID_STATE si el estado es nuevo. Por eso
  // este chequeo se hace acá, no en el engine ni en el orchestrator (fuera de
  // los archivos autorizados): si no hay ejecución activa para esta
  // conversación, se dispara "start"; si ya la hay, se asume que el mensaje
  // responde una pregunta en curso y se dispara "text".
  //
  // Fase 1 (Blocker #1, autorizado) — el "start" ahora SÍ lleva el texto
  // crudo del primer mensaje (event.text), que el Engine siembra en
  // variables[FIRST_MESSAGE_TEXT_VARIABLE_KEY] sin auto-responder nada. Un
  // flow que no lea esa variable (como el flow mínimo E2E de este archivo)
  // no cambia de comportamiento.
  const activeExecution = await store.getActiveExecution(params.cliente.id_tenant, {
    phoneNumberId: params.cliente.phone_number_id,
    telefonoCliente: params.telefonoCliente,
  });
  const buttonId = params.buttonId?.trim();
  const textoInicio = buttonId || params.texto;
  const engineEvent: FlowEngineEvent =
    !activeExecution
      ? { type: "start", text: textoInicio, eventId: params.wamid }
      : buttonId && activeExecution.expected_input === "button"
        ? { type: "button", id: buttonId, eventId: params.wamid }
        : { type: "text", text: params.texto, eventId: params.wamid };

  return orchestrator.process({
    tenantId: params.cliente.id_tenant,
    conversation: { phoneNumberId: params.cliente.phone_number_id, telefonoCliente: params.telefonoCliente },
    flowId: params.cliente.flow_id,
    eventId: params.wamid || randomUUID(),
    eventType: "message",
    payload: { text: params.texto },
    engineEvent,
    receivedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Fase 1 (Blocker #2, autorizado) — fallback de seguridad Flow -> LEGACY.
// ---------------------------------------------------------------------------

/** Motivo por el que se decidió (o no) permitir que LEGACY responda. */
export type MotivoIntentoFlow =
  | "processed_ok"
  | "duplicate_event"
  | "terminal_no_op"
  | "send_message_ya_enviado"
  | "fallback_a_legacy"
  | "excepcion_fallback_a_legacy"
  // Bug raíz #3 (incidente "disponible→ocupado", cita real #796) — Flow
  // ejecutó una acción CRÍTICA con éxito (creó/canceló/movió una cita real)
  // y SOLO falló una etapa posterior (ej. la redacción del mensaje final).
  // NUNCA se cede a LEGACY en este caso: LEGACY reprocesaría el mismo mensaje
  // y contradiría/duplicaría una operación que ya ocurrió de verdad. Señal
  // estructurada (OrchestratorResult.criticalActionExecuted), no textual.
  | "accion_critica_ya_ejecutada"
  // Fase 1 (Blocker #7) — Flow terminó SIN error y SIN enviar ningún
  // mensaje (ej. el enrutador clasificó la intención como "otro" y llegó a
  // un end deliberadamente vacío). Distinto de "processed_ok" (que si
  // envió algo) y de "fallback_a_legacy" (que es un fallo real): acá Flow
  // no falló, decidió activamente que este mensaje no es para él.
  | "sin_intencion_reconocida";

export interface ResultadoIntentoFlow {
  /** true = Flow ya resolvió este mensaje (con éxito o sin que haga falta
   * hacer nada más); el llamador NO debe seguir con LEGACY. false = Flow no
   * pudo atender este mensaje de forma segura; el llamador debe caer al
   * camino LEGACY normal para esta misma clienta. */
  handled: boolean;
  motivo: MotivoIntentoFlow;
  outcome?: OrchestratorResult["outcome"];
  result?: OrchestratorResult;
  error?: unknown;
}

function huboEnvioDeFlow(result: OrchestratorResult): boolean {
  return result.effects.some((e) => e.type === "send_message");
}

function flowFueExitoso(result: OrchestratorResult): boolean {
  return result.outcome === ORCHESTRATOR_OUTCOMES.PROCESSED && !result.engineError;
}

/**
 * Decisión PURA (sin I/O) de qué hacer con un OrchestratorResult ya
 * resuelto -- separada de atenderMensajeConFlowConFallback para poder
 * probar cada combinación de outcome/engineError/efectos sin necesitar
 * forzar al orchestrator real a cada estado. Ver las reglas completas en
 * el docstring de atenderMensajeConFlowConFallback.
 */
export function decidirFallbackDesdeResultado(
  result: OrchestratorResult,
): { handled: boolean; motivo: MotivoIntentoFlow; requiereMarcarFallida: boolean; yaEnvioAlgo: boolean } {
  if (result.outcome === ORCHESTRATOR_OUTCOMES.DUPLICATE_EVENT) {
    return { handled: true, motivo: "duplicate_event", requiereMarcarFallida: false, yaEnvioAlgo: false };
  }
  if (result.outcome === ORCHESTRATOR_OUTCOMES.TERMINAL_NO_OP) {
    return { handled: true, motivo: "terminal_no_op", requiereMarcarFallida: false, yaEnvioAlgo: false };
  }
  if (flowFueExitoso(result)) {
    if (huboEnvioDeFlow(result)) {
      return { handled: true, motivo: "processed_ok", requiereMarcarFallida: false, yaEnvioAlgo: true };
    }
    // Fase 1 (Blocker #7) — completó sin error pero sin decir NADA. Esto
    // nunca pasaba antes de este blocker: los 3 flows previos (agendar/
    // cancelar/reagendar) siempre terminan con algún mensaje en cada rama.
    // El enrutador introduce la primera rama deliberadamente muda ("otro")
    // -- acá se le da el turno a LEGACY, que sí sabe manejar información
    // general/conversación (base_conocimiento, prompt real de Daniela).
    return { handled: false, motivo: "sin_intencion_reconocida", requiereMarcarFallida: false, yaEnvioAlgo: false };
  }

  // A partir de acá: rejected, engineError (viaja con outcome=processed), o
  // concurrency_exhausted -- las tres son formas reales de fallo.
  const yaEnvioAlgo = huboEnvioDeFlow(result);
  if (yaEnvioAlgo) {
    // Flow ya le puso algo en la conversación a esta clienta -- LEGACY
    // JAMÁS responde encima, aunque el resto de la ejecución haya fallado.
    return { handled: true, motivo: "send_message_ya_enviado", requiereMarcarFallida: false, yaEnvioAlgo: true };
  }

  // Solo engineError/concurrency_exhausted representan una ejecución REAL y
  // rota que hay que desenganchar. Un rejected de configuración (sin
  // executionRowId, o por flow_not_published/version_not_found) no tiene
  // ninguna fila que marcar -- se deja tal cual, sin inventar nada.
  const esEjecucionRealYRota =
    (result.outcome === ORCHESTRATOR_OUTCOMES.PROCESSED && Boolean(result.engineError)) ||
    result.outcome === ORCHESTRATOR_OUTCOMES.CONCURRENCY_EXHAUSTED;

  // Bug raíz #3 — barrera estructural: si Flow YA ejecutó una acción crítica
  // con éxito en este turno, NUNCA se cede a LEGACY, aunque el Flow haya
  // fallado después sin enviar nada. LEGACY reprocesaría el mismo mensaje y
  // contradiría/duplicaría la operación real (exactamente lo que pasó con la
  // cita #796: creada por Flow, y luego LEGACY dijo "ocupado"). Se marca la
  // ejecución como rota (para que el PRÓXIMO mensaje arranque limpio), pero
  // este mensaje se considera manejado por Flow. El mensaje final al cliente
  // es responsabilidad de la rama de respaldo del propio Flow (ver
  // daniela-agendar-cita.flow.ts: ai-confirmar --aiFailure--> respaldo).
  if (result.criticalActionExecuted) {
    return {
      handled: true,
      motivo: "accion_critica_ya_ejecutada",
      requiereMarcarFallida: esEjecucionRealYRota && Boolean(result.executionRowId),
      yaEnvioAlgo: false,
    };
  }

  return {
    handled: false,
    motivo: "fallback_a_legacy",
    requiereMarcarFallida: esEjecucionRealYRota && Boolean(result.executionRowId),
    yaEnvioAlgo: false,
  };
}

/**
 * Marca una ejecución rota (engineError o CAS agotado) como "failed" para
 * que el PRÓXIMO mensaje de esta conversación arranque una ejecución nueva
 * y limpia, en vez de quedar reenganchado para siempre al mismo nodo caído
 * -- ver flow-store.ts::ACTIVE_EXECUTION_STATUSES (excluye "failed") y el
 * hecho documentado de que el orchestrator NUNCA persiste estado cuando
 * runFlowEngine devuelve error (a propósito, para permitir reintentos
 * limpios -- pero sin esto, "limpio" nunca llega a ocurrir).
 *
 * Best-effort real: si la fila ya está en un estado terminal (alguien más
 * ya la resolvió) o hay un conflicto de CAS, no reintenta ni lanza -- nunca
 * debe tumbar el fallback en curso por esto.
 */
async function marcarEjecucionRotaComoFallida(params: {
  store: FlowOrchestratorStore;
  tenantId: string;
  executionRowId: string;
}): Promise<void> {
  try {
    const row = await params.store.getExecutionById(params.tenantId, params.executionRowId);
    if (!row) return;
    if (row.status === "failed" || row.status === "completed" || row.status === "transferred") return;
    const state = executionRowToEngineState(row);
    await params.store.saveExecutionState(
      params.tenantId,
      params.executionRowId,
      { ...state, status: "failed" },
      row.state_version,
    );
  } catch {
    // Best-effort -- ver docstring.
  }
}

/**
 * Envuelve atenderMensajeConFlow con el fallback de seguridad hacia LEGACY.
 * Nunca ejecuta Flow y LEGACY en paralelo: esta función corre por completo
 * (incluida cualquier acción/envío real de Flow) ANTES de que el llamador
 * decida si sigue con LEGACY -- son dos pasos secuenciales dentro del mismo
 * candado de conversación (adquirirCandadoChat en route.ts), nunca dos
 * ejecuciones simultáneas.
 *
 * Reglas (ver informe de diseño del Blocker #2, extendido en el Blocker #7):
 * - PROCESSED sin engineError CON algún send_message -> handled=true, LEGACY
 *   nunca corre.
 * - PROCESSED sin engineError y SIN ningún send_message (Blocker #7: el
 *   enrutador clasificó la intención como "otro" y terminó sin decir nada)
 *   -> handled=false, "sin_intencion_reconocida". No es un fallo -- no se
 *   registra en dulabs_fallos_ia ni se marca ninguna ejecución como rota.
 *   LEGACY responde con su prompt/base_conocimiento reales, que Flow no
 *   intenta duplicar.
 * - duplicate_event / terminal_no_op -> handled=true, no es un fallo, no se
 *   registra como tal (evita el loop y evita responder dos veces a un
 *   reintento de Meta).
 * - rejected / engineError / concurrency_exhausted CON algún efecto
 *   send_message ya emitido -> handled=true (LEGACY NUNCA responde encima
 *   de un mensaje que Flow ya puso en la conversación), pero SÍ se registra
 *   el fallo para trazabilidad.
 * - rejected / engineError / concurrency_exhausted SIN ningún send_message
 *   -> handled=false (el llamador debe seguir con LEGACY), se registra el
 *   fallo, y si existe una ejecución real y rota (engineError o CAS
 *   agotado) se marca "failed" para no quedar enganchada para siempre.
 * - rejected por motivos de CONFIGURACIÓN (flow no publicado, versión no
 *   encontrada, etc.) nunca tiene executionRowId ni efectos -- no se
 *   inventa ninguna ejecución "failed": simplemente se permite el fallback.
 * - Excepción lanzada por atenderMensajeConFlow -> se asume (ver reporte de
 *   diseño: PERSIST BEFORE DISPATCH + EffectExecutorFramework nunca lanza,
 *   solo el Store puede lanzar, y eso ocurre antes de cualquier despacho
 *   real) que no se envió nada -> handled=false, se registra el fallo. NO
 *   se intenta marcar ninguna ejecución como "failed" en este camino (no
 *   hay forma confiable de identificar la fila desde afuera) -- riesgo
 *   residual documentado, no resuelto por este blocker.
 * - Un timeout que mate la función completa (Vercel/runtime) no puede
 *   pasar por acá -- fuera del alcance de este blocker, documentado como
 *   límite conocido.
 */
export async function atenderMensajeConFlowConFallback(params: {
  supabase: SupabaseClient;
  cliente: ClienteConfig & { flow_activo: true; flow_id: string };
  telefonoCliente: string;
  texto: string;
  wamid: string;
  buttonId?: string;
  sendMessageDepsOverride?: Partial<SendMessageDeps>;
}): Promise<ResultadoIntentoFlow> {
  let result: OrchestratorResult;
  try {
    result = await atenderMensajeConFlow(params);
  } catch (error) {
    await registrarFalloIA({
      tipo: "otro",
      mensaje: `[Flow->Legacy fallback] excepción en atenderMensajeConFlow: ${error instanceof Error ? error.message : String(error)}. Mensaje de la clienta: "${params.texto.slice(0, 200)}"`,
      idTenant: params.cliente.id_tenant,
      phoneNumberId: params.cliente.phone_number_id,
      nombreNegocio: params.cliente.nombre_negocio,
    });
    return { handled: false, motivo: "excepcion_fallback_a_legacy", error };
  }

  const decision = decidirFallbackDesdeResultado(result);

  if (decision.motivo === "duplicate_event" || decision.motivo === "terminal_no_op" || decision.motivo === "processed_ok") {
    return { handled: decision.handled, motivo: decision.motivo, outcome: result.outcome, result };
  }

  if (decision.motivo === "sin_intencion_reconocida") {
    // Fase 1 (Blocker #7) — NO es un fallo (Flow no crasheó, no fue
    // rechazado, no hubo conflicto de CAS): el enrutador decidió
    // activamente que este mensaje no es para él. No se registra en
    // dulabs_fallos_ia ni se alerta al dueño -- eso sería ruido para un
    // comportamiento esperado y correcto, no un error.
    return { handled: false, motivo: decision.motivo, outcome: result.outcome, result };
  }

  // A partir de acá: rejected, engineError, o concurrency_exhausted -- las
  // tres son fallos reales y quedan registrados, se haya podido caer a
  // LEGACY o no.
  const detalleFallo = result.engineError
    ? `engineError=${result.engineError.code} nodeId=${result.engineError.nodeId ?? "?"} :: ${result.engineError.message}`
    : result.outcome === ORCHESTRATOR_OUTCOMES.CONCURRENCY_EXHAUSTED
      ? "concurrency_exhausted"
      : `rejected: ${result.rejectReason ?? "sin motivo"}${result.detail ? ` (${result.detail})` : ""}`;

  await registrarFalloIA({
    tipo: "otro",
    mensaje: `[Flow->Legacy fallback] ${detalleFallo}. executionRowId=${result.executionRowId ?? "?"} yaEnvioAlgo=${decision.yaEnvioAlgo}. Mensaje de la clienta: "${params.texto.slice(0, 200)}"`,
    idTenant: params.cliente.id_tenant,
    phoneNumberId: params.cliente.phone_number_id,
    nombreNegocio: params.cliente.nombre_negocio,
  });

  if (decision.requiereMarcarFallida && result.executionRowId) {
    const store = createSupabaseFlowOrchestratorStore(params.supabase);
    await marcarEjecucionRotaComoFallida({
      store,
      tenantId: params.cliente.id_tenant,
      executionRowId: result.executionRowId,
    });
  }

  return { handled: decision.handled, motivo: decision.motivo, outcome: result.outcome, result };
}
