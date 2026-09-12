/**
 * Simulated Action Executor — Fase 1 (Flow Simulator, autorizado).
 *
 * Implementa `EffectExecutor` (kind: "action") sin ejecutar NUNCA un side
 * effect real -- este archivo no importa `@/lib/flow/executors/internal-action-executor`
 * ni ninguno de los adaptadores reales (`@/lib/especialistas-flow-adaptador`,
 * `@/lib/catalogo-servicios-flow-adaptador`, `@/lib/marketplace-citas`,
 * `@/lib/enterprise-leads`, `@/lib/pausas-chat`, etc.) -- aislamiento
 * estructural, mismo criterio que los otros Simulated*Executor.
 *
 * Cubre TODOS los `FlowActionType` (genéricos y específicos de un tenant,
 * incluidos los de AMORE) con el MISMO tratamiento genérico: nunca ejecuta
 * nada, solo registra la intención (params configurados + variables del
 * flow en ese punto) y devuelve un resumen legible. No se reimplementa
 * ningún catálogo ni lógica de negocio de un tenant -- este executor no
 * conoce el significado de ningún actionType, solo lo describe.
 */

import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type InternalActionOperationClass,
} from "@/lib/flow/executor-types";
import type { ActionNodeConfig } from "@/lib/flow/types";

export interface SimulatedActionOverride {
  success?: boolean;
  error?: string;
  /** Resumen legible mostrado en el inspector -- si no se da, se genera uno genérico. */
  summary?: string;
  /** Valores simulados devueltos como variables (equivalente a `event.data` de una acción real). */
  outputValues?: Record<string, unknown>;
}

export interface SimulatedActionExecutorDeps {
  resolveOverride?: (nodeId: string) => SimulatedActionOverride | undefined;
}

function resolveParams(action: ActionNodeConfig): Record<string, unknown> {
  if ("params" in action && action.params) return action.params;
  const rest: Record<string, unknown> = { ...action };
  delete rest.actionType;
  return rest;
}

function formatParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "(sin parámetros configurados)";
  return entries.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");
}

/** Resumen legible por defecto -- genérico para cualquier actionType, sin conocer su significado de negocio. */
function defaultSummary(action: ActionNodeConfig): string {
  const params = resolveParams(action);
  switch (action.actionType) {
    case "webhook_http":
      return `✓ Webhook simulado — ${action.method ?? "POST"} ${action.url} (nunca se hizo la llamada real)`;
    case "enviar_plantilla":
      return `✓ Plantilla Meta simulada — "${action.templateName}" (nunca se llamó a Meta)`;
    case "transferir_soporte":
      return "✓ Transferencia a soporte simulada (la conversación no se movió realmente)";
    case "etiquetar_conversacion":
      // FASE F7.3 (autorizado): tagId ahora es opcional (resolución dinámica
      // por nombre vía IA, ver internal-action-executor.ts) -- el simulador
      // solo describe la intención, nunca resuelve el nombre real.
      return action.tagId
        ? `✓ Etiqueta simulada — tagId=${action.tagId}`
        : "✓ Etiqueta simulada — tag elegido dinámicamente por la IA (tagName)";
    case "asignar_miembro":
      return `✓ Asignación simulada — memberId=${action.memberId}`;
    default:
      return `✓ Acción simulada (${action.actionType}) — ${formatParams(params)}`;
  }
}

export class SimulatedActionExecutor implements EffectExecutor {
  readonly kind = "action" as const;
  readonly version = "sim-1.0.0";
  readonly capabilities = {
    supportsIntegration: false,
    supportsAsync: false,
    operationClasses: [] as InternalActionOperationClass[],
  };

  constructor(private readonly deps: SimulatedActionExecutorDeps = {}) {}

  async dispatch(
    request: EffectDispatchRequest,
    _context: EffectExecutionContext,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    if (signal?.aborted) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.TIMEOUT, error: "executor_aborted" };
    }
    const action = request.action;
    if (!action) {
      return { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR, error: "action_config_required" };
    }

    const override = this.deps.resolveOverride?.(request.nodeId);

    if (override?.success === false) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: override.error ?? "action_simulated_failure",
      };
    }

    const summary = override?.summary ?? defaultSummary(action);
    const data = {
      type: "action_result" as const,
      simulated: true as const,
      actionType: action.actionType,
      summary,
      ...override?.outputValues,
    };

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data,
      appliedResult: data,
      metadata: { channel: "simulated", actionType: action.actionType },
    };
  }
}
