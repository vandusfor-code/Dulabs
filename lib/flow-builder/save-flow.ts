/**
 * Etapa 4 (Flow Builder, autorizado) — wrappers I/O delgados sobre las APIs
 * YA EXISTENTES (app/api/flows/[id]/versions, app/api/flows/[id]/validate).
 * Ninguna regla de negocio acá: guardar SIEMPRE manda un borrador
 * ({definition}, sin versionNumber ni publish -- publicar es Etapa 5) y
 * validar consume la respuesta de /validate exactamente como llega, sin
 * reinterpretarla. `fetchImpl` es inyectable (mismo patrón que
 * anthropicClient en claude-executor.ts) para poder probar sin red real.
 */

import type { FlowDefinition } from "@/lib/flow/types";
import type { FlowValidationResult } from "@/lib/flow/errors";
import type { FlowVersionRow } from "@/lib/flow/flow-store-types";

export type FetchLike = typeof fetch;

export type SaveFlowErrorKind = "embedded_secrets" | "version_conflict" | "unauthorized" | "forbidden" | "network" | "unknown";
export interface SaveFlowError {
  kind: SaveFlowErrorKind;
  message: string;
  status?: number;
}
export type SaveFlowResult = { ok: true; version: FlowVersionRow } | { ok: false; error: SaveFlowError };

export type ValidateFlowErrorKind = "unauthorized" | "forbidden" | "network" | "unknown";
export interface ValidateFlowError {
  kind: ValidateFlowErrorKind;
  message: string;
  status?: number;
}
export type ValidateFlowResult = { ok: true; result: FlowValidationResult } | { ok: false; error: ValidateFlowError };

function saveErrorKindForStatus(status: number): SaveFlowErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 409) return "version_conflict";
  if (status === 400) return "embedded_secrets";
  return "unknown";
}

function validateErrorKindForStatus(status: number): ValidateFlowErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return "unknown";
}

/**
 * POST /api/flows/[id]/versions -- SIEMPRE guarda un borrador. Nunca manda
 * `publish: true` (eso es exclusivamente de Etapa 5, sin implementar acá).
 */
export async function saveFlowVersion(params: {
  flowId: string;
  definition: FlowDefinition;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<SaveFlowResult> {
  const doFetch = params.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.accessToken}` },
      body: JSON.stringify({ definition: params.definition }),
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let body: { version?: FlowVersionRow; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- se trata como error genérico abajo
  }

  if (response.ok && body.version) {
    return { ok: true, version: body.version };
  }

  return {
    ok: false,
    error: {
      kind: saveErrorKindForStatus(response.status),
      message: body.error ?? "Error guardando el flow",
      status: response.status,
    },
  };
}

/** POST /api/flows/[id]/validate -- consume {valid, errors} exactamente como llega, sin reinterpretar ningún código. */
export async function validateFlowDefinition(params: {
  flowId: string;
  definition: FlowDefinition;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<ValidateFlowResult> {
  const doFetch = params.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`/api/flows/${params.flowId}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.accessToken}` },
      body: JSON.stringify({ definition: params.definition }),
    });
  } catch (err) {
    return { ok: false, error: { kind: "network", message: err instanceof Error ? err.message : "Error de red" } };
  }

  let body: { valid?: boolean; errors?: FlowValidationResult["errors"]; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta sin cuerpo JSON válido -- se trata como error genérico abajo
  }

  if (response.ok && typeof body.valid === "boolean") {
    return { ok: true, result: { valid: body.valid, errors: body.errors ?? [] } };
  }

  return {
    ok: false,
    error: {
      kind: validateErrorKindForStatus(response.status),
      message: body.error ?? "Error validando el flow",
      status: response.status,
    },
  };
}
