// DuLabs Business — Agent Compiler, Bloque 11 — resolución de commercialState.
//
// `current_node_id` (dulabs_flow_executions, motor genérico) y `commercialState`
// (WELCOME/IDENTIFICATION/.../COMPLETED, semántica de la IR) son conceptos
// DISTINTOS a propósito: el primero es un id de nodo del FlowDefinition
// compilado (flow-compiler.ts); el segundo es la fase comercial que ese nodo
// representa. Este módulo traduce el primero al segundo con una tabla
// DETERMINISTA derivada exactamente de los ids que construirMaquina() emite
// (flow-compiler.ts) -- nunca el LLM decide el estado, nunca se infiere del
// texto del mensaje.
//
// Fuente de la ejecución activa: el MISMO puerto que ya usa runAgentTurn
// (FlowOrchestratorStore.getActiveExecution) -- no se agrega ninguna query
// nueva a lib/flow, se reutiliza la que el Runtime ya necesita para decidir
// start vs. continuación.
//
// Fail-closed por diseño: un node_id no reconocido (ej. un id de un flow
// hand-built, o un `msg-fail:N` transitorio que nunca debería persistirse
// entre turnos porque el engine lo atraviesa automáticamente en el mismo
// turno) NUNCA se "adivina" -- se devuelve `undefined` explícitamente.

import type { ConversationKey, FlowOrchestratorStore } from "@/lib/flow/flow-orchestrator";
import type { CommercialState } from "@/lib/agent-compiler/ir";

/**
 * Tabla determinista node_id -> CommercialState, derivada EXACTAMENTE de los
 * ids que emite construirMaquina() en flow-compiler.ts. Si ese archivo cambia
 * los ids, esta tabla debe actualizarse junto (cubierto por
 * flow-compiler-alignment.test.ts + los tests de este módulo).
 */
const NODE_ID_TO_COMMERCIAL_STATE: Readonly<Record<string, CommercialState>> = {
  start: "WELCOME",
  welcome: "WELCOME",
  "q-need": "WELCOME",
  "q-identify": "IDENTIFICATION",
  "q-qualify": "QUALIFICATION",
  "ai-info": "INFORMATION",
  // R4 -- recuperación de conocimiento (ids de flow-compiler.ts::construirMaquina).
  "cond-first-question": "WELCOME",
  "act-faq": "INFORMATION",
  "cond-faq-found": "INFORMATION",
  "cond-faq-question": "INFORMATION",
  "ai-faq-present": "INFORMATION",
  "msg-faq-nofound": "INFORMATION",
  "msg-faq-fail": "INFORMATION",
  "q-faq-more": "INFORMATION",
  "human-faq-nofound": "HUMAN_TRANSFER",
  "ai-catalog-propose": "CATALOG",
  "act-catalog": "CATALOG",
  "ai-catalog-present": "CATALOG",
  "q-catalog-choose": "CATALOG",
  "ai-quote-propose": "QUOTING",
  "act-quote": "QUOTING",
  "ai-quote-present": "QUOTING",
  "q-booking-when": "BOOKING",
  // R7 -- consulta de disponibilidad real antes de reservar (nylas).
  "ai-avail-propose": "BOOKING",
  "act-avail": "BOOKING",
  "ai-avail-present": "BOOKING",
  "msg-avail-fail": "BOOKING",
  "q-booking-pick": "BOOKING",
  "ai-book-propose": "BOOKING",
  "act-book": "BOOKING",
  "ai-book-present": "BOOKING",
  "human-book-fail": "HUMAN_TRANSFER",
  // R5 -- transferencia REAL iniciada por el flow (msg + acción transferir_soporte).
  "cond-quote-lines": "QUOTING",
  "btn-quote-buy": "QUOTING",
  "msg-handoff-sale": "HUMAN_TRANSFER",
  "act-handoff-sale": "HUMAN_TRANSFER",
  "ap-fail-handoff": "HUMAN_TRANSFER",
  "act-handoff-cita": "HUMAN_TRANSFER",
  // R7 -- cancelar / reprogramar las citas del cliente (subgrafos deterministas de flow-compiler.ts::emitirGestionCitas).
  "ap-c-list": "BOOKING",
  "ap-c-present": "BOOKING",
  "ap-c-q-pick": "BOOKING",
  "ap-c-btn": "BOOKING",
  "ap-c-act": "BOOKING",
  "ap-c-done": "BOOKING",
  "ap-c-kept": "BOOKING",
  "ap-r-list": "BOOKING",
  "ap-r-present": "BOOKING",
  "ap-r-q-pick": "BOOKING",
  "ap-r-q-when": "BOOKING",
  "ap-r-ai-avail": "BOOKING",
  "ap-r-act-avail": "BOOKING",
  "ap-r-ai-avail-present": "BOOKING",
  "ap-r-q-hour": "BOOKING",
  "ap-r-act": "BOOKING",
  "ap-r-done": "BOOKING",
  "msg-ap-none": "BOOKING",
  "msg-ap-fail": "BOOKING",
  "msg-ap-avail-fail": "BOOKING",
  "msg-ap-move-fail": "BOOKING",
  "act-handoff-book": "HUMAN_TRANSFER",
  "act-handoff-faq": "HUMAN_TRANSFER",
  "msg-handoff-fail": "HUMAN_TRANSFER",
  "st-confirmation": "CONFIRMATION",
  end: "COMPLETED",
};

/**
 * Traduce un current_node_id a CommercialState. `undefined` explícito (nunca
 * un valor adivinado) para ids no reconocidos: nodos dinámicos (`msg-fail:0`,
 * `msg-fail:1`...) o de un flow que no sigue esta convención (hand-built).
 */
export function commercialStateFromNodeId(nodeId: string | null | undefined): CommercialState | undefined {
  if (!nodeId) return undefined;
  const exacto = NODE_ID_TO_COMMERCIAL_STATE[nodeId];
  if (exacto) return exacto;
  // R3 -- nodos de captura de datos del cliente (uno por campo configurado;
  // el sufijo es la clave del campo, así que no caben en la tabla exacta).
  // Prefijos emitidos por emitirCapturaDatos() en flow-compiler.ts; cubiertos
  // por flow-compiler-alignment/customer-data tests.
  if (DATA_CAPTURE_NODE_PREFIXES.some((p) => nodeId.startsWith(p))) return "IDENTIFICATION";
  return undefined;
}

const DATA_CAPTURE_NODE_PREFIXES: readonly string[] = ["cond-data:", "q-data:", "btn-data:", "sd-data"];

export interface ResolveCommercialStateResult {
  commercialState: CommercialState | undefined;
  /** Diagnóstico de por qué no se pudo resolver (auditoría/debug; nunca bloquea el turno). */
  reason?: "no_active_execution" | "tenant_mismatch" | "unrecognized_node_id";
}

/**
 * Resuelve el commercialState REAL de la conversación activa, tenant-scoped.
 * Defensa en profundidad: si la ejecución activa devuelta por el store no es
 * del tenant esperado (nunca debería pasar -- el store ya es tenant-scoped --
 * pero nunca se confía ciegamente), se trata como "sin estado" en vez de
 * exponer el estado de otro tenant.
 */
export async function resolveCommercialState(
  store: Pick<FlowOrchestratorStore, "getActiveExecution">,
  tenantId: string,
  conversation: ConversationKey,
): Promise<ResolveCommercialStateResult> {
  const active = await store.getActiveExecution(tenantId, conversation);
  if (!active) return { commercialState: undefined, reason: "no_active_execution" };
  if (active.tenant_id !== tenantId) return { commercialState: undefined, reason: "tenant_mismatch" };

  const commercialState = commercialStateFromNodeId(active.current_node_id);
  if (!commercialState) return { commercialState: undefined, reason: "unrecognized_node_id" };
  return { commercialState };
}
