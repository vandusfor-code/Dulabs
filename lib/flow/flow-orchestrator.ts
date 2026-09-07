/**
 * Execution Orchestrator (Fase 4.0).
 * Coordina lifecycle + Store + Engine + routing de efectos externos.
 * PERSIST BEFORE DISPATCH — ningún executor externo antes de saveExecutionState CAS.
 */

import { randomUUID } from "node:crypto";
import { parseFlowDefinition } from "@/lib/flow/schemas";
import { sanitizeEventPayloadForObservability } from "@/lib/flow/sanitize-observability-payload";
import { executionRowToEngineState } from "@/lib/flow/flow-store-types";
import { FlowExecutionConcurrencyConflictError } from "@/lib/flow/flow-store-errors";
import type { EngineEffect, FlowEngineEvent } from "@/lib/flow/engine-types";
import type { FlowDefinition } from "@/lib/flow/types";
import type { AiBudgetState } from "@/lib/flow/claude/claude-types";
import {
  bridgeActionDispatchResult,
  bridgeAiDispatchResult,
  rejectFabricatedAiEvidence,
} from "@/lib/flow/ai-runtime/ai-proposal-bridge";
import { buildVerifiedActionEffectData } from "@/lib/flow/ai-runtime/verified-results";
import { applyAiResponseClaimSecurity, filterClaimSecuredEffects } from "@/lib/flow/ai-runtime/ai-response-security";
import { isCriticalAction } from "@/lib/flow/action-capabilities";
import type {
  FlowEffectRow,
  FlowExecutionRow,
  FlowVersionRow,
} from "@/lib/flow/flow-store-types";
import type {
  EffectDispatchResult,
  ExecutionOrchestratorDeps,
  NormalizedFlowEvent,
  OrchestratorRejectReason,
  OrchestratorResult,
} from "@/lib/flow/orchestrator-types";
import {
  buildEffectDispatchRequest,
  isDispatchableEffect,
  storeKindForDispatchableEffect,
  type DispatchableEngineEffect,
} from "@/lib/flow/effect-dispatchable";
import {
  CAS_BACKOFF_BASE_MS,
  DEFAULT_MAX_CAS_ATTEMPTS,
  DEFAULT_MAX_INTERNAL_EVENTS,
  ORCHESTRATOR_OUTCOMES,
} from "@/lib/flow/orchestrator-types";

export { sanitizePayloadForObservability, sanitizeEventPayloadForObservability } from "@/lib/flow/sanitize-observability-payload";

export {
  ORCHESTRATOR_OUTCOMES,
  DEFAULT_MAX_CAS_ATTEMPTS,
  DEFAULT_MAX_INTERNAL_EVENTS,
  CAS_BACKOFF_BASE_MS,
} from "@/lib/flow/orchestrator-types";
export type {
  NormalizedFlowEvent,
  OrchestratorResult,
  OrchestratorOutcome,
  OrchestratorRejectReason,
  ConversationKey,
  FlowOrchestratorStore,
  FlowOrchestratorEngine,
  EffectExecutor,
  EffectDispatchRequest,
  EffectDispatchResult,
  ExecutionOrchestratorDeps,
} from "@/lib/flow/orchestrator-types";
export type { EffectExecutorKind } from "@/lib/flow/executor-types";

const TERMINAL_EXECUTION_STATUSES = new Set(["completed", "transferred", "failed"]);

// Resiliencia AI (autorizada, AMORE Fase 1) — un fallo de un nodo "ai" en
// effect_required (Claim Security, timeout, error recuperable del executor)
// se reintenta con la MISMA petición (mismo effectId, mismo contexto de
// variables) antes de dejar que el turno siga su camino normal de fallo
// (rama aiFailure del grafo si existe, o engineError). 2 intentos en total
// -- "retry controlado", nunca un reintento indefinido. Nunca reintenta
// efectos "action" (Nylas/reservas): esta constante solo se usa dentro del
// bloque effect.kind === "ai" de registerAndDispatchEffects.
const MAX_AI_DISPATCH_ATTEMPTS = 2;

function isTerminalExecutionStatus(status: string): boolean {
  return TERMINAL_EXECUTION_STATUSES.has(status);
}

function isLegitimateStartTrigger(event: FlowEngineEvent): boolean {
  return event.type === "start" || event.type === "text" || event.type === "button";
}

// Ajuste de seguridad (autorizado) — el texto/valor real que representa
// "el mensaje actual" según el tipo de evento entrante: `text` para
// start/text, `id` para un click de botón (mismo campo que ya usa
// handleButtonInput en flow-engine.ts para volcarlo a variableKey -- no se
// inventa un criterio nuevo). "effect_result" y cualquier tipo futuro sin
// texto/valor disponible devuelven undefined a propósito, para que el
// llamador conserve el valor anterior en vez de inventar uno.
function extraerTextoDelEvento(event: FlowEngineEvent): string | undefined {
  if (event.type === "start" || event.type === "text") return event.text;
  if (event.type === "button") return event.id;
  return undefined;
}

function casBackoffMs(attempt: number): number {
  const base = CAS_BACKOFF_BASE_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * CAS_BACKOFF_BASE_MS);
  return base + jitter;
}

function effectResultFromRow(row: FlowEffectRow): FlowEngineEvent {
  const data =
    (row.result_payload_applied as Record<string, unknown> | null) ??
    (row.result_payload_raw as Record<string, unknown> | null) ??
    {};
  return {
    type: "effect_result",
    success: row.status === "succeeded",
    effectId: row.effect_id,
    eventId: `effect-result:${row.effect_id}`,
    data,
    error: row.status === "failed" ? "effect_failed" : undefined,
  };
}

function isDispatchableEngineEffect(effect: EngineEffect): effect is DispatchableEngineEffect {
  return isDispatchableEffect(effect);
}

function rejected(
  reason: OrchestratorRejectReason,
  detail?: string,
  executionRowId?: string,
): OrchestratorResult {
  return {
    outcome: ORCHESTRATOR_OUTCOMES.REJECTED,
    rejectReason: reason,
    detail,
    executionRowId,
    effects: [],
    dispatchedEffectIds: [],
  };
}

interface PendingEngineWork {
  engineEvent: FlowEngineEvent;
  sourceEventId: string;
}

interface EngineIterationResult {
  outcome: OrchestratorResult["outcome"];
  effects: EngineEffect[];
  dispatchedEffectIds: string[];
  internalEvents: FlowEngineEvent[];
  engineError?: OrchestratorResult["engineError"];
  rejectReason?: OrchestratorRejectReason;
  detail?: string;
  /** Bug raíz #3 — una acción crítica se ejecutó con éxito en esta iteración. */
  criticalActionExecuted?: boolean;
}

export class ExecutionOrchestrator {
  private readonly maxCasAttempts: number;
  private readonly maxInternalEvents: number;

  constructor(private readonly deps: ExecutionOrchestratorDeps) {
    this.maxCasAttempts = deps.maxCasAttempts ?? DEFAULT_MAX_CAS_ATTEMPTS;
    this.maxInternalEvents = deps.maxInternalEvents ?? DEFAULT_MAX_INTERNAL_EVENTS;
  }

  async process(event: NormalizedFlowEvent): Promise<OrchestratorResult> {
    const resolve = await this.resolveExecution(event);
    if (resolve.kind === "reject") {
      return resolve.result;
    }

    const executionRow = resolve.executionRow;

    if (executionRow.tenant_id !== event.tenantId) {
      return rejected("tenant_mismatch", undefined, executionRow.id);
    }

    const eventInsert = await this.deps.store.insertEventIdempotent({
      tenantId: event.tenantId,
      flowExecutionId: executionRow.id,
      eventId: event.eventId,
      eventType: event.eventType,
      rawPayload: sanitizeEventPayloadForObservability(event.payload),
    });

    if (!eventInsert.inserted) {
      return {
        outcome: ORCHESTRATOR_OUTCOMES.DUPLICATE_EVENT,
        executionRowId: executionRow.id,
        effects: [],
        dispatchedEffectIds: [],
      };
    }

    const freshRow = await this.deps.store.getExecutionById(event.tenantId, executionRow.id);
    if (!freshRow) {
      return rejected("execution_not_found", undefined, executionRow.id);
    }

    if (isTerminalExecutionStatus(freshRow.status)) {
      return {
        outcome: ORCHESTRATOR_OUTCOMES.TERMINAL_NO_OP,
        executionRowId: freshRow.id,
        effects: [],
        dispatchedEffectIds: [],
      };
    }

    const versionRow = await this.deps.store.getFlowVersion(
      event.tenantId,
      freshRow.flow_version_id,
    );
    if (!versionRow) {
      return rejected("pinned_version_not_found", freshRow.flow_version_id, freshRow.id);
    }

    const flow = parseFlowDefinition(versionRow.definition_json);

    const accumulatedEffects: EngineEffect[] = [];
    const dispatchedEffectIds: string[] = [];
    const pending: PendingEngineWork[] = [
      { engineEvent: resolve.engineEvent, sourceEventId: event.eventId },
    ];
    let internalEventsProcessed = 0;
    // Bug raíz #3 — se acumula a través de TODAS las iteraciones del turno.
    // Una acción crítica exitosa en cualquier iteración marca todo el turno,
    // aunque una iteración POSTERIOR falle (ej. ai-confirmar → engineError).
    let criticalActionExecuted = false;

    while (pending.length > 0) {
      const work = pending.shift()!;
      const iteration = await this.runEngineIterationWithCas({
        tenantId: event.tenantId,
        executionRowId: freshRow.id,
        flow,
        engineEvent: work.engineEvent,
        sourceEventId: work.sourceEventId,
      });

      if (iteration.criticalActionExecuted) criticalActionExecuted = true;

      if (iteration.engineError) {
        return {
          outcome: ORCHESTRATOR_OUTCOMES.PROCESSED,
          executionRowId: freshRow.id,
          effects: [...accumulatedEffects, ...iteration.effects],
          dispatchedEffectIds: [...dispatchedEffectIds, ...iteration.dispatchedEffectIds],
          engineError: iteration.engineError,
          criticalActionExecuted,
        };
      }

      if (iteration.outcome !== ORCHESTRATOR_OUTCOMES.PROCESSED) {
        return {
          outcome: iteration.outcome,
          executionRowId: freshRow.id,
          effects: [...accumulatedEffects, ...iteration.effects],
          dispatchedEffectIds: [...dispatchedEffectIds, ...iteration.dispatchedEffectIds],
          engineError: iteration.engineError,
          rejectReason: iteration.rejectReason,
          detail: iteration.detail,
          criticalActionExecuted,
        };
      }

      accumulatedEffects.push(...iteration.effects);
      dispatchedEffectIds.push(...iteration.dispatchedEffectIds);

      for (const internalEvent of iteration.internalEvents) {
        if (internalEventsProcessed >= this.maxInternalEvents) {
          return {
            outcome: ORCHESTRATOR_OUTCOMES.PROCESSED,
            executionRowId: freshRow.id,
            effects: accumulatedEffects,
            dispatchedEffectIds,
            detail: "internal_event_limit_reached",
            criticalActionExecuted,
          };
        }
        pending.push({ engineEvent: internalEvent, sourceEventId: event.eventId });
        internalEventsProcessed += 1;
      }
    }

    return {
      outcome: ORCHESTRATOR_OUTCOMES.PROCESSED,
      executionRowId: freshRow.id,
      effects: accumulatedEffects,
      dispatchedEffectIds,
      criticalActionExecuted,
    };
  }

  private async resolveExecution(
    event: NormalizedFlowEvent,
  ): Promise<
    | { kind: "ok"; executionRow: FlowExecutionRow; engineEvent: FlowEngineEvent }
    | { kind: "reject"; result: OrchestratorResult }
  > {
    const active = await this.deps.store.getActiveExecution(event.tenantId, event.conversation);

    if (active) {
      // Diagnóstico forense (autorizado, incidente AMORE 2026-09-07 00:44) —
      // flow_version_id queda fijado al CREAR la ejecución y nunca migra
      // automáticamente (supabase/migrations/20260828100000_dulabs_flow_store.sql,
      // comentario de columna). Si mientras la ejecución sigue activa se
      // publica una versión nueva del Flow, esa ejecución sigue corriendo
      // la versión VIEJA indefinidamente -- confirmado con evidencia real:
      // una corrección de grafo (rama aiFailure) publicada como v10 nunca
      // llegó a aplicarse porque la ejecución real seguía anclada a v9.
      // Antes de procesar el mensaje sobre una ejecución activa, se compara
      // su flow_version_id contra la versión PUBLICADA actual (mismo
      // mecanismo ya usado más abajo para crear una ejecución nueva,
      // this.deps.store.getFlow). Si coincide, comportamiento intacto. Si
      // no coincide, se cierra esa ejecución vieja (mismo patrón exacto que
      // marcarEjecucionRotaComoFallida en flow-runtime-bridge.ts) y se crea
      // una ejecución nueva sobre el Flow publicado actual, conservando
      // TODO el `variables` real de la ejecución vieja (agendamiento,
      // servicio, fecha, etc.) -- nunca se trata como una conversación
      // nueva. Todo esto ocurre ANTES de insertEventIdempotent, así que
      // este mensaje se procesa una sola vez, sobre una sola ejecución.
      // El chequeo de tenant_mismatch real vive en process() (compara
      // executionRow.tenant_id contra event.tenantId DESPUÉS de resolver la
      // ejecución) -- si esta `active` es de OTRO tenant (nunca debería
      // pasar en producción, getActiveExecution ya filtra por tenant; solo
      // ocurre en pruebas adversariales), NUNCA se migra usando el flow del
      // tenant del EVENTO: se deja tal cual para que ese chequeo posterior
      // la rechace, exactamente como antes de este fix.
      //
      // Ajuste de seguridad (autorizado) -- si la ejecución tiene un efecto
      // externo REAL en vuelo (status="waiting_effect": Nylas, IA, etc.),
      // NUNCA se migra. Cerrarla dejaría el eventual effect_result huérfano
      // contra una ejecución ya cerrada -- inaceptable para una reserva que
      // Nylas puede terminar creando de todos modos del otro lado. La
      // migración de versión solo aplica a una ejecución que está
      // esperando un mensaje NUEVO del cliente (waiting_input/running),
      // nunca a una con un efecto ya despachado. No se inventa ningún
      // estado nuevo: "waiting_effect" ya es uno de los estados reales de
      // dulabs_flow_executions (ver ACTIVE_EXECUTION_STATUSES en flow-store.ts).
      const flowActual =
        active.status !== "waiting_effect" && active.tenant_id === event.tenantId
          ? await this.deps.store.getFlow(event.tenantId, active.flow_id)
          : null;
      if (flowActual?.published_version_id && flowActual.published_version_id !== active.flow_version_id) {
        const versionActual = await this.deps.store.getFlowVersion(event.tenantId, flowActual.published_version_id);
        if (versionActual) {
          return this.migrateToPublishedVersion(event, active, flowActual.id, versionActual);
        }
      }
      return { kind: "ok", executionRow: active, engineEvent: event.engineEvent };
    }

    if (!isLegitimateStartTrigger(event.engineEvent)) {
      if (event.engineEvent.type === "effect_result") {
        return { kind: "reject", result: rejected("orphan_effect_result") };
      }
      return { kind: "reject", result: rejected("not_a_start_trigger") };
    }

    const flowRow = await this.deps.store.getFlow(event.tenantId, event.flowId);
    if (!flowRow?.published_version_id) {
      return { kind: "reject", result: rejected("flow_not_published") };
    }

    const versionRow = await this.deps.store.getFlowVersion(
      event.tenantId,
      flowRow.published_version_id,
    );
    if (!versionRow) {
      return { kind: "reject", result: rejected("version_not_found") };
    }

    const createResult = await this.createExecutionRow(event, flowRow.id, versionRow, {});

    if (createResult.created) {
      return { kind: "ok", executionRow: createResult.row, engineEvent: event.engineEvent };
    }

    // Blocker #8 — perdimos la carrera de creación: esta fila NO la creamos
    // nosotros, la creó (y puede ya haber avanzado) otra invocación
    // concurrente de process() para la MISMA conversación. Un evento "start"
    // original SIEMPRE resetea el estado del engine incondicionalmente
    // (flow-engine.ts: currentNodeId/expectedInput/pendingEffect se pisan
    // sin mirar si el estado ya traía progreso real) -- aplicarlo tal cual
    // aquí pisaría el avance genuino del ganador y re-dispararía, por
    // ejemplo, la clasificación de intención del router desde cero.
    //
    // Se transforma a "text" (preservando el texto original si lo había)
    // para tratarlo como una continuación de la ejecución existente en vez
    // de un reinicio: si esa fila de verdad está esperando texto
    // (waiting_input + expectedInput:"text"), se aplica correctamente sobre
    // el nodo real donde quedó; si no (waiting_effect, esperando botón,
    // etc.), el propio guard INVALID_STATE del engine lo rechaza de forma
    // segura -- nunca pisa ni corrompe el estado real, y el llamador
    // (lib/flow-runtime-bridge.ts) ya sabe caer a LEGACY ante un
    // engineError. Un evento que YA era "text"/"button" no se toca: nunca
    // resetea nada, así que no había nada que corregir en ese caso -- ya
    // pasa por el mismo guard fail-closed del engine contra el estado real.
    const engineEvent: FlowEngineEvent =
      event.engineEvent.type === "start"
        ? { type: "text", text: event.engineEvent.text ?? "", eventId: event.engineEvent.eventId }
        : event.engineEvent;

    return { kind: "ok", executionRow: createResult.existing, engineEvent };
  }

  /**
   * Diagnóstico forense (autorizado) — ver comentario en resolveExecution.
   * Cierra la ejecución vieja (mismo patrón exacto que
   * marcarEjecucionRotaComoFallida en flow-runtime-bridge.ts: leer la fila
   * fresca, nunca tocar una ya terminal, guardar status:"failed" con su
   * propio state_version) y crea una ejecución nueva sobre el Flow
   * publicado actual, con el mensaje que disparó la migración como
   * mensajeActual del primer turno y TODO el `variables` real de la
   * ejecución vieja copiado encima -- nunca se trata como una conversación
   * nueva. No se importa marcarEjecucionRotaComoFallida directamente
   * (crearía un ciclo: flow-runtime-bridge.ts ya importa de este archivo)
   * -- se reimplementa el mismo cierre best-effort acá, con this.deps.store
   * (ya disponible en esta clase).
   */
  private async migrateToPublishedVersion(
    event: NormalizedFlowEvent,
    oldRow: FlowExecutionRow,
    flowId: string,
    versionRow: FlowVersionRow,
  ): Promise<
    | { kind: "ok"; executionRow: FlowExecutionRow; engineEvent: FlowEngineEvent }
    | { kind: "reject"; result: OrchestratorResult }
  > {
    // Ajuste de seguridad (autorizado) -- relectura fresca justo antes de
    // cerrar: `oldRow` puede haber quedado desactualizada (otra invocación
    // concurrente pudo haber despachado un efecto real, dejándola
    // waiting_effect, o haberla cerrado/completado ya) en el tiempo entre
    // leer `active` y llegar acá. Si ahora tiene un efecto en vuelo o ya es
    // terminal, se aborta la migración por completo -- NUNCA se cierra, NUNCA
    // se crea una ejecución nueva -- y se sigue procesando este mensaje
    // exactamente como si nunca se hubiera detectado un desfase de versión
    // (mismo camino que el guard de arriba en resolveExecution).
    const fresh = await this.deps.store.getExecutionById(event.tenantId, oldRow.id);
    if (!fresh || fresh.status === "waiting_effect" || isTerminalExecutionStatus(fresh.status)) {
      return { kind: "ok", executionRow: fresh ?? oldRow, engineEvent: event.engineEvent };
    }

    try {
      await this.deps.store.saveExecutionState(
        event.tenantId,
        fresh.id,
        { ...executionRowToEngineState(fresh), status: "failed" },
        fresh.state_version,
      );
    } catch {
      // Best-effort -- un conflicto de CAS (otra invocación concurrente ya
      // la cerró o la avanzó) no debe impedir que la ejecución nueva se
      // cree igual.
    }

    const textoActual = extraerTextoDelEvento(event.engineEvent);

    const presetVariables: Record<string, unknown> = { ...oldRow.variables };
    if (typeof textoActual === "string" && textoActual.trim()) {
      // El mensaje que disparó esta migración es el que la ejecución nueva
      // debe procesar en su primer turno -- nunca el que haya quedado
      // guardado en mensajeActual de la ejecución vieja (sería un turno
      // anterior). resolverEscenarioAction (internal-action-executor.ts)
      // ya prioriza mensajeActual sobre __firstMessageText.
      presetVariables.mensajeActual = textoActual;
    }

    const createResult = await this.createExecutionRow(event, flowId, versionRow, { presetVariables });
    const engineEvent: FlowEngineEvent = { type: "start", text: textoActual, eventId: event.engineEvent.eventId };

    if (createResult.created) {
      return { kind: "ok", executionRow: createResult.row, engineEvent };
    }
    // Best-effort -- colisión de UUID prácticamente imposible (executionId
    // es un UUID nuevo generado acá, no reutiliza ninguno existente).
    return { kind: "ok", executionRow: createResult.existing, engineEvent };
  }

  private async createExecutionRow(
    event: NormalizedFlowEvent,
    flowId: string,
    versionRow: FlowVersionRow,
    options: { presetVariables?: Record<string, unknown> },
  ) {
    const definition = parseFlowDefinition(versionRow.definition_json);
    const executionId = this.deps.ids.executionId();
    const initialState = this.deps.engine.createFlowEngineState(definition, {
      flowId,
      flowVersionId: versionRow.id,
      executionId,
    });
    // Bug raíz #4 (slot-filling) — se siembra la fecha de HOY (hora de
    // Colombia, YYYY-MM-DD) al CREAR la ejecución. Un nodo AI de extracción
    // (ej. agendar__ai-extraer) puede así resolver referencias relativas
    // ("el viernes") a una fecha concreta. Variable SIN prefijo "__" a
    // propósito: debe ser visible para Claude en el bloque VARIABLES (los
    // "__" se filtran vía stripInternalKeys). Es un dato inocuo y general:
    // los flows que no lo lean simplemente lo ignoran. NO reemplaza ninguna
    // consulta real -- solo ayuda a interpretar el primer mensaje.
    initialState.variables = {
      ...initialState.variables,
      hoy: new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }),
      // Mismo criterio que 'hoy' -- se siembra SOLO si el tenant tiene algo
      // configurado, sin prefijo "__" a propósito (debe ser visible para
      // Claude en el bloque VARIABLES). Un flow que no la lea no cambia de
      // comportamiento.
      ...(event.baseConocimiento ? { baseConocimiento: event.baseConocimiento } : {}),
      // Migración de versión (autorizada) -- copia explícita y mínima del
      // estado conversacional real de una ejecución vieja (agendamiento,
      // servicio, fecha, etc.) por encima de los valores por defecto del
      // Flow nuevo. Vacío (comportamiento de siempre) cuando no aplica.
      ...(options.presetVariables ?? {}),
    };

    return this.deps.store.createExecution({
      tenantId: event.tenantId,
      flowId,
      flowVersionId: versionRow.id,
      executionId,
      phoneNumberId: event.conversation.phoneNumberId,
      telefonoCliente: event.conversation.telefonoCliente,
      initialState,
    });
  }

  private async runEngineIterationWithCas(params: {
    tenantId: string;
    executionRowId: string;
    flow: FlowDefinition;
    engineEvent: FlowEngineEvent;
    sourceEventId: string;
  }): Promise<EngineIterationResult> {
    for (let attempt = 0; attempt < this.maxCasAttempts; attempt += 1) {
      const row = await this.deps.store.getExecutionById(params.tenantId, params.executionRowId);
      if (!row) {
        return {
          outcome: ORCHESTRATOR_OUTCOMES.REJECTED,
          rejectReason: "execution_not_found",
          effects: [],
          dispatchedEffectIds: [],
          internalEvents: [],
        };
      }

      if (isTerminalExecutionStatus(row.status)) {
        return {
          outcome: ORCHESTRATOR_OUTCOMES.TERMINAL_NO_OP,
          effects: [],
          dispatchedEffectIds: [],
          internalEvents: [],
        };
      }

      const engineState = executionRowToEngineState(row);
      const previousNodeId = engineState.currentNodeId;

      const runResult = this.deps.engine.runFlowEngine(
        params.flow,
        engineState,
        params.engineEvent,
        {
          eventId: params.sourceEventId,
          idGenerator: this.deps.ids.effectId,
        },
      );

      if (runResult.error) {
        return {
          outcome: ORCHESTRATOR_OUTCOMES.PROCESSED,
          effects: runResult.effects,
          dispatchedEffectIds: [],
          internalEvents: [],
          engineError: runResult.error,
        };
      }

      try {
        const saveResult = await this.deps.store.saveExecutionState(
          params.tenantId,
          row.id,
          runResult.state,
          row.state_version,
        );

        if (
          previousNodeId !== runResult.state.currentNodeId &&
          runResult.state.currentNodeId
        ) {
          await this.deps.store.recordNodeTransition({
            tenantId: params.tenantId,
            flowExecutionId: row.id,
            eventId: params.sourceEventId,
            fromNodeId: previousNodeId,
            toNodeId: runResult.state.currentNodeId,
          });
        }

        const effectOutcome = await this.registerAndDispatchEffects({
          tenantId: params.tenantId,
          // Bug raíz #1 (incidente "disponible→ocupado") — se pasan las
          // variables FRESCAS (runResult.state.variables, ya guardadas en
          // line 395 vía saveExecutionState), no las de `row` (snapshot del
          // INICIO de la iteración, antes de que el motor fusionara la
          // evidencia verificada que la acción de este mismo turno acaba de
          // producir). Sin esto, applyAiResponseClaimSecurity veía variables
          // obsoletas SIN appointment.reserved y rechazaba erróneamente el
          // mensaje de confirmación de una cita que SÍ se creó. Es la misma
          // fuente de verdad que ya usaba filterClaimSecuredEffects (abajo).
          executionRow: {
            ...row,
            variables: runResult.state.variables,
            state_version: saveResult.stateVersion,
          },
          effects: filterClaimSecuredEffects(runResult.effects, runResult.state.variables),
          flow: params.flow,
        });

        if (effectOutcome.variablesPatch && Object.keys(effectOutcome.variablesPatch).length > 0) {
          const patchedRow = await this.deps.store.getExecutionById(
            params.tenantId,
            params.executionRowId,
          );
          if (patchedRow) {
            const patchedState = executionRowToEngineState(patchedRow);
            patchedState.variables = {
              ...patchedState.variables,
              ...effectOutcome.variablesPatch,
            };
            try {
              await this.deps.store.saveExecutionState(
                params.tenantId,
                patchedRow.id,
                patchedState,
                patchedRow.state_version,
              );
            } catch {
              // CAS conflict — siguiente iteración reintentará con estado fresco
            }
          }
        }

        if (effectOutcome.aiBudgetAfter) {
          const budgetRow = await this.deps.store.getExecutionById(
            params.tenantId,
            params.executionRowId,
          );
          if (budgetRow) {
            const budgetState = executionRowToEngineState(budgetRow);
            budgetState.metadata = {
              ...budgetState.metadata,
              aiBudget: effectOutcome.aiBudgetAfter,
            };
            try {
              await this.deps.store.saveExecutionState(
                params.tenantId,
                budgetRow.id,
                budgetState,
                budgetRow.state_version,
              );
            } catch {
              // CAS conflict — budget se re-leerá en siguiente dispatch
            }
          }
        }

        return {
          outcome: ORCHESTRATOR_OUTCOMES.PROCESSED,
          effects: runResult.effects,
          dispatchedEffectIds: effectOutcome.dispatchedEffectIds,
          internalEvents: effectOutcome.internalEvents,
          criticalActionExecuted: effectOutcome.criticalActionExecuted,
        };
      } catch (err) {
        if (err instanceof FlowExecutionConcurrencyConflictError) {
          await this.deps.clock.sleepMs(casBackoffMs(attempt));
          continue;
        }
        throw err;
      }
    }

    return {
      outcome: ORCHESTRATOR_OUTCOMES.CONCURRENCY_EXHAUSTED,
      effects: [],
      dispatchedEffectIds: [],
      internalEvents: [],
    };
  }

  private async registerAndDispatchEffects(params: {
    tenantId: string;
    executionRow: FlowExecutionRow;
    effects: EngineEffect[];
    flow: FlowDefinition;
  }): Promise<{
    dispatchedEffectIds: string[];
    internalEvents: FlowEngineEvent[];
    variablesPatch?: Record<string, unknown>;
    aiBudgetAfter?: AiBudgetState;
    criticalActionExecuted: boolean;
  }> {
    const dispatchedEffectIds: string[] = [];
    const internalEvents: FlowEngineEvent[] = [];
    let variablesPatch: Record<string, unknown> = {};
    let aiBudgetAfter: AiBudgetState | undefined;
    let criticalActionExecuted = false;
    let currentAiBudget = params.executionRow.metadata?.aiBudget as AiBudgetState | undefined;
    const conversation = {
      phoneNumberId: params.executionRow.phone_number_id,
      telefonoCliente: params.executionRow.telefono_cliente,
    };

    for (const effect of params.effects) {
      if (!isDispatchableEngineEffect(effect)) continue;

      const existing = await this.deps.store.getEffectByEffectId(
        params.tenantId,
        params.executionRow.id,
        effect.effectId,
      );

      if (existing) {
        if (existing.status === "succeeded" && effect.type === "effect_required") {
          internalEvents.push(effectResultFromRow(existing));
        }
        continue;
      }

      const insertResult = await this.deps.store.insertEffectIdempotent({
        tenantId: params.tenantId,
        flowExecutionId: params.executionRow.id,
        effectId: effect.effectId,
        nodeId: effect.nodeId,
        kind: storeKindForDispatchableEffect(effect),
      });

      if (!insertResult.inserted) {
        const duplicate = await this.deps.store.getEffectByEffectId(
          params.tenantId,
          params.executionRow.id,
          effect.effectId,
        );
        if (duplicate?.status === "succeeded" && effect.type === "effect_required") {
          internalEvents.push(effectResultFromRow(duplicate));
        }
        continue;
      }

      const request = buildEffectDispatchRequest({
        effect,
        tenantId: params.tenantId,
        executionRowId: params.executionRow.id,
        conversation,
        attempt: 1,
        flowId: params.executionRow.flow_id,
        flowVersionId: params.executionRow.flow_version_id,
        aiBudget: currentAiBudget,
      });

      let dispatchResult = await this.deps.effectFramework.execute(request);
      dispatchedEffectIds.push(effect.effectId);

      if (effect.type === "effect_required" && effect.kind === "ai") {
        const applyAiPostProcessing = (raw: EffectDispatchResult): EffectDispatchResult => {
          const fabricated = rejectFabricatedAiEvidence(raw.appliedResult ?? raw.data ?? {});
          if (fabricated) return fabricated;
          const bridged = bridgeAiDispatchResult({
            flow: params.flow,
            aiNodeId: effect.nodeId,
            aiConfig: effect.ai,
            dispatchResult: raw,
            tenantId: params.tenantId,
          });
          if (bridged.variablesPatch) {
            variablesPatch = { ...variablesPatch, ...bridged.variablesPatch };
          }
          return applyAiResponseClaimSecurity({
            dispatchResult: bridged.dispatchResult,
            variables: params.executionRow.variables,
          });
        };

        dispatchResult = applyAiPostProcessing(dispatchResult);

        // Resiliencia (autorizada) — retry controlado: mismo effectId, mismo
        // contexto (variables no cambian entre intentos), nunca vuelve a
        // ejecutar Nylas/una acción crítica (viven en efectos "action"
        // aparte, no en este bloque). Si el reintento también falla, sigue
        // el camino de fallo normal sin cambios (aiFailure del grafo, o
        // engineError si no existe esa rama).
        for (
          let attempt = 2;
          !dispatchResult.success && attempt <= MAX_AI_DISPATCH_ATTEMPTS;
          attempt += 1
        ) {
          const retryRequest = buildEffectDispatchRequest({
            effect,
            tenantId: params.tenantId,
            executionRowId: params.executionRow.id,
            conversation,
            attempt,
            flowId: params.executionRow.flow_id,
            flowVersionId: params.executionRow.flow_version_id,
            aiBudget: currentAiBudget,
          });
          const retryDispatch = await this.deps.effectFramework.execute(retryRequest);
          dispatchResult = applyAiPostProcessing(retryDispatch);
        }

        const budgetMeta = dispatchResult.metadata?.budgetAfter as AiBudgetState | undefined;
        if (budgetMeta) {
          aiBudgetAfter = budgetMeta;
          currentAiBudget = budgetMeta;
        }
      }

      if (effect.type === "effect_required" && effect.kind === "action" && effect.action) {
        if (dispatchResult.success) {
          // Bug raíz #3 — señal estructurada: una acción CRÍTICA (agendar/
          // cancelar/mover cita) se ejecutó con éxito en este turno. El
          // fallback a LEGACY no debe reprocesar el mensaje después de esto.
          if (isCriticalAction(effect.action)) {
            criticalActionExecuted = true;
          }
          const verifiedData = buildVerifiedActionEffectData({
            action: effect.action,
            effectId: effect.effectId,
            executionId: effect.executionId,
            rawData: dispatchResult.appliedResult ?? dispatchResult.data ?? {},
          });
          dispatchResult = bridgeActionDispatchResult({ dispatchResult, verifiedData });
        }
      }

      const persisted = await this.persistEffectDispatchResult({
        tenantId: params.tenantId,
        flowExecutionId: params.executionRow.id,
        effectId: effect.effectId,
        dispatchResult,
        needsEngineContinuation: effect.type === "effect_required",
      });

      if (persisted && effect.type === "effect_required") {
        internalEvents.push(persisted);
      }
    }

    return {
      dispatchedEffectIds,
      internalEvents,
      variablesPatch: Object.keys(variablesPatch).length ? variablesPatch : undefined,
      aiBudgetAfter,
      criticalActionExecuted,
    };
  }

  private deriveDispatchResult(dispatchResult: EffectDispatchResult): {
    success: boolean;
    resultPayloadRaw?: Record<string, unknown>;
    resultPayloadApplied?: Record<string, unknown>;
  } {
    const baseRaw = dispatchResult.rawResult ?? dispatchResult.metadata ?? {};
    return {
      success: dispatchResult.success,
      // HALLAZGO REAL (autorizado) — cuando dispatchResult trae rawResult
      // (ej. applyAiResponseClaimSecurity, que preserva el rawResult original
      // de un dispatch que SÍ tuvo éxito antes de ser rechazado después) el
      // `?? dispatchResult.error` de abajo nunca se alcanzaba: el motivo real
      // del fallo (unverified_external_claim:..., etc.) se perdía por
      // completo y quedaba invisible para siempre en dulabs_flow_effects,
      // dejando una ejecución fallida sin ningún rastro diagnosticable. Ahora
      // el error se añade siempre que el dispatch falló, sin pisar ninguna
      // clave que el propio executor ya haya puesto en su rawResult.
      resultPayloadRaw:
        !dispatchResult.success && dispatchResult.error
          ? { ...baseRaw, error: dispatchResult.error }
          : baseRaw,
      resultPayloadApplied:
        dispatchResult.appliedResult ??
        dispatchResult.data ??
        dispatchResult.rawResult ??
        {},
    };
  }

  /**
   * Executor → persist effect result → effect_result para Engine.
   * Si la persistencia falla, NO se encola evento interno.
   */
  private async persistEffectDispatchResult(params: {
    tenantId: string;
    flowExecutionId: string;
    effectId: string;
    dispatchResult: EffectDispatchResult;
    needsEngineContinuation: boolean;
  }): Promise<FlowEngineEvent | null> {
    const derived = this.deriveDispatchResult(params.dispatchResult);

    const resolved = await this.deps.store.resolveEffectResult({
      tenantId: params.tenantId,
      flowExecutionId: params.flowExecutionId,
      effectId: params.effectId,
      status: derived.success ? "succeeded" : "failed",
      resultPayloadRaw: derived.resultPayloadRaw,
      resultPayloadApplied: derived.resultPayloadApplied,
      resolvedAt: this.deps.clock.nowIso(),
    });

    if (!resolved.ok) {
      return null;
    }

    if (!params.needsEngineContinuation) {
      return null;
    }

    return effectResultFromRow(resolved.row);
  }
}

/** Factory con reloj e IDs por defecto para producción/tests. */
export function createExecutionOrchestrator(
  deps: Omit<ExecutionOrchestratorDeps, "clock" | "ids"> & {
    clock?: Partial<ExecutionOrchestratorDeps["clock"]>;
    ids?: Partial<ExecutionOrchestratorDeps["ids"]>;
  },
): ExecutionOrchestrator {
  return new ExecutionOrchestrator({
    ...deps,
    clock: {
      nowIso: deps.clock?.nowIso ?? (() => new Date().toISOString()),
      sleepMs: deps.clock?.sleepMs ?? (async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      }),
    },
    ids: {
      executionId: deps.ids?.executionId ?? (() => randomUUID()),
      effectId: deps.ids?.effectId ?? (() => randomUUID()),
    },
  });
}

/**
 * GAP (observabilidad): el Engine no expone transiciones intermedias en auto-steps;
 * recordNodeTransition solo captura from→to del delta final por iteración CAS.
 *
 * GAP (crash safety): si saveExecutionState tiene éxito pero insertEffectIdempotent
 * falla parcialmente, no re-ejecutar Engine sobre el mismo evento; reconciliación futura.
 */
