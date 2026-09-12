/**
 * Execution Inspector — construcción de la vista de detalle (Fase 2, autorizado).
 *
 * Módulo PURO (sin Supabase, sin I/O): toma lo que ya trajo
 * `getExecutionDetailBundle` (lib/flow/execution-inspector-store.ts) más,
 * opcionalmente, la `FlowDefinition` de la versión ejecutada, y arma una
 * vista de solo lectura lista para responder por la API. Nunca escribe
 * nada, nunca decide una transición -- solo describe lo que YA ocurrió,
 * leído de las tablas de auditoría reales.
 *
 * Seguridad: TODO payload que pudiera contener texto libre de un proveedor
 * externo (eventos entrantes, resultados de efectos) pasa por
 * `sanitizePayloadForObservability` (lib/flow/sanitize-observability-payload.ts,
 * la MISMA función que ya usa el Orchestrator antes de persistir) como
 * defensa en profundidad adicional en el momento de LEER, redactando
 * cualquier valor con forma de secreto sin importar la clave. Nunca se leen
 * ni exponen `dulabs_flow_credentials`/`dulabs_flow_integrations`.
 *
 * Reconstrucción de camino: usa `reconstructNodePath` (módulo puro
 * compartido con el Simulador de Fase 1) para rellenar, SOLO quando el
 * camino es inequívoco, los nodos silenciosos entre dos transiciones reales
 * consecutivas -- ver la nota de arquitectura en ese archivo sobre por qué
 * `dulabs_flow_node_transitions` no registra esos nodos intermedios hoy.
 */

import { sanitizePayloadForObservability } from "@/lib/flow/sanitize-observability-payload";
import { reconstructNodePath } from "@/lib/flow/reconstruct-node-path";
import type { FlowDefinition, FlowNode, FlowNodeType } from "@/lib/flow/types";
import type {
  FlowEffectRow,
  FlowEffectStatus,
  FlowEventRow,
  FlowExecutionRow,
  FlowNodeTransitionRow,
} from "@/lib/flow/flow-store-types";
import type { ExecutionDetailBundle } from "@/lib/flow/execution-inspector-store";

function sanitizeRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  const sanitized = sanitizePayloadForObservability(value);
  return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : { value: sanitized };
}

const NODE_TYPE_LABEL: Record<FlowNodeType, string> = {
  start: "Inicio",
  message: "Mensaje",
  question: "Pregunta",
  buttons: "Botones",
  condition: "Condición",
  ai: "IA",
  save_data: "Guardar dato",
  action: "Acción",
  human: "Transferencia a humano",
  end: "Fin",
};

function nodeLabel(nodeById: Map<string, FlowNode> | null, nodeId: string | null): string {
  if (!nodeId) return "—";
  const node = nodeById?.get(nodeId);
  if (!node) return nodeId;
  return node.label?.trim() ? node.label : `${NODE_TYPE_LABEL[node.type]} (${nodeId})`;
}

export interface ExecutionSummaryView {
  id: string;
  executionId: string;
  flowId: string;
  flowVersionId: string;
  flowVersionNumber: number | null;
  telefonoCliente: string;
  phoneNumberId: string;
  status: FlowExecutionRow["status"];
  currentNodeId: string | null;
  currentNodeLabel: string;
  createdAt: string;
  lastActivityAt: string;
  durationMs: number;
  eventsCount: number;
  effectsCount: number;
  transitionsCount: number;
}

export interface ExecutionEventView {
  id: number;
  timestamp: string;
  eventType: string;
  payload: Record<string, unknown> | null;
}

export interface ExecutionEffectView {
  id: number;
  effectId: string;
  nodeId: string;
  nodeLabel: string;
  kind: string;
  status: FlowEffectStatus;
  requestedAt: string;
  resolvedAt: string | null;
  durationMs: number | null;
  provider: string | null;
  providerModel: string | null;
  result: Record<string, unknown> | null;
}

export interface ExecutionTransitionView {
  id: number;
  occurredAt: string;
  fromNodeId: string | null;
  fromNodeLabel: string;
  toNodeId: string;
  toNodeLabel: string;
  sourceHandle: string | null;
}

export interface ExecutionTimelineEntry {
  timestamp: string;
  kind: "event" | "transition" | "effect";
  title: string;
  detail: Record<string, unknown> | null;
}

export interface ExecutionNodeStep {
  nodeId: string;
  nodeType: FlowNodeType | null;
  nodeLabel: string;
  enteredAt: string | null;
  exitedAt: string | null;
  durationMs: number | null;
  effect: ExecutionEffectView | null;
  /** true si este hop se dedujo por topología (nodo silencioso entre dos transiciones reales), no leído directamente de una fila real. */
  inferred: boolean;
}

export interface ExecutionPathView {
  nodeIds: string[];
  edgeIds: string[];
  /** true si algún tramo del camino no pudo determinarse sin ambigüedad (ver reconstructNodePath). */
  hadAmbiguousSegment: boolean;
}

export interface ExecutionErrorView {
  code: string;
  technical: string;
  friendly: string;
  nodeId: string | null;
  nodeLabel: string;
}

export interface ExecutionInspectorDetail {
  execution: ExecutionSummaryView;
  variables: Record<string, unknown>;
  exports: Record<string, unknown>;
  events: ExecutionEventView[];
  effects: ExecutionEffectView[];
  transitions: ExecutionTransitionView[];
  timeline: ExecutionTimelineEntry[];
  nodeSteps: ExecutionNodeStep[];
  path: ExecutionPathView;
  error: ExecutionErrorView | null;
}

function durationMsBetween(start: string, end: string | null): number | null {
  if (!end) return null;
  return new Date(end).getTime() - new Date(start).getTime();
}

function buildEventView(row: FlowEventRow): ExecutionEventView {
  return { id: row.id, timestamp: row.created_at, eventType: row.event_type, payload: sanitizeRecord(row.raw_payload) };
}

function buildEffectView(row: FlowEffectRow, nodeById: Map<string, FlowNode> | null): ExecutionEffectView {
  return {
    id: row.id,
    effectId: row.effect_id,
    nodeId: row.node_id,
    nodeLabel: nodeLabel(nodeById, row.node_id),
    kind: row.kind,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    durationMs: durationMsBetween(row.requested_at, row.resolved_at),
    provider: row.provider,
    providerModel: row.provider_model,
    result: sanitizeRecord(row.result_payload_applied ?? row.result_payload_raw),
  };
}

function buildTransitionView(row: FlowNodeTransitionRow, nodeById: Map<string, FlowNode> | null): ExecutionTransitionView {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    fromNodeId: row.from_node_id,
    fromNodeLabel: nodeLabel(nodeById, row.from_node_id),
    toNodeId: row.to_node_id,
    toNodeLabel: nodeLabel(nodeById, row.to_node_id),
    sourceHandle: row.source_handle,
  };
}

const EVENT_TYPE_TITLE: Record<string, string> = {
  conversation_started: "Conversación iniciada",
  message: "Mensaje entrante del cliente",
};

function eventTitle(eventType: string): string {
  return EVENT_TYPE_TITLE[eventType] ?? `Evento: ${eventType}`;
}

const EFFECT_KIND_TITLE: Record<string, string> = {
  send_message: "Mensaje enviado",
  ai: "Llamada a IA",
  action: "Acción ejecutada",
};

function effectTitle(effect: ExecutionEffectView): string {
  const kindLabel = EFFECT_KIND_TITLE[effect.kind] ?? `Efecto (${effect.kind})`;
  const statusLabel = effect.status === "succeeded" ? "exitoso" : effect.status === "failed" ? "falló" : effect.status;
  return `${kindLabel} — ${statusLabel} (${effect.nodeLabel})`;
}

/** Arma el timeline unificado, ordenado cronológicamente, a partir de eventos + transiciones + efectos reales. */
function buildTimeline(
  events: ExecutionEventView[],
  transitions: ExecutionTransitionView[],
  effects: ExecutionEffectView[],
): ExecutionTimelineEntry[] {
  const entries: ExecutionTimelineEntry[] = [];
  for (const e of events) {
    entries.push({ timestamp: e.timestamp, kind: "event", title: eventTitle(e.eventType), detail: e.payload });
  }
  for (const t of transitions) {
    entries.push({
      timestamp: t.occurredAt,
      kind: "transition",
      title: `${t.fromNodeLabel} → ${t.toNodeLabel}`,
      detail: { sourceHandle: t.sourceHandle },
    });
  }
  for (const eff of effects) {
    entries.push({ timestamp: eff.requestedAt, kind: "effect", title: effectTitle(eff), detail: eff.result });
    if (eff.resolvedAt && eff.resolvedAt !== eff.requestedAt) {
      entries.push({
        timestamp: eff.resolvedAt,
        kind: "effect",
        title: `${EFFECT_KIND_TITLE[eff.kind] ?? eff.kind} resuelto (${eff.status})`,
        detail: eff.result,
      });
    }
  }
  return entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Construye los pasos nodo-por-nodo y el camino para resaltar en el canvas,
 * expandiendo cada transición REGISTRADA (from→to) con los nodos
 * silenciosos intermedios que la topología del grafo permite determinar sin
 * ambigüedad (ver reconstructNodePath). Correlaciona cada nodo con su
 * efecto real (mismo node_id) para mostrar duración/resultado/error.
 */
function buildNodeStepsAndPath(
  transitions: ExecutionTransitionView[],
  effectsByNode: Map<string, ExecutionEffectView[]>,
  flow: FlowDefinition | null,
): { nodeSteps: ExecutionNodeStep[]; path: ExecutionPathView } {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  let hadAmbiguousSegment = false;
  const steps: ExecutionNodeStep[] = [];

  function edgeIdFor(source: string, target: string, sourceHandle: string | undefined): string | undefined {
    if (!flow) return undefined;
    const match = flow.edges.find(
      (e) => e.source === source && e.target === target && (e.sourceHandle ?? undefined) === (sourceHandle ?? undefined),
    );
    return match?.id;
  }

  function pushStep(nodeId: string, timestamp: string | null, inferred: boolean, nodeType: FlowNodeType | null) {
    nodeIds.add(nodeId);
    const effects = effectsByNode.get(nodeId) ?? [];
    const effect = effects.length > 0 ? effects[effects.length - 1]! : null;
    steps.push({
      nodeId,
      nodeType,
      nodeLabel: flow ? nodeLabel(new Map(flow.nodes.map((n) => [n.id, n])), nodeId) : nodeId,
      enteredAt: timestamp,
      exitedAt: effect?.resolvedAt ?? timestamp,
      durationMs: effect?.durationMs ?? null,
      effect,
      inferred,
    });
  }

  const nodeById = flow ? new Map(flow.nodes.map((n) => [n.id, n])) : null;

  for (const t of transitions) {
    if (t.fromNodeId) nodeIds.add(t.fromNodeId);
    nodeIds.add(t.toNodeId);

    if (flow && nodeById && t.fromNodeId) {
      const { hops, ambiguous } = reconstructNodePath(flow, nodeById, t.fromNodeId, t.toNodeId);
      if (ambiguous) hadAmbiguousSegment = true;
      for (const hop of hops) {
        const eid = edgeIdFor(hop.fromNodeId, hop.toNodeId, hop.sourceHandle);
        if (eid) edgeIds.add(eid);
        nodeIds.add(hop.toNodeId);
        pushStep(hop.toNodeId, hop.toNodeId === t.toNodeId ? t.occurredAt : null, hop.toNodeId !== t.toNodeId, nodeById.get(hop.toNodeId)?.type ?? null);
      }
      if (hops.length === 0) {
        const eid = edgeIdFor(t.fromNodeId, t.toNodeId, t.sourceHandle ?? undefined);
        if (eid) edgeIds.add(eid);
        pushStep(t.toNodeId, t.occurredAt, false, nodeById.get(t.toNodeId)?.type ?? null);
      }
    } else {
      pushStep(t.toNodeId, t.occurredAt, false, nodeById?.get(t.toNodeId)?.type ?? null);
    }
  }

  return { nodeSteps: steps, path: { nodeIds: [...nodeIds], edgeIds: [...edgeIds], hadAmbiguousSegment } };
}

export function buildExecutionInspectorDetail(
  bundle: ExecutionDetailBundle,
  options: { flow: FlowDefinition | null; flowVersionNumber: number | null },
): ExecutionInspectorDetail {
  const { execution, events: rawEvents, effects: rawEffects, transitions: rawTransitions } = bundle;
  const nodeById = options.flow ? new Map(options.flow.nodes.map((n) => [n.id, n])) : null;

  const events = rawEvents.map(buildEventView);
  const effects = rawEffects.map((r) => buildEffectView(r, nodeById));
  const transitions = rawTransitions.map((r) => buildTransitionView(r, nodeById));

  const effectsByNode = new Map<string, ExecutionEffectView[]>();
  for (const eff of effects) {
    const list = effectsByNode.get(eff.nodeId) ?? [];
    list.push(eff);
    effectsByNode.set(eff.nodeId, list);
  }

  const timeline = buildTimeline(events, transitions, effects);
  const { nodeSteps, path } = buildNodeStepsAndPath(transitions, effectsByNode, options.flow);

  // LIMITACIÓN REAL DEL RUNTIME (documentada en el reporte de Fase 2, no
  // inventada): cuando `runFlowEngine` devuelve un error, el orchestrator
  // NUNCA persiste ese `FlowEngineError` (código/mensaje/nodeId exacto) en
  // ninguna columna de `dulabs_flow_executions` -- ver el comentario
  // explícito en lib/flow-runtime-bridge.ts::marcarEjecucionRotaComoFallida
  // ("el orchestrator NUNCA persiste estado cuando runFlowEngine devuelve
  // error, a propósito, para permitir reintentos limpios"). Esa función solo
  // marca `status:'failed'` sobre el estado que la fila YA tenía ANTES del
  // intento roto -- `current_node_id` es entonces el ÚLTIMO NODO CONOCIDO
  // antes de la falla, no necesariamente el nodo exacto donde el motor
  // falló. Por eso acá NUNCA se inventa un código/mensaje técnico: se
  // muestra la pista más concreta que SÍ existe (el último efecto con
  // status:"failed" de esta ejecución, si lo hay, que sí persiste su
  // resultado real vía resolveEffectResult) y se es explícito sobre el
  // límite del dato disponible.
  const lastFailedEffect = [...effects].reverse().find((e) => e.status === "failed") ?? null;
  const error: ExecutionErrorView | null =
    execution.status === "failed"
      ? {
          code: lastFailedEffect ? `EFFECT_FAILED:${lastFailedEffect.kind}` : "NOT_PERSISTED",
          technical: lastFailedEffect
            ? `El efecto "${lastFailedEffect.kind}" en el nodo "${lastFailedEffect.nodeLabel}" terminó en estado failed. Resultado: ${JSON.stringify(lastFailedEffect.result)}`
            : "El runtime actual no persiste el código/mensaje técnico exacto del error del motor (ver limitación documentada de esta fase) -- solo queda registrado que la ejecución terminó en estado 'failed' y cuál fue el último nodo conocido antes de la falla.",
          friendly: "Hubo un problema técnico continuando esta conversación.",
          nodeId: execution.current_node_id,
          nodeLabel: nodeLabel(nodeById, execution.current_node_id),
        }
      : null;

  const summary: ExecutionSummaryView = {
    id: execution.id,
    executionId: execution.execution_id,
    flowId: execution.flow_id,
    flowVersionId: execution.flow_version_id,
    flowVersionNumber: options.flowVersionNumber,
    telefonoCliente: execution.telefono_cliente,
    phoneNumberId: execution.phone_number_id,
    status: execution.status,
    currentNodeId: execution.current_node_id,
    currentNodeLabel: nodeLabel(nodeById, execution.current_node_id),
    createdAt: execution.created_at,
    lastActivityAt: execution.last_activity_at,
    durationMs: durationMsBetween(execution.created_at, execution.last_activity_at) ?? 0,
    eventsCount: events.length,
    effectsCount: effects.length,
    transitionsCount: transitions.length,
  };

  return {
    execution: summary,
    variables: (sanitizeRecord(execution.variables) ?? {}) as Record<string, unknown>,
    exports: (sanitizeRecord(execution.exports) ?? {}) as Record<string, unknown>,
    events,
    effects,
    transitions,
    timeline,
    nodeSteps,
    path,
    error,
  };
}
