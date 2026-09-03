/**
 * Etapa 1 (Flow Builder, autorizado) — traduce las respuestas de
 * GET /api/flows/[id] y GET /api/flows/[id]/versions en el estado de carga
 * del Builder de solo lectura. Función pura: no hace fetch, no toca el DOM
 * -- separada así para poder probarla sin red ni React.
 */

import type { FlowRow, FlowVersionRow } from "@/lib/flow/flow-store-types";
import type { FlowDefinition, FlowNode } from "@/lib/flow/types";
import { selectVersionToDisplay } from "@/lib/flow-builder/select-version";

export type FlowLoadResult =
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "no_versions"; flow: FlowRow }
  | { kind: "loaded"; flow: FlowRow; version: FlowVersionRow };

interface JsonResponseLike<T> {
  ok: boolean;
  status: number;
  json: T & { error?: string };
}

export function buildFlowLoadResult(
  flowResponse: JsonResponseLike<{ flow?: FlowRow }>,
  versionsResponse: JsonResponseLike<{ versions?: FlowVersionRow[] }>,
): FlowLoadResult {
  if (flowResponse.status === 404) return { kind: "not_found" };
  if (!flowResponse.ok || !flowResponse.json.flow) {
    return { kind: "error", message: flowResponse.json.error ?? "Error cargando el Flow" };
  }
  const flow = flowResponse.json.flow;

  if (!versionsResponse.ok || !versionsResponse.json.versions) {
    return { kind: "error", message: versionsResponse.json.error ?? "Error cargando versiones" };
  }

  const version = selectVersionToDisplay(flow, versionsResponse.json.versions);
  if (!version) return { kind: "no_versions", flow };
  return { kind: "loaded", flow, version };
}

/** Nodo seleccionado en el canvas -- null si no hay selección o no existe. */
export function findNodeById(flow: FlowDefinition, nodeId: string | null): FlowNode | null {
  if (!nodeId) return null;
  return flow.nodes.find((n) => n.id === nodeId) ?? null;
}
