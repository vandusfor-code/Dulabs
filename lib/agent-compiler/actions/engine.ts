// DuLabs Business — Business Agent 2.0, FASE 4 — Action Engine.
//
//   ActionRequest (state machine) → VALIDATE → AUTHORIZE → STATE/STALE → CONFIRMATION → IDEMPOTENCY (claim)
//   → (candado) → EXECUTE (handler real, timeout, reintentos por política) → ActionResult → (state machine)
//
// Reglas:
//   - El modelo nunca llega aquí: la solicitud la construyó el backend desde slots validados. Aun así se revalida todo
//     contra el contrato de FASE 1, el estado VIGENTE y la configuración publicada del negocio.
//   - Tenant, agente, conversación, capacidades y zona horaria salen del contexto del servidor, nunca de la solicitud.
//   - FASE 5: lo único que autoriza y configura una acción es el ARTEFACTO publicado (Universal Business Model compilado):
//     acción habilitada, config por paso, agenda (anticipación máxima, servicios reservables, duración) y versión.
//   - Una misma operación (misma clave determinista) se ejecuta UNA vez: la garantía la da Postgres (claim atómico).
//   - Un timeout o un worker caído en una ESCRITURA deja el desenlace como desconocido: nunca se re-ejecuta.
//   - No redacta mensajes: devuelve un ActionResult estructurado.

import { createHash } from "node:crypto";
import { getActionContract } from "@/lib/agent-compiler/contracts/action-contracts";
import { CAPABILITY_BACKING } from "@/lib/agent-compiler/spec/capabilities";
import type { ActionNodeConfig } from "@/lib/flow/types";
import type { ConversationKey } from "@/lib/flow/orchestrator-types";
import type { EffectDispatchRequest, EffectDispatchResult } from "@/lib/flow/executor-types";
import { buildActionRequest, sha } from "@/lib/agent-compiler/conversation/actions";
import { actionRequestSchema, type ActionRequest, type ConversationState } from "@/lib/agent-compiler/conversation/model";
import { artifactRequirements, type CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import { conversationIdOf } from "@/lib/agent-compiler/conversation/store";
import { appointmentSelection, getActionDefinition, type ActionDefinition, type FailureMapping } from "@/lib/agent-compiler/actions/registry";
import { parseActionResult, type ActionErrorCode, type ActionResult, type ActionStatus } from "@/lib/agent-compiler/actions/result";
import type { ActionExecutionStore } from "@/lib/agent-compiler/actions/store";
import { RETRY_POLICIES, retryClassOf, retryDecision } from "@/lib/agent-compiler/runtime/production/retry-policy";
import type { CircuitRegistry, Dependency } from "@/lib/agent-compiler/runtime/production/circuits";
import type { RateLimiter } from "@/lib/agent-compiler/runtime/production/operations";

/** Única zona que los handlers de agenda existentes soportan (fechas con offset fijo -05:00). */
export const SUPPORTED_SCHEDULING_TIMEZONE = "America/Bogota";

/** Handler real: el EffectExecutor de acciones internas existente (InternalActionExecutor). */
export type ActionHandler = (request: EffectDispatchRequest, signal: AbortSignal) => Promise<EffectDispatchResult>;

export interface ActionExecutionContext {
  tenantId: string;
  agentId: string;
  agentVersion: string | null;
  conversation: ConversationKey;
  /** Artefacto publicado vigente (FASE 5): autorización, configuración por paso, agenda y versión. */
  artifact: CompiledAgentArtifact;
  /** Estado conversacional VIGENTE (recién leído del store). */
  state: ConversationState;
  /** Mensaje actual del cliente (runtime-injected; solo para la consulta de conocimiento). */
  userMessage: string;
  /**
   * FASE 6 — SIMULACIÓN (lo fija el servidor, nunca el navegador): ninguna escritura se ejecuta. Una acción con efecto
   * (reservar, cancelar, transferir…) devuelve SUCCEEDED `simulated` SIN tocar el handler ni el registro de ejecuciones.
   * Una solicitud simulada no corre en vivo ni al revés (SIMULATION_MISMATCH).
   */
  simulation?: boolean;
}

/** Requisitos del artefacto con su huella de ejecución (la misma que usa la state machine para construir solicitudes). */
export const requirementsOf = artifactRequirements;

export interface ActionEngineEvent {
  tenantId: string;
  agentId: string;
  /** Versión publicada del negocio (artefacto) con que se evaluó la solicitud. */
  artifactVersion: string;
  artifactRef: string;
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
  /** FASE 8 — handler de las acciones NATIVAS del Business Agent (actions/native/handler.ts). */
  native?: ActionHandler;
  clock?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: ActionEngineEvent) => void;
  /** FASE 9 — circuitos por dependencia y tenant (runtime/production/circuits.ts). Sin registro = sin circuito. */
  circuits?: CircuitRegistry;
  /** FASE 9 — aleatoriedad del jitter (tests deterministas). */
  random?: () => number;
  /** FASE 9 — límite de acciones con efecto por conversación (Postgres). Sin limitador = sin límite. */
  limiter?: RateLimiter;
}

/** FASE 9 — dependencia EXTERNA de una acción (la que protege su circuito). */
export function dependencyOf(def: ActionDefinition): Dependency | null {
  return def.schedulingProvider === "nylas" ? "nylas_calendar" : null;
}

/** Fallas que hablan de la salud del proveedor (no de la solicitud): timeout, 5xx, 429, red, credencial rechazada. */
export function countsAgainstDependency(f: { code: string; reason: string; ambiguous: boolean }): boolean {
  return f.ambiguous || f.code === "TIMEOUT" || f.code === "RATE_LIMITED" || (f.code === "EXTERNAL_ERROR" && f.reason !== "CIRCUIT_OPEN") || f.reason === "PROVIDER_AUTH_ERROR";
}

/** Escritura que NO se puede repetir a ciegas (externa o no idempotente). Las idempotentes del store propio sí. */
const unsafeWrite = (def: ActionDefinition) => def.mutation && !def.idempotentWrite;

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
  simulated?: boolean;
}): ActionResult {
  return {
    status: input.status,
    action: input.action,
    executionId: input.executionId,
    idempotencyKey: input.request?.id && /^[a-f0-9]{32}$/.test(input.request.id) ? input.request.id : ZERO_KEY,
    attempt: input.attempt,
    replayed: input.replayed ?? false,
    data: (input.data ?? input.error?.data ?? {}) as ActionResult["data"],
    error: input.error ? { code: input.error.code, reason: input.error.reason, retryable: input.error.retryable, ambiguous: input.error.ambiguous } : null,
    invalidSlots: input.error?.invalidSlots ?? [],
    durationMs: Math.max(0, input.now - input.started),
    ...(input.simulated ? { simulated: true as const } : {}),
  };
}

const rejectWith = (code: ActionErrorCode, reason: string): FailureMapping => ({ code, reason, retryable: false, ambiguous: false, invalidSlots: [] });

/**
 * execute       se ejecuta (claim → handler).
 * resolve_only  la acción ya estaba EXECUTING cuando cambió la versión publicada: no se ejecuta nada nuevo; solo se
 *               recupera su desenlace (replay / desconocido) o se cierra como STALE si nunca llegó a empezar.
 */
type Validation = { ok: true; def: ActionDefinition; contractVersion: string; mode: "execute" | "resolve_only" } | { ok: false; error: FailureMapping; action: string };

/** VALIDATE + AUTHORIZE + ESTADO + CONFIRMACIÓN. Nada de esto toca la base ni ningún sistema externo. */
export function validateActionRequest(raw: unknown, ctx: ActionExecutionContext, nowIso: string): Validation {
  const parsed = actionRequestSchema.safeParse(raw);
  const action = typeof (raw as { action?: unknown })?.action === "string" ? String((raw as { action: string }).action).slice(0, 80) : "unknown";
  if (!parsed.success) return { ok: false, action, error: rejectWith("INVALID_ACTION", "MALFORMED_REQUEST") };
  const request = parsed.data;
  // Simulación y producción nunca se cruzan: lo decide el contexto del SERVIDOR, y la solicitud debe coincidir.
  if ((request.simulation === true) !== (ctx.simulation === true)) return { ok: false, action, error: rejectWith("UNAUTHORIZED", "SIMULATION_MISMATCH") };

  const def = getActionDefinition(request.action);
  if (!def) return { ok: false, action, error: rejectWith("INVALID_ACTION", "UNKNOWN_ACTION") };
  const contract = getActionContract(request.action);
  if (!contract) return { ok: false, action, error: rejectWith("INVALID_CONTRACT", "CONTRACT_MISSING") };
  if (request.contractVersion !== contract.version) return { ok: false, action, error: rejectWith("INVALID_CONTRACT", "CONTRACT_VERSION_MISMATCH") };
  if (request.sideEffects !== contract.sideEffects) return { ok: false, action, error: rejectWith("INVALID_CONTRACT", "SIDE_EFFECT_MISMATCH") };

  // Argumentos: exactamente lo que el contrato permite (campos extra = rechazo, no "se ignoran").
  if (!contract.llmArguments.strict().safeParse(request.arguments).success) return { ok: false, action, error: rejectWith("INVALID_ARGUMENTS", "ARGUMENTS_VIOLATE_CONTRACT") };
  if (Object.keys(request.constraints).some((k) => !def.allowedConstraints.includes(k))) return { ok: false, action, error: rejectWith("INVALID_ARGUMENTS", "UNKNOWN_CONSTRAINT") };
  const artifact = ctx.artifact;
  const allowedCustomer = new Set(Object.values(artifact.requirements.customerFieldBySlot));
  if (Object.keys(request.customerData).some((k) => !def.allowsCustomerData || !allowedCustomer.has(k))) return { ok: false, action, error: rejectWith("INVALID_ARGUMENTS", "UNKNOWN_CUSTOMER_FIELD") };
  if (!def.purposes.includes(request.purpose)) return { ok: false, action, error: rejectWith("INVALID_ARGUMENTS", "PURPOSE_NOT_ALLOWED") };
  if (def.requiresConfirmation !== request.requiresConfirmation) return { ok: false, action, error: rejectWith("INVALID_CONTRACT", "CONFIRMATION_POLICY_MISMATCH") };

  // Alcance: el estado cargado debe ser de ESTE tenant, agente y conversación (derivados del canal, no de la solicitud).
  const scope = ctx.state.scope;
  if (scope.tenantId !== ctx.tenantId || scope.agentId !== ctx.agentId || scope.conversationId !== conversationIdOf(ctx.conversation) || scope.contactId !== ctx.conversation.telefonoCliente) {
    return { ok: false, action, error: rejectWith("TENANT_ERROR", "SCOPE_MISMATCH") };
  }

  // Versión: la solicitud se construyó con OTRO artefacto publicado (v17 → v18). No se autoriza con la versión vieja.
  const otherVersion = (request.artifactRef ?? null) !== artifact.executionFingerprint;

  // Autorización: la acción debe estar HABILITADA en el artefacto publicado (capacidad activa con respaldo real del
  // runtime) y, si es de agenda, con el mismo proveedor.
  const entry = Object.prototype.hasOwnProperty.call(artifact.actions, request.action) ? artifact.actions[request.action] : undefined;
  if (!otherVersion) {
    const backing = CAPABILITY_BACKING[def.capability];
    // FASE 8: una acción nativa no está en el respaldo del grafo; la autoriza SOLO su entrada en el artefacto publicado.
    if (!entry || (!def.native && (!backing.available || !backing.actions.includes(request.action as never)))) {
      return { ok: false, action, error: rejectWith("UNAUTHORIZED", "CAPABILITY_DISABLED") };
    }
    if (def.schedulingProvider && artifact.booking?.provider !== def.schedulingProvider) {
      return { ok: false, action, error: rejectWith("UNAUTHORIZED", "SCHEDULING_PROVIDER_MISMATCH") };
    }
  }

  // Estado: la solicitud debe ser EXACTAMENTE la pendiente del estado vigente, y recalcularse igual desde sus slots.
  const pending = ctx.state.pendingAction;
  if (!pending) return { ok: false, action, error: rejectWith("STALE_ACTION_REQUEST", "NO_PENDING_ACTION") };
  if (pending.id !== request.id) return { ok: false, action, error: rejectWith("STALE_ACTION_REQUEST", "SUPERSEDED_BY_NEWER_REQUEST") };
  if (
    stableStringify(operationOf(pending)) !== stableStringify(operationOf(request)) ||
    (pending.artifactRef ?? null) !== (request.artifactRef ?? null) ||
    (pending.simulation === true) !== (request.simulation === true)
  ) {
    return { ok: false, action, error: rejectWith("STALE_ACTION_REQUEST", "REQUEST_DOES_NOT_MATCH_STATE") };
  }
  const expectedStatus = request.purpose === "handoff" ? ["HANDOFF_PENDING", "HANDED_OFF", "PAUSED"] : ["READY_FOR_ACTION", "EXECUTING"];
  if (!expectedStatus.includes(ctx.state.status)) return { ok: false, action, error: rejectWith("INVALID_STATE", `STATE_${ctx.state.status}`) };
  if (otherVersion) {
    // Ya en ejecución: solo se recupera su desenlace. Sin empezar: se re-propone (y se re-confirma) con la versión vigente.
    if (request.status === "executing" && pending.status === "executing") return { ok: true, def, contractVersion: contract.version, mode: "resolve_only" };
    return { ok: false, action, error: rejectWith("STALE_ACTION_REQUEST", "AGENT_VERSION_CHANGED") };
  }
  const rebuilt = buildActionRequest({ state: ctx.state, requirements: { ...requirementsOf(artifact), ...(ctx.simulation ? { simulation: true } : {}) }, action: request.action, purpose: request.purpose, requiresConfirmation: request.requiresConfirmation, confirmationId: request.confirmationId, now: nowIso });
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
  if (def.temporal && (artifact.identity.timezone !== SUPPORTED_SCHEDULING_TIMEZONE || ctx.state.timezone !== SUPPORTED_SCHEDULING_TIMEZONE)) {
    return { ok: false, action, error: rejectWith("BUSINESS_RULE_VIOLATION", "TIMEZONE_NOT_SUPPORTED") };
  }

  // Configuración publicada: cada paso debe tener su configuración compilada en el artefacto (horario, datos, política).
  for (const step of def.steps) {
    if (!entry?.steps[step.action]) return { ok: false, action, error: rejectWith("INTERNAL_ERROR", "AGENT_CONFIGURATION_MISSING") };
  }
  return { ok: true, def, contractVersion: contract.version, mode: "execute" };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Fecha local (YYYY-MM-DD) del negocio para un instante. */
export function businessDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Acciones que operan sobre UNA reserva nueva/movida (fecha y servicio del cliente). */
const BOOKING_SLOT_ACTIONS: ReadonlySet<string> = new Set(["buscar_disponibilidad_nylas_generico", "crear_cita_nylas_generico", "agendar_cita_especialista", "reprogramar_cita_cliente"]);
const SERVICE_ACTIONS: ReadonlySet<string> = new Set(["buscar_disponibilidad_nylas_generico", "crear_cita_nylas_generico", "agendar_cita_especialista"]);

/** Servicio reservable del modelo que nombró el cliente (solo con catálogo en el modelo). */
function bookableService(artifact: CompiledAgentArtifact, name: string | undefined) {
  if (!name) return undefined;
  const wanted = fold(name);
  return artifact.services.find((s) => s.bookable && fold(s.name) === wanted);
}

/**
 * Reglas de negocio del MODELO que el Action Engine aplica antes de tocar la agenda (los handlers existentes no las
 * conocen): anticipación máxima y servicio ofrecido. Nada se ejecuta si fallan.
 */
export function bookingPreconditions(request: ActionRequest, artifact: CompiledAgentArtifact, now: Date): FailureMapping | null {
  const booking = artifact.booking;
  if (!booking || !BOOKING_SLOT_ACTIONS.has(request.action)) return null;
  const fecha = request.arguments.fecha ?? request.constraints.fecha;
  if (booking.maximumAdvanceDays !== null && fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const limit = addDays(businessDate(now, artifact.identity.timezone), booking.maximumAdvanceDays);
    if (fecha > limit) return { code: "BUSINESS_RULE_VIOLATION", reason: "DATE_TOO_FAR", retryable: false, ambiguous: false, invalidSlots: ["date"] };
  }
  if (artifact.catalogAuthority === "model" && SERVICE_ACTIONS.has(request.action) && request.arguments.servicio && !bookableService(artifact, request.arguments.servicio)) {
    return { code: "BUSINESS_RULE_VIOLATION", reason: "SERVICE_NOT_OFFERED", retryable: false, ambiguous: false, invalidSlots: ["service"] };
  }
  return null;
}

/** Datos del modelo que el handler de agenda Nylas recibe: duración del servicio (o la de una reserva sin servicio). */
function modelPayload(request: ActionRequest, artifact: CompiledAgentArtifact, stepAction: string): Record<string, unknown> {
  const booking = artifact.booking;
  if (!booking || booking.provider !== "nylas" || (stepAction !== "crear_cita_nylas_generico" && stepAction !== "buscar_disponibilidad_nylas_generico")) return {};
  const service = bookableService(artifact, request.arguments.servicio);
  return { duracionMin: String(service?.durationMinutes ?? booking.slotDurationMinutes) };
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
      const config = ctx.artifact.actions[request.action]?.steps[step.action] ?? {};
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
        payload: { ...step.buildPayload(request, { userMessage: ctx.userMessage, previous, agentId: ctx.agentId, tone: ctx.artifact.presentation.tone }), ...modelPayload(request, ctx.artifact, step.action) },
        action: { ...config, actionType: step.action } as ActionNodeConfig,
        conversation: ctx.conversation,
      };
      let r: EffectDispatchResult | "timeout";
      try {
        const handler = def.native ? deps.native : deps.handler;
        if (!handler) return { ok: false, failure: rejectWith("INTERNAL_ERROR", "NATIVE_HANDLER_MISSING") };
        r = await withTimeout((signal) => handler(dispatch, signal), def.timeoutMs);
      } catch {
        // Excepción del handler: en una escritura no se sabe si el efecto ocurrió.
        return { ok: false, failure: { code: "EXTERNAL_ERROR", reason: "HANDLER_EXCEPTION", retryable: !unsafeWrite(def), ambiguous: unsafeWrite(def) && isMain, invalidSlots: [] } };
      }
      if (r === "timeout") {
        return { ok: false, failure: { code: "TIMEOUT", reason: isMain ? "ACTION_TIMEOUT" : "PRECHECK_TIMEOUT", retryable: !unsafeWrite(def) || !isMain, ambiguous: unsafeWrite(def) && isMain, invalidSlots: [] } };
      }
      if (!r.success) return { ok: false, failure: def.mapFailure(r, request) };
      const data = (r.data ?? {}) as Record<string, unknown>;
      if (!isMain) {
        Object.assign(previous, data);
        const selection = step.action === "listar_citas_cliente" ? appointmentSelection(previous, request) : null;
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
      log({ tenantId: ctx.tenantId, agentId: ctx.agentId, artifactVersion: ctx.artifact.version.ref, artifactRef: ctx.artifact.executionFingerprint.slice(0, 12), conversationRef, executionId: final.executionId, action: final.action, contractVersion, status: final.status, attempt: final.attempt, durationMs: final.durationMs, errorCode: final.error?.code ?? null, reason: final.error?.reason ?? null, replayed: final.replayed });
      return final;
    };

    const v = validateActionRequest(rawRequest, ctx, clock().toISOString());
    if (!v.ok) return finish(result({ status: "REJECTED", request, action: v.action, executionId: null, attempt: 0, started, now: clock().getTime(), error: v.error }), request?.contractVersion ?? "-");
    const { def, contractVersion, mode } = v;
    const req = request!;

    // Reglas del modelo (anticipación máxima, servicio ofrecido): se rechaza sin ejecutar nada ni reservar la clave.
    if (mode === "execute") {
      const pre = bookingPreconditions(req, ctx.artifact, clock());
      if (pre) return finish(result({ status: "FAILED", request: req, action: req.action, executionId: null, attempt: 0, started, now: clock().getTime(), error: pre }), contractVersion);
    }

    // SIMULACIÓN: una acción con efecto NUNCA llega al handler ni al registro de ejecuciones. Es lo que habría hecho.
    if (ctx.simulation && def.mutation) {
      return finish(result({ status: "SUCCEEDED", request: req, action: req.action, executionId: null, attempt: 0, started, now: clock().getTime(), simulated: true }), contractVersion);
    }

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
        retakeable: mode === "execute" && !unsafeWrite(def),
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

    // Versión cambiada y la ejecución anterior nunca llegó a empezar: se cierra sin ejecutar (la state machine re-propone).
    if (mode === "resolve_only") {
      return complete(result({ status: "REJECTED", request: req, action: req.action, executionId, attempt, started, now: clock().getTime(), error: rejectWith("STALE_ACTION_REQUEST", "AGENT_VERSION_CHANGED") }));
    }

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

    // FASE 9 — límite de escrituras por conversación (bucles / abuso). Solo una ejecución NUEVA cuenta: un replay o una
    // reanudación nunca se bloquea (su resultado ya existe o está en curso).
    if (def.mutation && deps.limiter) {
      const hit = await deps.limiter.hit("conversation_writes", `${ctx.tenantId}:${conversationRef}`);
      if (hit && !hit.allowed) {
        return complete(result({ status: "FAILED", request: req, action: req.action, executionId, attempt, started, now: clock().getTime(), error: rejectWith("RATE_LIMITED", "CONVERSATION_WRITE_LIMIT") }));
      }
    }

    // FASE 9 — circuito de la dependencia externa (por tenant): abierto = falla rápida, sin llamar al proveedor.
    const dependency = dependencyOf(def);
    const breaker = dependency && deps.circuits ? deps.circuits.get(dependency, ctx.tenantId) : null;
    // "skip" = no se llamó al proveedor (circuito abierto): nada que registrar.
    let breakerOutcome: "skip" | "ok" | "fail" = "skip";
    try {
      if (breaker && !breaker.allow(clock().getTime())) {
        return complete(result({ status: "FAILED", request: req, action: req.action, executionId, attempt, started, now: clock().getTime(), error: { code: "EXTERNAL_ERROR", reason: "CIRCUIT_OPEN", retryable: true, ambiguous: false, invalidSlots: [] } }));
      }
      let outcome = await runSteps(def, req, ctx, attempt);
      // Reintentos (política única, retry-policy.ts): solo lo RETRYABLE de acciones que se pueden repetir sin riesgo
      // (lecturas y escrituras idempotentes del store propio); backoff exponencial con jitter y máximo de intentos.
      for (let n = 1; !outcome.ok && (!def.mutation || def.idempotentWrite); n++) {
        const d = retryDecision({ ...RETRY_POLICIES.action_read, maxAttempts: def.retry.maxAttempts, baseDelayMs: def.retry.baseDelayMs }, n, retryClassOf(outcome.failure), deps.random);
        if (!d.retry) break;
        await sleep(d.delayMs);
        outcome = await runSteps(def, req, ctx, attempt);
      }
      breakerOutcome = !outcome.ok && countsAgainstDependency(outcome.failure) ? "fail" : "ok";
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
    } catch (e) {
      breakerOutcome = "fail";
      throw e;
    } finally {
      // Siempre se registra el desenlace (un half-open nunca queda colgado).
      if (breaker && breakerOutcome === "fail") breaker.failure(clock().getTime());
      else if (breaker && breakerOutcome === "ok") breaker.success();
      if (lockKey) {
        try {
          await deps.store.releaseLock({ tenantId: ctx.tenantId, lockKey, holder });
        } catch {
          // El lease vence solo: nunca bloquea para siempre.
        }
      }
    }
  }

  /**
   * FASE 8 — VERIFICA una escritura de desenlace desconocido con una LECTURA al proveedor (nunca escribe, nunca
   * re-ejecuta). found = el efecto existe (p. ej. la cita está en la agenda); not_found = no ocurrió; unknown = no se
   * puede saber (el proveedor falló o la acción no tiene verificación): se deja para una persona.
   */
  async function verifyOutcome(request: ActionRequest, ctx: ActionExecutionContext): Promise<VerificationResult> {
    const def = getActionDefinition(request.action);
    const verifier = def?.verifyOutcome;
    if (!def || !verifier) return { outcome: "unknown", reason: "NO_VERIFIER" };
    if (ctx.state.scope.tenantId !== ctx.tenantId || ctx.state.scope.conversationId !== conversationIdOf(ctx.conversation)) return { outcome: "unknown", reason: "SCOPE_MISMATCH" };
    const config = ctx.artifact.actions[request.action]?.steps[verifier.step.action] ?? {};
    const dispatch: EffectDispatchRequest = {
      effectId: `${request.id}:verify:${verifier.step.action}`,
      executionRowId: `ba-verify:${request.id}`,
      executionLogicalId: `ba-verify:${request.id}`,
      tenantId: ctx.tenantId,
      nodeId: `ba-verify:${verifier.step.action}`,
      kind: "action",
      attempt: 1,
      payload: verifier.step.buildPayload(request, { userMessage: "", previous: {}, agentId: ctx.agentId }),
      action: { ...config, actionType: verifier.step.action } as ActionNodeConfig,
      conversation: ctx.conversation,
    };
    // FASE 9 — la verificación también es una llamada al proveedor: respeta (y alimenta) su circuito.
    const dependency = dependencyOf(def);
    const breaker = dependency && deps.circuits ? deps.circuits.get(dependency, ctx.tenantId) : null;
    if (breaker && !breaker.allow(clock().getTime())) return { outcome: "unknown", reason: "CIRCUIT_OPEN" };
    let r: EffectDispatchResult | "timeout";
    try {
      r = await withTimeout((signal) => deps.handler(dispatch, signal), def.timeoutMs);
    } catch {
      breaker?.failure(clock().getTime());
      return { outcome: "unknown", reason: "VERIFY_EXCEPTION" };
    }
    if (r === "timeout") {
      breaker?.failure(clock().getTime());
      return { outcome: "unknown", reason: "VERIFY_TIMEOUT" };
    }
    const noAppointments = !r.success && /sin_citas/.test(r.error ?? "");
    if (!r.success && !noAppointments && r.classification !== "NON_RETRYABLE") breaker?.failure(clock().getTime());
    else breaker?.success();
    if (!r.success && !noAppointments) return { outcome: "unknown", reason: "VERIFY_FAILED" };
    // "Sin citas" es un dato: para crear = no ocurrió; para cancelar = sí ocurrió (lo decide cada verificador).
    const m = verifier.match(request, noAppointments ? { sinCitas: true } : ((r.data ?? {}) as Record<string, unknown>));
    return m.outcome === "found" ? { outcome: "found", reason: "FOUND", ...(m.booking ? { booking: m.booking } : {}) } : { outcome: m.outcome, reason: m.outcome === "not_found" ? "NOT_FOUND" : "UNDETERMINED" };
  }

  return { execute, verifyOutcome };
}

export type VerificationResult =
  | { outcome: "found"; reason: string; booking?: { appointmentRef: string | null; start: string; service: string | null } }
  | { outcome: "not_found" | "unknown"; reason: string };

export type ActionEngine = ReturnType<typeof createActionEngine>;
