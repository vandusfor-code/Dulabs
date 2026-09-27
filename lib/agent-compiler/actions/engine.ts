// DuLabs Business — Business Agent 2.0, FASE 4 — Action Engine.
//
//   ActionRequest (state machine) → VALIDATE → AUTHORIZE → STATE/STALE → CONFIRMATION → IDEMPOTENCY (claim)
//   → (candado) → EXECUTE (handler real, timeout, reintentos por política) → ActionResult → (state machine)
//
// Reglas:
//   - El modelo nunca llega aquí: la solicitud la construyó el backend desde slots validados. Aun así se revalida todo
//     contra el contrato de FASE 1, el estado VIGENTE y la configuración publicada del negocio.
//   - Tenant, agente, conversación, capacidades y zona horaria salen del contexto del servidor, nunca de la solicitud.
//   - Una misma operación (misma clave determinista) se ejecuta UNA vez: la garantía la da Postgres (claim atómico).
//   - Un timeout o un worker caído en una ESCRITURA deja el desenlace como desconocido: nunca se re-ejecuta.
//   - No redacta mensajes: devuelve un ActionResult estructurado.

import { createHash } from "node:crypto";
import { getActionContract } from "@/lib/agent-compiler/contracts/action-contracts";
import { CAPABILITY_BACKING } from "@/lib/agent-compiler/spec/capabilities";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { ActionNodeConfig } from "@/lib/flow/types";
import type { ConversationKey } from "@/lib/flow/orchestrator-types";
import type { EffectDispatchRequest, EffectDispatchResult } from "@/lib/flow/executor-types";
import { buildActionRequest, sha } from "@/lib/agent-compiler/conversation/actions";
import { actionRequestSchema, type ActionRequest, type ConversationState } from "@/lib/agent-compiler/conversation/model";
import type { AgentRequirements } from "@/lib/agent-compiler/conversation/requirements";
import { conversationIdOf } from "@/lib/agent-compiler/conversation/store";
import { appointmentSelection, getActionDefinition, type ActionDefinition, type FailureMapping } from "@/lib/agent-compiler/actions/registry";
import { parseActionResult, type ActionErrorCode, type ActionResult, type ActionStatus } from "@/lib/agent-compiler/actions/result";
import type { ActionExecutionStore } from "@/lib/agent-compiler/actions/store";

/** Única zona que los handlers de agenda existentes soportan (fechas con offset fijo -05:00). */
export const SUPPORTED_SCHEDULING_TIMEZONE = "America/Bogota";

/** Handler real: el EffectExecutor de acciones internas existente (InternalActionExecutor). */
export type ActionHandler = (request: EffectDispatchRequest, signal: AbortSignal) => Promise<EffectDispatchResult>;

export interface ActionExecutionContext {
  tenantId: string;
  agentId: string;
  agentVersion: string | null;
  conversation: ConversationKey;
  spec: Pick<BusinessAgentSpec, "capabilities" | "scheduling" | "identity" | "handoff">;
  requirements: AgentRequirements;
  /** Estado conversacional VIGENTE (recién leído del store). */
  state: ConversationState;
  /** Configuración estática que el compilador embebió en el flow publicado para esa acción (null = no existe). */
  businessConfig(action: string): Record<string, unknown> | null;
  /** Mensaje actual del cliente (runtime-injected; solo para la consulta de conocimiento). */
  userMessage: string;
}

export interface ActionEngineEvent {
  tenantId: string;
  agentId: string;
  conversationRef: string;
  executionId: string | null;
  action: string;
  contractVersion: string;
  status: ActionStatus;
  attempt: number;
  durationMs: number;
  errorCode: string | null;
  reason: string | null;
  replayed: boolean;
}

export interface ActionEngineDeps {
  store: ActionExecutionStore;
  handler: ActionHandler;
  clock?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: ActionEngineEvent) => void;
}

export interface ExecuteHooks {
  /**
   * Se llama después del claim y ANTES de cualquier efecto (la runtime registra ACTION_STARTED en el estado). Si
   * devuelve false, el estado cambió entre tanto: no se ejecuta nada (STALE_ACTION_REQUEST).
   */
  beforeExecute?(executionId: string, attempt: number): Promise<boolean>;
}

const ZERO_KEY = "0".repeat(32);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Lo que identifica la operación (sin estado de la solicitud ni reloj). */
function operationOf(r: ActionRequest) {
  return {
    id: r.id,
    action: r.action,
    contractVersion: r.contractVersion,
    purpose: r.purpose,
    arguments: r.arguments,
    constraints: r.constraints,
    customerData: r.customerData,
    requiresConfirmation: r.requiresConfirmation,
    confirmationId: r.confirmationId,
    goalId: r.goalId,
  };
}

export function argumentsHashOf(r: ActionRequest): string {
  const { id: _id, ...op } = operationOf(r);
  void _id;
  return createHash("sha256").update(stableStringify(op)).digest("hex");
}

const SCALAR = (v: unknown) => v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || typeof v === "string";

/** Solo los datos declarados por la acción, con tipos simples y tamaños acotados. */
function pickData(def: ActionDefinition, data: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of def.resultData) {
    const v = data?.[key];
    if (v === undefined) continue;
    if (SCALAR(v)) out[key] = typeof v === "string" ? v.slice(0, 2000) : v;
    else if (Array.isArray(v)) {
      out[key] = v
        .slice(0, 50)
        .filter((x) => SCALAR(x) || (x && typeof x === "object" && !Array.isArray(x) && Object.values(x).every(SCALAR)))
        .map((x) => (typeof x === "string" ? x.slice(0, 2000) : x));
    }
  }
  return out;
}

/** Horarios reales dentro de la franja que pidió el cliente (la franja la aplica el backend, no el modelo). */
export function filterSlotsByRange(slots: string[], range: string | undefined): string[] {
  if (!range) return slots;
  const periods: Record<string, [string, string]> = { morning: ["00:00", "11:59"], afternoon: ["12:00", "17:59"], evening: ["18:00", "23:59"] };
  const [from, to] = periods[range] ?? (range.split("-") as [string, string]);
  return slots.filter((s) => (!from || s >= from) && (!to || s <= to));
}

function result(input: {
  status: ActionStatus;
  request: ActionRequest | null;
  action: string;
  executionId: string | null;
  attempt: number;
  started: number;
  now: number;
  data?: Record<string, unknown>;
  error?: FailureMapping | null;
  replayed?: boolean;
}): ActionResult {
  return {
    status: input.status,
    action: input.action,
    executionId: input.executionId,
    idempotencyKey: input.request?.id && /^[a-f0-9]{32}$/.test(input.request.id) ? input.request.id : ZERO_KEY,
    attempt: input.attempt,
    replayed: input.replayed ?? false,
    data: (input.data ?? {}) as ActionResult["data"],
    error: input.error ? { code: input.error.code, reason: input.error.reason, retryable: input.error.retryable, ambiguous: input.error.ambiguous } : null,
    invalidSlots: input.error?.invalidSlots ?? [],
    durationMs: Math.max(0, input.now - input.started),
  };
}

const rejectWith = (code: ActionErrorCode, reason: string): FailureMapping => ({ code, reason, retryable: false, ambiguous: false, invalidSlots: [] });

type Validation = { ok: true; def: ActionDefinition; contractVersion: string } | { ok: false; error: FailureMapping; action: string };

/** VALIDATE + AUTHORIZE + ESTADO + CONFIRMACIÓN. Nada de esto toca la base ni ningún sistema externo. */
export function validateActionRequest(raw: unknown, ctx: ActionExecutionContext, nowIso: string): Validation {
  const parsed = actionRequestSchema.safeParse(raw);
  const action = typeof (raw as { action?: unknown })?.action === "string" ? String((raw as { action: string }).action).slice(0, 80) : "unknown";
  if (!parsed.success) return { ok: false, action, error: rejectWith("INVALID_ACTION", "MALFORMED_REQUEST") };
  const request = parsed.data;

  const def = getActionDefinition(request.action);
  if (!def) return { ok: false, action, error: rejectWith("INVALID_ACTION", "UNKNOWN_ACTION") };
  const contract = getActionContract(request.action);
  if (!contract) return { ok: false, action, error: rejectWith("INVALID_CONTRACT", "CONTRACT_MISSING") };
  if (request.contractVersion !== contract.version) return { ok: false, action, error: rejectWith("INVALID_CONTRACT", "CONTRACT_VERSION_MISMATCH") };
  if (request.sideEffects !== contract.sideEffects) return { ok: false, action, error: rejectWith("INVALID_CONTRACT", "SIDE_EFFECT_MISMATCH") };

  // Argumentos: exactamente lo que el contrato permite (campos extra = rechazo, no "se ignoran").
  if (!contract.llmArguments.strict().safeParse(request.arguments).success) return { ok: false, action, error: rejectWith("INVALID_ARGUMENTS", "ARGUMENTS_VIOLATE_CONTRACT") };
  if (Object.keys(request.constraints).some((k) => !def.allowedConstraints.includes(k))) return { ok: false, action, error: rejectWith("INVALID_ARGUMENTS", "UNKNOWN_CONSTRAINT") };
  const allowedCustomer = new Set(Object.values(ctx.requirements.customerFieldBySlot));
  if (Object.keys(request.customerData).some((k) => !def.allowsCustomerData || !allowedCustomer.has(k))) return { ok: false, action, error: rejectWith("INVALID_ARGUMENTS", "UNKNOWN_CUSTOMER_FIELD") };
  if (!def.purposes.includes(request.purpose)) return { ok: false, action, error: rejectWith("INVALID_ARGUMENTS", "PURPOSE_NOT_ALLOWED") };
  if (def.requiresConfirmation !== request.requiresConfirmation) return { ok: false, action, error: rejectWith("INVALID_CONTRACT", "CONFIRMATION_POLICY_MISMATCH") };

  // Alcance: el estado cargado debe ser de ESTE tenant, agente y conversación (derivados del canal, no de la solicitud).
  const scope = ctx.state.scope;
  if (scope.tenantId !== ctx.tenantId || scope.agentId !== ctx.agentId || scope.conversationId !== conversationIdOf(ctx.conversation) || scope.contactId !== ctx.conversation.telefonoCliente) {
    return { ok: false, action, error: rejectWith("TENANT_ERROR", "SCOPE_MISMATCH") };
  }

  // Autorización: capacidad activa en el Spec publicado, respaldada por el runtime, y proveedor de agenda correcto.
  const backing = CAPABILITY_BACKING[def.capability];
  if (!ctx.spec.capabilities[def.capability] || !backing.available || !backing.actions.includes(request.action as never)) {
    return { ok: false, action, error: rejectWith("UNAUTHORIZED", "CAPABILITY_DISABLED") };
  }
  if (def.schedulingProvider && (!ctx.spec.scheduling?.enabled || ctx.spec.scheduling.provider !== def.schedulingProvider)) {
    return { ok: false, action, error: rejectWith("UNAUTHORIZED", "SCHEDULING_PROVIDER_MISMATCH") };
  }

  // Estado: la solicitud debe ser EXACTAMENTE la pendiente del estado vigente, y recalcularse igual desde sus slots.
  const pending = ctx.state.pendingAction;
  if (!pending) return { ok: false, action, error: rejectWith("STALE_ACTION_REQUEST", "NO_PENDING_ACTION") };
  if (pending.id !== request.id) return { ok: false, action, error: rejectWith("STALE_ACTION_REQUEST", "SUPERSEDED_BY_NEWER_REQUEST") };
  if (stableStringify(operationOf(pending)) !== stableStringify(operationOf(request))) return { ok: false, action, error: rejectWith("STALE_ACTION_REQUEST", "REQUEST_DOES_NOT_MATCH_STATE") };
  const expectedStatus = request.purpose === "handoff" ? ["HANDOFF_PENDING", "HANDED_OFF", "PAUSED"] : ["READY_FOR_ACTION", "EXECUTING"];
  if (!expectedStatus.includes(ctx.state.status)) return { ok: false, action, error: rejectWith("INVALID_STATE", `STATE_${ctx.state.status}`) };
  const rebuilt = buildActionRequest({ state: ctx.state, requirements: ctx.requirements, action: request.action, purpose: request.purpose, requiresConfirmation: request.requiresConfirmation, confirmationId: request.confirmationId, now: nowIso });
  if (!rebuilt.ok) return { ok: false, action, error: rejectWith("INVALID_ARGUMENTS", "CURRENT_DATA_VIOLATES_CONTRACT") };
  if (rebuilt.request.id !== request.id) return { ok: false, action, error: rejectWith("STALE_ACTION_REQUEST", "DATA_CHANGED_SINCE_REQUEST") };

  // Confirmación: debe referirse a ESTOS datos (id de la propuesta = objetivo + huella de argumentos).
  if (def.requiresConfirmation) {
    const goal = ctx.state.goal;
    if (!request.confirmationId || !goal || request.confirmationId !== sha(`${goal.id}|${rebuilt.argsHash}`)) {
      return { ok: false, action, error: rejectWith("CONFIRMATION_REQUIRED", "NO_VALID_CONFIRMATION") };
    }
  }

  // Zona horaria: los handlers de agenda existentes operan con offset fijo de Colombia. Otra zona = no se agenda.
  if (def.temporal && (ctx.spec.identity.timezone !== SUPPORTED_SCHEDULING_TIMEZONE || ctx.state.timezone !== SUPPORTED_SCHEDULING_TIMEZONE)) {
    return { ok: false, action, error: rejectWith("BUSINESS_RULE_VIOLATION", "TIMEZONE_NOT_SUPPORTED") };
  }

  // Configuración publicada: una acción de agenda sin su configuración compilada (horario, datos, política) no se ejecuta.
  for (const step of def.steps) {
    if (def.temporal && !ctx.businessConfig(step.action)) return { ok: false, action, error: rejectWith("INTERNAL_ERROR", "AGENT_CONFIGURATION_MISSING") };
  }
  return { ok: true, def, contractVersion: contract.version };
}

function withTimeout(run: (signal: AbortSignal) => Promise<EffectDispatchResult>, ms: number): Promise<EffectDispatchResult | "timeout"> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, ms);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

export function createActionEngine(deps: ActionEngineDeps) {
  const clock = deps.clock ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log =
    deps.log ??
    ((e: ActionEngineEvent) => {
      console.info("[business-agent.action]", JSON.stringify(e));
    });

  async function runSteps(def: ActionDefinition, request: ActionRequest, ctx: ActionExecutionContext, attempt: number): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; failure: FailureMapping }> {
    const previous: Record<string, unknown> = {};
    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i]!;
      const isMain = i === def.steps.length - 1;
      const config = ctx.businessConfig(step.action) ?? (step.action === "transferir_soporte" ? { pauseDurationHours: ctx.spec.handoff.defaultPauseHours } : {});
      const dispatch: EffectDispatchRequest = {
        // effectId/executionRowId deterministas: la idempotencia propia de los handlers (ejecutarConIdempotencia)
        // usa la MISMA clave en cualquier reintento de esta operación.
        effectId: `${request.id}:${step.action}`,
        executionRowId: `ba-action:${request.id}`,
        executionLogicalId: `ba-action:${request.id}`,
        tenantId: ctx.tenantId,
        nodeId: `ba-action:${step.action}`,
        kind: "action",
        attempt,
        payload: step.buildPayload(request, { userMessage: ctx.userMessage, previous }),
        action: { ...config, actionType: step.action } as ActionNodeConfig,
        conversation: ctx.conversation,
      };
      let r: EffectDispatchResult | "timeout";
      try {
        r = await withTimeout((signal) => deps.handler(dispatch, signal), def.timeoutMs);
      } catch {
        // Excepción del handler: en una escritura no se sabe si el efecto ocurrió.
        return { ok: false, failure: { code: "EXTERNAL_ERROR", reason: "HANDLER_EXCEPTION", retryable: !def.mutation, ambiguous: def.mutation && isMain, invalidSlots: [] } };
      }
      if (r === "timeout") {
        return { ok: false, failure: { code: "TIMEOUT", reason: isMain ? "ACTION_TIMEOUT" : "PRECHECK_TIMEOUT", retryable: !def.mutation || !isMain, ambiguous: def.mutation && isMain, invalidSlots: [] } };
      }
      if (!r.success) return { ok: false, failure: def.mapFailure(r, request) };
      const data = (r.data ?? {}) as Record<string, unknown>;
      if (!isMain) {
        Object.assign(previous, data);
        const selection = step.action === "listar_citas_cliente" ? appointmentSelection(previous) : null;
        if (selection) return { ok: false, failure: selection };
        continue;
      }
      return { ok: true, data };
    }
    return { ok: false, failure: rejectWith("INTERNAL_ERROR", "NO_STEPS") };
  }

  async function execute(rawRequest: unknown, ctx: ActionExecutionContext, hooks: ExecuteHooks = {}): Promise<ActionResult> {
    const started = clock().getTime();
    const request = actionRequestSchema.safeParse(rawRequest).success ? (rawRequest as ActionRequest) : null;
    const conversationRef = sha(conversationIdOf(ctx.conversation), 16);
    const finish = (r: ActionResult, contractVersion: string): ActionResult => {
      const checked = parseActionResult(r);
      const final = checked.ok ? checked.result : result({ status: "FAILED", request, action: r.action, executionId: r.executionId, attempt: r.attempt, started, now: clock().getTime(), error: rejectWith("INTERNAL_ERROR", "RESULT_SCHEMA_VIOLATION") });
      log({ tenantId: ctx.tenantId, agentId: ctx.agentId, conversationRef, executionId: final.executionId, action: final.action, contractVersion, status: final.status, attempt: final.attempt, durationMs: final.durationMs, errorCode: final.error?.code ?? null, reason: final.error?.reason ?? null, replayed: final.replayed });
      return final;
    };

    const v = validateActionRequest(rawRequest, ctx, clock().toISOString());
    if (!v.ok) return finish(result({ status: "REJECTED", request, action: v.action, executionId: null, attempt: 0, started, now: clock().getTime(), error: v.error }), request?.contractVersion ?? "-");
    const { def, contractVersion } = v;
    const req = request!;

    // IDEMPOTENCIA: claim atómico en Postgres.
    let claim;
    try {
      claim = await deps.store.claim({
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        conversationId: conversationIdOf(ctx.conversation),
        action: req.action,
        contractVersion,
        idempotencyKey: req.id,
        argumentsHash: argumentsHashOf(req),
        leaseSeconds: Math.min(300, Math.ceil((def.timeoutMs * def.retry.maxAttempts) / 1000) + 15),
        retakeable: !def.mutation,
      });
    } catch {
      return finish(result({ status: "FAILED", request: req, action: req.action, executionId: null, attempt: 0, started, now: clock().getTime(), error: { code: "INTERNAL_ERROR", reason: "EXECUTION_STORE_UNAVAILABLE", retryable: true, ambiguous: false, invalidSlots: [] } }), contractVersion);
    }

    if (claim.kind === "completed" || claim.kind === "unknown") {
      const stored = parseActionResult(claim.result);
      if (stored.ok) return finish({ ...stored.result, replayed: true, durationMs: Math.max(0, clock().getTime() - started) }, contractVersion);
      if (claim.kind === "unknown") {
        return finish(result({ status: "TIMED_OUT", request: req, action: req.action, executionId: claim.executionId, attempt: claim.attempt, started, now: clock().getTime(), replayed: true, error: { code: "TIMEOUT", reason: "OUTCOME_UNKNOWN", retryable: false, ambiguous: true, invalidSlots: [] } }), contractVersion);
      }
      return finish(result({ status: "FAILED", request: req, action: req.action, executionId: claim.executionId, attempt: claim.attempt, started, now: clock().getTime(), replayed: true, error: rejectWith("INTERNAL_ERROR", "STORED_RESULT_INVALID") }), contractVersion);
    }
    if (claim.kind === "in_progress") {
      return finish(result({ status: "IN_PROGRESS", request: req, action: req.action, executionId: claim.executionId, attempt: claim.attempt, started, now: clock().getTime(), error: { code: "CONFLICT", reason: "EXECUTION_IN_PROGRESS", retryable: true, ambiguous: false, invalidSlots: [] } }), contractVersion);
    }
    if (claim.kind === "mismatch") {
      return finish(result({ status: "REJECTED", request: req, action: req.action, executionId: claim.executionId, attempt: 0, started, now: clock().getTime(), error: rejectWith("IDEMPOTENCY_CONFLICT", "KEY_REUSED_WITH_DIFFERENT_OPERATION") }), contractVersion);
    }

    const { executionId, attempt } = claim;
    const complete = async (r: ActionResult): Promise<ActionResult> => {
      const status = r.status === "SUCCEEDED" || r.status === "FAILED" || r.status === "REJECTED" || r.status === "TIMED_OUT" ? r.status : "FAILED";
      try {
        const written = await deps.store.complete({ tenantId: ctx.tenantId, executionId, attempt, status, result: r as unknown as Record<string, unknown>, errorCode: r.error?.code ?? null, retryable: r.error?.retryable ?? false });
        if (!written) console.warn(`[business-agent.action] complete_fenced execution=${executionId} attempt=${attempt}`);
      } catch {
        console.error(`[business-agent.action] complete_failed execution=${executionId}`);
      }
      return finish(r, contractVersion);
    };

    // El estado registra ACTION_STARTED antes de cualquier efecto; si ya no corresponde, no se ejecuta.
    if (hooks.beforeExecute && !(await hooks.beforeExecute(executionId, attempt))) {
      return complete(result({ status: "REJECTED", request: req, action: req.action, executionId, attempt, started, now: clock().getTime(), error: rejectWith("STALE_ACTION_REQUEST", "STATE_CHANGED_BEFORE_EXECUTION") }));
    }

    // Exclusión: verificar → escribir en la agenda, de a una conversación por negocio y fecha.
    const lockKey = def.lockKey?.(req) ?? null;
    const holder = `${executionId}:${attempt}`;
    if (lockKey) {
      let got = false;
      try {
        got = await deps.store.acquireLock({ tenantId: ctx.tenantId, lockKey, holder, leaseSeconds: Math.ceil(def.timeoutMs / 1000) + 15 });
      } catch {
        got = false;
      }
      if (!got) {
        return complete(result({ status: "FAILED", request: req, action: req.action, executionId, attempt, started, now: clock().getTime(), error: { code: "CONFLICT", reason: "BOOKING_IN_PROGRESS", retryable: true, ambiguous: false, invalidSlots: [] } }));
      }
    }

    try {
      let outcome = await runSteps(def, req, ctx, attempt);
      // Reintentos: solo errores transitorios de acciones que se pueden repetir sin riesgo; backoff exponencial acotado.
      for (let n = 1; !outcome.ok && outcome.failure.retryable && !def.mutation && n < def.retry.maxAttempts; n++) {
        await sleep(def.retry.baseDelayMs * 2 ** (n - 1));
        outcome = await runSteps(def, req, ctx, attempt);
      }
      if (!outcome.ok) {
        const status: ActionStatus = outcome.failure.code === "TIMEOUT" ? "TIMED_OUT" : "FAILED";
        return complete(result({ status, request: req, action: req.action, executionId, attempt, started, now: clock().getTime(), error: outcome.failure }));
      }
      let data = pickData(def, outcome.data);
      if (req.action === "buscar_disponibilidad_nylas_generico" && req.constraints.franjaHoraria) {
        const within = filterSlotsByRange(Array.isArray(data.horariosDisponibles) ? (data.horariosDisponibles as string[]) : [], req.constraints.franjaHoraria);
        if (within.length === 0) {
          return complete(result({ status: "FAILED", request: req, action: req.action, executionId, attempt, started, now: clock().getTime(), error: { code: "BUSINESS_RULE_VIOLATION", reason: "NO_AVAILABILITY_IN_RANGE", retryable: false, ambiguous: false, invalidSlots: ["time_range"] } }));
        }
        // El texto del backend listaba el día completo: se entregan solo los horarios de la franja pedida.
        const { disponibilidadTexto: _omit, ...rest } = data;
        void _omit;
        data = { ...rest, horariosDisponibles: within };
      }
      return complete(result({ status: "SUCCEEDED", request: req, action: req.action, executionId, attempt, started, now: clock().getTime(), data }));
    } finally {
      if (lockKey) {
        try {
          await deps.store.releaseLock({ tenantId: ctx.tenantId, lockKey, holder });
        } catch {
          // El lease vence solo: nunca bloquea para siempre.
        }
      }
    }
  }

  return { execute };
}

export type ActionEngine = ReturnType<typeof createActionEngine>;
