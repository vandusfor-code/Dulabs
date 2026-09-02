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

function isTerminalExecutionStatus(status: string): boolean {
  return TERMINAL_EXECUTION_STATUSES.has(status);
}

function isLegitimateStartTrigger(event: FlowEngineEvent): boolean {
  return event.type === "start" || event.type === "text" || event.type === "button";
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

    const definition = parseFlowDefinition(versionRow.definition_json);
    const executionId = this.deps.ids.executionId();
    const initialState = this.deps.engine.createFlowEngineState(definition, {
      flowId: flowRow.id,
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
    };

    const createResult = await this.deps.store.createExecution({
      tenantId: event.tenantId,
      flowId: flowRow.id,
      flowVersionId: versionRow.id,
      executionId,
      phoneNumberId: event.conversation.phoneNumberId,
      telefonoCliente: event.conversation.telefonoCliente,
      initialState,
    });

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
        const fabricated = rejectFabricatedAiEvidence(
          dispatchResult.appliedResult ?? dispatchResult.data ?? {},
        );
        if (fabricated) {
          dispatchResult = fabricated;
        } else {
          const bridged = bridgeAiDispatchResult({
            flow: params.flow,
            aiNodeId: effect.nodeId,
            aiConfig: effect.ai,
            dispatchResult,
            tenantId: params.tenantId,
          });
          dispatchResult = bridged.dispatchResult;
          if (bridged.variablesPatch) {
            variablesPatch = { ...variablesPatch, ...bridged.variablesPatch };
          }
        }
        dispatchResult = applyAiResponseClaimSecurity({
          dispatchResult,
          variables: params.executionRow.variables,
        });
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
    return {
      success: dispatchResult.success,
      resultPayloadRaw:
        dispatchResult.rawResult ??
        dispatchResult.metadata ??
        (dispatchResult.error ? { error: dispatchResult.error } : {}),
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
