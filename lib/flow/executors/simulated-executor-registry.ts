/**
 * Factory del registry de executors SIMULADOS — Fase 1 (Flow Simulator, autorizado).
 *
 * Defensa estructural (spec §6): este archivo es el ÚNICO lugar donde se
 * arma un `ExecutorRegistry` para el simulador, y solo registra
 * Simulated*Executor -- nunca importa `createDefaultExecutorRegistry`
 * (lib/flow/executor-factory.ts, el registry REAL de producción) ni ninguno
 * de los executors reales (ClaudeExecutor/GeminiExecutor/SendMessageExecutor/
 * InternalActionExecutor). Es estructuralmente imposible que una simulación
 * termine ejecutando el executor real: no existe ninguna ruta de código en
 * este módulo (ni en los que importa) que lo referencie.
 *
 * A diferencia de producción, el simulador NO pasa por
 * `EffectExecutorFramework`/`IntegrationResolver` (que sí puede tocar
 * `dulabs_flow_integrations`/`dulabs_flow_credentials` reales al resolver
 * acciones externas) -- lib/flow/simulate-flow.ts despacha directo contra
 * este registry, sin ninguna capa que pueda requerir Supabase.
 */

import { ExecutorRegistry } from "@/lib/flow/executor-registry";
import { SimulatedSendMessageExecutor } from "@/lib/flow/executors/simulated-send-message-executor";
import { SimulatedAiExecutor, type SimulatedAiOverride } from "@/lib/flow/executors/simulated-ai-executor";
import { SimulatedActionExecutor, type SimulatedActionOverride } from "@/lib/flow/executors/simulated-action-executor";

export interface SimulationOverrides {
  /** Overrides de respuesta IA por nodeId. La clave "default" aplica si no hay una entrada específica del nodo. */
  ai?: Record<string, SimulatedAiOverride>;
  /** Overrides de resultado de acción por nodeId. La clave "default" aplica si no hay una entrada específica del nodo. */
  action?: Record<string, SimulatedActionOverride>;
}

function overrideResolver<T>(map: Record<string, T> | undefined) {
  return (nodeId: string): T | undefined => map?.[nodeId] ?? map?.default;
}

export function createSimulatedExecutorRegistry(overrides?: SimulationOverrides): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  registry.register(new SimulatedSendMessageExecutor());
  registry.register(new SimulatedAiExecutor({ resolveOverride: overrideResolver(overrides?.ai) }));
  registry.register(new SimulatedActionExecutor({ resolveOverride: overrideResolver(overrides?.action) }));
  return registry;
}

export type { SimulatedAiOverride, SimulatedActionOverride };
