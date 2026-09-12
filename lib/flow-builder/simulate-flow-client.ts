/**
 * Fase 1 (Flow Simulator, autorizado) — wrapper I/O delgado sobre la API YA
 * EXISTENTE (POST /api/flows/[id]/simulate). Mismo patrón exacto que
 * save-flow.ts/publish-flow.ts: ninguna regla de negocio acá, `fetchImpl`
 * inyectable para testear sin red real, consume la respuesta tal cual llega
 * sin reinterpretar ningún campo.
 */

import type { SimulationInputEvent, SimulationTurnResult } from "@/lib/flow/simulate-flow";
import type { SimulationOverrides } from "@/lib/flow/executors/simulated-executor-registry";
import type { FlowEngineState } from "@/lib/flow/engine-types";
import type { FlowValidationResult } from "@/lib/flow/errors";

export type FetchLike = typeof fetch;

export type SimulateFlowErrorKind = "unauthorized" | "forbidden" | "not_found" | "invalid_flow" | "network" | "unknown";
export interface SimulateFlowError {
  kind: SimulateFlowErrorKind;
  message: string;
  status?: number;
  /** Presente cuando kind === "invalid_flow" -- errores del MISMO validador que POST /validate. */
  validation?: FlowValidationResult;
}
export type SimulateFlowResult =
  | { ok: true; versionId: string; versionNumber: number; turn: SimulationTurnResult }
  | { ok: false; error: SimulateFlowError };

function errorKindForStatus(status: number): SimulateFlowErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 422) return "invalid_flow";
  return "unknown";
}

/**
 * POST /api/flows/[id]/simulate -- manda un turno de simulación (evento del
 * usuario + el `engineState` que devolvió el turno anterior, o `null` para
 * arrancar/REINICIAR, spec §24). Nunca manda `tenantId` (se deriva
 * server-side del token, como el resto de la API).
 */
export async function simulateFlowTurn(params: {
  flowId: string;
  event: SimulationInputEvent;
  engineState: FlowEngineState | null;
  accessToken: string;
  versionId?: string;
  initialVariables?: Record<string, unknown>;
  overrides?: SimulationOverrides;
  fetchImpl?: FetchLike;
}): Promise<SimulateFlowResult> {
  const doFetch = params.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.accessToken}` },
      body: JSON.stringify({
        event: params.event,
        engineState: params.engineState,
        versionId: params.versionId,
        initialVariables: params.initialVariables,
        overrides: params.overrides,
      }),
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let body: { versionId?: string; versionNumber?: number; turn?: SimulationTurnResult; error?: string; validation?: FlowValidationResult } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- se trata como error genérico abajo
  }

  if (response.ok && body.turn && body.versionId && typeof body.versionNumber === "number") {
    return { ok: true, versionId: body.versionId, versionNumber: body.versionNumber, turn: body.turn };
  }

  return {
    ok: false,
    error: {
      kind: errorKindForStatus(response.status),
      message: body.error ?? "Error simulando el flow",
      status: response.status,
      validation: body.validation,
    },
  };
}
