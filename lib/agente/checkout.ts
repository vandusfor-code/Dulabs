/**
 * Bloque 27 — CHECKOUT CONVERSACIONAL: la IA conversa, el BACKEND decide.
 *
 * El modelo solo detecta la intención de comprar (create_order_request) o el backend la reconoce
 * con frases fijas; desde ahí esta máquina de estados conduce, SIN modelo:
 *
 *   nombre (si no hay uno confiable) -> entrega [tienda | domicilio]
 *     -> (domicilio) dirección -> ciudad -> referencia (opcional)
 *     -> pago [pago en tienda | transferencia] -> RESUMEN (del motor) [confirmar | modificar | cancelar]
 *
 * - Nunca se pregunta persona natural/empresa, razón social, teléfono ni modalidad (el canal es el
 *   del contacto y queda congelado en el pedido).
 * - El resumen sale del motor (precios, total y propuesta vigentes); solo ESA propuesta se confirma.
 * - Confirmar: una transacción del motor (re-verifica canal, productos, precios, stock y propuesta;
 *   aparta el stock y guarda los datos del checkout). Si algo cambió, no se confirma: se explica y
 *   se muestra el resumen nuevo.
 * - Modificar / cancelar: la propuesta se cancela (sin reserva, nada que devolver) y los productos
 *   vuelven a la selección de la conversación.
 * - Tras confirmar: una asesora sigue la conversación (pausa de la IA) con un mensaje FIJO.
 *
 * Todo detrás de dulabs_agente_runtime_config.checkout_conversacional (false por defecto).
 */
import { formatCop } from "@/lib/business-agent-quote";
import { publicView, type OrderChannel, type OrderPublicView } from "@/lib/catalogo/pedidos/contrato";
import { OrderError, type CheckoutData, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import type { OrderContact } from "@/lib/catalogo/pedidos/repositorio";
import { MAX_CART_LINES, type CheckoutState, type CheckoutStep, type ConversationState } from "@/lib/agente/estado";

type Button = { id: string; title: string };

export const CHECKOUT_BUTTONS = {
  delivery: [
    { id: "checkout_tienda", title: "🏬 Recoger en tienda" },
    { id: "checkout_domicilio", title: "🏠 Domicilio" },
  ],
  reference: [{ id: "checkout_sin_referencia", title: "Sin referencia" }],
  payment: [
    { id: "checkout_pago_tienda", title: "💵 Pago en tienda" },
    { id: "checkout_transferencia", title: "🏦 Transferencia" },
  ],
  summary: [
    { id: "checkout_confirmar", title: "✅ Confirmar pedido" },
    { id: "checkout_modificar", title: "✏️ Modificar pedido" },
    { id: "checkout_cancelar", title: "❌ Cancelar" },
  ],
} as const satisfies Record<string, readonly Button[]>;

/** Mensajes FIJOS (sin IA). Nunca dicen "pago recibido", "enviado" ni "completado". */
export const CHECKOUT_MESSAGES = {
  intro: "¡Perfecto! 💖 Vamos a registrar tu pedido.",
  askName: "¿A nombre de quién registramos tu pedido?",
  askNameAgain: "Por favor escríbeme solo el nombre de la persona a nombre de quien registramos el pedido.",
  delivery: "¿Cómo deseas recibir tu pedido?",
  deliveryFallback: "¿Cómo deseas recibir tu pedido? Respóndeme *recoger en tienda* o *domicilio*.",
  address: "Perfecto. Envíame la dirección donde deseas recibir tu pedido.",
  addressAgain: "Por favor envíame la dirección completa donde deseas recibir tu pedido (calle, número y barrio si aplica).",
  city: "¿En qué ciudad?",
  cityAgain: "Por favor escríbeme la ciudad donde deseas recibir tu pedido.",
  reference: "¿Tienes alguna referencia para facilitar la entrega?",
  referenceFallback: "¿Tienes alguna referencia para facilitar la entrega? (Si no tienes, respóndeme *no*.)",
  payment: "¿Cómo deseas pagar?",
  paymentFallback: "¿Cómo deseas pagar? Respóndeme *pago en tienda* o *transferencia*.",
  summaryPrompt: "¿Confirmas tu pedido?",
  summaryFallback: "Respóndeme *confirmar*, *modificar* o *cancelar*.",
  chooseOption: "Para continuar, elige una opción:",
  confirmed: (business: string | null) =>
    `✅ Tu pedido quedó registrado correctamente.\n\nUna asesora continuará contigo para coordinar el pago y los siguientes pasos.\n\n${business ? `Gracias por comprar en ${business} 💖` : "¡Gracias por tu compra! 💖"}`,
  alreadyConfirmed: "✅ Tu pedido ya quedó registrado. Una asesora continuará contigo para coordinar el pago y los siguientes pasos.",
  modify: "Claro 😊 Tus productos siguen guardados.\n\nDime qué deseas cambiar (agregar, quitar o cambiar cantidades). Cuando quieras terminar, escríbeme *finalizar pedido*.",
  cancelled: "Listo, cancelé el registro de tu pedido: no quedó ninguna compra ni reserva.\n\nTus productos siguen guardados por si quieres retomarlo; escríbeme *finalizar pedido* cuando quieras.",
  stale: "Ese resumen ya no está vigente. Escríbeme *finalizar pedido* y te muestro el resumen actualizado.",
  updatedSummary: "Te comparto el resumen actualizado:",
  notConfirmed: "Tu pedido NO quedó confirmado y no se reservó nada. Dime qué deseas cambiar y te ayudo.",
  /** Falla conocida (nada se escribió). */
  failed: "Disculpa, no pude registrar tu pedido en este momento; no quedó confirmado. ¿Me escribes de nuevo en un momento?",
  /** Resultado desconocido (la escritura pudo quedar hecha): ni "listo" ni "falló". */
  pending: "Estoy verificando el estado de tu pedido. Escríbeme de nuevo en un momento y te confirmo cómo quedó.",
} as const;

// ---------------------------------------------------------------------------
// Lectura determinista de lo que escribió el cliente
// ---------------------------------------------------------------------------

/** Minúsculas, sin tildes ni signos/emojis, un espacio. */
const bare = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const TITLES = new Map<string, string>(Object.values(CHECKOUT_BUTTONS).flatMap((list) => list.map((b) => [bare(b.title), b.id] as const)));

/** Id de botón del checkout: el que llegó, o el del título EXACTO (el buzón guarda solo el texto). */
function buttonOf(text: string, buttonId?: string | null): string | null {
  if (buttonId && buttonId.startsWith("checkout_")) return buttonId;
  return TITLES.get(bare(text)) ?? null;
}

/** ¿Es el texto/id de un botón del checkout? (un clic en un resumen viejo fuera del checkout) */
export function isCheckoutButton(text: string, buttonId?: string | null): boolean {
  return buttonOf(text, buttonId) !== null;
}

const NOT_A_NAME = new Set(
  "si no ok okay dale listo hola buenas gracias cancelar cancela modificar confirmar confirmo domicilio tienda transferencia efectivo pago recoger detal mayor por mayor al detal nada ninguno ninguna yo mio"
    .split(" ")
    .concat(["buenos dias", "buenas tardes", "buenas noches", "a mi nombre", "mi nombre"]),
);

/** Nombre escrito por el cliente ("Laura Gómez", "me llamo Laura", "a nombre de Laura"). Nunca un teléfono. */
export function parseCustomerName(text: string): string | null {
  let t = text.trim().replace(/\s+/g, " ");
  t = t.replace(/^(a nombre de|mi nombre es|me llamo|soy|nombre\s*:)\s+/i, "").replace(/[.!,;]+$/g, "").trim();
  if (t.length < 2 || t.length > 60) return null;
  if (!/^\p{L}[\p{L} .'’-]*$/u.test(t)) return null;
  if (t.split(" ").length > 6) return null;
  if (NOT_A_NAME.has(bare(t))) return null;
  return t;
}

/** Nombre guardado confiable: con letras, sin ser (ni contener) un número de teléfono. */
export function isTrustedName(name: string | null | undefined): name is string {
  const t = (name ?? "").trim();
  if (t.length < 2 || t.length > 60) return false;
  if (!/\p{L}/u.test(t)) return false;
  if ((t.match(/\d/g) ?? []).length >= 3) return false;
  return !NOT_A_NAME.has(bare(t));
}

export function parseDelivery(text: string, buttonId?: string | null): "tienda" | "domicilio" | null {
  const b = buttonOf(text, buttonId);
  if (b === "checkout_tienda") return "tienda";
  if (b === "checkout_domicilio") return "domicilio";
  const t = bare(text);
  if (!t || t.length > 80) return null;
  const store = /\b(recoger|recojo|recogerlo|recogerla|recogerlos|recogerlas|tienda|local|paso por el|voy por el)\b/.test(t);
  const home = /\b(domicilio|envio|enviar|envien|enviarlo|enviarla|mandar|manden|mandarlo|a mi casa|a la casa)\b/.test(t);
  return store === home ? null : store ? "tienda" : "domicilio";
}

export function parsePayment(text: string, buttonId?: string | null): "pago_en_tienda" | "transferencia" | null {
  const b = buttonOf(text, buttonId);
  if (b === "checkout_pago_tienda") return "pago_en_tienda";
  if (b === "checkout_transferencia") return "transferencia";
  const t = bare(text);
  if (!t || t.length > 80) return null;
  const store = /\b(tienda|efectivo|local|en persona|al recoger|contra entrega)\b/.test(t);
  const transfer = /\b(transferencia|transferir|transfiero|consignacion|consignar|consigno|nequi|daviplata|bancolombia|pse)\b/.test(t);
  return store === transfer ? null : store ? "pago_en_tienda" : "transferencia";
}

const CONFIRM_WORDS = new Set(["confirmar pedido", "confirmar", "confirmo", "si", "si confirmo", "confirmo el pedido", "confirmo mi pedido", "confirmar mi pedido", "si confirmar", "si confirmo el pedido", "si confirmar pedido"]);
const MODIFY_WORDS = new Set(["modificar pedido", "modificar", "modificar mi pedido", "quiero modificar", "quiero modificar el pedido", "cambiar pedido", "cambiar mi pedido"]);
const CANCEL_WORDS = new Set(["cancelar", "cancelar pedido", "cancela", "cancelar mi pedido", "cancelar el pedido", "quiero cancelar", "cancelalo"]);

/**
 * Qué eligió el cliente frente al resumen. ESTRICTO: el botón, o el texto exacto (una ráfaga de
 * dos clics iguales cuenta como uno). "ok", "dale" o "perfecto" NO confirman un pedido real.
 */
export function parseSummaryAction(text: string, buttonId?: string | null): "confirm" | "modify" | "cancel" | null {
  const one = (b: string | null, t: string) =>
    b === "checkout_confirmar" || CONFIRM_WORDS.has(t) ? "confirm" : b === "checkout_modificar" || MODIFY_WORDS.has(t) ? "modify" : b === "checkout_cancelar" || CANCEL_WORDS.has(t) ? "cancel" : null;
  if (buttonId && buttonId.startsWith("checkout_")) return one(buttonId, "");
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  // Una pregunta ("¿sí?") nunca es una decisión.
  if (lines.length === 0 || lines.length > 4 || /[?¿]/.test(text)) return null;
  const actions = new Set(lines.map((l) => one(TITLES.get(bare(l)) ?? null, bare(l))));
  return actions.size === 1 ? ([...actions][0] ?? null) : null;
}

/** En cualquier paso: el cliente cancela o quiere modificar (nunca "sí"). */
export function parseEscape(text: string, buttonId?: string | null): "modify" | "cancel" | null {
  const a = parseSummaryAction(text, buttonId);
  return a === "confirm" ? null : a;
}

const ENTRY = [
  /^(quiero |me gustaria |deseo |vamos a |voy a |puedo |como puedo |como hago para )?(finalizar|terminar|cerrar|completar|hacer|realizar|confirmar|registrar)( (el|mi|la|este|esta|ese|esa))? (pedido|compra|orden)( (por favor|ya|ahora))?$/,
  /^(si )?(quiero|deseo) (comprar|pedir|llevar)(lo|la|los|las|melo|mela|melos|melas)?( (eso|esto|todo|todos|ya|ahora|por favor))*$/,
  /^(si )?(me )?(lo|la|los|las) llevo( (todo|todos|ya|por favor))*$/,
  /^(como|donde) (pago|puedo pagar|hago el pedido|hago la compra)$/,
  /^(quiero )?(comprar|pagar|finalizar)( pedido| compra)?$/,
];

/** Frase FIJA de "quiero comprar lo que tengo" (sin productos nuevos). */
export function wantsCheckout(text: string): boolean {
  const t = bare(text).replace(/^(hola|buenas|buenos dias|buenas tardes|buenas noches|ok|listo|perfecto|dale|bueno)( |$)/, "").trim();
  return t.length > 0 && t.length <= 60 && ENTRY.some((re) => re.test(t));
}

function freeText(text: string, min: number, max: number): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length < min || t.length > max) return null;
  if (!/[\p{L}\p{N}]/u.test(t)) return null;
  return t;
}
const NO_REFERENCE = new Set(["no", "ninguna", "ninguno", "no tengo", "sin referencia", "no hay", "nada", "no gracias", "asi esta bien", "no tengo referencia", "no ninguna"]);

// ---------------------------------------------------------------------------
// Resumen (del motor, nunca de la IA)
// ---------------------------------------------------------------------------

export function checkoutData(ck: CheckoutState): CheckoutData | null {
  if (!ck.customerName || !ck.delivery || !ck.paymentMethod) return null;
  if (ck.delivery === "domicilio" && (!ck.address || !ck.city)) return null;
  return {
    customerName: ck.customerName,
    paymentMethod: ck.paymentMethod,
    delivery: ck.delivery,
    address: ck.delivery === "domicilio" ? ck.address : null,
    city: ck.delivery === "domicilio" ? ck.city : null,
    deliveryReference: ck.delivery === "domicilio" ? ck.deliveryReference : null,
  };
}

export function summaryText(order: OrderPublicView, data: CheckoutData): string {
  const lines = order.lines.map((l) => `• ${l.product_name} (${l.reference}) × ${l.quantity} — ${l.subtotal === null ? "precio a consultar" : formatCop(l.subtotal)}`);
  const out = [`📋 *Resumen de tu pedido* (${order.order_id})`, "", ...lines, "", `*Total: ${formatCop(order.total)}*`];
  if (order.unpriced_units > 0) out.push("Algunos productos tienen precio a consultar: una asesora te confirma su valor.");
  out.push("", `👤 A nombre de: ${data.customerName}`);
  if (data.delivery === "tienda") out.push("🏬 Entrega: Recoger en tienda");
  else {
    out.push("🏠 Entrega: Domicilio", `📍 Dirección: ${data.address}, ${data.city}`);
    if (data.deliveryReference) out.push(`📝 Referencia: ${data.deliveryReference}`);
  }
  out.push(`💳 Pago: ${data.paymentMethod === "transferencia" ? "Transferencia" : "Pago en tienda"}`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Máquina de estados
// ---------------------------------------------------------------------------

export interface CheckoutIO {
  engine: Pick<OrderEngine, "validateOrder" | "confirmOrder" | "cancelProposal" | "getOrder">;
  tenantId: string;
  contact: OrderContact;
  channel: OrderChannel;
  requestId: string;
  turn: number;
  /** Nombre del negocio para el mensaje final (config del negocio; null = genérico). */
  businessName: string | null;
  /** Texto enviado (o null si no salió). */
  sendText(text: string): Promise<string | null>;
  /** Botones; si no salen, el texto alternativo. Devuelve lo enviado (o null). */
  sendMenu(body: string, buttons: readonly Button[], fallback: string): Promise<string | null>;
  /** Nombre conocido del cliente (puede ser el teléfono como marcador: se valida aquí). */
  knownName(): Promise<string | null>;
  rememberName?(name: string): Promise<void>;
  /** Pausa la IA en ESTA conversación (una asesora sigue). false = no se pudo. */
  handOff(reason: string): Promise<boolean>;
}

export type CheckoutAction =
  | "started"
  | "asked"
  | "invalid"
  | "summary"
  | "confirmed"
  | "already_confirmed"
  | "resummarized"
  | "not_confirmed"
  | "modified"
  | "cancelled"
  | "stale"
  | "failed"
  | "pending";

export interface CheckoutResult {
  state: ConversationState;
  reply: string | null;
  action: CheckoutAction;
  step: CheckoutStep | null;
  /** true si la conversación quedó en manos de una asesora (IA pausada). */
  handedOff: boolean;
}

const done = (state: ConversationState, reply: string | null, action: CheckoutAction, handedOff = false): CheckoutResult => ({
  state,
  reply,
  action,
  step: state.checkout?.step ?? null,
  handedOff,
});

/** El paso que sigue según lo que ya se tiene (orden fijo). */
function nextStep(ck: CheckoutState): CheckoutStep {
  if (!ck.customerName) return "name";
  if (!ck.delivery) return "delivery";
  if (ck.delivery === "domicilio") {
    if (!ck.address) return "address";
    if (!ck.city) return "city";
    if (ck.step === "reference") return "reference";
  }
  if (!ck.paymentMethod) return "payment";
  return "summary";
}

async function ask(io: CheckoutIO, step: CheckoutStep, prefix: string | null): Promise<string | null> {
  const p = (s: string) => (prefix ? `${prefix}\n\n${s}` : s);
  switch (step) {
    case "name":
      return io.sendText(p(CHECKOUT_MESSAGES.askName));
    case "delivery":
      return io.sendMenu(p(CHECKOUT_MESSAGES.delivery), CHECKOUT_BUTTONS.delivery, p(CHECKOUT_MESSAGES.deliveryFallback));
    case "address":
      return io.sendText(p(CHECKOUT_MESSAGES.address));
    case "city":
      return io.sendText(p(CHECKOUT_MESSAGES.city));
    case "reference":
      return io.sendMenu(p(CHECKOUT_MESSAGES.reference), CHECKOUT_BUTTONS.reference, p(CHECKOUT_MESSAGES.referenceFallback));
    case "payment":
      return io.sendMenu(p(CHECKOUT_MESSAGES.payment), CHECKOUT_BUTTONS.payment, p(CHECKOUT_MESSAGES.paymentFallback));
    case "summary":
      return io.sendMenu(p(CHECKOUT_MESSAGES.summaryPrompt), CHECKOUT_BUTTONS.summary, p(`${CHECKOUT_MESSAGES.summaryPrompt} ${CHECKOUT_MESSAGES.summaryFallback}`));
  }
}

/** Los productos del pedido vuelven a la selección (modificar / cancelar / no se pudo confirmar). */
function backToCart(state: ConversationState, order: OrderPublicView | null): ConversationState {
  const cart = order ? order.lines.filter((l) => l.quantity > 0).map((l) => ({ reference: l.reference, quantity: Math.min(l.quantity, 99) })).slice(0, MAX_CART_LINES) : state.cart;
  return { ...state, checkout: null, proposal: null, activeOrderId: null, ambiguity: null, cart };
}

/**
 * Empieza el checkout sobre una propuesta del motor (pending_confirmation) de ESTA conversación.
 * El nombre se reutiliza si hay uno confiable (nunca el teléfono).
 */
export async function startCheckout(io: CheckoutIO, state: ConversationState, order: OrderPublicView): Promise<CheckoutResult> {
  const known = await io.knownName().catch(() => null);
  const ck: CheckoutState = {
    orderId: order.order_id,
    step: "name",
    customerName: isTrustedName(known) ? known.trim() : null,
    delivery: null,
    address: null,
    city: null,
    deliveryReference: null,
    paymentMethod: null,
    summary: null,
    startedTurn: io.turn,
  };
  ck.step = nextStep(ck);
  const next: ConversationState = { ...state, checkout: ck, activeOrderId: order.order_id, cart: [], ambiguity: null };
  const reply = await ask(io, ck.step, CHECKOUT_MESSAGES.intro);
  return done(next, reply, "started");
}

/** Resumen desde el MOTOR (re-valida precios/stock y renueva la propuesta si hizo falta). */
async function summarize(io: CheckoutIO, state: ConversationState, ck: CheckoutState, prefix: string | null): Promise<CheckoutResult> {
  const data = checkoutData(ck);
  if (!data) {
    const step = nextStep(ck);
    const next = { ...state, checkout: { ...ck, step } };
    return done(next, await ask(io, step, prefix), "asked");
  }
  let order: OrderPublicView;
  try {
    order = publicView(await io.engine.validateOrder({ tenantId: io.tenantId, contact: io.contact, orderId: ck.orderId, actor: "agent", requestId: io.requestId }));
  } catch (err) {
    if (!(err instanceof OrderError)) throw err;
    return done({ ...state, checkout: { ...ck, step: "payment" } }, await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  if (order.channel !== io.channel) {
    // Modalidad congelada: un pedido de otro canal nunca se registra por aquí.
    return done(backToCart(state, null), await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  if (order.status !== "pending_confirmation" || !order.confirmation) {
    // El catálogo cambió y hay problemas (agotado, retirado…): se explica y no se confirma nada.
    const issues = order.issues.map((i) => i.message).slice(0, 5);
    await io.engine.cancelProposal({ tenantId: io.tenantId, contact: io.contact, orderId: ck.orderId, reason: "checkout_issues", requestId: io.requestId }).catch(() => null);
    const text = [prefix, ...issues, CHECKOUT_MESSAGES.notConfirmed].filter(Boolean).join("\n\n");
    return done(backToCart(state, order), await io.sendText(text), "not_confirmed");
  }
  const summary = summaryText(order, data);
  const nextCk: CheckoutState = { ...ck, step: "summary", summary: { confirmationId: order.confirmation.id, total: order.confirmation.total, turn: io.turn } };
  const next: ConversationState = { ...state, checkout: nextCk, activeOrderId: order.order_id };
  const head = [prefix, summary].filter(Boolean).join("\n\n");
  const body = `${head}\n\n${CHECKOUT_MESSAGES.summaryPrompt}`;
  // El cuerpo de un mensaje con botones admite 1024 caracteres: un resumen largo va antes, en texto.
  if (body.length <= 1000) {
    const reply = await io.sendMenu(body, CHECKOUT_BUTTONS.summary, `${body} ${CHECKOUT_MESSAGES.summaryFallback}`);
    return done(next, reply, "summary");
  }
  const first = await io.sendText(head);
  const menu = await ask(io, "summary", null);
  return done(next, first && menu ? `${first}\n\n${menu}` : (first ?? menu), "summary");
}

async function confirm(io: CheckoutIO, state: ConversationState, ck: CheckoutState, order: OrderPublicView): Promise<CheckoutResult> {
  const data = checkoutData(ck);
  // Solo el resumen MOSTRADO y vigente se confirma; si el pedido cambió, se muestra el nuevo.
  if (!data || !ck.summary || order.confirmation?.id !== ck.summary.confirmationId || order.confirmation.total !== ck.summary.total) {
    return summarize(io, state, ck, CHECKOUT_MESSAGES.updatedSummary);
  }
  try {
    await io.engine.confirmOrder({
      tenantId: io.tenantId,
      contact: io.contact,
      orderId: ck.orderId,
      confirmationId: ck.summary.confirmationId,
      actor: "agent",
      requestId: io.requestId,
      checkout: data,
      expectedChannel: io.channel,
    });
  } catch (err) {
    if (!(err instanceof OrderError)) {
      // No se sabe si quedó confirmado: nunca "listo" ni "falló". El próximo mensaje ve el estado real.
      return done(state, await io.sendText(CHECKOUT_MESSAGES.pending), "pending");
    }
    if (["PRICE_CHANGED", "OUT_OF_STOCK", "PRODUCT_UNAVAILABLE", "CONFIRMATION_EXPIRED", "CONFIRMATION_MISMATCH", "ORDER_HAS_ISSUES", "REFERENCE_NOT_FOUND"].includes(err.code)) {
      const r = await summarize(io, state, { ...ck, summary: null }, `${err.message}\n\n${CHECKOUT_MESSAGES.updatedSummary}`.trim());
      return { ...r, action: r.action === "summary" ? "resummarized" : r.action };
    }
    return done(state, await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  return finishConfirmed(io, state);
}

/** Pedido confirmado: se cierra el checkout y una asesora sigue (mensaje FIJO, nunca de la IA). */
async function finishConfirmed(io: CheckoutIO, state: ConversationState): Promise<CheckoutResult> {
  const next: ConversationState = { ...state, checkout: null, proposal: null, cart: [], ambiguity: null };
  const paused = await io.handOff("pedido confirmado").catch(() => false);
  const reply = await io.sendText(CHECKOUT_MESSAGES.confirmed(io.businessName));
  return done(paused ? { ...next, handoffTurn: io.turn } : next, reply, "confirmed", paused);
}

async function leave(io: CheckoutIO, state: ConversationState, ck: CheckoutState, order: OrderPublicView | null, kind: "modify" | "cancel"): Promise<CheckoutResult> {
  try {
    await io.engine.cancelProposal({ tenantId: io.tenantId, contact: io.contact, orderId: ck.orderId, reason: kind === "modify" ? "checkout_modify" : "checkout_cancelled_by_customer", requestId: io.requestId });
  } catch (err) {
    if (!(err instanceof OrderError)) return done(state, await io.sendText(CHECKOUT_MESSAGES.pending), "pending");
    // Ya confirmado por otro camino: no se cancela por aquí.
    if (err.code === "INVALID_TRANSITION") return done({ ...state, checkout: null }, await io.sendText(CHECKOUT_MESSAGES.alreadyConfirmed), "already_confirmed");
    if (err.code !== "NOT_FOUND") return done(state, await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  const next = backToCart(state, order);
  return done(next, await io.sendText(kind === "modify" ? CHECKOUT_MESSAGES.modify : CHECKOUT_MESSAGES.cancelled), kind === "modify" ? "modified" : "cancelled");
}

/**
 * Un mensaje con el checkout en curso. null = el checkout ya no aplica (el pedido cambió por otro
 * camino: vencido, cancelado, en manos de una asesora): quien llama lo cierra y el turno sigue normal.
 */
export async function continueCheckout(
  io: CheckoutIO,
  state: ConversationState,
  input: { text: string; buttonId?: string | null },
  order: (OrderPublicView & { next_step?: string }) | null,
): Promise<CheckoutResult | null> {
  const ck = state.checkout;
  if (!ck) return null;
  if (order && order.order_id === ck.orderId && order.status === "confirmed") {
    // Ya quedó confirmado (p. ej. la respuesta anterior no llegó a guardarse): se cierra igual, una vez.
    return finishConfirmed(io, state);
  }
  if (!order || order.order_id !== ck.orderId || order.status !== "pending_confirmation") {
    return null;
  }
  const escape = parseEscape(input.text, input.buttonId);
  if (escape) return leave(io, state, ck, order, escape);

  const save = (patch: Partial<CheckoutState>) => ({ ...ck, ...patch });
  const move = async (nextCk: CheckoutState, prefix: string | null = null) => {
    const step = nextStep(nextCk);
    if (step === "summary") return summarize(io, state, nextCk, prefix);
    return done({ ...state, checkout: { ...nextCk, step } }, await ask(io, step, prefix), "asked");
  };
  const again = async (text: string, step: CheckoutStep) => done(state, await ask(io, step, text), "invalid");

  switch (ck.step) {
    case "name": {
      const name = parseCustomerName(input.text);
      if (!name) return done(state, await io.sendText(CHECKOUT_MESSAGES.askNameAgain), "invalid");
      await io.rememberName?.(name).catch(() => undefined);
      return move(save({ customerName: name }));
    }
    case "delivery": {
      const d = parseDelivery(input.text, input.buttonId);
      if (!d) return again(CHECKOUT_MESSAGES.chooseOption, "delivery");
      const patch: Partial<CheckoutState> = d === "tienda" ? { delivery: d, address: null, city: null, deliveryReference: null } : { delivery: d };
      return move(save(patch));
    }
    case "address": {
      const a = freeText(input.text, 5, 300);
      if (!a || NO_REFERENCE.has(bare(a))) return done(state, await io.sendText(CHECKOUT_MESSAGES.addressAgain), "invalid");
      return move(save({ address: a }));
    }
    case "city": {
      const c = freeText(input.text, 2, 80);
      if (!c || !/\p{L}/u.test(c) || NO_REFERENCE.has(bare(c))) return done(state, await io.sendText(CHECKOUT_MESSAGES.cityAgain), "invalid");
      // La referencia es opcional, pero se pregunta (paso explícito).
      return move(save({ city: c, step: "reference" }));
    }
    case "reference": {
      const skip = buttonOf(input.text, input.buttonId) === "checkout_sin_referencia" || NO_REFERENCE.has(bare(input.text));
      const r = skip ? null : freeText(input.text, 2, 300);
      if (!skip && !r) return again(CHECKOUT_MESSAGES.chooseOption, "reference");
      return move(save({ deliveryReference: r, step: "payment" }));
    }
    case "payment": {
      const m = parsePayment(input.text, input.buttonId);
      if (!m) return again(CHECKOUT_MESSAGES.chooseOption, "payment");
      return move(save({ paymentMethod: m, step: "summary" }));
    }
    case "summary": {
      const action = parseSummaryAction(input.text, input.buttonId);
      if (action === "confirm") return confirm(io, state, ck, order);
      return again(CHECKOUT_MESSAGES.chooseOption, "summary");
    }
  }
}

/**
 * Clic en un botón del checkout SIN checkout en curso (un resumen viejo): nunca confirma nada.
 * Si el pedido de la conversación ya está confirmado, se dice; si no, el resumen ya no vale.
 */
export async function staleCheckoutButton(io: CheckoutIO, state: ConversationState, order: OrderPublicView | null): Promise<CheckoutResult> {
  const confirmed = order && (order.status === "confirmed" || order.status === "handoff");
  return done(state, await io.sendText(confirmed ? CHECKOUT_MESSAGES.alreadyConfirmed : CHECKOUT_MESSAGES.stale), confirmed ? "already_confirmed" : "stale");
}
