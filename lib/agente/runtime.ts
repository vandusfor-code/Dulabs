/**
 * RUNTIME DEL AGENTE — un turno de conversación.
 *
 *   mensaje -> ¿ya atendido (reintento de Meta)? -> ¿una asesora tiene el chat?
 *     -> estado (memoria estructurada) -> foto citada (registro de fotos) + selección determinista
 *     -> contexto por capas
 *     -> [modelo -> ¿herramientas? -> backend valida y ejecuta -> resultado -> modelo]* (acotado)
 *     -> anclaje de la respuesta -> ¿una asesora tomó el chat? -> envío (texto y fotos, cada foto
 *        registrada con su wamid) -> estado (CAS) -> traza
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
import { createResolucionCatalogo, extractReferences } from "@/lib/catalogo/resolucion";
import { publicView, type OrderChannel, type OrderPublicView } from "@/lib/catalogo/pedidos/contrato";
import { OrderError, nextStepOf } from "@/lib/catalogo/pedidos/motor";
import { contactRef } from "@/lib/catalogo/pedidos/log";
import { AIProviderError, type AIGenerateResult, type AIProvider, type AITurn } from "@/lib/ia-proveedores/contrato";
import { generateWithRetry } from "@/lib/ia-proveedores/reintentos";
import { addCustomerEvidence, addEvidence, checkGrounding, emptyEvidence, type Evidence, type GroundingViolation } from "@/lib/agente/anclaje";
import type { AgentRuntimeConfig } from "@/lib/agente/config";
import { HISTORY_MAX_TURNS, HISTORY_WINDOW_MS, buildSystemInstruction, historyTurns, type HistoryStore, type ReplyContext, type TurnFacts } from "@/lib/agente/contexto";
import { MAX_IMAGES_REMEMBERED, MAX_RECENT_WAMIDS, rememberReferences, type ConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import type { ProductMediaLedger } from "@/lib/agente/medios";
import { resolveSelection } from "@/lib/agente/seleccion";
import { STAGE_GUIDANCE, conversationStage, type ConversationStage } from "@/lib/agente/etapa";
import { decideLimits, type UsageReader } from "@/lib/agente/limites";
import { asksForHuman, detectIntent, type HandoffMotive, type SystemHandoffMotive, type TurnIntent } from "@/lib/agente/intencion";
import { agentToolDeclarations, executeAgentTool, toolKind, type AgentToolsDeps, type AgentTurnToolContext, type QueuedImage } from "@/lib/agente/herramientas";
import type { AgentToolName } from "@/lib/agente/nombres-herramientas";
import { NON_TEXT_MESSAGES, NON_TEXT_NOTICE_COOLDOWN_MS, nonTextPolicy, type NonTextAction, type NonTextKind } from "@/lib/agente/entrada";
import {
  CHANNEL_LABEL,
  CHANNEL_QUESTION,
  CLASSIFICATION_MESSAGES,
  DEFAULT_WELCOME,
  parseChannelChoice,
  type CustomerChannel,
  type CustomerChannelOrigin,
  type CustomerChannelStore,
} from "@/lib/agente/clasificacion";

/**
 * Resultado de un envío: true/false o, con detalle, el wamid que asignó Meta (necesario para
 * registrar fotos) y, si falló, el motivo sin datos sensibles (p. ej. "meta_rejected 400/131053").
 */
export type SendOutcome = boolean | { sent: boolean; wamid: string | null; error?: string | null };

function sendResult(r: SendOutcome): { sent: boolean; wamid: string | null; error: string | null } {
  return typeof r === "boolean" ? { sent: r, wamid: null, error: null } : { sent: r.sent, wamid: r.sent ? r.wamid : null, error: r.sent ? null : (r.error ?? null) };
}

export interface AgentSender {
  sendText(text: string): Promise<SendOutcome>;
  sendImage(image: QueuedImage): Promise<SendOutcome>;
  /** Mensaje con botones de respuesta (Bloque 25: pregunta detal / por mayor). Sin él, la pregunta sale en texto. */
  sendButtons?(body: string, buttons: ReadonlyArray<{ id: string; title: string }>): Promise<SendOutcome>;
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
  /** Registro de fotos enviadas (wamid -> producto). Sin él, una respuesta a una foto no se puede resolver: se pide aclaración. */
  media?: ProductMediaLedger;
  /** Consumo para los topes de costo/abuso (Bloque 14). Sin él, no se aplican topes. */
  usage?: UsageReader;
  /** Bloque 25: canal por contacto. Obligatorio si config.classifyCustomers (sin él, el turno no sigue: fail-closed). */
  classification?: CustomerChannelStore;
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
  /** context de Meta: el mensaje citado (wamid) o si fue reenviado. */
  replyTo?: { wamid?: string | null; forwarded?: boolean } | null;
  /**
   * Todos los mensajes que atiende este turno (ráfaga del buzón), en orden; `wamid` es el
   * más nuevo y `text` los reúne. Sin él, el turno atiende solo `wamid`.
   */
  wamids?: readonly string[];
  /**
   * Mensaje SIN texto (nota de voz, imagen, documento…; Bloque 23): lo resuelve la política
   * determinista de entrada.ts, sin modelo. `text` llega vacío.
   */
  nonText?: { kind: NonTextKind } | null;
}

export type AgentTurnOutcome = "replied" | "handoff" | "fallback" | "preempted" | "safety" | "duplicate" | "rate_limited";

export interface AgentTurnTrace {
  log: "agent_turn";
  request_id: string;
  business_id: string;
  contact_ref: string;
  /** wamid del mensaje del cliente (correlación con Meta y con dulabs_mensajes_log; no es dato personal). */
  wamid: string;
  turn: number;
  provider: string;
  model: string;
  outcome: AgentTurnOutcome;
  rounds: number;
  tool_calls: Array<{ name: string; result: string; ms: number; args: Record<string, unknown> }>;
  usage: { input: number; output: number; thinking: number; cached: number };
  latency_ms: number;
  retries: number;
  /**
   * `values`: solo los MONTOS bloqueados (con "$", "COP" o "mil"; nunca referencias, enlaces ni otros
   * números, que podrían ser datos del cliente) para diagnosticar qué cifra inventó el modelo.
   */
  grounding: { violations: GroundingViolation["kind"][]; corrected: boolean; values?: string[] };
  order_id: string | null;
  images: number;
  error_kind: string | null;
  state_saved: boolean;
  /** true solo si WhatsApp aceptó el mensaje de texto (outcome dice qué se decidió; esto, si salió). */
  sent: boolean;
  /** A qué respondió el cliente (sin contenido): foto de producto, otro mensaje, reenviado o nada. */
  reply_to: ReplyContext["kind"] | null;
  /** Cómo señaló el cliente el producto en este mensaje (sin texto). */
  selection: Array<{ reference: string; via: string }>;
  clarification_needed: boolean;
  /** Etapa derivada por el backend al empezar el turno y al terminarlo. */
  stage: { start: ConversationStage | null; end: ConversationStage | null };
  /** Entrega: wamid del texto y de cada foto (y si la foto quedó registrada para poder citarla); motivo si falló. */
  delivery: { text_wamid: string | null; text_error: string | null; images: Array<{ reference: string; wamid: string | null; recorded: boolean; error?: string | null }> };
  /** Qué entró (sin contenido): mensajes atendidos en este turno y largo del texto. */
  input: { wamids: string[]; messages: number; chars: number };
  /** Contexto confiable con el que se decidió (sin datos personales). */
  context: { channel: string | null; cart_lines: number; open_options: number; proposal_presented: boolean; active_order: string | null } | null;
  /** Consumo medido y decisión de topes (null = no se midió). */
  limits: { contact_minute: number; contact_day: number; tenant_tokens_day: number; decision: string } | null;
  /** Qué intentó resolver el turno (derivado de las herramientas pedidas y del resultado; ver intencion.ts). */
  intent: TurnIntent | null;
  /** Traspaso a una asesora: quién lo decidió y el motivo CERRADO (nunca el texto libre). */
  handoff: { source: "customer" | "model" | "system"; motive: HandoffMotive | SystemHandoffMotive } | null;
  /** Mensaje sin texto y la política que aplicó el backend (Bloque 23); null = mensaje de texto. */
  non_text: { kind: NonTextKind; action: NonTextAction } | null;
  /**
   * Bloque 25 — clasificación detal / por mayor del contacto (null = el número no clasifica):
   * asked (se le preguntó), classified (quedó clasificado en este turno), known (ya lo estaba),
   * change_requested (pidió el otro canal: asesora), order_mismatch (pedido abierto de otro canal: asesora).
   */
  classification: { action: "asked" | "classified" | "known" | "change_requested" | "order_mismatch"; channel: OrderChannel | null; origin: CustomerChannelOrigin | null } | null;
}

// Mensajes FIJOS (sin IA): nunca afirman datos comerciales.
export const FALLBACK_MESSAGES = {
  technical: "Disculpa, tuve un inconveniente para responderte. ¿Me lo escribes de nuevo en un momento?",
  handoff: "Te comunico con una asesora para ayudarte mejor. En breve te escribe.",
  safety: "Disculpa, con eso no puedo ayudarte por aquí. ¿Te ayudo con algo de nuestro catálogo?",
  unverified: "Disculpa, no pude verificar esa información en el catálogo. ¿Me confirmas la referencia o el producto que buscas?",
  /** Bloque 23: una escritura quedó sin respuesta (no se sabe si se hizo): ni "listo" ni "falló". */
  pending: "Estoy verificando el estado de tu pedido. Escríbeme de nuevo en un momento y te confirmo cómo quedó.",
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

/**
 * Foto citada: SOLO si el registro dice que es de ESTA conversación; el producto se vuelve a
 * consultar AHORA (la referencia debe seguir siendo el MISMO producto que se fotografió).
 */
async function repliedPhoto(
  deps: AgentRuntimeDeps,
  input: AgentTurnInput,
  key: { tenantId: string; phoneNumberId: string; waId: string },
  wamid: string,
): Promise<Extract<ReplyContext, { kind: "product_image" }> | null> {
  const sentImage = deps.media ? await deps.media.findByWamid(key, wamid).catch(() => null) : null;
  if (!sentImage) return null;
  const [p, product] = await Promise.all([
    createResolucionCatalogo({ repo: deps.tools.catalog })
      .resolverReferencia(input.tenantId, sentImage.reference)
      .catch(() => null),
    deps.tools.catalog.getProductByReference(input.tenantId, sentImage.reference).catch(() => null),
  ]);
  const same = !!p && !!product && (sentImage.productId === null || product.id === sentImage.productId);
  return {
    kind: "product_image",
    reference: sentImage.reference,
    name: (p?.name ?? sentImage.reference).slice(0, 160),
    status: !same || p.status !== "ACTIVE" ? "unavailable" : p.availability === "sold_out" ? "sold_out" : "available",
  };
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
    wamid: input.wamid.slice(0, 200),
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
    sent: false,
    reply_to: null,
    selection: [],
    clarification_needed: false,
    stage: { start: null, end: null },
    delivery: { text_wamid: null, text_error: null, images: [] },
    limits: null,
    intent: null,
    handoff: null,
    non_text: null,
    classification: null,
    input: { wamids: (input.wamids && input.wamids.length > 0 ? [...input.wamids] : [input.wamid]).map((w) => w.slice(0, 200)).slice(0, 10), messages: input.wamids?.length || 1, chars: input.text.length },
    context: null,
  };
  const finish = (outcome: AgentTurnOutcome, reply: string | null) => {
    trace.outcome = outcome;
    trace.intent = detectIntent(trace.tool_calls.map((c) => c.name), outcome);
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
    const r = sendResult(await deps.sender.sendText(FALLBACK_MESSAGES.technical).catch(() => false));
    trace.sent = r.sent;
    trace.delivery.text_wamid = r.wamid;
    trace.delivery.text_error = r.error;
    return finish("fallback", r.sent ? FALLBACK_MESSAGES.technical : null);
  }
  const wamids = input.wamids && input.wamids.length > 0 ? [...input.wamids] : [input.wamid];
  // Reintento de Meta / mensaje doble ya atendido: ni modelo ni respuesta (el webhook también deduplica; esto es la segunda barrera).
  if (wamids.every((w) => loaded.state.recentWamids.includes(w))) {
    trace.turn = loaded.state.turn;
    return finish("duplicate", null);
  }
  // Una asesora ya tiene el chat: no se gasta una llamada al modelo ni se responde.
  if (await deps.sender.humanTookOver().catch(() => false)) {
    trace.turn = loaded.state.turn;
    return finish("preempted", null);
  }
  // Topes de costo/abuso (Bloque 14): se deciden ANTES de gastar una llamada al modelo.
  const usage = deps.usage ? await deps.usage.read({ tenantId: input.tenantId, phoneNumberId: input.phoneNumberId, contactRef: trace.contact_ref }).catch(() => null) : null;
  const limit = decideLimits(usage, deps.config.limits);
  if (usage) trace.limits = { contact_minute: usage.contactMinute, contact_day: usage.contactDay, tenant_tokens_day: usage.tenantTokensDay, decision: limit.action === "allow" ? "allow" : `${limit.action}:${limit.reason}` };
  const seen = { ...loaded.state, recentWamids: [...loaded.state.recentWamids.filter((w) => !wamids.includes(w)), ...wamids].slice(-MAX_RECENT_WAMIDS) };
  /** Traspaso decidido por el backend (sin modelo): pausa + mensaje fijo. false = no se pudo pausar. */
  const handOffNow = async (motive: SystemHandoffMotive | HandoffMotive, source: "customer" | "system", reason: string, message: string = FALLBACK_MESSAGES.handoff, orderId?: string) => {
    try {
      await deps.tools.engine.requestHandoff({ tenantId: input.tenantId, contact, reason, actor: "system", requestId, ...(orderId ? { orderId } : {}) });
    } catch {
      return false;
    }
    trace.handoff = { source, motive };
    const r = sendResult(await deps.sender.sendText(message).catch(() => false));
    trace.sent = r.sent;
    trace.delivery.text_wamid = r.wamid;
    trace.delivery.text_error = r.error;
    trace.state_saved = await deps.state.save(key, { ...seen, handoffTurn: seen.turn }, loaded.version).catch(() => false);
    return true;
  };
  if (limit.action !== "allow") {
    trace.turn = loaded.state.turn;
    if (limit.action === "throttle") {
      // Spam o bucle: ni modelo ni respuesta; el mensaje queda como atendido.
      trace.state_saved = await deps.state.save(key, seen, loaded.version).catch(() => false);
      return finish("rate_limited", null);
    }
    // Tope del día: una asesora sigue la conversación (mensaje fijo, sin modelo).
    trace.error_kind = `limit_${limit.reason}`;
    if (await handOffNow(`limit_${limit.reason}`, "system", `Límite de uso del asistente (${limit.reason})`)) return finish("handoff", trace.sent ? FALLBACK_MESSAGES.handoff : null);
    trace.state_saved = await deps.state.save(key, seen, loaded.version).catch(() => false);
    return finish("rate_limited", null);
  }
  // Mensaje sin texto (Bloque 23): política determinista, sin modelo (entrada.ts).
  if (input.nonText) {
    const policy = nonTextPolicy(input.nonText.kind) ?? { kind: "other" as const, action: "ignore" as const };
    trace.non_text = { kind: policy.kind, action: policy.action };
    trace.turn = loaded.state.turn;
    const sendFixed = async (text: string) => {
      const r = sendResult(await deps.sender.sendText(text).catch(() => false));
      trace.sent = r.sent;
      trace.delivery.text_wamid = r.wamid;
      trace.delivery.text_error = r.error;
      return r.sent;
    };
    if (policy.action === "handoff") {
      const message = NON_TEXT_MESSAGES.handoff(policy.kind);
      // Motivo de la lista cerrada existente ("algo que el asistente no puede resolver"); el tipo exacto queda en trace.non_text.
      if (await handOffNow("out_of_scope", "system", "El cliente envió una imagen, archivo o ubicación que el asistente no puede revisar", message)) return finish("handoff", trace.sent ? message : null);
      // La pausa no se pudo registrar: no se promete una asesora; se dice la verdad.
      trace.error_kind = "handoff_failed";
      const failed = NON_TEXT_MESSAGES.handoffFailed(policy.kind);
      const sent = await sendFixed(failed);
      trace.state_saved = await deps.state.save(key, seen, loaded.version).catch(() => false);
      return finish("fallback", sent ? failed : null);
    }
    if (policy.action === "ignore") {
      trace.state_saved = await deps.state.save(key, seen, loaded.version).catch(() => false);
      return finish("rate_limited", null);
    }
    // ask_text: nota de voz / mensaje que Meta no pudo entregar. Si responde a una foto de ESTA
    // conversación, el producto queda señalado para el siguiente mensaje ("quiero ese").
    let next: ConversationState = { ...seen, turn: seen.turn + 1, lastInteractionAt: new Date(now()).toISOString() };
    trace.turn = next.turn;
    const photo = input.replyTo?.forwarded ? null : input.replyTo?.wamid ? await repliedPhoto(deps, input, key, input.replyTo.wamid) : null;
    trace.reply_to = input.replyTo?.forwarded ? "forwarded" : input.replyTo?.wamid ? (photo ? "product_image" : "unknown_message") : null;
    if (photo) {
      next = rememberReferences(next, [photo.reference], "image");
      next = { ...next, selection: [{ reference: photo.reference, via: "image_reply", turn: next.turn }] };
      trace.selection = [{ reference: photo.reference, via: "image_reply" }];
    }
    const last = next.nonTextNoticeAt ? Date.parse(next.nonTextNoticeAt) : NaN;
    if (Number.isFinite(last) && now() - last < NON_TEXT_NOTICE_COOLDOWN_MS) {
      // Ya se le pidió escribir hace poco: no se repite el aviso (anti-spam), pero la foto citada queda señalada.
      trace.state_saved = await deps.state.save(key, next, loaded.version).catch(() => false);
      return finish("rate_limited", null);
    }
    const text =
      policy.kind === "unsupported"
        ? NON_TEXT_MESSAGES.unsupported
        : photo
          ? NON_TEXT_MESSAGES.audioAboutProduct({ reference: photo.reference, name: photo.name, available: photo.status === "available" })
          : NON_TEXT_MESSAGES.audio;
    const sent = await sendFixed(text);
    if (sent) next = { ...next, nonTextNoticeAt: new Date(now()).toISOString() };
    trace.state_saved = await deps.state.save(key, next, loaded.version).catch(() => false);
    return finish("replied", sent ? text : null);
  }

  // El cliente pide una persona: el backend lo pasa a una asesora sin depender del modelo.
  // Si la pausa falla, sigue el turno normal (el modelo puede reintentar con handoff_to_human).
  if (asksForHuman(input.text)) {
    trace.turn = loaded.state.turn;
    if (await handOffNow("customer_request", "customer", "El cliente pidió hablar con una asesora")) return finish("handoff", trace.sent ? FALLBACK_MESSAGES.handoff : null);
  }

  let state: ConversationState = {
    ...loaded.state,
    turn: loaded.state.turn + 1,
    lastInteractionAt: new Date(now()).toISOString(),
    recentWamids: [...loaded.state.recentWamids.filter((w) => !wamids.includes(w)), ...wamids.map((w) => w.slice(0, 200))].slice(-MAX_RECENT_WAMIDS),
  };
  trace.turn = state.turn;
  const typedRefs = extractReferences(input.text);
  state = rememberReferences(state, typedRefs, "customer");

  // Foto citada: SOLO si el registro dice que es de ESTA conversación; el producto se vuelve a consultar ahora.
  let replyTo: ReplyContext | null = null;
  if (input.replyTo?.forwarded) replyTo = { kind: "forwarded" };
  else if (input.replyTo?.wamid) {
    const photo = await repliedPhoto(deps, input, key, input.replyTo.wamid);
    if (!photo) replyTo = { kind: "unknown_message" };
    else {
      replyTo = photo;
      state = rememberReferences(state, [photo.reference], "image");
    }
  }
  trace.reply_to = replyTo?.kind ?? null;

  // Selección determinista del mensaje (foto citada, referencia, posición o nombre inequívoco).
  const selection = resolveSelection(input.text, state.lastShown, {
    replyReference: replyTo?.kind === "product_image" ? replyTo.reference : null,
    typedReferences: typedRefs,
    previous: [...state.selection.map((x) => x.reference), ...state.cart.map((c) => c.reference)],
  });
  const designated = new Set([...selection.selected.map((x) => x.reference), ...state.selection.filter((x) => x.turn === state.turn - 1).map((x) => x.reference)]);
  state = { ...state, selection: selection.selected.slice(0, 10).map((x) => ({ ...x, turn: state.turn })) };
  trace.selection = selection.selected.map((x) => ({ reference: x.reference, via: x.via }));
  trace.clarification_needed = selection.needsClarification || replyTo?.kind === "forwarded" || replyTo?.kind === "unknown_message";

  // 2) Hechos confiables del turno (pedido activo desde el motor).
  let activeOrder: (OrderPublicView & { next_step: string }) | null = null;
  let activeOrderSource: string | null = null;
  try {
    const o = await deps.tools.engine.getOrder({ tenantId: input.tenantId, contact, requestId });
    activeOrder = { ...publicView(o), next_step: nextStepOf(o) };
    activeOrderSource = o.source;
  } catch (err) {
    if (!(err instanceof OrderError)) trace.error_kind = "order_lookup_failed";
  }
  // Propuesta creada fuera del agente (p. ej. la solicitud del catálogo reclamada por el webhook).
  if (activeOrder?.status === "pending_confirmation" && activeOrder.confirmation && state.proposal?.confirmationId !== activeOrder.confirmation.id) {
    state = { ...state, activeOrderId: activeOrder.order_id, proposal: { orderId: activeOrder.order_id, confirmationId: activeOrder.confirmation.id, presentedTurn: null } };
  }
  if (activeOrder && activeOrder.status !== "pending_confirmation" && state.proposal?.orderId === activeOrder.order_id) state = { ...state, proposal: null };
  // Bloque 24: lo que ya está en el pedido ABIERTO de esta conversación lo eligió el cliente: cambiar
  // su cantidad ("mejor que sean 2") no exige volver a señalarlo aunque la lista siga abierta.
  // Solo esas referencias (del backend); nunca habilita un producto nuevo.
  if (activeOrder && ["draft", "validated", "pending_confirmation"].includes(activeOrder.status)) {
    for (const l of activeOrder.lines) designated.add(l.reference);
  }
  // Bloque 25: canal POR CONTACTO (detal / por mayor), decidido y guardado por el backend, nunca por el modelo.
  let classified: { channel: OrderChannel; source: "customer_classification" } | null = null;
  if (deps.config.classifyCustomers) {
    const sendFixed = async (text: string) => {
      const r = sendResult(await deps.sender.sendText(text).catch(() => false));
      trace.sent = r.sent;
      trace.delivery.text_wamid = r.wamid;
      trace.delivery.text_error = r.error;
      return r.sent;
    };
    let current: CustomerChannel | null = null;
    try {
      if (!deps.classification) throw new Error("classification_store_missing");
      current = await deps.classification.get(key);
      if (current) trace.classification = { action: "known", channel: current.channel, origin: current.origin };
      else {
        // Primera vez: la solicitud del catálogo abierta de ESTA conversación (tienda detal o enlace
        // mayorista firmado) ya dice cómo compra; si no, lo que el cliente eligió en este mensaje.
        const fromCatalog = activeOrder && activeOrderSource === "catalog" && !["completed", "cancelled", "expired"].includes(activeOrder.status) ? activeOrder.channel : null;
        const choice = fromCatalog ?? parseChannelChoice(input.text);
        if (choice) {
          const origin = fromCatalog ? (fromCatalog === "wholesale" ? "catalogo_mayorista" : "catalogo_detal") : "cliente";
          const w = await deps.classification.setInitial(key, choice, origin);
          // conflicto = otra escritura lo clasificó antes: manda la que quedó guardada.
          if (w.channel && w.origin) {
            current = { channel: w.channel, origin: w.origin, updatedAt: new Date(now()).toISOString(), updatedBy: null };
            trace.classification = { action: w.result === "fijado" ? "classified" : "known", channel: w.channel, origin: w.origin };
          }
        }
      }
    } catch {
      // Sin clasificación legible no se sabe qué precios mostrar: mensaje fijo, sin modelo (fail-closed).
      trace.error_kind = "classification_unavailable";
      const sent = await sendFixed(FALLBACK_MESSAGES.technical);
      trace.state_saved = await deps.state.save(key, state, loaded.version).catch(() => false);
      return finish("fallback", sent ? FALLBACK_MESSAGES.technical : null);
    }
    if (!current) {
      // Sin clasificar: la pregunta FIJA con botones (sin modelo). Ningún precio ni catálogo antes de elegir.
      trace.classification = { action: "asked", channel: null, origin: null };
      // Primer mensaje de la conversación: saludo aparte (fijo, del negocio). Al volver a preguntar, no se repite.
      if (loaded.state.turn === 0) await deps.sender.sendText(deps.config.business.saludo ?? DEFAULT_WELCOME).catch(() => false);
      let text: string = CHANNEL_QUESTION.body;
      const b = deps.sender.sendButtons ? sendResult(await deps.sender.sendButtons(CHANNEL_QUESTION.body, CHANNEL_QUESTION.buttons).catch(() => false)) : null;
      if (b?.sent) {
        trace.sent = true;
        trace.delivery.text_wamid = b.wamid;
      } else {
        text = CHANNEL_QUESTION.textFallback;
        await sendFixed(text);
      }
      trace.state_saved = await deps.state.save(key, state, loaded.version).catch(() => false);
      return finish("replied", trace.sent ? text : null);
    }
    // Pedido abierto de OTRO canal (p. ej. solicitud de la tienda mayorista de un cliente al detal): asesora.
    // Va primero: el mensaje de esa solicitud nombra su canal y no es un pedido de cambio.
    if (activeOrder && ["draft", "validated", "pending_confirmation"].includes(activeOrder.status) && activeOrder.channel !== current.channel) {
      trace.classification = { action: "order_mismatch", channel: current.channel, origin: current.origin };
      const message = CLASSIFICATION_MESSAGES.orderMismatch(activeOrder.order_id, activeOrder.channel, current.channel);
      const reason = `Pedido ${activeOrder.order_id} ${CHANNEL_LABEL[activeOrder.channel]} de un cliente registrado ${CHANNEL_LABEL[current.channel]}`;
      if (await handOffNow("order_issue", "system", reason, message, activeOrder.order_id)) return finish("handoff", trace.sent ? message : null);
      // Sin pausa: ese pedido no se muestra ni se propone en este turno (confirmarlo lo bloquean las herramientas).
      if (state.proposal?.orderId === activeOrder.order_id) state = { ...state, proposal: null };
      activeOrder = null;
    }
    // Pide el OTRO canal ("soy mayorista", "precio al por mayor"): el modelo no lo cambia; solo una asesora.
    const asked = parseChannelChoice(input.text);
    if (asked && asked !== current.channel && trace.classification?.action !== "classified") {
      trace.classification = { action: "change_requested", channel: current.channel, origin: current.origin };
      const message = CLASSIFICATION_MESSAGES.changeRequested(current.channel);
      if (await handOffNow("customer_request", "customer", `El cliente pidió cambiar su modalidad de compra (${CHANNEL_LABEL[current.channel]} → ${CHANNEL_LABEL[asked]})`, message)) {
        return finish("handoff", trace.sent ? message : null);
      }
      // Sin pausa: el turno sigue con SU canal (las herramientas nunca devuelven el otro precio).
    }
    classified = { channel: current.channel, source: "customer_classification" };
  }
  const { channel, source } = classified ?? channelFor(deps.config, activeOrder);
  state = { ...state, channel: { value: channel, source } };

  const customerName = deps.tools.customerName ? await deps.tools.customerName(key).catch(() => null) : null;
  const facts: TurnFacts = {
    channel,
    channelSource: source,
    customerName,
    activeOrder,
    handoffActive: false,
    replyTo,
    selection: { selected: selection.selected, needsClarification: trace.clarification_needed && selection.selected.length === 0 },
  };
  const stage = conversationStage(state, facts);
  facts.stage = { name: stage, guidance: STAGE_GUIDANCE[stage] };
  trace.stage.start = stage;
  trace.context = {
    channel,
    cart_lines: state.cart.length,
    open_options: state.ambiguity?.references.length ?? 0,
    proposal_presented: !!state.proposal && state.proposal.presentedTurn !== null,
    active_order: activeOrder ? `${activeOrder.order_id}:${activeOrder.status}` : null,
  };

  const evidence: Evidence = emptyEvidence();
  addCustomerEvidence(input.text, evidence);
  addEvidence(activeOrder, evidence);
  for (const k of state.known) evidence.refs.add(k.reference);
  for (const c of state.cart) evidence.numbers.add(c.quantity);

  // 3) Contexto por capas.
  const rows = await deps.history.recent({ phoneNumberId: input.phoneNumberId, waId: input.waId, sinceIso: new Date(now() - HISTORY_WINDOW_MS).toISOString(), limit: HISTORY_MAX_TURNS * 2 + 4 });
  const turns: AITurn[] = [...historyTurns(rows, { excludeWamids: wamids }), { role: "user", text: input.text }];
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
    designated,
    customerText: input.text,
    images: [],
    handedOff: false,
    handoffMotive: null,
    newProposal: null,
  };

  let writes = 0;
  let toolCalls = 0;
  let reply: string | null = null;
  let failure: "technical" | "safety" | "unverified" | "pending" | null = null;
  let corrected = false;
  let forceText = false;
  let nudged = false;

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
        // Una escritura sin respuesta: el backend responde con un mensaje FIJO (el modelo no puede
        // saber si el pedido quedó hecho, y adivinarlo sería inventar). El próximo mensaje del
        // cliente ve el estado real del pedido (pedido activo desde el motor).
        if (trace.tool_calls.some((c) => c.result === "OUTCOME_UNKNOWN")) {
          failure = "pending";
          trace.error_kind = "write_outcome_unknown";
          break;
        }
        if (ctx.handedOff) forceText = true;
        continue;
      }
      // Última ronda (sin herramientas) y el modelo AÚN pide herramientas, sin texto: en vez de fallar,
      // una sola vez se le responde que no hay más consultas y se le pide contestar con lo que ya tiene.
      if (r.toolCalls.length > 0 && lastChance && !r.text && !nudged) {
        nudged = true;
        forceText = true;
        turns.push({ role: "model", text: r.text, toolCalls: r.toolCalls, continuation: r.continuation });
        const stop = { error: { code: "TOOL_LIMIT", message: "No hay más consultas en este mensaje. Responde AHORA en texto solo con los datos que ya devolvieron las herramientas." } };
        turns.push({ role: "tool", results: r.toolCalls.map((tc) => ({ callId: tc.id, name: tc.name, output: stop })) });
        for (const tc of r.toolCalls) trace.tool_calls.push({ name: tc.name.slice(0, 40), result: "TOOL_LIMIT", ms: 0, args: summarizeArgs(tc.args) });
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
      const montos = check.violations.filter((v) => v.kind === "amount" && /\$|cop|\bmil\b/i.test(v.value) && v.value.length <= 24).map((v) => v.value);
      if (montos.length > 0) trace.grounding.values = [...(trace.grounding.values ?? []), ...montos].slice(0, 10);
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
    ctx.state = { ...ctx.state, failures: Math.min(10, ctx.state.failures + (failure === "safety" || failure === "pending" ? 0 : 1)) };
    if (failure === "safety") {
      reply = FALLBACK_MESSAGES.safety;
      outcome = "safety";
    } else if (failure === "pending") {
      reply = FALLBACK_MESSAGES.pending;
      outcome = "fallback";
    } else if (ctx.state.failures >= 2 && !ctx.handedOff) {
      try {
        await deps.tools.engine.requestHandoff({ tenantId: input.tenantId, contact, reason: "El asistente no pudo responder (fallas repetidas)", actor: "system", requestId });
        trace.handoff = { source: "system", motive: "repeated_failures" };
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
  // Tras pasar a una asesora el agente solo se despide: ni fotos ni nada más.
  if (ctx.handedOff || outcome === "handoff") {
    if (ctx.handedOff && !trace.handoff) trace.handoff = { source: "model", motive: ctx.handoffMotive ?? "other" };
    ctx.images = [];
    ctx.state = { ...ctx.state, handoffTurn: ctx.turn };
  }

  // 6) Última barrera: si una asesora tomó el chat mientras tanto, el agente NO envía nada.
  if (!ctx.handedOff && outcome !== "handoff" && (await deps.sender.humanTookOver().catch(() => false))) {
    trace.state_saved = await deps.state.save(key, ctx.state, loaded.version).catch(() => false);
    return finish("preempted", null);
  }

  const textResult = reply ? sendResult(await deps.sender.sendText(reply).catch(() => false)) : { sent: false, wamid: null, error: null };
  const sent = textResult.sent;
  trace.sent = sent;
  trace.delivery.text_wamid = textResult.wamid;
  trace.delivery.text_error = textResult.error;
  if (sent && !failure) {
    // La propuesta cuenta como MOSTRADA solo si el mensaje enviado lleva su total exacto.
    const p = ctx.state.proposal;
    const total = ctx.newProposal?.orderId === p?.orderId ? ctx.newProposal?.total : activeOrder?.confirmation?.id === p?.confirmationId ? activeOrder?.confirmation?.total : undefined;
    if (p && p.presentedTurn === null && total !== undefined && reply?.includes(formatCop(total))) {
      ctx.state = { ...ctx.state, proposal: { ...p, presentedTurn: ctx.turn } };
    }
    if (ctx.state.ambiguity && ctx.state.ambiguity.createdTurn === ctx.turn) ctx.state = { ...ctx.state, ambiguity: { ...ctx.state.ambiguity, presentedTurn: ctx.turn } };
    for (const img of ctx.images) {
      const r = sendResult(await deps.sender.sendImage(img).catch(() => false));
      if (!r.sent) {
        trace.delivery.images.push({ reference: img.reference, wamid: null, recorded: false, error: r.error });
        continue;
      }
      trace.images++;
      // wamid de la foto -> producto: permite resolver "quiero este" cuando el cliente responde a ESTA foto.
      const recorded =
        r.wamid !== null && deps.media
          ? await deps.media
              .record({ tenantId: input.tenantId, phoneNumberId: input.phoneNumberId, waId: input.waId, wamid: r.wamid, reference: img.reference, productId: img.productId, channel, turn: ctx.turn })
              .catch(() => false)
          : false;
      trace.delivery.images.push({ reference: img.reference, wamid: r.wamid, recorded });
      ctx.state = { ...ctx.state, imagesSent: [...ctx.state.imagesSent, { reference: img.reference, turn: ctx.turn }].slice(-MAX_IMAGES_REMEMBERED) };
    }
  }
  trace.order_id = ctx.state.activeOrderId;
  trace.stage.end = conversationStage(
    ctx.state,
    ctx.confirmedOrderId && facts.activeOrder ? { activeOrder: { ...facts.activeOrder, status: "confirmed", next_step: "none" } } : ctx.confirmedOrderId ? { activeOrder: { status: "confirmed", next_step: "none" } as TurnFacts["activeOrder"] } : facts,
  );
  trace.state_saved = await deps.state.save(key, ctx.state, loaded.version).catch(() => false);
  return finish(outcome, sent ? reply : null);
}
