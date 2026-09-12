/**
 * Flow Simulator — Fase 1 (Flow Simulator, autorizado).
 *
 * Motor del "Probar Flow" del Builder. Reutiliza EXACTAMENTE el Flow Engine
 * puro de producción (`runFlowEngine`, `resolveNextNodeId`,
 * `createFlowEngineState`, `DEFAULT_MAX_AUTO_STEPS` -- todos importados sin
 * modificación de lib/flow/flow-engine.ts) para decidir transiciones,
 * condiciones e interpolación de variables. Este archivo NUNCA reimplementa
 * esa lógica -- solo orquesta: llama al motor puro, y cuando el motor pide
 * un efecto externo (`effect_required`, nodos `action`/`ai`) lo despacha
 * contra un `ExecutorRegistry` de executors SIMULADOS (nunca los reales, ver
 * lib/flow/executors/simulated-executor-registry.ts) y le devuelve el
 * resultado al motor como evento `effect_result`, igual que hace
 * `FlowOrchestrator` en producción -- pero sin ninguna de las piezas de
 * producción (Supabase, CAS, idempotencia, Claim Security, WhatsApp, IA
 * real): este módulo no importa `lib/flow/flow-orchestrator.ts` ni
 * `lib/flow/executor-factory.ts`.
 *
 * Sin persistencia: el estado del motor (`FlowEngineState`) es JSON
 * serializable y viaja completo en la respuesta de cada turno para que el
 * caller (la API) lo devuelva al cliente y el cliente lo reenvíe en el
 * siguiente turno -- nunca se escribe en `dulabs_flow_executions` ni en
 * ninguna tabla real (spec §26).
 */

import {
  DEFAULT_MAX_AUTO_STEPS,
  createFlowEngineState,
  resolveNextNodeId,
  runFlowEngine,
} from "@/lib/flow/flow-engine";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import type {
  EngineEffect,
  FlowEngineEvent,
  FlowEngineState,
  FlowEngineStatus,
} from "@/lib/flow/engine-types";
import type {
  ConditionRule,
  FlowButton,
  FlowDefinition,
  FlowMessageContent,
  FlowNode,
  FlowNodeType,
  MessageOrigin,
} from "@/lib/flow/types";
import { buildEffectDispatchRequest, type DispatchableEngineEffect } from "@/lib/flow/effect-dispatchable";
import type { ExecutorRegistry } from "@/lib/flow/executor-registry";
import type { EffectDispatchResult } from "@/lib/flow/executor-types";
import { reconstructNodePath } from "@/lib/flow/reconstruct-node-path";

// ---------------------------------------------------------------------------
// Contratos públicos
// ---------------------------------------------------------------------------

/** Evento que el usuario del simulador puede enviar -- subconjunto de FlowEngineEvent (effect_result es interno del driver, nunca se acepta desde afuera). */
export type SimulationInputEvent =
  | { type: "start" }
  | { type: "text"; text: string }
  | { type: "button"; id: string };

export interface SimulatedMessage {
  nodeId: string;
  content: FlowMessageContent;
  buttons?: FlowButton[];
  origin: MessageOrigin;
  simulated: true;
}

export interface SimulatedEffectLogEntry {
  effectId: string;
  nodeId: string;
  kind: "send_message" | "action" | "ai" | "human" | "end";
  actionType?: string;
  summary: string;
  simulated: true;
  data?: Record<string, unknown>;
  success: boolean;
}

export interface ConditionEvaluationTrace {
  nodeId: string;
  /** "unknown" cuando el camino intermedio entre dos puntos observados es ambiguo (ver reconstructPath) -- nunca se adivina. */
  result: boolean | "unknown";
  rules: ConditionRule[];
  match: "all" | "any";
}

export type SimulationTransitionReason =
  | "start"
  | "auto"
  | "condition_true"
  | "condition_false"
  | "button"
  | "text"
  | "effect_success"
  | "effect_failure"
  | "ai_classification";

export interface SimulationTransition {
  fromNodeId: string | null;
  toNodeId: string;
  nodeType: FlowNodeType;
  reason: SimulationTransitionReason;
  /** true si el camino intermedio (entre dos nodos observados) tenía más de una ruta posible sin poder determinarse cuál se usó realmente -- ver reconstructPath. Nunca se fabrica un resultado en ese caso. */
  ambiguous?: boolean;
  timestamp: string;
}

export interface SimulationTurnResult {
  /** Estado del motor puro -- serializable, se reenvía tal cual en el siguiente turno. */
  engineState: FlowEngineState;
  status: FlowEngineStatus;
  currentNodeId: string | null;
  expectedInput?: "text" | "button";
  currentButtons?: FlowButton[];
  messages: SimulatedMessage[];
  effectsLog: SimulatedEffectLogEntry[];
  transitions: SimulationTransition[];
  conditionEvaluations: ConditionEvaluationTrace[];
  variables: Record<string, unknown>;
  exports: FlowEngineState["exports"];
  /** Antes/después de exports de ESTE turno -- para el panel "antes/después" de save_data (spec §13). */
  exportsBefore: FlowEngineState["exports"];
  error?: { code: string; message: string; nodeId: string | null };
  humanHandoff?: { nodeId: string; pauseDurationHours: number; assignTo?: string };
  completed?: { nodeId: string; tags?: string[] };
  /** Ids de nodos "save_data" visitados en este turno cuyo diff de exports es inequívoco (exactamente un save_data en el turno). */
  saveDataNodeId?: string;
}

export interface RunSimulationTurnInput {
  flow: FlowDefinition;
  /** null para arrancar una simulación nueva (o para "Reiniciar", ver spec §24). */
  engineState: FlowEngineState | null;
  event: SimulationInputEvent;
  registry: ExecutorRegistry;
  tenantId: string;
  /** Variables de prueba iniciales (spec §13) -- solo se aplican cuando engineState es null. */
  initialVariables?: Record<string, unknown>;
  flowId?: string;
  flowVersionId?: string;
  maxAutoSteps?: number;
}

// ---------------------------------------------------------------------------
// Límite del driver -- independiente del límite interno del Engine puro
// (DEFAULT_MAX_AUTO_STEPS ya protege runAutoLoop). Este protege el LOOP del
// simulador (dispatch de efecto -> effect_result -> nueva llamada al motor),
// que es un bucle nuevo que no existía antes de este módulo -- spec §27.
// ---------------------------------------------------------------------------
export const MAX_SIMULATION_EFFECT_LOOPS = 32;

function nowIso(): string {
  return new Date().toISOString();
}

function isConditionNode(node: FlowNode | undefined): node is Extract<FlowNode, { type: "condition" }> {
  return node?.type === "condition";
}

/**
 * Adapta `reconstructNodePath` (lib/flow/reconstruct-node-path.ts, módulo
 * puro compartido con el Execution Inspector de Fase 2) a la forma
 * `SimulationTransition`/`ConditionEvaluationTrace` de este archivo. El
 * algoritmo de búsqueda del camino vive en un solo lugar -- acá solo se
 * traduce `PathHop.sourceHandle` a un `SimulationTransitionReason` legible y
 * se deduce la evaluación de cada `condition` intermedio del camino
 * encontrado (nunca reevaluando la regla).
 */
function reconstructPath(
  flow: FlowDefinition,
  nodeById: Map<string, FlowNode>,
  fromNodeId: string,
  toNodeId: string,
): { transitions: SimulationTransition[]; conditions: ConditionEvaluationTrace[] } {
  const { hops, ambiguous } = reconstructNodePath(flow, nodeById, fromNodeId, toNodeId);
  if (hops.length === 0) return { transitions: [], conditions: [] };

  if (ambiguous) {
    const only = hops[0]!;
    return {
      transitions: [{ ...only, reason: "auto", ambiguous: true, timestamp: nowIso() }],
      conditions: [],
    };
  }

  const transitions: SimulationTransition[] = [];
  const conditions: ConditionEvaluationTrace[] = [];
  for (const hop of hops) {
    const reason: SimulationTransitionReason =
      hop.sourceHandle === FLOW_EDGE_HANDLE.conditionTrue
        ? "condition_true"
        : hop.sourceHandle === FLOW_EDGE_HANDLE.conditionFalse
          ? "condition_false"
          : "auto";
    transitions.push({ fromNodeId: hop.fromNodeId, toNodeId: hop.toNodeId, nodeType: hop.nodeType, reason, timestamp: nowIso() });
    if (reason === "condition_true" || reason === "condition_false") {
      const conditionNode = nodeById.get(hop.fromNodeId);
      if (isConditionNode(conditionNode)) {
        conditions.push({
          nodeId: conditionNode.id,
          result: reason === "condition_true",
          rules: conditionNode.config.rules,
          match: conditionNode.config.match,
        });
      }
    }
  }
  return { transitions, conditions };
}

/** Pin determinístico del PRIMER salto cuando el driver ya sabe qué edge se tomó (botón elegido, o resultado de efecto que el propio simulador generó) -- nunca reevalúa nada de negocio, solo usa resolveNextNodeId (exportado). */
function pinnedFirstHop(
  flow: FlowDefinition,
  nodeById: Map<string, FlowNode>,
  fromNodeId: string,
  handle: string,
  reason: SimulationTransitionReason,
): SimulationTransition | null {
  const next = resolveNextNodeId(flow, fromNodeId, handle);
  if (!next) return null;
  const targetNode = nodeById.get(next);
  if (!targetNode) return null;
  return { fromNodeId, toNodeId: next, nodeType: targetNode.type, reason, timestamp: nowIso() };
}

function effectSummary(kind: SimulatedEffectLogEntry["kind"], nodeId: string, data: Record<string, unknown> | undefined): string {
  if (kind === "send_message") return `Mensaje simulado enviado (nodo ${nodeId})`;
  if (typeof data?.summary === "string") return data.summary;
  if (typeof data?.response === "string") return `Respuesta simulada de IA — "${data.response}"`;
  return `Efecto ${kind} simulado (nodo ${nodeId})`;
}

async function dispatchEffect(
  registry: ExecutorRegistry,
  effect: DispatchableEngineEffect,
  input: { tenantId: string; executionRowId: string; flowId?: string; flowVersionId?: string },
): Promise<EffectDispatchResult> {
  const request = buildEffectDispatchRequest({
    effect,
    tenantId: input.tenantId,
    executionRowId: input.executionRowId,
    flowId: input.flowId,
    flowVersionId: input.flowVersionId,
  });
  const kind = effect.type === "send_message" ? "send_message" : effect.kind;
  const executor = registry.resolve(kind);
  return executor.dispatch(request, { tenantId: input.tenantId, internal: true });
}

function toEngineEvent(event: SimulationInputEvent): FlowEngineEvent {
  if (event.type === "start") return { type: "start" };
  if (event.type === "text") return { type: "text", text: event.text };
  return { type: "button", id: event.id };
}

/**
 * Corre UN turno de simulación: procesa el evento del usuario (o "start"
 * para arrancar/reiniciar), avanza el motor puro las veces que haga falta
 * (una llamada por cada efecto `action`/`ai` que el Engine pida, despachado
 * contra executors SIMULADOS), y devuelve todo lo que el inspector necesita
 * mostrar. Nunca escribe en ninguna tabla real.
 */
export async function runSimulationTurn(input: RunSimulationTurnInput): Promise<SimulationTurnResult> {
  const nodeById = new Map(input.flow.nodes.map((n) => [n.id, n]));
  const maxAutoSteps = input.maxAutoSteps ?? DEFAULT_MAX_AUTO_STEPS;

  let workingState: FlowEngineState;
  if (input.engineState) {
    workingState = input.engineState;
  } else {
    workingState = createFlowEngineState(input.flow, { flowId: input.flowId, flowVersionId: input.flowVersionId });
    if (input.initialVariables) {
      workingState = { ...workingState, variables: { ...workingState.variables, ...input.initialVariables } };
    }
  }

  const exportsBefore = workingState.exports;
  const previousNodeId = workingState.currentNodeId;
  const previousNode = previousNodeId ? nodeById.get(previousNodeId) : undefined;

  const messages: SimulatedMessage[] = [];
  const effectsLog: SimulatedEffectLogEntry[] = [];
  const transitions: SimulationTransition[] = [];
  const conditionEvaluations: ConditionEvaluationTrace[] = [];
  let humanHandoff: SimulationTurnResult["humanHandoff"];
  let completed: SimulationTurnResult["completed"];
  let saveDataNodeId: string | undefined;
  let saveDataHits = 0;

  // save_data nunca produce su propio EngineEffect (ver flow-engine.ts,
  // processAutomaticNode caso "save_data": solo actualiza exports y
  // continúa) -- la ÚNICA forma de saber que se visitó un nodo save_data es
  // a través de las transiciones reconstruidas (pinnedFirstHop/reconstructPath),
  // nunca de `result.effects`. Si hay más de uno en el mismo turno, no se le
  // atribuye el diff de exports a ninguno en particular (spec §13: antes/
  // después general del turno igual queda disponible en exportsBefore/exports).
  function trackSaveData(hops: readonly SimulationTransition[]): void {
    for (const hop of hops) {
      if (hop.nodeType === "save_data" && !hop.ambiguous) {
        saveDataHits += 1;
        saveDataNodeId = saveDataHits === 1 ? hop.toNodeId : undefined;
      }
    }
  }

  // "Cursor" de reconstrucción de camino: el último nodo OBSERVADO (con
  // certeza) hasta ahora en este turno.
  let observedNodeId = previousNodeId;
  let pinnedHop: SimulationTransition | null = null;

  // Para el primer runFlowEngine() de este turno, si sabemos EXACTAMENTE qué
  // edge se tomó (start fresco, o clic de botón válido), lo fijamos.
  if (!input.engineState) {
    // Simulación nueva: el primer nodo observado es el propio start.
    const startNode = input.flow.nodes.find((n) => n.type === "start");
    if (startNode) {
      transitions.push({ fromNodeId: null, toNodeId: startNode.id, nodeType: "start", reason: "start", timestamp: nowIso() });
      observedNodeId = startNode.id;
    }
  } else if (input.event.type === "button" && previousNode?.type === "buttons" && previousNodeId) {
    pinnedHop = pinnedFirstHop(input.flow, nodeById, previousNodeId, FLOW_EDGE_HANDLE.button(input.event.id), "button");
  }

  if (pinnedHop) {
    transitions.push(pinnedHop);
    trackSaveData([pinnedHop]);
    observedNodeId = pinnedHop.toNodeId;
  }

  let engineEvent: FlowEngineEvent = toEngineEvent(input.event);
  let loops = 0;
  let terminalError: SimulationTurnResult["error"];

  for (;;) {
    loops += 1;
    if (loops > MAX_SIMULATION_EFFECT_LOOPS) {
      terminalError = {
        code: "SIMULATION_EFFECT_LOOP_LIMIT",
        message: `Se alcanzó el límite de ${MAX_SIMULATION_EFFECT_LOOPS} efectos encadenados en un solo turno -- posible ciclo no controlado en el flow.`,
        nodeId: workingState.currentNodeId,
      };
      // El Engine real nunca vio esto como un fallo (cada runFlowEngine
      // individual fue exitoso) -- es el DRIVER el que decide cortar acá
      // (spec §27), así que es el driver el que debe reflejar "failed" en el
      // estado devuelto -- nunca dejarlo colgado en "waiting_effect" como si
      // fuera una pausa normal.
      workingState = { ...workingState, status: "failed" };
      break;
    }

    const result = runFlowEngine(input.flow, workingState, engineEvent, { maxAutoSteps });
    workingState = result.state;

    for (const effect of result.effects) {
      const nodeIdOfEffect = "nodeId" in effect ? effect.nodeId : null;
      if (nodeIdOfEffect && observedNodeId !== nodeIdOfEffect) {
        const { transitions: hops, conditions } = reconstructPath(input.flow, nodeById, observedNodeId ?? nodeIdOfEffect, nodeIdOfEffect);
        transitions.push(...hops);
        trackSaveData(hops);
        conditionEvaluations.push(...conditions);
        observedNodeId = nodeIdOfEffect;
      }

      if (effect.type === "send_message") {
        const dispatchResult = await dispatchEffect(input.registry, effect, {
          tenantId: input.tenantId,
          executionRowId: workingState.executionId,
          flowId: input.flowId,
          flowVersionId: input.flowVersionId,
        });
        messages.push({
          nodeId: effect.nodeId,
          content: effect.content,
          buttons: effect.buttons,
          origin: effect.origin,
          simulated: true,
        });
        effectsLog.push({
          effectId: effect.effectId,
          nodeId: effect.nodeId,
          kind: "send_message",
          summary: effectSummary("send_message", effect.nodeId, dispatchResult.data),
          simulated: true,
          data: dispatchResult.data,
          success: dispatchResult.success,
        });
      } else if (effect.type === "completed") {
        completed = { nodeId: effect.nodeId, tags: effect.tags };
        effectsLog.push({
          effectId: effect.effectId,
          nodeId: effect.nodeId,
          kind: "end",
          summary: "✓ Flow finalizado",
          simulated: true,
          success: true,
        });
      } else if (effect.type === "transferred") {
        humanHandoff = { nodeId: effect.nodeId, pauseDurationHours: effect.pauseDurationHours, assignTo: effect.assignTo };
        effectsLog.push({
          effectId: effect.effectId,
          nodeId: effect.nodeId,
          kind: "human",
          summary: "Simulación transferida a un asesor. La automatización se pausa aquí.",
          simulated: true,
          success: true,
        });
      } else if (effect.type === "failed") {
        terminalError = { code: effect.code, message: effect.message, nodeId: effect.nodeId };
      }
      // "wait_input" e "invalid_input" no generan entradas propias de
      // effectsLog -- ya quedan representados por el send_message que los
      // acompaña (mensaje de la pregunta/botones, o el mensaje de error de
      // validación con origin "system").
    }

    if (result.error) {
      terminalError = terminalError ?? { code: result.error.code, message: result.error.message, nodeId: result.error.nodeId ?? null };
      break;
    }

    const pendingEffectRequired = result.effects.find((e): e is Extract<EngineEffect, { type: "effect_required" }> => e.type === "effect_required");
    if (!pendingEffectRequired) break;

    const dispatchResult = await dispatchEffect(input.registry, pendingEffectRequired, {
      tenantId: input.tenantId,
      executionRowId: workingState.executionId,
      flowId: input.flowId,
      flowVersionId: input.flowVersionId,
    });

    const node = nodeById.get(pendingEffectRequired.nodeId);
    let classification: string | undefined;
    if (dispatchResult.success && node?.type === "ai" && node.config.mode === "classify") {
      classification = typeof dispatchResult.data?.classification === "string" ? dispatchResult.data.classification : undefined;
    }

    effectsLog.push({
      effectId: pendingEffectRequired.effectId,
      nodeId: pendingEffectRequired.nodeId,
      kind: pendingEffectRequired.kind,
      actionType: pendingEffectRequired.kind === "action" ? pendingEffectRequired.action?.actionType : undefined,
      summary: effectSummary(pendingEffectRequired.kind, pendingEffectRequired.nodeId, dispatchResult.data),
      simulated: true,
      data: dispatchResult.data,
      success: dispatchResult.success,
    });

    // Pin del siguiente salto: se conoce EXACTAMENTE qué handle usará el
    // Engine (mismo criterio que handleEffectResult en flow-engine.ts:
    // "failure" si falló, "class:{x}"/"default" para classify, "success" en
    // cualquier otro caso) -- se usa para reconstrucción de camino, nunca
    // para decidir la transición real (eso lo sigue haciendo runFlowEngine).
    const handle = !dispatchResult.success
      ? FLOW_EDGE_HANDLE.aiFailure
      : classification
        ? FLOW_EDGE_HANDLE.aiClass(classification)
        : node?.type === "ai" && node.config.mode === "classify"
          ? FLOW_EDGE_HANDLE.aiDefault
          : FLOW_EDGE_HANDLE.aiSuccess;
    const reason: SimulationTransitionReason = !dispatchResult.success
      ? "effect_failure"
      : classification
        ? "ai_classification"
        : "effect_success";
    const hop = pinnedFirstHop(input.flow, nodeById, pendingEffectRequired.nodeId, handle, reason);
    if (hop) {
      transitions.push(hop);
      trackSaveData([hop]);
      observedNodeId = hop.toNodeId;
    }

    engineEvent = {
      type: "effect_result",
      effectId: pendingEffectRequired.effectId,
      success: dispatchResult.success,
      data: dispatchResult.data,
      error: dispatchResult.error,
    };
  }

  // Si el turno terminó en un nodo distinto del último observado (ej. cadena
  // silenciosa final sin más efectos), se completa la reconstrucción.
  if (workingState.currentNodeId && observedNodeId !== workingState.currentNodeId) {
    const { transitions: hops, conditions } = reconstructPath(input.flow, nodeById, observedNodeId ?? workingState.currentNodeId, workingState.currentNodeId);
    transitions.push(...hops);
    trackSaveData(hops);
    conditionEvaluations.push(...conditions);
  }

  const currentNode = workingState.currentNodeId ? nodeById.get(workingState.currentNodeId) : undefined;
  const currentButtons =
    workingState.status === "waiting_input" && workingState.expectedInput === "button" && currentNode?.type === "buttons"
      ? currentNode.config.buttons
      : undefined;

  return {
    engineState: workingState,
    status: workingState.status,
    currentNodeId: workingState.currentNodeId,
    expectedInput: workingState.expectedInput,
    currentButtons,
    messages,
    effectsLog,
    transitions,
    conditionEvaluations,
    variables: workingState.variables,
    exports: workingState.exports,
    exportsBefore,
    error: terminalError,
    humanHandoff,
    completed,
    saveDataNodeId,
  };
}

