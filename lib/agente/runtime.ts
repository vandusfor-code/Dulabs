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
import { OrderError, conversationKey, nextStepOf, requestFingerprint } from "@/lib/catalogo/pedidos/motor";
import { contactRef } from "@/lib/catalogo/pedidos/log";
import { AIProviderError, type AIGenerateResult, type AIProvider, type AITurn } from "@/lib/ia-proveedores/contrato";
import { generateWithRetry } from "@/lib/ia-proveedores/reintentos";
import { addCustomerEvidence, addEvidence, checkGrounding, emptyEvidence, type Evidence, type GroundingViolation } from "@/lib/agente/anclaje";
import type { AgentRuntimeConfig } from "@/lib/agente/config";
import { HISTORY_MAX_TURNS, HISTORY_WINDOW_MS, buildSystemInstruction, historyTurns, type HistoryStore, type ReplyContext, type TurnFacts } from "@/lib/agente/contexto";
import { MAX_CART_LINES, MAX_IMAGES_REMEMBERED, MAX_RECENT_WAMIDS, rememberReferences, type ConversationState, type ConversationStateStore } from "@/lib/agente/estado";
import type { ProductMediaLedger } from "@/lib/agente/medios";
import { resolveSelection } from "@/lib/agente/seleccion";
import { STAGE_GUIDANCE, conversationStage, type ConversationStage } from "@/lib/agente/etapa";
import { decideLimits, type UsageReader } from "@/lib/agente/limites";
import { asksForHuman, detectIntent, type HandoffMotive, type SystemHandoffMotive, type TurnIntent } from "@/lib/agente/intencion";
import { agentToolDeclarations, catalogPublication, executeAgentTool, toolKind, type AgentToolsDeps, type AgentTurnToolContext, type QueuedImage } from "@/lib/agente/herramientas";
import type { AgentToolName } from "@/lib/agente/nombres-herramientas";
import { MEDIA_DEL_CLIENTE, MEDIA_MESSAGES, hablaDePago, NON_TEXT_MESSAGES, NON_TEXT_NOTICE_COOLDOWN_MS, nonTextPolicy, type NonTextAction, type NonTextKind } from "@/lib/agente/entrada";
import {
  CHANNEL_LABEL,
  CHANNEL_QUESTION,
  CLASSIFICATION_MESSAGES,
  DEFAULT_WELCOME,
  INTENT_MENU,
  START_MESSAGES,
  channelQuestionBody,
  resolveStartAction,
  parseChannelChoice,
  type CustomerChannel,
  type CustomerChannelOrigin,
  type CustomerChannelStore,
} from "@/lib/agente/clasificacion";
import { isExplicitConfirmation } from "@/lib/agente/etapa";
import {
  CHECKOUT_MESSAGES,
  CHECKOUT_STEP_HINT,
  continueCheckout,
  isCheckoutButton,
  parseSummaryAction,
  staleCheckoutButton,
  startCheckout,
  wantsCheckout,
  type CheckoutAction,
  type CheckoutIO,
  type CheckoutResult,
} from "@/lib/agente/checkout";
import type { CheckoutStep } from "@/lib/agente/estado";
import { esAfirmacion, leerCantidad, modalidadInicial, numerosDelCliente, pideQuitar } from "@/lib/agente/lenguaje/interpretar";
import { addOrderStateEvidence, type OrderTracking } from "@/lib/agente/anclaje";

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
  /** Bloque 29: lee las referencias escritas en una foto del cliente (lectura-referencias.ts). Sin él, se piden escritas. */
  readImageReferences?: (mediaId: string) => Promise<string[]>;
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
  nonText?: { kind: NonTextKind; caption?: string | null; mediaId?: string | null } | null;
  /**
   * Bloque 26: id del botón de WhatsApp que tocó el cliente (solo si llegó; el buzón guarda solo el
   * texto, y entonces la acción se decide por el título exacto del botón). Nunca lo interpreta el modelo.
   */
  buttonId?: string | null;
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
  /** Bloque 29: referencias leídas en la foto del cliente y cuántas existen en el catálogo (sin los códigos). */
  image_references?: { read: number; valid: number };
  /**
   * Bloque 25 — clasificación detal / por mayor del contacto (null = el número no clasifica):
   * asked (se le preguntó), classified (quedó clasificado en este turno), known (ya lo estaba),
   * change_requested (pidió el otro canal: asesora), order_mismatch (pedido abierto de otro canal: asesora).
   */
  classification: { action: "asked" | "classified" | "known" | "change_requested" | "order_mismatch"; channel: OrderChannel | null; origin: CustomerChannelOrigin | null } | null;
  /** Bloque 26 — acción de inicio que resolvió el backend sin modelo (menú, búsqueda guiada o catálogo). */
  start: "intent_menu" | "search_prompt" | "catalog_link" | null;
  /** Bloque 27 — checkout conversacional: paso en que quedó y qué decidió el backend (sin datos del cliente). */
  checkout?: { step: CheckoutStep | null; action: CheckoutAction } | null;
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

/**
 * Bloque 28 (auditoría final): la selección no cambió porque el backend rechazó el cambio y el modelo no
 * supo decirlo: en vez de un "no pude verificar" genérico, la pregunta CONCRETA que falta (nunca "no entendí").
 */
export const CART_CLARIFY: Readonly<Partial<Record<string, string>>> = {
  CHOICE_REQUIRED: "¿Cuál de las opciones quieres? 😊 Escríbeme el número o responde a la foto del producto.",
  QUANTITY_NOT_STATED: "¿Cuántas unidades quieres? 😊",
  SELECTION_INCOMPLETE: "¿Quieres todos los productos que te mostré o solo algunos? 😊",
  REFERENCE_NOT_ALLOWED: "¿Me confirmas cuál producto quieres? 😊 Puedes escribirme su nombre o su referencia.",
};

/** Bloque 28 (auditoría final): el modelo afirmó un estado que la BD no respalda => se cuenta el estado REAL (fijo). */
export function realOrderStatus(order: { order_id: string; tracking?: OrderTracking }): string | null {
  const t = order.tracking;
  if (!t) return null;
  const etapa = { confirmado: "confirmado (aún no se prepara)", en_preparacion: "en preparación", enviado: "enviado", entregado: "entregado" }[t.etapa];
  const pago = t.pago === "recibido" ? "el pago está recibido" : "el pago está pendiente de verificación";
  return `Según nuestro sistema, tu pedido ${order.order_id} está ${etapa} y ${pago}. Una asesora te confirma cualquier novedad 😊`;
}

/** Bloque 28: herramientas de SOLO LECTURA para responder una pregunta durante el checkout (nunca escriben). */
const SIDE_QUESTION_TOOLS: readonly AgentToolName[] = [
  "search_products",
  "more_products",
  "similar_products",
  "resolve_product_by_reference",
  "resolve_product_by_attributes",
  "get_product_details",
  "get_catalog_link",
  "get_customer_context",
];
const STEP_LABEL: Readonly<Record<CheckoutStep, string>> = {
  name: "nombre",
  delivery: "forma de entrega",
  address: "dirección",
  city: "ciudad",
  reference: "referencia de la entrega",
  payment: "forma de pago",
  summary: "resumen del pedido",
};
const SIDE_QUESTION_RULES = (step: CheckoutStep) =>
  `El cliente está REGISTRANDO su pedido con el sistema (paso actual: ${STEP_LABEL[step]}) y te hizo una pregunta. Responde SOLO esa pregunta, en 1 a 3 frases, con datos de las herramientas o de la configuración del negocio (políticas). Si el dato no está (por ejemplo, el costo o el tiempo del envío no están configurados), dilo con honestidad y di que una asesora lo confirma al registrar el pedido. No pidas nombre, dirección, entrega ni pago; no confirmes ni registres pedidos; no agregues ni quites productos; no repitas la pregunta del paso: el sistema la repite después de tu respuesta.`;

const CORRECTION = (v: GroundingViolation[]) =>
  v.some((x) => x.kind === "cart")
    ? "[VERIFICACIÓN DEL SISTEMA] La selección NO cambió: la herramienta rechazó el cambio (lee su motivo). No digas que agregaste o dejaste listo nada: hazle al cliente la pregunta concreta que indica la herramienta (cuál producto o cuántas unidades). No menciones esta verificación."
    : `[VERIFICACIÓN DEL SISTEMA] Tu respuesta incluye datos que no vienen de las herramientas (${v
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
  if (activeOrder?.channel === "wholesale" && !["completed", "cancelled", "expired", "rejected"].includes(activeOrder.status)) return { channel: "wholesale", source: "catalog_request" };
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
  // Bloque 27: con el checkout del sistema, el modelo NO confirma pedidos (confirm_order no existe para él).
  const allowed = deps.config.checkoutEnabled ? deps.config.tools.filter((t) => t !== "confirm_order") : deps.config.tools;

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
    start: null,
    checkout: null,
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
  /** Bloque 29: qué hacer con una foto, video o archivo del cliente según su pedido (tabla en entrada.ts). */
  const mediaDelCliente = async (
    kind: NonTextKind,
    caption: string | null | undefined,
    ckStep: string | null,
    mediaId: string | null | undefined,
  ): Promise<{ tipo: "comprobante" | "posventa"; orderId: string; etapa: string } | { tipo: "leyenda"; texto: string } | { tipo: "pedir" } | null> => {
    let order: Awaited<ReturnType<typeof deps.tools.engine.getOrder>> | null = null;
    try {
      order = await deps.tools.engine.getOrder({ tenantId: input.tenantId, contact, requestId });
    } catch (err) {
      // Sin pedido abierto es lo normal; si NO se pudo consultar, se conserva lo de antes (asesora).
      if (!(err instanceof OrderError)) return null;
    }
    const ck = order?.checkout ?? null;
    const texto = typeof caption === "string" ? caption.trim().slice(0, 1_000) : "";
    // Un texto que NO habla de pago ("me gustó esta", "¿lo tienen en plateado?") manda sobre el pedido abierto.
    const deProducto = texto !== "" && !hablaDePago(texto);
    if (order && ck && !deProducto) {
      if (ck.stage === "enviado" || ck.stage === "entregado") return { tipo: "posventa", orderId: order.orderId, etapa: ck.stage };
      if (kind !== "video" && ck.paymentMethod === "transferencia" && ck.paymentStatus === "pendiente") return { tipo: "comprobante", orderId: order.orderId, etapa: ck.stage };
    }
    if (ckStep) return { tipo: "pedir" };
    // La referencia escrita EN la foto (la marca del catálogo): solo si existe en ESTE catálogo y está activa.
    let refs: string[] = [];
    if (kind === "image" && mediaId && deps.readImageReferences) {
      const leidas = (await deps.readImageReferences(mediaId).catch(() => [] as string[])).slice(0, 5);
      const productos = leidas.length > 0 ? await deps.tools.catalog.getProductsByReferences(input.tenantId, leidas).catch(() => []) : [];
      refs = leidas.filter((r) => productos.some((p) => p.reference === r && p.status === "ACTIVE"));
      trace.image_references = { read: leidas.length, valid: refs.length };
    }
    if (texto || refs.length > 0) return { tipo: "leyenda", texto: [texto, refs.length > 0 ? `(referencia en la foto: ${refs.join(", ")})` : ""].filter(Boolean).join("\n") };
    return { tipo: "pedir" };
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
    // Bloque 28: con un pedido en registro, una ubicación en el paso de la dirección no pasa a una asesora:
    // se pide la dirección escrita (el checkout sigue).
    const ckStep = deps.config.checkoutEnabled ? (loaded.state.checkout?.step ?? null) : null;
    // Igual una foto o un documento en la dirección o la ciudad (una captura de la dirección): se pide escrito.
    const pideEscrito =
      ckStep === "address" && policy.kind === "location"
        ? CHECKOUT_MESSAGES.locationNeedsText
        : (ckStep === "address" || ckStep === "city") && (policy.kind === "image" || policy.kind === "document")
          ? CHECKOUT_MESSAGES.mediaNeedsText(ckStep)
          : null;
    if (ckStep && pideEscrito) {
      const sent = await sendFixed(pideEscrito);
      trace.checkout = { step: ckStep, action: "invalid" };
      trace.state_saved = await deps.state.save(key, seen, loaded.version).catch(() => false);
      return finish("replied", sent ? pideEscrito : null);
    }
    // Bloque 29 (solo con el checkout conversacional): foto, video o archivo del cliente (tabla en entrada.ts).
    const media = deps.config.checkoutEnabled && MEDIA_DEL_CLIENTE.has(policy.kind) ? await mediaDelCliente(policy.kind, input.nonText.caption, ckStep, input.nonText.mediaId) : null;
    if (media?.tipo === "leyenda") {
      // La leyenda se atiende como un mensaje de texto (turno normal, más abajo).
      input = { ...input, text: media.texto, nonText: null };
    } else {
      if (media?.tipo === "comprobante") {
        const message = MEDIA_MESSAGES.comprobante(policy.kind);
        if (await handOffNow("payment_or_delivery", "system", `Posible comprobante de pago del pedido ${media.orderId} (transferencia pendiente)`, message, media.orderId)) return finish("handoff", trace.sent ? message : null);
      } else if (media?.tipo === "posventa") {
        const message = NON_TEXT_MESSAGES.handoff(policy.kind);
        if (await handOffNow("order_issue", "system", `El cliente envió una imagen o archivo sobre el pedido ${media.orderId} (${media.etapa})`, message, media.orderId)) return finish("handoff", trace.sent ? message : null);
      } else if (media?.tipo === "pedir") {
        let next: ConversationState = { ...seen, turn: seen.turn + 1, lastInteractionAt: new Date(now()).toISOString() };
        trace.turn = next.turn;
        const last = next.nonTextNoticeAt ? Date.parse(next.nonTextNoticeAt) : NaN;
        if (Number.isFinite(last) && now() - last < NON_TEXT_NOTICE_COOLDOWN_MS) {
          // Varias fotos seguidas: un solo aviso (anti-spam).
          trace.state_saved = await deps.state.save(key, next, loaded.version).catch(() => false);
          return finish("rate_limited", null);
        }
        const text = ckStep ? MEDIA_MESSAGES.enCheckout(CHECKOUT_STEP_HINT[ckStep]) : MEDIA_MESSAGES.pideReferencia(policy.kind);
        const sent = await sendFixed(text);
        if (sent) next = { ...next, nonTextNoticeAt: new Date(now()).toISOString(), ...(ckStep ? {} : { fotoPedidaTurn: next.turn }) };
        trace.state_saved = await deps.state.save(key, next, loaded.version).catch(() => false);
        return finish("replied", sent ? text : null);
      }
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
            : ckStep
              ? // Bloque 28: con un pedido en registro, se dice exactamente qué dato falta.
                `Por ahora no puedo escuchar notas de voz 🙏 ${CHECKOUT_STEP_HINT[ckStep]}`
              : NON_TEXT_MESSAGES.audio;
      const sent = await sendFixed(text);
      if (sent) next = { ...next, nonTextNoticeAt: new Date(now()).toISOString() };
      trace.state_saved = await deps.state.save(key, next, loaded.version).catch(() => false);
      return finish("replied", sent ? text : null);
    }
  }

  // Bloque 29: "sí" justo después de "¿me escribes la referencia? … o te comunico con una asesora" => asesora.
  if (deps.config.checkoutEnabled && loaded.state.fotoPedidaTurn === loaded.state.turn && esAfirmacion(input.text) && extractReferences(input.text).length === 0) {
    trace.turn = loaded.state.turn;
    if (await handOffNow("customer_request", "customer", "El cliente envió una foto y pidió una asesora")) return finish("handoff", trace.sent ? FALLBACK_MESSAGES.handoff : null);
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
    // Bloque 28 (solo con el checkout conversacional): capa de lenguaje y "el de la foto" con UNA sola foto enviada.
    ...(deps.config.checkoutEnabled ? { lenguaje: true, photoReferences: state.imagesSent.filter((x) => x.turn >= state.turn - 6).map((x) => x.reference) } : {}),
  });
  const designated = new Set([...selection.selected.map((x) => x.reference), ...state.selection.filter((x) => x.turn === state.turn - 1).map((x) => x.reference)]);
  state = { ...state, selection: selection.selected.slice(0, 10).map((x) => ({ ...x, turn: state.turn })) };
  trace.selection = selection.selected.map((x) => ({ reference: x.reference, via: x.via }));
  trace.clarification_needed = selection.needsClarification || replyTo?.kind === "forwarded" || replyTo?.kind === "unknown_message";

  // 2) Hechos confiables del turno (pedido activo desde el motor).
  let activeOrder: (OrderPublicView & { next_step: string; tracking?: OrderTracking }) | null = null;
  let activeOrderSource: string | null = null;
  try {
    const o = await deps.tools.engine.getOrder({ tenantId: input.tenantId, contact, requestId });
    // Bloque 28: seguimiento REAL del pedido del checkout (etapa, pago, entrega): el modelo nunca lo supone.
    const tracking: OrderTracking | undefined = o.checkout ? { etapa: o.checkout.stage, pago: o.checkout.paymentStatus, entrega: o.checkout.delivery, metodo_pago: o.checkout.paymentMethod } : undefined;
    activeOrder = { ...publicView(o), next_step: nextStepOf(o), ...(tracking ? { tracking } : {}) };
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
    /** Mensaje con botones; si los botones no salen, el mismo contenido en texto. Devuelve lo enviado (o null). */
    const sendMenu = async (body: string, buttons: ReadonlyArray<{ id: string; title: string }>, fallback: string) => {
      const b = deps.sender.sendButtons ? sendResult(await deps.sender.sendButtons(body, buttons).catch(() => false)) : null;
      if (b?.sent) {
        trace.sent = true;
        trace.delivery.text_wamid = b.wamid;
        return body;
      }
      return (await sendFixed(fallback)) ? fallback : null;
    };
    // Qué botón tocó (por id o por su texto exacto): lo decide el backend, nunca el modelo.
    const startAction = resolveStartAction(input.text, input.buttonId);
    const buttonChoice: OrderChannel | null = startAction === "classify_retail" ? "retail" : startAction === "classify_wholesale" ? "wholesale" : null;
    let current: CustomerChannel | null = null;
    try {
      if (!deps.classification) throw new Error("classification_store_missing");
      current = await deps.classification.get(key);
      if (current) trace.classification = { action: "known", channel: current.channel, origin: current.origin };
      else {
        // Primera vez: la solicitud del catálogo abierta de ESTA conversación (tienda detal o enlace
        // mayorista firmado) ya dice cómo compra; si no, lo que el cliente eligió en este mensaje.
        const fromCatalog = activeOrder && activeOrderSource === "catalog" && !["completed", "cancelled", "expired", "rejected"].includes(activeOrder.status) ? activeOrder.channel : null;
        // Bloque 28: "soy particular" / "es para mí" => detal (seguro); mayorista SOLO con la palabra ("mayor", "por mallor").
        const choice = fromCatalog ?? buttonChoice ?? parseChannelChoice(input.text) ?? modalidadInicial(input.text);
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
      // Primer mensaje de la conversación: el saludo del negocio va ARRIBA de la pregunta, en el mismo
      // mensaje (Bloque 26). Al volver a preguntar, solo la pregunta.
      const welcome = loaded.state.turn === 0 ? (deps.config.business.saludo ?? DEFAULT_WELCOME) : null;
      const text = await sendMenu(channelQuestionBody(welcome), CHANNEL_QUESTION.buttons, welcome ? `${welcome}\n\n${CHANNEL_QUESTION.textFallback}` : CHANNEL_QUESTION.textFallback);
      trace.state_saved = await deps.state.save(key, state, loaded.version).catch(() => false);
      return finish("replied", text);
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
    // Bloque 26 — acciones de inicio, fijas y sin modelo. El canal es SIEMPRE el guardado del contacto.
    const startDone = async (kind: NonNullable<AgentTurnTrace["start"]>, text: string | null) => {
      trace.start = kind;
      state = { ...state, channel: { value: current.channel, source: "customer_classification" } };
      trace.state_saved = await deps.state.save(key, state, loaded.version).catch(() => false);
      return finish("replied", text);
    };
    //   a) Acaba de elegir DETAL con el botón (o solo escribió "detal"): menú de intención. El mayorista
    //      sigue como antes (el agente conversa); un mensaje con más contenido ("detal, busco aretes") también.
    if (trace.classification?.action === "classified" && current.channel === "retail" && buttonChoice === "retail") {
      return startDone("intent_menu", await sendMenu(INTENT_MENU.body, INTENT_MENU.buttons, INTENT_MENU.textFallback));
    }
    //   b) "Buscar una joya": se le pide que escriba; lo que escriba entra a la búsqueda normal del agente.
    // Con un pedido en registro, "catálogo" / "buscar" los atiende el checkout (responde y repite su pregunta).
    if (startAction === "search_product" && !state.checkout) return startDone("search_prompt", (await sendFixed(START_MESSAGES.searchPrompt)) ? START_MESSAGES.searchPrompt : null);
    //   c) "Ver catálogo": el enlace REAL de la publicación para el canal GUARDADO (detal => tienda detal;
    //      mayorista => enlace mayorista firmado). El modelo no elige ni arma el enlace.
    if (startAction === "open_catalog" && !state.checkout) {
      const pub = await catalogPublication(deps.tools, input.tenantId, current.channel).catch(() => null);
      const text = pub ? START_MESSAGES.catalog(`${pub.origin}${pub.base}`) : START_MESSAGES.catalogUnavailable;
      return startDone("catalog_link", (await sendFixed(text)) ? text : null);
    }
    classified = { channel: current.channel, source: "customer_classification" };
  }
  const { channel, source } = classified ?? channelFor(deps.config, activeOrder);
  state = { ...state, channel: { value: channel, source } };

  // Bloque 27 — CHECKOUT CONVERSACIONAL (solo si el número lo tiene encendido): lo conduce el BACKEND,
  // sin modelo. El modelo solo detecta la intención (create_order_request, más abajo).
  const checkoutIO: CheckoutIO | null = deps.config.checkoutEnabled
    ? {
        engine: deps.tools.engine,
        tenantId: input.tenantId,
        contact,
        channel,
        requestId,
        turn: state.turn,
        businessName: deps.config.business.nombre_negocio ?? null,
        sendText: async (text) => {
          const r = sendResult(await deps.sender.sendText(text).catch(() => false));
          trace.sent = r.sent;
          trace.delivery.text_wamid = r.wamid;
          trace.delivery.text_error = r.error;
          return r.sent ? text : null;
        },
        sendMenu: async (body, buttons, fallback) => {
          const b = deps.sender.sendButtons ? sendResult(await deps.sender.sendButtons(body, buttons).catch(() => false)) : null;
          if (b?.sent) {
            trace.sent = true;
            trace.delivery.text_wamid = b.wamid;
            trace.delivery.text_error = null;
            return body;
          }
          const r = sendResult(await deps.sender.sendText(fallback).catch(() => false));
          trace.sent = r.sent;
          trace.delivery.text_wamid = r.wamid;
          trace.delivery.text_error = r.error;
          return r.sent ? fallback : null;
        },
        knownName: async () => (deps.tools.customerName ? deps.tools.customerName(key) : null),
        rememberName: deps.tools.rememberCustomerName ? (name) => deps.tools.rememberCustomerName!(key, name) : undefined,
        handOff: async (reason) => {
          try {
            // Pedido confirmado: la IA calla hasta que una persona la libere (nunca vuelve sola).
            const r = await deps.tools.engine.requestHandoff({ tenantId: input.tenantId, contact, reason, actor: "system", requestId, pauseUntil: "released" });
            return r.paused;
          } catch {
            return false;
          }
        },
        wamid: input.wamid,
        // Bloque 28: una PREGUNTA durante el checkout la responde el modelo SOLO con herramientas de lectura
        // (y el anclaje); el checkout no cambia y el backend repite la pregunta del paso.
        answerQuestion: (text, step) => answerSideQuestion(text, step),
      }
    : null;
  async function answerSideQuestion(text: string, step: CheckoutStep): Promise<string | null> {
    const readOnly = allowed.filter((t) => SIDE_QUESTION_TOOLS.includes(t));
    const rows = await deps.history.recent({ phoneNumberId: input.phoneNumberId, waId: input.waId, sinceIso: new Date(now() - HISTORY_WINDOW_MS).toISOString(), limit: HISTORY_MAX_TURNS * 2 + 4 }).catch(() => []);
    const qTurns: AITurn[] = [...historyTurns(rows, { excludeWamids: wamids }), { role: "user", text }];
    const qFacts: TurnFacts = {
      channel,
      channelSource: source,
      customerName: null,
      activeOrder,
      handoffActive: false,
      replyTo: null,
      selection: { selected: [], needsClarification: false },
      stage: { name: "registrando_pedido", guidance: SIDE_QUESTION_RULES(step) },
    };
    const qCtx: AgentTurnToolContext = {
      tenantId: input.tenantId,
      phoneNumberId: input.phoneNumberId,
      waId: input.waId,
      channel,
      requestId,
      wamid: input.wamid,
      turn: state.turn,
      state,
      pendingChoice: new Set(),
      designated: new Set(),
      customerText: text,
      images: [],
      handedOff: false,
      handoffMotive: null,
      newProposal: null,
    };
    const ev = emptyEvidence();
    addCustomerEvidence(text, ev);
    addEvidence(activeOrder, ev);
    addOrderStateEvidence(activeOrder, ev);
    for (const k of state.known) ev.refs.add(k.reference);
    const system = `${buildSystemInstruction(deps.config, state, qFacts)}\n\n=== PREGUNTA DURANTE EL REGISTRO DEL PEDIDO ===\n${SIDE_QUESTION_RULES(step)}`;
    try {
      for (let round = 0; round < 3; round++) {
        trace.rounds++;
        const r = await generateWithRetry(
          deps.provider,
          { model: deps.model, system, turns: qTurns, tools: agentToolDeclarations(readOnly), toolMode: round === 2 ? "none" : "auto", maxOutputTokens: limits.maxOutputTokens, ...(deps.config.thinking ? { thinking: deps.config.thinking } : {}), timeoutMs: limits.modelTimeoutMs },
          { deadlineAt, now, sleep: deps.retry?.sleep, random: deps.retry?.random, onRetry: () => trace.retries++ },
        );
        trace.model = r.model;
        trace.usage.input += r.usage.inputTokens ?? 0;
        trace.usage.output += r.usage.outputTokens ?? 0;
        trace.usage.thinking += r.usage.thinkingTokens ?? 0;
        trace.usage.cached += r.usage.cachedTokens ?? 0;
        if (r.finish === "safety") return null;
        if (r.toolCalls.length > 0 && round < 2) {
          qTurns.push({ role: "model", text: r.text, toolCalls: r.toolCalls, continuation: r.continuation });
          const results = [];
          for (const tc of r.toolCalls.slice(0, 3)) {
            const t0 = now();
            // Solo lectura: cualquier otra herramienta (update_cart, create_order_request…) => TOOL_NOT_ALLOWED.
            const outcome = await executeAgentTool(tc.name, tc.args, readOnly, qCtx, deps.tools);
            trace.tool_calls.push({ name: tc.name.slice(0, 40), result: outcome.ok ? "ok" : outcome.error.code, ms: now() - t0, args: summarizeArgs(tc.args) });
            const output = outcome.ok ? outcome.data : { error: outcome.error };
            addEvidence(output, ev);
            results.push({ callId: tc.id, name: tc.name, output });
          }
          for (const k of qCtx.state.known) ev.refs.add(k.reference);
          qTurns.push({ role: "tool", results });
          continue;
        }
        if (!r.text) return null;
        const check = checkGrounding(r.text, ev);
        if (!check.ok) {
          trace.grounding.violations.push(...check.violations.map((v) => v.kind));
          return null;
        }
        return r.text.trim().slice(0, 1_200);
      }
    } catch (err) {
      trace.error_kind = err instanceof AIProviderError ? `side_${err.kind}` : "side_error";
    }
    return null;
  }
  const checkoutDone = async (r: CheckoutResult) => {
    trace.checkout = { step: r.step, action: r.action };
    if (r.handedOff) trace.handoff = { source: "system", motive: "payment_or_delivery" };
    state = r.state;
    trace.state_saved = await deps.state.save(key, state, loaded.version).catch(() => false);
    return finish(r.handedOff ? "handoff" : r.action === "pending" || r.action === "failed" ? "fallback" : "replied", r.reply);
  };
  if (checkoutIO) {
    try {
      let r: CheckoutResult | null = null;
      if (state.checkout) {
        r = await continueCheckout(checkoutIO, state, { text: input.text, buttonId: input.buttonId }, activeOrder);
        if (!r) {
          // El pedido cambió por otro camino (vencido por abandono, cancelado, una asesora lo tomó): el
          // checkout se cierra y, si esa propuesta ya no existe, sus productos vuelven a la selección.
          const previo = state.checkout;
          state = { ...state, checkout: null };
          if (previo && state.cart.length === 0) {
            const viejo = await deps.tools.engine.getOrder({ tenantId: input.tenantId, contact, orderId: previo.orderId, requestId }).catch(() => null);
            if (viejo && (viejo.status === "expired" || viejo.status === "cancelled")) {
              state = { ...state, cart: viejo.lines.filter((l) => l.quantity > 0).map((l) => ({ reference: l.reference, quantity: Math.min(l.quantity, 99) })).slice(0, MAX_CART_LINES) };
            }
          }
        }
      } else if (isCheckoutButton(input.text, input.buttonId) && !(activeOrder?.status === "pending_confirmation" && parseSummaryAction(input.text, input.buttonId) === "confirm")) {
        // Un botón de un resumen viejo: nunca confirma ni cancela nada.
        r = await staleCheckoutButton(checkoutIO, state, activeOrder);
      } else if (
        activeOrder?.status === "pending_confirmation" &&
        activeOrder.channel === channel &&
        // "Confirmar" de un resumen viejo con otra propuesta abierta: se muestra el resumen NUEVO (nunca se confirma).
        (isCheckoutButton(input.text, input.buttonId) ||
          wantsCheckout(input.text) ||
          input.text.toUpperCase().includes(`SOLICITUD: ${activeOrder.order_id}`) ||
          (state.proposal?.orderId === activeOrder.order_id && state.proposal.presentedTurn !== null && isExplicitConfirmation(input.text)))
      ) {
        r = await startCheckout(checkoutIO, state, activeOrder, input.text);
      } else if (
        state.cart.length > 0 &&
        !(activeOrder && ["draft", "validated", "pending_confirmation"].includes(activeOrder.status)) &&
        wantsCheckout(input.text) &&
        typedRefs.length === 0 &&
        selection.selected.every((x) => state.cart.some((c) => c.reference === x.reference))
      ) {
        // "Quiero comprar" con productos ya elegidos: el backend crea la propuesta (misma regla que create_order_request).
        const created = await deps.tools.engine
          .createOrder({
            tenantId: input.tenantId,
            channel,
            source: "agent",
            contact,
            items: state.cart,
            idempotencyKey: conversationKey("agent", contact, `${input.wamid}|${requestFingerprint(channel, state.cart)}`),
            requestId,
          })
          .catch((err: unknown) => {
            if (err instanceof OrderError) return null;
            throw err;
          });
        if (created?.order.status === "pending_confirmation" && created.order.confirmation) {
          r = await startCheckout(checkoutIO, { ...state, activeOrderId: created.order.orderId }, publicView(created.order), input.text);
        } else if (created) {
          // Con problemas (agotado, retirado…): el agente se los explica con el pedido real a la vista.
          activeOrder = { ...publicView(created.order), next_step: nextStepOf(created.order) };
          state = { ...state, activeOrderId: created.order.orderId };
        }
      }
      if (r) return await checkoutDone(r);
    } catch {
      trace.error_kind = "checkout_failed";
      const sent = await checkoutIO.sendText(FALLBACK_MESSAGES.pending);
      trace.checkout = { step: state.checkout?.step ?? null, action: "pending" };
      trace.state_saved = await deps.state.save(key, state, loaded.version).catch(() => false);
      return finish("fallback", sent);
    }
  }

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
  addOrderStateEvidence(activeOrder, evidence);
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
    // Bloque 28: "eran 3" / "quita ese" sin decir cuál, con 2+ productos en la selección => se pregunta (nunca se elige).
    cartTargetAmbiguous: deps.config.checkoutEnabled && selection.selected.length === 0 && state.cart.length >= 2 && (leerCantidad(input.text) !== null || pideQuitar(input.text)),
    // Bloque 28 (auditoría final): cantidades y "todos" respaldados por lo que ESCRIBIÓ el cliente (sus mensajes recientes).
    ...(deps.config.checkoutEnabled
      ? {
          cartBacking: {
            numbers: numerosDelCliente([...rows.filter((r) => r.direccion === "entrante").slice(-4).map((r) => r.contenido ?? ""), input.text].join("\n")),
            cambio: leerCantidad(input.text),
            todos: selection.all ? selection.selected.map((x) => x.reference) : null,
            inicio: new Map(state.cart.map((c) => [c.reference, c.quantity])),
          },
        }
      : {}),
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
  /** Bloque 28: último rechazo de update_cart en el turno (solo con el checkout conversacional). */
  let cartError: string | null = null;
  let corrected = false;
  let forceText = false;
  let nudged = false;
  let checkoutOrderId: string | null = null;

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
          // Bloque 28: "actualicé tu pedido" solo con una escritura real sobre el pedido en este turno.
          if (outcome.ok && ["create_order_request", "validate_order", "confirm_order"].includes(tc.name)) evidence.orderWritten = true;
          // Bloque 28 (auditoría final; solo con el checkout conversacional): "listo" sin cambio real en la selección.
          if (tc.name === "update_cart" && deps.config.checkoutEnabled) {
            if (outcome.ok) evidence.cartWritten = true;
            else {
              evidence.cartBlocked = true;
              cartError = outcome.error.code;
            }
          }
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
        // Bloque 27: hay propuesta del backend => el checkout del sistema sigue (el modelo no la presenta).
        if (checkoutIO && ctx.newProposal && !ctx.handedOff) {
          checkoutOrderId = ctx.newProposal.orderId;
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
    if (reply === null && failure === null && checkoutOrderId === null) failure = "technical";
  } catch (err) {
    failure = "technical";
    trace.error_kind = err instanceof AIProviderError ? err.kind : "runtime_error";
  }

  // Bloque 27: el modelo detectó la compra y el backend creó la propuesta => empieza el checkout.
  if (checkoutIO && checkoutOrderId !== null && failure === null) {
    state = { ...ctx.state, failures: 0 };
    try {
      const o = await deps.tools.engine.getOrder({ tenantId: input.tenantId, contact, orderId: checkoutOrderId, requestId });
      if (o.status === "pending_confirmation") return await checkoutDone(await startCheckout(checkoutIO, state, publicView(o), input.text));
    } catch {
      // Sin el pedido a la vista: nunca se inventa un resumen.
    }
    trace.error_kind = "checkout_failed";
    const sent = await checkoutIO.sendText(FALLBACK_MESSAGES.pending);
    trace.checkout = { step: null, action: "pending" };
    trace.state_saved = await deps.state.save(key, state, loaded.version).catch(() => false);
    return finish("fallback", sent);
  }

  // 5) Fallos: mensaje fijo; dos fallos técnicos seguidos => asesora.
  let outcome: AgentTurnOutcome = ctx.handedOff ? "handoff" : "replied";
  if (failure) {
    const aclarar =
      failure === "unverified" && !evidence.cartWritten && cartError
        ? (CART_CLARIFY[cartError] ?? null)
        : failure === "unverified" && deps.config.checkoutEnabled && trace.grounding.violations.includes("order_status") && activeOrder
          ? realOrderStatus(activeOrder)
          : null;
    ctx.state = { ...ctx.state, failures: Math.min(10, ctx.state.failures + (failure === "safety" || failure === "pending" || aclarar ? 0 : 1)) };
    if (aclarar) {
      // Una pregunta concreta no es una falla: no suma para pasar a una asesora.
      reply = aclarar;
      outcome = "fallback";
    } else if (failure === "safety") {
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
