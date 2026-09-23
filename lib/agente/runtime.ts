/**
 * RUNTIME DEL AGENTE — un turno de conversación.
 *
 *   mensaje -> estado (memoria estructurada) -> contexto por capas
 *     -> [modelo -> ¿herramientas? -> backend valida y ejecuta -> resultado -> modelo]* (acotado)
 *     -> anclaje de la respuesta -> ¿una asesora tomó el chat? -> envío -> estado (CAS) -> traza
 *
 * El runtime NO conoce a Gemini: usa el contrato AIProvider. El proveedor y
 * el modelo vienen de la configuración explícita (sin default ni fallback).
 *
 * La IA interpreta y conversa; todo dato comercial sale de las herramientas;
 * toda escritura la hace el motor de pedidos; tenant, canal y conversación
 * los fija este runtime a partir del webhook.
 */
import { randomUUID } from "node:crypto";
import { formatCop } from "@/lib/business-agent-quote";
import { extractReferences } from "@/lib/catalogo/resolucion";
import { publicView, type OrderChannel, type OrderPublicView } from "@/lib/catalogo/pedidos/contrato";
import { OrderError, nextStepOf } from "@/lib/catalogo/pedidos/motor";
import { contactRef } from "@/lib/catalogo/pedidos/log";
import { AIProviderError, type AIGenerateResult, type AIProvider, type AITurn } from "@/lib/ia-proveedores/contrato";
import { generateWithRetry } from "@/lib/ia-proveedores/reintentos";
import { addCustomerEvidence, addEvidence, checkGrounding, emptyEvidence, type Evidence, type GroundingViolation } from "@/lib/agente/anclaje";
import type { AgentRuntimeConfig } from "@/lib/agente/config";
import { HISTORY_MAX_TURNS, HISTORY_WINDOW_MS, buildSystemInstruction, historyTurns, type HistoryStore, type TurnFacts } from "@/lib/agente/contexto";
import { rememberReferences, type ConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import { agentToolDeclarations, executeAgentTool, toolKind, type AgentToolsDeps, type AgentTurnToolContext, type QueuedImage } from "@/lib/agente/herramientas";
import type { AgentToolName } from "@/lib/agente/nombres-herramientas";

export interface AgentSender {
  sendText(text: string): Promise<boolean>;
  sendImage(image: QueuedImage): Promise<boolean>;
  /** ¿Una asesora tomó el chat mientras el agente pensaba? (última barrera antes de enviar) */
  humanTookOver(): Promise<boolean>;
}

export interface AgentLimits {
  maxRounds: number;
  maxToolCalls: number;
  maxWrites: number;
  turnDeadlineMs: number;
  modelTimeoutMs: number;
  maxOutputTokens: number;
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxRounds: 4,
  maxToolCalls: 8,
  maxWrites: 1,
  turnDeadlineMs: 45_000,
  modelTimeoutMs: 15_000,
  maxOutputTokens: 1_024,
};

export interface AgentRuntimeDeps {
  config: AgentRuntimeConfig;
  provider: AIProvider;
  model: string;
  tools: AgentToolsDeps;
  state: ConversationStateStore;
  history: HistoryStore;
  sender: AgentSender;
  limits?: Partial<AgentLimits>;
  log?: (trace: AgentTurnTrace) => void;
  now?: () => number;
  retry?: { sleep?: (ms: number) => Promise<void>; random?: () => number };
}

export interface AgentTurnInput {
  tenantId: string;
  phoneNumberId: string;
  waId: string;
  wamid: string;
  text: string;
  requestId?: string;
}

export type AgentTurnOutcome = "replied" | "handoff" | "fallback" | "preempted" | "safety";

export interface AgentTurnTrace {
  log: "agent_turn";
  request_id: string;
  business_id: string;
  contact_ref: string;
  turn: number;
  provider: string;
  model: string;
  outcome: AgentTurnOutcome;
  rounds: number;
  tool_calls: Array<{ name: string; result: string; ms: number; args: Record<string, unknown> }>;
  usage: { input: number; output: number; thinking: number; cached: number };
  latency_ms: number;
  retries: number;
  grounding: { violations: GroundingViolation["kind"][]; corrected: boolean };
  order_id: string | null;
  images: number;
  error_kind: string | null;
  state_saved: boolean;
}

// Mensajes FIJOS (sin IA): nunca afirman datos comerciales.
export const FALLBACK_MESSAGES = {
  technical: "Disculpa, tuve un inconveniente para responderte. ¿Me lo escribes de nuevo en un momento?",
  handoff: "Te comunico con una asesora para ayudarte mejor. En breve te escribe.",
  safety: "Disculpa, con eso no puedo ayudarte por aquí. ¿Te ayudo con algo de nuestro catálogo?",
  unverified: "Disculpa, no pude verificar esa información en el catálogo. ¿Me confirmas la referencia o el producto que buscas?",
} as const;

const CORRECTION = (v: GroundingViolation[]) =>
  `[VERIFICACIÓN DEL SISTEMA] Tu respuesta incluye datos que no vienen de las herramientas (${v
    .map((x) => x.value)
    .slice(0, 5)
    .join(", ")}). Reescríbela usando SOLO referencias, precios y cantidades devueltos por las herramientas, o consulta la herramienta que corresponda. No menciones esta verificación.`;

/** Resumen SEGURO de argumentos: referencias, cantidades y números; de los textos libres solo el largo. */
export function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {}).slice(0, 10)) {
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = /^[A-Z]{1,6}-\d{6,}$|^DL-ORD-[0-9A-Z]{6}$/.test(v.toUpperCase()) || /^cf_[0-9a-z]{16}$/.test(v) ? v.slice(0, 24) : `<text:${v.length}>`;
    else if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => (typeof x === "object" && x ? summarizeArgs(x as Record<string, unknown>) : typeof x === "string" ? (/^[A-Z]{1,6}-\d{6,}$/i.test(x) ? x : `<text:${x.length}>`) : x));
    else out[k] = typeof v;
  }
  return out;
}

function channelFor(config: AgentRuntimeConfig, activeOrder: OrderPublicView | null): { channel: OrderChannel; source: "number_config" | "catalog_request" } {
  if (config.channel === "wholesale") return { channel: "wholesale", source: "number_config" };
  // Mayorista solo si la conversación trae una solicitud FIRMADA del link mayorista (verificada por el backend).
  if (activeOrder?.channel === "wholesale" && !["completed", "cancelled", "expired"].includes(activeOrder.status)) return { channel: "wholesale", source: "catalog_request" };
  return { channel: "retail", source: "number_config" };
}

export async function runAgentTurn(deps: AgentRuntimeDeps, input: AgentTurnInput): Promise<{ outcome: AgentTurnOutcome; reply: string | null; trace: AgentTurnTrace }> {
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const now = deps.now ?? Date.now;
  const started = now();
  const deadlineAt = started + limits.turnDeadlineMs;
  const requestId = input.requestId ?? randomUUID();
  const key = { tenantId: input.tenantId, phoneNumberId: input.phoneNumberId, waId: input.waId };
  const contact = { phoneNumberId: input.phoneNumberId, waId: input.waId };
  const allowed = deps.config.tools;

  const trace: AgentTurnTrace = {
    log: "agent_turn",
    request_id: requestId,
    business_id: input.tenantId,
    contact_ref: contactRef(input.waId),
    turn: 0,
    provider: deps.provider.id,
    model: deps.model,
    outcome: "fallback",
    rounds: 0,
    tool_calls: [],
    usage: { input: 0, output: 0, thinking: 0, cached: 0 },
    latency_ms: 0,
    retries: 0,
    grounding: { violations: [], corrected: false },
    order_id: null,
    images: 0,
    error_kind: null,
    state_saved: false,
  };
  const finish = (outcome: AgentTurnOutcome, reply: string | null) => {
    trace.outcome = outcome;
    trace.latency_ms = now() - started;
    deps.log?.(trace);
    return { outcome, reply, trace };
  };

  // Seguridad de configuración (defensa en profundidad: el webhook ya resolvió el negocio).
  if (deps.config.tenantId !== input.tenantId || deps.config.phoneNumberId !== input.phoneNumberId || deps.provider.id !== deps.config.provider) {
    trace.error_kind = "config_mismatch";
    return finish("fallback", null);
  }

  // 1) Memoria estructurada.
  let loaded: Awaited<ReturnType<ConversationStateStore["load"]>>;
  try {
    loaded = await deps.state.load(key);
  } catch {
    trace.error_kind = "state_unavailable";
    const sent = await deps.sender.sendText(FALLBACK_MESSAGES.technical).catch(() => false);
    return finish("fallback", sent ? FALLBACK_MESSAGES.technical : null);
  }
  let state: ConversationState = { ...loaded.state, turn: loaded.state.turn + 1, lastInteractionAt: new Date(now()).toISOString() };
  trace.turn = state.turn;
  state = rememberReferences(state, extractReferences(input.text), "customer");

  // 2) Hechos confiables del turno (pedido activo desde el motor).
  let activeOrder: (OrderPublicView & { next_step: string }) | null = null;
  try {
    const o = await deps.tools.engine.getOrder({ tenantId: input.tenantId, contact, requestId });
    activeOrder = { ...publicView(o), next_step: nextStepOf(o) };
  } catch (err) {
    if (!(err instanceof OrderError)) trace.error_kind = "order_lookup_failed";
  }
  // Propuesta creada fuera del agente (p. ej. la solicitud del catálogo reclamada por el webhook).
  if (activeOrder?.status === "pending_confirmation" && activeOrder.confirmation && state.proposal?.confirmationId !== activeOrder.confirmation.id) {
    state = { ...state, activeOrderId: activeOrder.order_id, proposal: { orderId: activeOrder.order_id, confirmationId: activeOrder.confirmation.id, presentedTurn: null } };
  }
  if (activeOrder && activeOrder.status !== "pending_confirmation" && state.proposal?.orderId === activeOrder.order_id) state = { ...state, proposal: null };
  const { channel, source } = channelFor(deps.config, activeOrder);
  state = { ...state, channel: { value: channel, source } };

  const customerName = deps.tools.customerName ? await deps.tools.customerName(key).catch(() => null) : null;
  const facts: TurnFacts = { channel, channelSource: source, customerName, activeOrder, handoffActive: false };

  const evidence: Evidence = emptyEvidence();
  addCustomerEvidence(input.text, evidence);
  addEvidence(activeOrder, evidence);
  for (const k of state.known) evidence.refs.add(k.reference);
  for (const c of state.cart) evidence.numbers.add(c.quantity);

  // 3) Contexto por capas.
  const rows = await deps.history.recent({ phoneNumberId: input.phoneNumberId, waId: input.waId, sinceIso: new Date(now() - HISTORY_WINDOW_MS).toISOString(), limit: HISTORY_MAX_TURNS * 2 + 4 });
  const turns: AITurn[] = [...historyTurns(rows, { excludeWamid: input.wamid }), { role: "user", text: input.text }];
  const declarations = agentToolDeclarations(allowed);

  const ctx: AgentTurnToolContext = {
    tenantId: input.tenantId,
    phoneNumberId: input.phoneNumberId,
    waId: input.waId,
    channel,
    requestId,
    wamid: input.wamid,
    turn: state.turn,
    state,
    pendingChoice: new Set(),
    images: [],
    handedOff: false,
    newProposal: null,
  };

  let writes = 0;
  let toolCalls = 0;
  let reply: string | null = null;
  let failure: "technical" | "safety" | "unverified" | null = null;
  let corrected = false;
  let forceText = false;

  const call = async (toolMode: "auto" | "none"): Promise<AIGenerateResult> => {
    trace.rounds++;
    const r = await generateWithRetry(
      deps.provider,
      {
        model: deps.model,
        system: buildSystemInstruction(deps.config, ctx.state, facts),
        turns,
        tools: declarations,
        toolMode,
        maxOutputTokens: limits.maxOutputTokens,
        ...(deps.config.thinking ? { thinking: deps.config.thinking } : {}),
        timeoutMs: limits.modelTimeoutMs,
      },
      { deadlineAt, now, sleep: deps.retry?.sleep, random: deps.retry?.random, onRetry: () => trace.retries++ },
    );
    trace.model = r.model;
    trace.usage.input += r.usage.inputTokens ?? 0;
    trace.usage.output += r.usage.outputTokens ?? 0;
    trace.usage.thinking += r.usage.thinkingTokens ?? 0;
    trace.usage.cached += r.usage.cachedTokens ?? 0;
    return r;
  };

  // 4) Bucle de herramientas (acotado).
  try {
    for (let round = 0; round < limits.maxRounds + 2 && reply === null && failure === null; round++) {
      const lastChance = round >= limits.maxRounds || forceText;
      const r = await call(lastChance ? "none" : "auto");
      if (r.finish === "safety") {
        failure = "safety";
        break;
      }
      if (r.toolCalls.length > 0 && !lastChance) {
        turns.push({ role: "model", text: r.text, toolCalls: r.toolCalls, continuation: r.continuation });
        const results = [];
        for (const tc of r.toolCalls) {
          const t0 = now();
          let outcome;
          if (toolCalls >= limits.maxToolCalls) {
            outcome = { ok: false as const, error: { code: "TOOL_LIMIT" as const, message: "Se alcanzó el límite de consultas de este mensaje. Responde con lo que ya tienes." } };
          } else if ((allowed as readonly string[]).includes(tc.name) && toolKind(tc.name as AgentToolName) === "write" && writes >= limits.maxWrites) {
            outcome = { ok: false as const, error: { code: "TOOL_LIMIT" as const, message: "Solo se permite una acción sobre pedidos por mensaje." } };
          } else {
            toolCalls++;
            if ((allowed as readonly string[]).includes(tc.name) && toolKind(tc.name as AgentToolName) === "write") writes++;
            outcome = await executeAgentTool(tc.name, tc.args, allowed, ctx, deps.tools);
          }
          trace.tool_calls.push({ name: tc.name.slice(0, 40), result: outcome.ok ? "ok" : outcome.error.code, ms: now() - t0, args: summarizeArgs(tc.args) });
          const output = outcome.ok ? outcome.data : { error: outcome.error };
          addEvidence(output, evidence);
          results.push({ callId: tc.id, name: tc.name, output });
        }
        for (const k of ctx.state.known) evidence.refs.add(k.reference);
        turns.push({ role: "tool", results });
        if (ctx.handedOff) forceText = true;
        continue;
      }
      if (r.finish === "invalid_output" || !r.text) {
        failure = "technical";
        trace.error_kind = `model_${r.finish}`;
        break;
      }
      const check = checkGrounding(r.text, evidence);
      if (check.ok) {
        reply = r.text;
        break;
      }
      trace.grounding.violations.push(...check.violations.map((v) => v.kind));
      if (corrected) {
        failure = "unverified";
        break;
      }
      corrected = true;
      trace.grounding.corrected = true;
      turns.push({ role: "model", text: r.text, toolCalls: [], continuation: r.continuation });
      turns.push({ role: "user", text: CORRECTION(check.violations) });
    }
    if (reply === null && failure === null) failure = "technical";
  } catch (err) {
    failure = "technical";
    trace.error_kind = err instanceof AIProviderError ? err.kind : "runtime_error";
  }

  // 5) Fallos: mensaje fijo; dos fallos técnicos seguidos => asesora.
  let outcome: AgentTurnOutcome = ctx.handedOff ? "handoff" : "replied";
  if (failure) {
    ctx.state = { ...ctx.state, failures: Math.min(10, ctx.state.failures + (failure === "safety" ? 0 : 1)) };
    if (failure === "safety") {
      reply = FALLBACK_MESSAGES.safety;
      outcome = "safety";
    } else if (ctx.state.failures >= 2 && !ctx.handedOff) {
      try {
        await deps.tools.engine.requestHandoff({ tenantId: input.tenantId, contact, reason: "El asistente no pudo responder (fallas repetidas)", actor: "system", requestId });
        reply = FALLBACK_MESSAGES.handoff;
        outcome = "handoff";
      } catch {
        reply = FALLBACK_MESSAGES.technical;
        outcome = "fallback";
      }
    } else {
      reply = failure === "unverified" ? FALLBACK_MESSAGES.unverified : FALLBACK_MESSAGES.technical;
      outcome = "fallback";
    }
    ctx.images = [];
  } else {
    ctx.state = { ...ctx.state, failures: 0 };
  }

  // 6) Última barrera: si una asesora tomó el chat mientras tanto, el agente NO envía nada.
  if (!ctx.handedOff && outcome !== "handoff" && (await deps.sender.humanTookOver().catch(() => false))) {
    trace.state_saved = await deps.state.save(key, ctx.state, loaded.version).catch(() => false);
    return finish("preempted", null);
  }

  const sent = reply ? await deps.sender.sendText(reply).catch(() => false) : false;
  if (sent && !failure) {
    // La propuesta cuenta como MOSTRADA solo si el mensaje enviado lleva su total exacto.
    const p = ctx.state.proposal;
    const total = ctx.newProposal?.orderId === p?.orderId ? ctx.newProposal?.total : activeOrder?.confirmation?.id === p?.confirmationId ? activeOrder?.confirmation?.total : undefined;
    if (p && p.presentedTurn === null && total !== undefined && reply?.includes(formatCop(total))) {
      ctx.state = { ...ctx.state, proposal: { ...p, presentedTurn: ctx.turn } };
    }
    if (ctx.state.ambiguity && ctx.state.ambiguity.createdTurn === ctx.turn) ctx.state = { ...ctx.state, ambiguity: { ...ctx.state.ambiguity, presentedTurn: ctx.turn } };
    for (const img of ctx.images) if (await deps.sender.sendImage(img).catch(() => false)) trace.images++;
  }
  trace.order_id = ctx.state.activeOrderId;
  trace.state_saved = await deps.state.save(key, ctx.state, loaded.version).catch(() => false);
  return finish(outcome, sent ? reply : null);
}
