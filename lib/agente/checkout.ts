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
 *
 * Bloque 28 — lenguaje humano (lib/agente/lenguaje): antes de leer el dato del paso, cada mensaje se
 * clasifica: salida (cancelar / modificar) · duda · espera · PREGUNTA (se responde sin tocar nada y se
 * repite la pregunta del paso) · cambio de productos (cantidad / quitar, con el producto claro o se
 * pregunta cuál) · CORRECCIÓN de entrega o pago (se cambia ESE dato) · respuesta del paso (estricta:
 * una intención o una risa nunca es un nombre ni una dirección). El nombre se guarda en el contacto
 * solo cuando el pedido se confirma.
 */
import { formatCop } from "@/lib/business-agent-quote";
import { publicView, type OrderChannel, type OrderPublicView } from "@/lib/catalogo/pedidos/contrato";
import { OrderError, conversationKey, requestFingerprint, type CheckoutData, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { extractReferences } from "@/lib/catalogo/resolucion";
import type { OrderContact } from "@/lib/catalogo/pedidos/repositorio";
import { MAX_CART_LINES, type CheckoutState, type CheckoutStep, type ConversationState } from "@/lib/agente/estado";
import { isExplicitConfirmation } from "@/lib/agente/etapa";
import { resolveSelection } from "@/lib/agente/seleccion";
import {
  anunciaDireccion,
  esAfirmacion,
  esEspera,
  esPregunta,
  sinIntencionDeNombre,
  esRelleno,
  leerCantidad,
  leerCiudad,
  leerCorreccion,
  leerDireccion,
  leerEntrega,
  leerNombre,
  leerPago,
  leerSalida,
  pideCatalogo,
  pideElPedido,
  pideProducto,
  pideQuitar,
  pistasCheckout,
  type Cantidad,
} from "@/lib/agente/lenguaje/interpretar";
import { NUMEROS_EN_LETRAS } from "@/lib/agente/lenguaje/lexico";
import { normalizar } from "@/lib/agente/lenguaje/normalizar";

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
  /** "sí", "confirmo", "ok"… en el resumen: solo el botón registra el pedido (acción inequívoca). */
  tapToConfirm: "Para registrar tu pedido toca el botón ✅ Confirmar pedido.",
  confirmed: (business: string | null) =>
    `✅ Tu pedido quedó registrado correctamente.\n\nUna asesora continuará contigo para coordinar el pago y los siguientes pasos.\n\n${business ? `Gracias por comprar en ${business} 💖` : "¡Gracias por tu compra! 💖"}`,
  alreadyConfirmed: "✅ Tu pedido ya quedó registrado. Una asesora continuará contigo para coordinar el pago y los siguientes pasos.",
  modify: "Claro 😊 Tus productos siguen guardados.\n\nDime qué deseas cambiar (agregar, quitar o cambiar cantidades). Cuando quieras terminar, escríbeme *finalizar pedido*.",
  cancelled: "Listo, cancelé el registro de tu pedido: no quedó ninguna compra ni reserva.\n\nTus productos siguen guardados por si quieres retomarlo; escríbeme *finalizar pedido* cuando quieras.",
  stale: "Ese resumen ya no está vigente. Escríbeme *finalizar pedido* y te muestro el resumen actualizado.",
  updatedSummary: "Te comparto el resumen actualizado:",
  // --- Bloque 28: lenguaje humano dentro del checkout (fijos, sin IA) ---
  /** Pregunta que el asistente no pudo responder con datos verificados: nunca se inventa. */
  questionFallback: "Ese detalle te lo confirma una asesora apenas registremos tu pedido 😊",
  waiting: "Claro, aquí te espero 😊",
  doubt: "Claro 😊 ¿Qué quieres cambiar? Puedes escribirme, por ejemplo, *recoger en tienda*, *domicilio*, *transferencia* o *pago en tienda*. Para cambiar cantidades dime cuántas y de cuál producto.",
  productsViaModify: "Para agregar otros productos escríbeme *modificar pedido* (lo que ya elegiste se conserva). Si solo quieres cambiar cantidades, dime cuántas y de cuál producto.",
  whichProduct: (c: { tipo: "fijar" | "sumar" | "restar" | "quitar"; n: number }, lines: ReadonlyArray<{ product_name: string; quantity: number }>) =>
    `${c.tipo === "quitar" ? "Claro. ¿Cuál producto quieres quitar?" : c.tipo === "fijar" ? `Claro. ¿De cuál producto quieres ${c.n} ${c.n === 1 ? "unidad" : "unidades"}?` : "Claro. ¿De cuál producto?"}\n\n${lines
      .map((l, i) => `${i + 1}. ${l.product_name} (${l.quantity})`)
      .join("\n")}\n\nRespóndeme con el número.`,
  onlyProduct: "Ese es el único producto de tu pedido. Si ya no lo quieres, toca ❌ Cancelar; si quieres seguir, continuemos 😊",
  updated: "Listo, actualicé tu pedido ✨",
  noChange: (name: string, qty: number) => `Tu pedido ya tiene ${qty} ${qty === 1 ? "unidad" : "unidades"} de ${name}.`,
  noted: (c: { entrega?: "tienda" | "domicilio"; pago?: "pago_en_tienda" | "transferencia" }) =>
    [
      c.entrega ? (c.entrega === "tienda" ? "Anotado: *recoger en tienda* 🏬" : "Anotado: entrega a *domicilio* 🏠") : null,
      c.pago ? (c.pago === "transferencia" ? "Anotado: pago por *transferencia* 🏦" : "Anotado: pago *en tienda* 💵") : null,
    ]
      .filter(Boolean)
      .join("\n"),
  addressVague: "Para que llegue sin problema necesito la dirección exacta: calle o carrera, número y barrio 📍",
  addressAnnounce: "Claro, envíamela cuando quieras 😊",
  referenceAsk: "Claro, escríbeme la referencia (por ejemplo: portón azul, frente al parque).",
  noCashOnDelivery: "Por ahora no manejamos pago contra entrega 🙏 Puedes pagar por *transferencia* o *en la tienda*.",
  /** Ubicación compartida en el paso de la dirección (Bloque 28): se pide escrita, sin pasar a una asesora. */
  locationNeedsText: "Recibí tu ubicación 📍, pero para registrar el pedido necesito la dirección escrita: calle o carrera, número y barrio.",
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

/**
 * Nombre escrito por el cliente ("Laura Gómez", "me llamo Laura", "es Duvan", "a nombre de Laura").
 * Bloque 28: nunca un teléfono, una intención ("quiero dos aretes"), una pregunta, una risa ni un "ok".
 */
export function parseCustomerName(text: string): string | null {
  return leerNombre(text);
}

/** Nombre guardado confiable: con letras, sin ser (ni contener) un número de teléfono ni palabras que no son de un nombre. */
export function isTrustedName(name: string | null | undefined): name is string {
  const t = (name ?? "").trim();
  if (t.length < 2 || t.length > 60) return false;
  if (!/\p{L}/u.test(t)) return false;
  if ((t.match(/\d/g) ?? []).length >= 3) return false;
  return sinIntencionDeNombre(t);
}

export function parseDelivery(text: string, buttonId?: string | null): "tienda" | "domicilio" | null {
  const b = buttonOf(text, buttonId);
  if (b === "checkout_tienda") return "tienda";
  if (b === "checkout_domicilio") return "domicilio";
  return leerEntrega(text);
}

/** Pago elegido. `entrega` resuelve "cuando llegue" / "contra entrega" (con domicilio no se ofrece => null). */
export function parsePayment(text: string, buttonId?: string | null, entrega: "tienda" | "domicilio" | null = null): "pago_en_tienda" | "transferencia" | null {
  const b = buttonOf(text, buttonId);
  if (b === "checkout_pago_tienda") return "pago_en_tienda";
  if (b === "checkout_transferencia") return "transferencia";
  const p = leerPago(text, entrega);
  return p === "no_disponible" ? null : p;
}

/**
 * Confirmar es SOLO el botón (su id o su título exacto: el buzón de producción guarda el texto).
 * "sí", "confirmo", "ok", "dale" NO confirman un pedido real: el backend pide tocar el botón.
 */
const CONFIRM_TITLE = bare(CHECKOUT_BUTTONS.summary[0].title);
const MODIFY_WORDS = new Set(["modificar pedido", "modificar", "modificar mi pedido", "quiero modificar", "quiero modificar el pedido", "cambiar pedido", "cambiar mi pedido"]);
const CANCEL_WORDS = new Set(["cancelar", "cancelar pedido", "cancela", "cancelar mi pedido", "cancelar el pedido", "quiero cancelar", "cancelalo"]);

/**
 * Qué eligió el cliente frente al resumen. ESTRICTO: confirmar = el botón (id o título exacto; una
 * ráfaga de dos clics iguales cuenta como uno). Modificar / cancelar: el botón o la palabra exacta.
 */
export function parseSummaryAction(text: string, buttonId?: string | null): "confirm" | "modify" | "cancel" | null {
  const one = (b: string | null, t: string) =>
    b === "checkout_confirmar" || t === CONFIRM_TITLE ? "confirm" : b === "checkout_modificar" || MODIFY_WORDS.has(t) ? "modify" : b === "checkout_cancelar" || CANCEL_WORDS.has(t) ? "cancel" : null;
  if (buttonId && buttonId.startsWith("checkout_")) return one(buttonId, "");
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  // Una pregunta ("¿sí?") nunca es una decisión.
  if (lines.length === 0 || lines.length > 4 || /[?¿]/.test(text)) return null;
  const actions = new Set(lines.map((l) => one(TITLES.get(bare(l)) ?? null, bare(l))));
  return actions.size === 1 ? ([...actions][0] ?? null) : null;
}

/** En cualquier paso: el cliente cancela o quiere modificar (nunca "sí"). Bloque 28: también "cancela porfa", "ya no quiero", "mejor quiero otro". */
export function parseEscape(text: string, buttonId?: string | null): "modify" | "cancel" | null {
  const a = parseSummaryAction(text, buttonId);
  if (a === "confirm") return null;
  if (a) return a;
  if (buttonId && buttonId.startsWith("checkout_")) return null;
  const s = leerSalida(text);
  return s === "cancel" || s === "modify" ? s : null;
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
  // Bloque 28: sobre el texto NORMALIZADO ("kiero el pedido", "QUIEROOO COMPRAR", "hagamos el pedido").
  const t = normalizar(text).replace(/^(hola|buenas|buenos dias|buenas tardes|buenas noches|ok|listo|perfecto|dale|bueno)( |$)/, "").trim();
  return (t.length > 0 && t.length <= 60 && ENTRY.some((re) => re.test(t))) || pideElPedido(text);
}

function freeText(text: string, min: number, max: number): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length < min || t.length > max) return null;
  if (!/[\p{L}\p{N}]/u.test(t)) return null;
  return t;
}
const NO_REFERENCE = new Set(["no", "nop", "ninguna", "ninguno", "no tengo", "sin referencia", "no hay", "nada", "no gracias", "asi esta bien", "no tengo referencia", "no ninguna", "no hay referencia", "ninguna referencia", "sin", "no necesito"]);

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
  engine: Pick<OrderEngine, "validateOrder" | "confirmOrder" | "cancelProposal" | "getOrder" | "createOrder">;
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
  /** Bloque 28: wamid del mensaje (idempotencia al rehacer la propuesta por un cambio de cantidad). */
  wamid?: string;
  /**
   * Bloque 28: responde una PREGUNTA del cliente sin tocar el checkout (el modelo, solo con herramientas
   * de LECTURA y el anclaje). null = sin respuesta verificable: se dice que una asesora lo confirma.
   */
  answerQuestion?(text: string, step: CheckoutStep): Promise<string | null>;
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
  | "pending"
  // Bloque 28
  | "question"
  | "waiting"
  | "doubt"
  | "corrected"
  | "updated"
  | "unchanged"
  | "ask_target"
  | "only_product"
  | "products_via_modify";

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
  // Un prefijo largo (p. ej. una respuesta a una pregunta) va aparte: el cuerpo con botones admite 1024 caracteres.
  if (prefix && prefix.length > 700) {
    const first = await io.sendText(prefix);
    const rest = await ask(io, step, null);
    return first && rest ? `${first}\n\n${rest}` : (first ?? rest);
  }
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
export async function startCheckout(io: CheckoutIO, state: ConversationState, order: OrderPublicView, textoCompra: string | null = null): Promise<CheckoutResult> {
  const known = await io.knownName().catch(() => null);
  // Bloque 28: lo que el cliente YA dijo en el mismo mensaje ("soy Laura…, domicilio y transferencia") llena
  // campos vacíos; las preguntas del mensaje nunca cuentan. El resumen y el botón siguen siendo obligatorios.
  const pistas = textoCompra ? pistasCheckout(textoCompra) : {};
  const ck: CheckoutState = {
    orderId: order.order_id,
    step: "name",
    // El nombre dado en un checkout anterior de ESTA conversación (se salió con Modificar) va antes que el del contacto.
    customerName: pistas.nombre ?? (isTrustedName(state.checkoutName) ? state.checkoutName : isTrustedName(known) ? known.trim() : null),
    delivery: pistas.entrega ?? null,
    address: null,
    city: null,
    deliveryReference: null,
    paymentMethod: pistas.pago ?? null,
    summary: null,
    startedTurn: io.turn,
    pendingChange: null,
  };
  ck.step = nextStep(ck);
  const next: ConversationState = { ...state, checkout: ck, activeOrderId: order.order_id, cart: [], ambiguity: null };
  if (ck.step === "summary") return summarize(io, next, ck, CHECKOUT_MESSAGES.intro);
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
  const validate = async () => publicView(await io.engine.validateOrder({ tenantId: io.tenantId, contact: io.contact, orderId: ck.orderId, actor: "agent", requestId: io.requestId }));
  try {
    order = await validate();
    // Solo cambió el precio (el motor deja el pedido en borrador con el aviso): se re-valida con el
    // precio nuevo y se muestra el resumen NUEVO explicando el cambio. Stock o productos: no se arregla solo.
    if (order.status === "draft" && order.issues.length > 0 && order.issues.every((i) => i.code === "price_changed")) {
      const aviso = order.issues.map((i) => i.message).join("\n");
      order = await validate();
      if (order.status === "pending_confirmation") prefix = [prefix, `${aviso}\n\n${CHECKOUT_MESSAGES.updatedSummary}`].filter(Boolean).join("\n\n");
    }
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
  // Bloque 28: el nombre se guarda en el contacto SOLO con el pedido confirmado (antes era un dato en curso).
  const name = state.checkout?.customerName;
  if (name && isTrustedName(name)) await io.rememberName?.(name).catch(() => undefined);
  const next: ConversationState = { ...state, checkout: null, proposal: null, cart: [], ambiguity: null };
  delete next.checkoutName;
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
  // El nombre se conserva SOLO en esta conversación (no en el contacto) para no volver a pedirlo tras modificar.
  const name = isTrustedName(ck.customerName) ? ck.customerName : state.checkoutName;
  const next: ConversationState = { ...backToCart(state, order), ...(name ? { checkoutName: name } : {}) };
  return done(next, await io.sendText(kind === "modify" ? CHECKOUT_MESSAGES.modify : CHECKOUT_MESSAGES.cancelled), kind === "modify" ? "modified" : "cancelled");
}

// ---------------------------------------------------------------------------
// Bloque 28 — lenguaje humano dentro del checkout
// ---------------------------------------------------------------------------

type Entrega = "tienda" | "domicilio";
type Pago = "pago_en_tienda" | "transferencia";
type Cambio = { tipo: "fijar" | "sumar" | "restar" | "quitar"; n: number };
type Linea = OrderPublicView["lines"][number];

/** Lo que se le recuerda al cliente en cada paso (p. ej. tras una nota de voz). */
export const CHECKOUT_STEP_HINT: Readonly<Record<CheckoutStep, string>> = {
  name: "Escríbeme el nombre de la persona a nombre de quien registramos el pedido.",
  delivery: "Escríbeme si prefieres *domicilio* o *recoger en tienda*.",
  address: "Escríbeme la dirección (calle o carrera, número y barrio).",
  city: "Escríbeme la ciudad.",
  reference: "Escríbeme si tienes alguna referencia para la entrega (o *sin referencia*).",
  payment: "Escríbeme si pagas por *transferencia* o *en tienda*.",
  summary: "Toca ✅ Confirmar pedido, ✏️ Modificar pedido o ❌ Cancelar.",
};

/** Pregunta del cliente: se responde (solo lectura) y se repite la pregunta del paso. Nada cambia. */
async function answerAndRepeat(io: CheckoutIO, state: ConversationState, ck: CheckoutState, text: string): Promise<CheckoutResult> {
  const answer = io.answerQuestion ? await io.answerQuestion(text, ck.step).catch(() => null) : null;
  return done(state, await ask(io, ck.step, answer?.trim() || CHECKOUT_MESSAGES.questionFallback), "question");
}

/** Corrige entrega y/o pago (en cualquier paso) y sigue con lo que falte (o un resumen NUEVO). */
async function corregir(io: CheckoutIO, state: ConversationState, ck: CheckoutState, c: { entrega?: Entrega; pago?: Pago }): Promise<CheckoutResult> {
  let n: CheckoutState = { ...ck, summary: null, pendingChange: null };
  if (c.entrega) n = c.entrega === "tienda" ? { ...n, delivery: "tienda", address: null, city: null, deliveryReference: null } : { ...n, delivery: "domicilio" };
  if (c.pago) n = { ...n, paymentMethod: c.pago };
  const step = nextStep(n);
  const prefix = CHECKOUT_MESSAGES.noted(c);
  if (step === "summary") return summarize(io, state, { ...n, step }, prefix);
  return done({ ...state, checkout: { ...n, step } }, await ask(io, step, prefix), "corrected");
}

const NUMERO = (w: string): number | null => (/^\d{1,2}$/.test(w) ? Number(w) : (NUMEROS_EN_LETRAS[w] ?? null));

/** El producto del pedido al que se refiere el mensaje: el único, o el que la selección determinista señala. */
function objetivo(text: string, lines: readonly Linea[]): string | "ambiguo" {
  if (lines.length === 1) return lines[0].reference;
  const sel = resolveSelection(
    text,
    lines.map((l) => ({ reference: l.reference, name: l.product_name })),
    { typedReferences: extractReferences(text) },
  );
  return sel.selected.length === 1 ? sel.selected[0].reference : "ambiguo";
}

/** Cambio de cantidad EXPLÍCITO (no un número suelto: en un paso con opciones "2" puede ser la opción 2). */
function cambioDeCantidad(text: string): { cambio: Cambio; objetivoTexto: string } | null {
  const c: Cantidad | null = leerCantidad(text);
  const t = normalizar(text);
  if (c && !/^(\d{1,2}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)$/.test(t)) return { cambio: c, objetivoTexto: text };
  // "3 del primero", "quiero 2 del dorado", "ponme 4 de la pulsera"
  const m = /^(?:(?:quiero|ponme|dame|mejor|no|que sean|eran|cambia a|solo)\s+)*(\d{1,2}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)(?:\s+(?:unidades?|und|uds|u))?\s+(?:del|de la|de el|de los|de las|de)\s+(.+)$/.exec(t);
  if (m) {
    const n = NUMERO(m[1]);
    if (n && n >= 1 && n <= 99) return { cambio: { tipo: "fijar", n }, objetivoTexto: m[2] };
  }
  return null;
}

/** Cambia cantidades / quita un producto del pedido en curso: se rehace la propuesta y se conservan los datos del checkout. */
async function aplicarCambio(io: CheckoutIO, state: ConversationState, ck: CheckoutState, order: OrderPublicView, ref: string, cambio: Cambio): Promise<CheckoutResult> {
  const lines = order.lines.filter((l) => l.quantity > 0);
  const actual = lines.find((l) => l.reference === ref);
  if (!actual) return done(state, await ask(io, ck.step, CHECKOUT_MESSAGES.doubt), "doubt");
  const base: CheckoutState = { ...ck, pendingChange: null };
  const q = Math.min(99, cambio.tipo === "fijar" ? cambio.n : cambio.tipo === "sumar" ? actual.quantity + 1 : cambio.tipo === "restar" ? actual.quantity - 1 : 0);
  const items = lines.map((l) => ({ reference: l.reference, quantity: l.reference === ref ? q : l.quantity })).filter((l) => l.quantity > 0);
  if (items.length === 0) {
    const cancel = CHECKOUT_BUTTONS.summary[2];
    return done({ ...state, checkout: base }, await io.sendMenu(CHECKOUT_MESSAGES.onlyProduct, [cancel], `${CHECKOUT_MESSAGES.onlyProduct} (escríbeme *cancelar* si ya no lo quieres)`), "only_product");
  }
  if (q === actual.quantity) return done({ ...state, checkout: base }, await ask(io, ck.step, CHECKOUT_MESSAGES.noChange(actual.product_name, q)), "unchanged");
  return rehacer(io, state, base, items);
}

/**
 * Rehace la propuesta con las cantidades nuevas (el pedido confirmado nunca se toca: esto es ANTES de
 * confirmar). La propuesta vieja se cancela (sin reserva, nada que devolver); la nueva sale del motor
 * con precios y stock vigentes. Nombre, entrega y pago se conservan; el resumen se vuelve a mostrar.
 */
async function rehacer(io: CheckoutIO, state: ConversationState, ck: CheckoutState, items: Array<{ reference: string; quantity: number }>): Promise<CheckoutResult> {
  try {
    await io.engine.cancelProposal({ tenantId: io.tenantId, contact: io.contact, orderId: ck.orderId, reason: "checkout_quantity_change", requestId: io.requestId });
  } catch (err) {
    if (!(err instanceof OrderError)) return done(state, await io.sendText(CHECKOUT_MESSAGES.pending), "pending");
    if (err.code === "INVALID_TRANSITION") return done({ ...state, checkout: null }, await io.sendText(CHECKOUT_MESSAGES.alreadyConfirmed), "already_confirmed");
    if (err.code !== "NOT_FOUND") return done(state, await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  let created;
  try {
    created = await io.engine.createOrder({
      tenantId: io.tenantId,
      channel: io.channel,
      source: "agent",
      contact: io.contact,
      items,
      // Idempotente por mensaje + contenido: el reintento del mismo mensaje no crea otra propuesta.
      idempotencyKey: conversationKey("agent", io.contact, `${io.wamid ?? io.requestId}|${requestFingerprint(io.channel, items)}|checkout`),
      requestId: io.requestId,
    });
  } catch (err) {
    if (!(err instanceof OrderError)) throw err;
    return done({ ...state, checkout: null, proposal: null, activeOrderId: null, cart: items.slice(0, MAX_CART_LINES) }, await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  const o = publicView(created.order);
  if (o.status !== "pending_confirmation" || !o.confirmation) {
    const issues = o.issues.map((i) => i.message).slice(0, 5);
    await io.engine.cancelProposal({ tenantId: io.tenantId, contact: io.contact, orderId: o.order_id, reason: "checkout_issues", requestId: io.requestId }).catch(() => null);
    return done(backToCart(state, o), await io.sendText([...issues, CHECKOUT_MESSAGES.notConfirmed].join("\n\n")), "not_confirmed");
  }
  const n: CheckoutState = { ...ck, orderId: o.order_id, summary: null, pendingChange: null };
  const next: ConversationState = { ...state, activeOrderId: o.order_id };
  const step = ck.step === "summary" ? "summary" : nextStep(n);
  if (step === "summary") return summarize(io, next, { ...n, step }, CHECKOUT_MESSAGES.updated);
  return done({ ...next, checkout: { ...n, step } }, await ask(io, step, CHECKOUT_MESSAGES.updated), "updated");
}

/** Cambio de productos dentro del checkout (cantidad, quitar, "¿de cuál?" pendiente) o null si el mensaje no es eso. */
async function cambiarProductos(io: CheckoutIO, state: ConversationState, ck: CheckoutState, order: OrderPublicView, text: string): Promise<CheckoutResult | null> {
  const lines = order.lines.filter((l) => l.quantity > 0);
  // Respuesta a "¿de cuál producto?": el número de la lista, la referencia, la posición o un nombre inequívoco.
  if (ck.pendingChange) {
    const t = normalizar(text);
    const k = /^\d{1,2}$/.test(t) ? Number(t) : null;
    const ref = k && k >= 1 && k <= lines.length ? lines[k - 1].reference : objetivo(text, lines);
    if (ref !== "ambiguo") return aplicarCambio(io, state, ck, order, ref, ck.pendingChange);
  }
  const cant = cambioDeCantidad(text);
  const quitar = !cant && pideQuitar(text);
  if (!cant && !quitar) return pideProducto(text) ? done(state, await ask(io, ck.step, CHECKOUT_MESSAGES.productsViaModify), "products_via_modify") : null;
  const cambio: Cambio = cant ? cant.cambio : { tipo: "quitar", n: 0 };
  const ref = objetivo(cant ? cant.objetivoTexto : text, lines);
  if (ref === "ambiguo") return done({ ...state, checkout: { ...ck, pendingChange: cambio } }, await io.sendText(CHECKOUT_MESSAGES.whichProduct(cambio, lines)), "ask_target");
  return aplicarCambio(io, state, ck, order, ref, cambio);
}

/**
 * Un mensaje con el checkout en curso. null = el checkout ya no aplica (el pedido cambió por otro
 * camino: vencido, cancelado, en manos de una asesora): quien llama lo cierra y el turno sigue normal.
 *
 * Orden (Bloque 28): salida → botón de otro paso (corrección) → "¿de cuál?" pendiente → duda → espera
 * → PREGUNTA (se responde, nada cambia) → cambio de productos → corrección de entrega/pago → dato del paso.
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
  const text = input.text;
  const escape = parseEscape(text, input.buttonId);
  if (escape) return leave(io, state, ck, order, escape);

  const btn = buttonOf(text, input.buttonId);
  // Botón de entrega o de pago de un mensaje anterior, tocado en otro paso: corrige ESE dato.
  if ((btn === "checkout_tienda" || btn === "checkout_domicilio") && ck.step !== "delivery") return corregir(io, state, ck, { entrega: btn === "checkout_tienda" ? "tienda" : "domicilio" });
  if ((btn === "checkout_pago_tienda" || btn === "checkout_transferencia") && ck.step !== "payment") return corregir(io, state, ck, { pago: btn === "checkout_pago_tienda" ? "pago_en_tienda" : "transferencia" });

  if (!btn) {
    if (ck.pendingChange) {
      const r = await cambiarProductos(io, state, ck, order, text);
      if (r) return r;
    }
    if (leerSalida(text) === "doubt") return done(state, await ask(io, ck.step, CHECKOUT_MESSAGES.doubt), "doubt");
    if (esEspera(text)) return done(state, await io.sendText(CHECKOUT_MESSAGES.waiting), "waiting");
    if (ck.step === "address" && anunciaDireccion(text)) return done(state, await io.sendText(CHECKOUT_MESSAGES.addressAnnounce), "waiting");
    // Una PREGUNTA nunca es un dato: se responde y se repite la pregunta del paso (sin tocar nada).
    if (esPregunta(text) || pideCatalogo(text)) return answerAndRepeat(io, state, ck, text);
    const cambio = await cambiarProductos(io, state, ck, order, text);
    if (cambio) return cambio;
    const corr = leerCorreccion(text, ck.delivery);
    if (corr && ((corr.entrega && ck.step !== "delivery") || (corr.pago && ck.step !== "payment"))) return corregir(io, state, ck, corr);
  }

  const save = (patch: Partial<CheckoutState>) => ({ ...ck, ...patch, pendingChange: null });
  const move = async (nextCk: CheckoutState, prefix: string | null = null) => {
    const step = nextStep(nextCk);
    if (step === "summary") return summarize(io, state, nextCk, prefix);
    return done({ ...state, checkout: { ...nextCk, step } }, await ask(io, step, prefix), "asked");
  };
  const again = async (text: string, step: CheckoutStep) => done(state, await ask(io, step, text), "invalid");
  /** Otro dato que vino en el MISMO mensaje ("domicilio y transferencia"): solo llena lo vacío. */
  const extra = (c: CheckoutState): CheckoutState => {
    if (btn) return c;
    const x = leerCorreccion(text, c.delivery);
    return { ...c, ...(x?.pago && !c.paymentMethod && ck.step !== "payment" ? { paymentMethod: x.pago } : {}) };
  };

  switch (ck.step) {
    case "name": {
      const name = parseCustomerName(text);
      if (!name) return done(state, await io.sendText(CHECKOUT_MESSAGES.askNameAgain), "invalid");
      // Bloque 28: el nombre queda en el pedido en curso; se guarda en el contacto solo al confirmar.
      return move(save({ customerName: name }));
    }
    case "delivery": {
      const d = parseDelivery(text, input.buttonId);
      if (!d) return again(CHECKOUT_MESSAGES.chooseOption, "delivery");
      const patch: Partial<CheckoutState> = d === "tienda" ? { delivery: d, address: null, city: null, deliveryReference: null } : { delivery: d };
      return move(extra(save(patch)));
    }
    case "address": {
      const a = leerDireccion(text);
      if (a?.tipo === "vaga") return done(state, await io.sendText(CHECKOUT_MESSAGES.addressVague), "invalid");
      if (a?.tipo === "anuncio") return done(state, await io.sendText(CHECKOUT_MESSAGES.addressAnnounce), "waiting");
      if (!a || NO_REFERENCE.has(normalizar(a.valor))) return done(state, await io.sendText(CHECKOUT_MESSAGES.addressAgain), "invalid");
      return move(save({ address: a.valor }));
    }
    case "city": {
      const c = leerCiudad(text);
      if (!c || NO_REFERENCE.has(normalizar(c))) return done(state, await io.sendText(CHECKOUT_MESSAGES.cityAgain), "invalid");
      // La referencia es opcional, pero se pregunta (paso explícito).
      return move(save({ city: c, step: "reference" }));
    }
    case "reference": {
      const skip = btn === "checkout_sin_referencia" || NO_REFERENCE.has(normalizar(text));
      if (!skip && esAfirmacion(text)) return done(state, await io.sendText(CHECKOUT_MESSAGES.referenceAsk), "invalid");
      const r = skip ? null : esRelleno(text) ? null : freeText(text, 2, 300);
      if (!skip && !r) return again(CHECKOUT_MESSAGES.chooseOption, "reference");
      return move(save({ deliveryReference: r, step: "payment" }));
    }
    case "payment": {
      const m = btn ? parsePayment(text, input.buttonId) : leerPago(text, ck.delivery);
      if (m === "no_disponible") return again(CHECKOUT_MESSAGES.noCashOnDelivery, "payment");
      if (!m) return again(CHECKOUT_MESSAGES.chooseOption, "payment");
      return move(save({ paymentMethod: m, step: "summary" }));
    }
    case "summary": {
      const action = parseSummaryAction(text, input.buttonId);
      if (action === "confirm") return confirm(io, state, ck, order);
      // "sí", "sii", "confirmo", "ok", "dale"…: nunca confirman; se pide el botón (acción inequívoca).
      const afirma = esAfirmacion(text) || isExplicitConfirmation(text) || /\bconfirm/i.test(normalizar(text));
      return again(afirma ? CHECKOUT_MESSAGES.tapToConfirm : CHECKOUT_MESSAGES.chooseOption, "summary");
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
