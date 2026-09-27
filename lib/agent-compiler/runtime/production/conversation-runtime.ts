// DuLabs Business — Business Agent 2.0, FASE 4/5 — runtime conversacional (state machine + Action Engine), configurado
// ÚNICAMENTE por el artefacto publicado del Universal Business Model (FASE 5).
//
//   (Gate PRE-LLM ya pasó) → pausa humana → dedupe → Understanding → State Machine → Action Engine → ActionResult
//   → State update → Response Plan → Renderer → WhatsApp
//
// Solo lo usa un Business Agent cuyo tenant está habilitado explícitamente (ver isStateMachineRuntimeEnabled). Para
// todos los demás, el camino del grafo compilado (Flow Engine) sigue exactamente igual.
//
// Garantías de este orquestador (además de las de cada pieza):
//   - Antes de interpretar el mensaje, se resuelve cualquier acción pendiente de un turno anterior (worker caído,
//     reintento): el motor devuelve el resultado ya guardado o el desenlace desconocido; nunca re-ejecuta una escritura.
//   - ACTION_STARTED se registra en el estado DESPUÉS del claim y ANTES de cualquier efecto.
//   - Máximo de acciones por turno acotado (sin bucles).
//   - Solo se envía texto que produce el renderer; nada se envía con una persona a cargo.

import type { CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import {
  applySystemEvent,
  loadTurnView,
  processConversationTurn,
  type ConversationServiceDeps,
  type TurnView,
} from "@/lib/agent-compiler/conversation/service";
import type { ConversationStateKey } from "@/lib/agent-compiler/conversation/store";
import { renderResponse } from "@/lib/agent-compiler/conversation/renderer";
import type { ActionEngine, VerificationResult } from "@/lib/agent-compiler/actions/engine";
import type { ActionRequest } from "@/lib/agent-compiler/conversation/model";
import type { OfferList } from "@/lib/agent-compiler/conversation/transitions";
import { MAX_OFFERED_SLOTS } from "@/lib/agent-compiler/conversation/renderer";
import { stateCategoryFor, type ActionResult } from "@/lib/agent-compiler/actions/result";
import { stateSnapshot } from "@/lib/agent-compiler/conversation/service";
import { classifyActionError, classifyTurnError } from "@/lib/agent-compiler/runtime/production/error-taxonomy";
import { defaultTurnTraceSink, shortHash, understandingTrace, type BusinessAgentTurnTrace, type TurnActionTrace } from "@/lib/agent-compiler/runtime/production/turn-trace";

export const MAX_ACTIONS_PER_TURN = 3;
export const STATE_MACHINE_TENANTS_ENV = "BUSINESS_AGENT_STATE_MACHINE_TENANTS";

/**
 * Activación explícita por tenant (lista separada por comas de UUIDs). Vacía = nadie: el comportamiento de producción no
 * cambia hasta que se habilite un negocio concreto. No existe comodín.
 */
export function isStateMachineRuntimeEnabled(tenantId: string, env: Record<string, string | undefined> = process.env): boolean {
  const raw = env[STATE_MACHINE_TENANTS_ENV] ?? "";
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^[0-9a-f-]{36}$/.test(t))
    .includes(tenantId.toLowerCase());
}

export interface ConversationRuntimeDeps {
  service: ConversationServiceDeps;
  engine: ActionEngine;
  /**
   * Artefacto publicado (FASE 5): lo único que configura este runtime. `service.requirements` y `service.business`
   * deben derivarse de ÉL (artifactRequirements / businessContextFromArtifact); createConversationRuntime lo verifica.
   */
  artifact: CompiledAgentArtifact;
  send(text: string): Promise<void>;
  maxActionsPerTurn?: number;
  /** FASE 6 — vista previa / pruebas: el motor no ejecuta ninguna escritura (ver ActionExecutionContext.simulation). */
  simulation?: boolean;
  /** FASE 7 — traza reconstruible del turno (por defecto, una línea JSON en el log). */
  trace?: (trace: BusinessAgentTurnTrace) => void;
  /** FASE 7 — reloj monotónico para las latencias (inyectable en tests). */
  monotonic?: () => number;
  /**
   * FASE 8 — el recordatorio sigue a la cita: cancelarla lo cancela y reprogramarla lo mueve (ver migración
   * 20261127000000). Ausente = el agente no tiene recordatorios. Nunca se llama en simulación.
   */
  reminders?: ReminderLifecyclePort;
}

export interface ReminderLifecyclePort {
  appointmentCancelled(conversationId: string, anchorRef: string | null): Promise<void>;
  appointmentMoved(conversationId: string, anchorRef: string | null, newStart: string): Promise<void>;
}

const BOOKING_WRITES = new Set(["crear_cita_nylas_generico", "agendar_cita_especialista", "reprogramar_cita_cliente"]);

/** Opciones que el backend le MOSTRÓ al cliente en este resultado (las mismas que numera el renderer). */
function offersOf(result: ActionResult): OfferList | undefined {
  if (result.action === "buscar_disponibilidad_nylas_generico" && result.status === "SUCCEEDED" && Array.isArray(result.data.horariosDisponibles)) {
    const times = (result.data.horariosDisponibles as unknown[]).filter((x): x is string => typeof x === "string" && /^\d{2}:\d{2}$/.test(x)).slice(0, MAX_OFFERED_SLOTS);
    return times.length > 0 ? { slot: "time", options: times.map((t) => ({ value: t, label: t })) } : undefined;
  }
  if (result.error?.reason === "APPOINTMENT_SELECTION_REQUIRED" && Array.isArray(result.data.opciones)) {
    const options = (result.data.opciones as unknown[])
      .filter((o): o is { value: string; label: string } => Boolean(o) && typeof (o as { value?: unknown }).value === "string" && typeof (o as { label?: unknown }).label === "string")
      .slice(0, 10);
    return options.length > 0 ? { slot: "appointment", options } : undefined;
  }
  return undefined;
}

/** Cita creada/movida según el BACKEND (ancla de recordatorios). */
function bookingOf(request: ActionRequest, result: ActionResult): { appointmentRef: string | null; start: string; service: string | null } | undefined {
  if (!BOOKING_WRITES.has(result.action) || result.status !== "SUCCEEDED" || result.simulated) return undefined;
  const start = typeof result.data.inicio === "string" && !Number.isNaN(Date.parse(result.data.inicio)) ? new Date(result.data.inicio).toISOString() : null;
  if (!start) return undefined;
  return { appointmentRef: typeof result.data.citaId === "string" ? result.data.citaId : (request.constraints.cita ?? null), start, service: request.arguments.servicio ?? null };
}

export interface ConversationTurnInput {
  key: ConversationStateKey;
  agentVersion: string | null;
  wamid: string;
  text: string;
  sentAt?: string;
}

export interface ConversationRuntimeOutcome {
  outcome: "processed" | "duplicate" | "human_control" | "rejected";
  status?: string;
  sent: boolean;
  actions: Array<{ action: string; status: string; errorCode: string | null; replayed: boolean; simulated?: boolean }>;
  errorCode?: string;
  /** FASE 7 — la traza del turno (la misma que se registra). */
  trace?: BusinessAgentTurnTrace;
}

/** Opciones de los datos tipo lista publicados (se muestran numeradas al preguntar). */
function selectOptionsOfArtifact(artifact: CompiledAgentArtifact): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const d of artifact.understanding.businessSlots) if (d.kind === "select" && d.options?.length) out[d.name] = d.options;
  return out;
}

export function createConversationRuntime(deps: ConversationRuntimeDeps) {
  const maxActions = deps.maxActionsPerTurn ?? MAX_ACTIONS_PER_TURN;
  // Una sola fuente: requisitos y contexto de entendimiento del MISMO artefacto (misma huella, mismo tenant y agente).
  if (deps.service.requirements.artifactRef !== deps.artifact.executionFingerprint || deps.service.business.tenantId !== deps.artifact.tenantId || deps.service.business.agentId !== deps.artifact.agentId) {
    throw new Error("conversation_runtime_artifact_mismatch");
  }
  // Los requisitos de una simulación marcan cada solicitud; los de producción nunca.
  if ((deps.service.requirements.simulation === true) !== (deps.simulation === true)) throw new Error("conversation_runtime_simulation_mismatch");

  const mono = deps.monotonic ?? (() => performance.now());
  /** Reloj de los eventos del sistema: el MISMO del servicio conversacional (tests y producción coherentes). */
  const nowIso = () => (deps.service.clock?.() ?? new Date()).toISOString();
  const sink = deps.trace ?? defaultTurnTraceSink;

  /** Ejecuta la acción pendiente de la vista y aplica su resultado al estado. Devuelve la vista nueva. */
  async function drive(key: ConversationStateKey, agentVersion: string | null, view: TurnView, userMessage: string, results: ActionResult[], traces: TurnActionTrace[]): Promise<TurnView | null> {
    const request = view.actionRequest ?? view.state.pendingAction;
    if (!request) return null;
    const result = await deps.engine.execute(
      request,
      {
        tenantId: key.tenantId,
        agentId: key.agentId,
        agentVersion,
        conversation: { phoneNumberId: key.phoneNumberId, telefonoCliente: key.telefonoCliente },
        artifact: deps.artifact,
        state: view.state,
        userMessage,
        ...(deps.simulation ? { simulation: true } : {}),
      },
      {
        beforeExecute: async (executionId, attempt) => {
          const started = await applySystemEvent(deps.service, key, { type: "ACTION_STARTED", eventId: `${request.id}:started:${attempt}`, at: nowIso(), actionId: request.id });
          return started.outcome === "processed" || started.outcome === "duplicate";
        },
      },
    );
    results.push(result);
    traces.push({
      action: result.action,
      purpose: request.purpose,
      requestRef: shortHash(request.id),
      status: result.status,
      errorCode: result.error?.code ?? null,
      reason: result.error?.reason ?? null,
      simulated: result.simulated === true,
      replayed: result.replayed,
      durationMs: result.durationMs,
      ...(result.error ? { baError: classifyActionError(result.error).code } : {}),
    });
    // Otra ejecución está en curso (otro worker): no se toca el estado; ese worker aplicará el resultado.
    if (result.status === "IN_PROGRESS") return null;
    const eventId = `${request.id}:result:${result.executionId ?? "rejected"}:${result.attempt}`;
    const offers = offersOf(result);
    const booking = bookingOf(request, result);
    const focusProduct = result.action === "ba_consultar_producto" && result.status === "SUCCEEDED" && typeof result.data.productoNombre === "string" ? result.data.productoNombre : undefined;
    const applied =
      result.status === "SUCCEEDED"
        ? await applySystemEvent(deps.service, key, { type: "ACTION_SUCCEEDED", eventId, at: nowIso(), actionId: request.id, ...(offers ? { offers } : {}), ...(booking ? { booking } : {}), ...(focusProduct ? { focusProduct } : {}) })
        : await applySystemEvent(deps.service, key, { type: "ACTION_FAILED", eventId, at: nowIso(), actionId: request.id, category: stateCategoryFor(result.error!, { replayed: result.replayed }), invalidSlots: result.invalidSlots, ambiguous: result.error!.ambiguous, ...(offers ? { offers } : {}) });
    // FASE 8 — el recordatorio sigue a la cita (solo en producción y con un resultado real, no un replay de otra vuelta).
    if (deps.reminders && !deps.simulation && result.status === "SUCCEEDED" && !result.simulated && !result.replayed) {
      const conversationId = view.state.scope.conversationId;
      try {
        if (result.action === "cancelar_cita_cliente") await deps.reminders.appointmentCancelled(conversationId, request.constraints.cita ?? null);
        if (result.action === "reprogramar_cita_cliente" && booking) await deps.reminders.appointmentMoved(conversationId, request.constraints.cita ?? null, booking.start);
      } catch {
        // Un recordatorio que no se pudo ajustar NUNCA revierte la cancelación/reprogramación (ya ocurrió). Queda en la traza.
        traces.push({ action: "reminder_lifecycle", purpose: request.purpose, requestRef: shortHash(request.id), status: "FAILED", errorCode: "EXTERNAL_ERROR", reason: "REMINDER_LIFECYCLE_FAILED", simulated: false, replayed: false, durationMs: 0 });
      }
    }
    if (applied.outcome === "processed" || applied.outcome === "duplicate") return applied;
    // La solicitud ya no era la vigente (p. ej. STALE): se relee el estado actual.
    return loadTurnView(deps.service, key);
  }

  async function handle(input: ConversationTurnInput): Promise<ConversationRuntimeOutcome> {
    const t0 = mono();
    const results: ActionResult[] = [];
    const actionTraces: TurnActionTrace[] = [];
    let understandingMs = 0;
    let actionsMs = 0;
    const summary = () => results.map((r) => ({ action: r.action, status: r.status, errorCode: r.error?.code ?? null, replayed: r.replayed, ...(r.simulated ? { simulated: true } : {}) }));
    const service = {
      ...deps.service,
      understand: async (u: Parameters<typeof deps.service.understand>[0]) => {
        const s0 = mono();
        try {
          return await deps.service.understand(u);
        } finally {
          understandingMs += mono() - s0;
        }
      },
    };
    const emit = (outcome: ConversationRuntimeOutcome, extra: { understanding?: BusinessAgentTurnTrace["understanding"]; before?: BusinessAgentTurnTrace["stateBefore"]; after?: BusinessAgentTurnTrace["stateAfter"]; planIntent?: string | null; text?: string | null; responseMs?: number; stateMs?: number }): ConversationRuntimeOutcome => {
      const total = mono() - t0;
      const trace: BusinessAgentTurnTrace = {
        event: "business_agent.turn",
        messageId: input.wamid,
        tenantId: input.key.tenantId,
        agentId: input.key.agentId,
        publishedVersion: input.agentVersion ?? deps.artifact.version.ref,
        artifactFingerprint: deps.artifact.executionFingerprint,
        simulation: deps.simulation === true,
        outcome: outcome.outcome,
        understanding: extra.understanding ?? null,
        stateBefore: extra.before ?? null,
        stateAfter: extra.after ?? null,
        actions: actionTraces,
        response: { planIntent: extra.planIntent ?? null, sent: outcome.sent, chars: extra.text?.length ?? 0, textHash: extra.text ? shortHash(extra.text, 16) : null },
        latencyMs: {
          understanding: Math.round(understandingMs),
          state: Math.round(Math.max(0, extra.stateMs ?? 0)),
          actions: Math.round(actionsMs),
          response: Math.round(extra.responseMs ?? 0),
          total: Math.round(total),
        },
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
        ...(() => {
          const ba = [...(outcome.errorCode ? [classifyTurnError(outcome.errorCode).code] : []), ...actionTraces.map((a) => a.baError).filter((x): x is string => Boolean(x))];
          return ba.length > 0 ? { baErrors: [...new Set(ba)] } : {};
        })(),
        at: nowIso(),
      };
      try {
        sink(trace);
      } catch {
        // La observabilidad nunca rompe el turno.
      }
      return { ...outcome, trace };
    };

    // 0. Acción pendiente de un turno anterior (reintento / worker caído): se resuelve primero.
    const a0 = mono();
    const before = await loadTurnView(deps.service, input.key);
    if (before?.state.pendingAction && (before.state.status === "READY_FOR_ACTION" || before.state.status === "EXECUTING")) {
      await drive(input.key, input.agentVersion, before, input.text, results, actionTraces);
    }
    // 0b. FASE 8 — escritura de desenlace DESCONOCIDO: antes de conversar, se VERIFICA con el proveedor (lectura) si
    //     ocurrió. Existe → completada (nunca se repite); no existe → se puede re-proponer como operación nueva.
    let verification: (VerificationResult & { start?: string }) | null = null;
    const unresolved = before?.state.unresolvedAction;
    if (before && unresolved && before.state.status === "ERROR" && !deps.simulation && deps.engine.verifyOutcome) {
      const v = await deps.engine.verifyOutcome(unresolved, {
        tenantId: input.key.tenantId,
        agentId: input.key.agentId,
        agentVersion: input.agentVersion,
        conversation: { phoneNumberId: input.key.phoneNumberId, telefonoCliente: input.key.telefonoCliente },
        artifact: deps.artifact,
        state: before.state,
        userMessage: "",
      });
      actionTraces.push({ action: `verify:${unresolved.action}`, purpose: unresolved.purpose, requestRef: shortHash(unresolved.id), status: v.outcome === "unknown" ? "FAILED" : "SUCCEEDED", errorCode: v.outcome === "unknown" ? "OUTCOME_UNKNOWN" : null, reason: `VERIFY_${v.outcome.toUpperCase()}:${v.reason}`.slice(0, 60), simulated: false, replayed: false, durationMs: 0 });
      if (v.outcome !== "unknown") {
        const applied = await applySystemEvent(deps.service, input.key, {
          type: "OUTCOME_VERIFIED",
          eventId: `${unresolved.id}:verified:${input.wamid}`,
          at: nowIso(),
          actionId: unresolved.id,
          found: v.outcome === "found",
          ...(v.outcome === "found" && v.booking ? { booking: v.booking } : {}),
          messageId: input.wamid,
        });
        if (applied.outcome === "processed") verification = { ...v, ...(v.outcome === "found" && v.booking ? { start: v.booking.start } : {}) };
      }
    }
    actionsMs += mono() - a0;

    // El turno de la verificación SOLO informa lo verificado (+ la propuesta nueva si no ocurrió): el mensaje quedó
    // consumido y no se interpreta (un "sí" viejo nunca confirma una propuesta que el cliente no ha visto).
    if (verification) {
      const current = await loadTurnView(deps.service, input.key);
      if (current) {
        const text = renderResponse({
          plan: current.responsePlan,
          state: current.state,
          actions: [],
          businessName: deps.artifact.identity.name,
          questions: deps.artifact.questions,
          offerHandoff: deps.artifact.policies.offerHandoff,
          tone: deps.artifact.presentation.tone,
          locale: deps.artifact.presentation.locale,
          currency: deps.artifact.identity.currency,
          verification,
        });
        if (text) await deps.send(text);
        return emit(
          { outcome: "processed", status: current.state.status, sent: Boolean(text), actions: summary() },
          { before: before ? stateSnapshot(before.state, before.version) : null, after: stateSnapshot(current.state, current.version), planIntent: current.responsePlan.intent, text },
        );
      }
    }

    // 1. Mensaje → entendimiento → (entidades del negocio) → estado.
    const p0 = mono();
    const turn = await processConversationTurn(service, { key: input.key, agentVersion: input.agentVersion, eventId: input.wamid, text: input.text, sentAt: input.sentAt });
    const stateMs = mono() - p0 - understandingMs;
    if (turn.outcome === "rejected") return emit({ outcome: "rejected", sent: false, actions: summary(), errorCode: turn.error.code }, { stateMs, before: before ? stateSnapshot(before.state, before.version) : null });
    if (turn.outcome === "duplicate") return emit({ outcome: "duplicate", status: turn.state.status, sent: false, actions: summary() }, { stateMs, after: stateSnapshot(turn.state, turn.version) });
    const understood = turn.outcome === "processed" ? turn.understanding : undefined;
    const understandingFailed = understood?.ok === false;

    // 2. Acciones que el backend decidió (acotadas por turno). Si el mensaje NO se pudo interpretar, no se ejecuta
    //    NADA en este turno: el estado se conservó y la respuesta lo dice.
    let current: TurnView = turn;
    const a1 = mono();
    for (let i = 0; i < maxActions && current.actionRequest && !understandingFailed; i++) {
      const next = await drive(input.key, input.agentVersion, current, input.text, results, actionTraces);
      if (!next) break;
      current = next;
    }
    actionsMs += mono() - a1;
    const base = {
      stateMs,
      understanding: understandingTrace(understood),
      before: turn.outcome === "processed" ? (turn.stateBefore ?? null) : null,
      after: stateSnapshot(current.state, current.version),
      planIntent: current.responsePlan.intent,
    };

    if (turn.outcome === "human_control" && current.responsePlan.intent === "NO_RESPONSE") {
      return emit({ outcome: "human_control", status: current.state.status, sent: false, actions: summary() }, base);
    }

    // 3. Plan → texto (determinista; hechos solo del backend) → WhatsApp.
    const r0 = mono();
    const text = renderResponse({
      plan: current.responsePlan,
      state: current.state,
      actions: results,
      businessName: deps.artifact.identity.name,
      questions: deps.artifact.questions,
      handoffMessage: deps.artifact.handoff.message,
      noAnswerMessage: deps.artifact.knowledge.noAnswerMessage,
      offerHandoff: deps.artifact.policies.offerHandoff,
      handoffAvailable: deps.artifact.requirements.handoff.supported,
      tone: deps.artifact.presentation.tone,
      locale: deps.artifact.presentation.locale,
      currency: deps.artifact.identity.currency,
      selectOptions: selectOptionsOfArtifact(deps.artifact),
      ...(turn.outcome === "processed" && turn.facts ? { facts: turn.facts } : {}),
      ...(verification ? { verification } : {}),
      ...(understandingFailed ? { understandingFailed: true } : {}),
      ...(deps.simulation ? { simulation: true } : {}),
    });
    let sent = false;
    if (text) {
      await deps.send(text);
      sent = true;
    }
    return emit(
      { outcome: turn.outcome === "human_control" ? "human_control" : "processed", status: current.state.status, sent, actions: summary(), ...(understandingFailed && understood && !understood.ok ? { errorCode: understood.code } : {}) },
      { ...base, text, responseMs: mono() - r0 },
    );
  }

  return { handle };
}

export type ConversationRuntime = ReturnType<typeof createConversationRuntime>;
