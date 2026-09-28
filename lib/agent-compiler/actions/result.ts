// DuLabs Business — Business Agent 2.0, FASE 4 — ActionResult y taxonomía de errores del Action Engine.
//
// El Action Engine nunca devuelve "algo salió mal": cada resultado tiene un estado, un código estable, si es
// reintentable y si el desenlace externo es AMBIGUO (p. ej. un timeout de una escritura: no se sabe si ocurrió).
// Nunca incluye lenguaje para el cliente: eso es del renderer.

import { z } from "zod";
import { STALE_REQUEST_CATEGORY } from "@/lib/agent-compiler/conversation/model";

export { STALE_REQUEST_CATEGORY };

export const ACTION_STATUSES = ["SUCCEEDED", "FAILED", "REJECTED", "TIMED_OUT", "IN_PROGRESS"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/**
 * Taxonomía pequeña y estable.
 *   REJECTED (no se ejecutó nada): INVALID_ACTION, INVALID_CONTRACT, INVALID_ARGUMENTS, UNAUTHORIZED, TENANT_ERROR,
 *     STALE_ACTION_REQUEST, CONFIRMATION_REQUIRED, INVALID_STATE, IDEMPOTENCY_CONFLICT
 *   FAILED (se intentó): BUSINESS_RULE_VIOLATION, NOT_FOUND, CONFLICT, RATE_LIMITED, EXTERNAL_ERROR, INTERNAL_ERROR
 *   TIMED_OUT: TIMEOUT (ambiguo en escrituras)
 *   IN_PROGRESS: otra ejecución con la misma clave está en curso.
 */
export const ACTION_ERROR_CODES = [
  "INVALID_ACTION",
  "INVALID_CONTRACT",
  "INVALID_ARGUMENTS",
  "UNAUTHORIZED",
  "TENANT_ERROR",
  "STALE_ACTION_REQUEST",
  "CONFIRMATION_REQUIRED",
  "INVALID_STATE",
  "IDEMPOTENCY_CONFLICT",
  "BUSINESS_RULE_VIOLATION",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "TIMEOUT",
  "EXTERNAL_ERROR",
  "INTERNAL_ERROR",
] as const;
export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

export const actionErrorSchema = z
  .object({
    code: z.enum(ACTION_ERROR_CODES),
    /** Motivo específico (snake/upper case corto): OCUPADO, FUERA_DE_HORARIO, CALENDAR_NOT_CONNECTED... */
    reason: z.string().regex(/^[A-Z0-9_]{1,60}$/),
    retryable: z.boolean(),
    /** true = no se sabe si el efecto externo ocurrió (nunca se reintenta una escritura en ese caso). */
    ambiguous: z.boolean(),
  })
  .strict();
export type ActionError = z.infer<typeof actionErrorSchema>;

const scalar = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]);

export const actionResultSchema = z
  .object({
    status: z.enum(ACTION_STATUSES),
    action: z.string().min(1).max(80),
    /** Id de la ejecución persistida (null si se rechazó antes de registrar). */
    executionId: z.string().max(64).nullable(),
    idempotencyKey: z.string().regex(/^[a-f0-9]{32}$/),
    attempt: z.number().int().min(0).max(10),
    /** true = resultado de una ejecución anterior con la misma clave (replay). No se volvió a ejecutar nada. */
    replayed: z.boolean(),
    /** Datos del backend, ya filtrados por la definición de la acción (allowlist por acción). */
    data: z.record(z.string(), z.union([scalar, z.array(z.union([scalar, z.record(z.string(), scalar)])).max(50)])),
    error: actionErrorSchema.nullable(),
    /** Slots que el backend rechazó (horario ocupado → time): la state machine los marca INVALID. */
    invalidSlots: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)).max(10),
    durationMs: z.number().int().min(0),
    /**
     * FASE 6 — SIMULACIÓN (vista previa / pruebas): la acción NO se ejecutó; es lo que el agente habría hecho. Solo
     * aparece con status SUCCEEDED y nunca en producción (un resultado simulado no se guarda en la base).
     */
    simulated: z.literal(true).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.status === "SUCCEEDED" && r.error) ctx.addIssue({ code: "custom", message: "succeeded_with_error" });
    if (r.status !== "SUCCEEDED" && !r.error) ctx.addIssue({ code: "custom", message: "failure_without_error" });
    if (r.simulated && r.status !== "SUCCEEDED") ctx.addIssue({ code: "custom", message: "simulated_must_be_succeeded" });
  });
export type ActionResult = z.infer<typeof actionResultSchema>;

export function parseActionResult(value: unknown): { ok: true; result: ActionResult } | { ok: false; issue: string } {
  const r = actionResultSchema.safeParse(value);
  if (r.success) return { ok: true, result: r.data };
  const i = r.error.issues[0];
  return { ok: false, issue: `${i?.code ?? "invalid"}:${i?.path.join(".") ?? ""}:${i?.message ?? ""}` };
}

/**
 * Categoría (contrato de errores de FASE 1) con la que la state machine interpreta un fallo. Una solicitud vieja
 * (STALE, p. ej. cambió la versión publicada del negocio) no es un error del negocio: se re-evalúa con la versión
 * vigente. Si el rechazo STALE es un REPLAY (misma operación ya cerrada), re-evaluar la repetiría: es INTERNAL_ERROR.
 */
export function stateCategoryFor(error: ActionError, opts: { replayed?: boolean } = {}): string {
  if (error.code === "STALE_ACTION_REQUEST") return opts.replayed ? "INTERNAL_ERROR" : STALE_REQUEST_CATEGORY;
  switch (error.code) {
    case "BUSINESS_RULE_VIOLATION":
    case "NOT_FOUND":
    case "CONFLICT":
      return "BUSINESS_RULE_ERROR";
    case "INVALID_ARGUMENTS":
      return "VALIDATION_ERROR";
    case "UNAUTHORIZED":
      return "AUTHORIZATION_ERROR";
    case "TENANT_ERROR":
      return "TENANT_ERROR";
    case "RATE_LIMITED":
    case "TIMEOUT":
    case "EXTERNAL_ERROR":
      return "EXTERNAL_SERVICE_ERROR";
    default:
      return "INTERNAL_ERROR";
  }
}
