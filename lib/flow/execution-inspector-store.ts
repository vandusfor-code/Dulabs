/**
 * Execution Inspector — capa de lectura aislada (Fase 2, autorizado).
 *
 * Consultas 100% de solo lectura sobre las tablas de observabilidad YA
 * EXISTENTES (`dulabs_flow_executions`, `dulabs_flow_events`,
 * `dulabs_flow_effects`, `dulabs_flow_node_transitions`) -- ninguna
 * modifica una fila, ninguna toca `dulabs_flow_credentials` ni
 * `dulabs_flow_integrations`. Archivo NUEVO y separado de `flow-store.ts`
 * a propósito (prioridad AISLAMIENTO, ver reporte de Fase 2): así ninguna
 * función que SÍ escribe estado real de ejecución (`saveExecutionState`,
 * `insertEventIdempotent`, `resolveEffectResult`, `recordNodeTransition`,
 * todas en flow-store.ts) queda cerca ni se ve tentada a mezclarse con este
 * código, que solo lo consume el Execution Inspector.
 *
 * Cada consulta filtra SIEMPRE por `tenant_id` explícito (nunca confía
 * solo en que el `flow_execution_id` ya sea del tenant correcto) -- mismo
 * criterio "defensa en profundidad" que el resto de `lib/flow/*`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FlowEffectRow,
  FlowEventRow,
  FlowExecutionRow,
  FlowNodeTransitionRow,
} from "@/lib/flow/flow-store-types";

export type ExecutionStatusFilter = FlowExecutionRow["status"];

export interface ListExecutionsFilters {
  tenantId: string;
  flowId: string;
  status?: ExecutionStatusFilter;
  /** Coincidencia parcial sobre telefono_cliente (contacto). */
  telefono?: string;
  /** 1-indexado. */
  page?: number;
  pageSize?: number;
}

export interface ListExecutionsResult {
  executions: FlowExecutionRow[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Listado paginado + filtrado -- NO reemplaza `listExecutionsForFlow`
 * (flow-store.ts, usada hoy por `GET /api/flows/[id]/executions` sin
 * filtros/paginación); esta es la versión ampliada que consume la Fase 2 de
 * ese mismo endpoint una vez extendido, dejando la función original intacta
 * para no arriesgar a quien ya la llame.
 */
export async function listExecutionsFiltered(
  supabase: SupabaseClient,
  input: ListExecutionsFilters,
): Promise<ListExecutionsResult> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("dulabs_flow_executions")
    .select("*", { count: "exact" })
    .eq("tenant_id", input.tenantId)
    .eq("flow_id", input.flowId)
    .order("last_activity_at", { ascending: false })
    .range(from, to);

  if (input.status) query = query.eq("status", input.status);
  if (input.telefono) query = query.ilike("telefono_cliente", `%${input.telefono}%`);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    executions: (data ?? []) as FlowExecutionRow[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

export interface ExecutionDetailBundle {
  execution: FlowExecutionRow;
  events: FlowEventRow[];
  effects: FlowEffectRow[];
  transitions: FlowNodeTransitionRow[];
}

/**
 * Trae la ejecución + TODO lo relacionado en un número FIJO de queries (4,
 * sin importar cuántos eventos/efectos/transiciones tenga) -- nunca N+1.
 * Devuelve null si la ejecución no existe, no es de este tenant, o no
 * pertenece al `flowId` pedido (defensa en profundidad extra: no basta con
 * que sea del tenant correcto, debe ser del Flow de la URL).
 */
export async function getExecutionDetailBundle(
  supabase: SupabaseClient,
  input: { tenantId: string; flowId: string; executionRowId: string },
): Promise<ExecutionDetailBundle | null> {
  const { data: executionData, error: executionError } = await supabase
    .from("dulabs_flow_executions")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.executionRowId)
    .maybeSingle();
  if (executionError) throw executionError;
  const execution = executionData as FlowExecutionRow | null;
  if (!execution || execution.flow_id !== input.flowId) return null;

  const [eventsRes, effectsRes, transitionsRes] = await Promise.all([
    supabase
      .from("dulabs_flow_events")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("flow_execution_id", execution.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("dulabs_flow_effects")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("flow_execution_id", execution.id)
      .order("requested_at", { ascending: true }),
    supabase
      .from("dulabs_flow_node_transitions")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("flow_execution_id", execution.id)
      .order("occurred_at", { ascending: true }),
  ]);
  if (eventsRes.error) throw eventsRes.error;
  if (effectsRes.error) throw effectsRes.error;
  if (transitionsRes.error) throw transitionsRes.error;

  return {
    execution,
    events: (eventsRes.data ?? []) as FlowEventRow[],
    effects: (effectsRes.data ?? []) as FlowEffectRow[],
    transitions: (transitionsRes.data ?? []) as FlowNodeTransitionRow[],
  };
}
