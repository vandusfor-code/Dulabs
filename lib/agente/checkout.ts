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
 *
 * Multi-negocio: las entregas y los pagos que se ofrecen, su orden, sus políticas y los textos que
 * los enumeran salen del perfil del negocio (io.perfil, lib/agente/perfil-negocio.ts); igual el
 * vocabulario con que se reconoce un producto o un nombre. Una sola opción => no se pregunta. Más
 * de 3 => lista de WhatsApp (la decide quien envía). Antes de confirmar, el backend verifica que la
 * entrega y el pago sigan entre los ofrecidos.
 */
import { formatCop } from "@/lib/business-agent-quote";
import { publicView, type DeliveryType, type OrderChannel, type OrderPublicView, type PaymentMethod } from "@/lib/catalogo/pedidos/contrato";
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
  ciudadEnDireccion,
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
import {
  ENTREGA_INFO,
  PAGO_INFO,
  VOCABULARIO_NEUTRAL,
  ofreceEntrega,
  pagoPermitido,
  pagosPara,
  type CheckoutOpciones,
  type PerfilNegocio,
  type Vocabulario,
} from "@/lib/agente/perfil-negocio";

type Button = { id: string; title: string };

/** Botón de cada entrega y de cada pago del catálogo de la plataforma (cada negocio ofrece un subconjunto). */
export const DELIVERY_BUTTONS: Readonly<Record<DeliveryType, Button>> = { tienda: ENTREGA_INFO.tienda.boton, domicilio: ENTREGA_INFO.domicilio.boton };
export const PAYMENT_BUTTONS: Readonly<Record<PaymentMethod, Button>> = {
  pago_en_tienda: PAGO_INFO.pago_en_tienda.boton,
  transferencia: PAGO_INFO.transferencia.boton,
  contra_entrega: PAGO_INFO.contra_entrega.boton,
  link_pago: PAGO_INFO.link_pago.boton,
};

/** Botones de entrega que ofrece el negocio (en su orden). */
export const deliveryButtons = (o: Pick<CheckoutOpciones, "entregas">): Button[] => o.entregas.map((e) => DELIVERY_BUTTONS[e]);
/** Botones de pago que ofrece el negocio con esa entrega (en su orden). */
export const paymentButtons = (o: Pick<CheckoutOpciones, "entregas" | "pagos">, entrega: DeliveryType | null): Button[] => pagosPara(o, entrega).map((p) => PAYMENT_BUTTONS[p]);

export const CHECKOUT_BUTTONS = {
  reference: [{ id: "checkout_sin_referencia", title: "Sin referencia" }],
  summary: [
    { id: "checkout_confirmar", title: "✅ Confirmar pedido" },
    { id: "checkout_modificar", title: "✏️ Modificar pedido" },
    { id: "checkout_cancelar", title: "❌ Cancelar" },
  ],
} as const satisfies Record<string, readonly Button[]>;

/** Todos los botones del checkout de ESE negocio, por paso (los de pago: los que ofrece con cualquier entrega). */
export const checkoutButtons = (o: CheckoutOpciones) => ({ ...CHECKOUT_BUTTONS, delivery: deliveryButtons(o), payment: paymentButtons(o, null) });

/** Mensajes FIJOS (sin IA). Nunca dicen "pago recibido", "enviado" ni "completado". */
export const CHECKOUT_MESSAGES = {
  intro: "¡Perfecto! 💖 Vamos a registrar tu pedido.",
  askName: "¿A nombre de quién registramos tu pedido?",
  askNameAgain: "Por favor escríbeme solo el nombre de la persona a nombre de quien registramos el pedido.",
  delivery: "¿Cómo deseas recibir tu pedido?",
  address: "Perfecto. Envíame la dirección donde deseas recibir tu pedido.",
  addressAgain: "Por favor envíame la dirección completa donde deseas recibir tu pedido (calle, número y barrio si aplica).",
  city: "¿En qué ciudad?",
  cityAgain: "Por favor escríbeme la ciudad donde deseas recibir tu pedido.",
  reference: "¿Tienes alguna referencia para facilitar la entrega?",
  referenceFallback: "¿Tienes alguna referencia para facilitar la entrega? (Si no tienes, respóndeme *no*.)",
  payment: "¿Cómo deseas pagar?",
  summaryPrompt: "¿Confirmas tu pedido?",
  summaryFallback: "Respóndeme *confirmar*, *modificar* o *cancelar*.",
  chooseOption: "Para continuar, elige una opción:",
  /** "sí", "confirmo", "ok"… en el resumen: solo el botón registra el pedido (acción inequívoca). */
  tapToConfirm: "Para registrar tu pedido toca el botón ✅ Confirmar pedido.",
  confirmed: (business: string | null, note?: string | null, storeAddress?: string | null) =>
    `✅ Tu pedido quedó registrado correctamente.\n\nUna asesora continuará contigo para coordinar el pago y los siguientes pasos.${note ? `\n\n${note}` : ""}${storeAddress ? `\n\n📍 Te esperamos en: ${storeAddress}` : ""}\n\n${business ? `Gracias por comprar en ${business} 💖` : "¡Gracias por tu compra! 💖"}`,
  alreadyConfirmed: "✅ Tu pedido ya quedó registrado. Una asesora continuará contigo para coordinar el pago y los siguientes pasos.",
  modify: "Claro 😊 Tus productos siguen guardados.\n\nDime qué deseas cambiar (agregar, quitar o cambiar cantidades). Cuando quieras terminar, escríbeme *finalizar pedido*.",
  cancelled: "Listo, cancelé el registro de tu pedido: no quedó ninguna compra ni reserva.\n\nTus productos siguen guardados por si quieres retomarlo; escríbeme *finalizar pedido* cuando quieras.",
  stale: "Ese resumen ya no está vigente. Escríbeme *finalizar pedido* y te muestro el resumen actualizado.",
  updatedSummary: "Te comparto el resumen actualizado:",
  // --- Bloque 28: lenguaje humano dentro del checkout (fijos, sin IA) ---
  /** Pregunta que el asistente no pudo responder con datos verificados: nunca se inventa. */
  questionFallback: "Ese detalle te lo confirma una asesora apenas registremos tu pedido 😊",
  waiting: "Claro, aquí te espero 😊",
  productsViaModify: "Para agregar otros productos escríbeme *modificar pedido* (lo que ya elegiste se conserva). Si solo quieres cambiar cantidades, dime cuántas y de cuál producto.",
  whichProduct: (c: { tipo: "fijar" | "sumar" | "restar" | "quitar"; n: number }, lines: ReadonlyArray<{ product_name: string; quantity: number }>) =>
    `${c.tipo === "quitar" ? "Claro. ¿Cuál producto quieres quitar?" : c.tipo === "fijar" ? `Claro. ¿De cuál producto quieres ${c.n} ${c.n === 1 ? "unidad" : "unidades"}?` : "Claro. ¿De cuál producto?"}\n\n${lines
      .map((l, i) => `${i + 1}. ${l.product_name} (${l.quantity})`)
      .join("\n")}\n\nRespóndeme con el número.`,
  onlyProduct: "Ese es el único producto de tu pedido. Si ya no lo quieres, toca ❌ Cancelar; si quieres seguir, continuemos 😊",
  updated: "Listo, actualicé tu pedido ✨",
  noChange: (name: string, qty: number) => `Tu pedido ya tiene ${qty} ${qty === 1 ? "unidad" : "unidades"} de ${name}.`,
  noted: (c: { entrega?: DeliveryType; pago?: PaymentMethod }) =>
    [c.entrega ? ENTREGA_INFO[c.entrega].anotado : null, c.pago ? PAGO_INFO[c.pago].anotado : null].filter(Boolean).join("\n"),
  addressVague: "Para que llegue sin problema necesito la dirección exacta: calle o carrera, número y barrio 📍",
  addressAnnounce: "Claro, envíamela cuando quieras 😊",
  referenceAsk: "Claro, escríbeme la referencia (por ejemplo: portón azul, frente al parque).",
  /** Ubicación compartida en el paso de la dirección (Bloque 28): se pide escrita, sin pasar a una asesora. */
  locationNeedsText: "Recibí tu ubicación 📍, pero para registrar el pedido necesito la dirección escrita: calle o carrera, número y barrio.",
  /** Foto o documento en el paso de la dirección o la ciudad (p. ej. captura de la dirección): se pide escrito. */
  mediaNeedsText: (step: "address" | "city") =>
    step === "address"
      ? "Recibí tu archivo 📎, pero para registrar el pedido necesito la dirección escrita: calle o carrera, número y barrio."
      : "Recibí tu archivo 📎, pero para registrar el pedido necesito que me escribas la ciudad.",
  notConfirmed: "Tu pedido NO quedó confirmado y no se reservó nada. Dime qué deseas cambiar y te ayudo.",
  /** Falla conocida (nada se escribió). */
  failed: "Disculpa, no pude registrar tu pedido en este momento; no quedó confirmado. ¿Me escribes de nuevo en un momento?",
  /** Resultado desconocido (la escritura pudo quedar hecha): ni "listo" ni "falló". */
  pending: "Estoy verificando el estado de tu pedido. Escríbeme de nuevo en un momento y te confirmo cómo quedó.",
} as const;

/** "a", "a o b", "a, b o c". */
const listaO = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} o ${xs[xs.length - 1]}`);
const negrita = (s: string) => `*${s}*`;

/**
 * Textos FIJOS (sin IA) que enumeran lo que el negocio OFRECE. Salen de sus opciones: nunca nombran
 * un método que no ofrece. Los que el negocio escribió (`mensajes`) van tal cual.
 */
export function checkoutOptionTexts(o: CheckoutOpciones) {
  const m = o.mensajes ?? {};
  const entregas = o.entregas.map((e) => ENTREGA_INFO[e].palabra);
  const pagos = (entrega: DeliveryType | null) => pagosPara(o, entrega).map((p) => PAGO_INFO[p].palabra);
  const cambiables = [...(entregas.length > 1 ? entregas : []), ...(pagos(null).length > 1 ? pagos(null) : [])];
  return {
    deliveryFallback: `${CHECKOUT_MESSAGES.delivery} Respóndeme ${listaO(entregas.map(negrita))}.`,
    /** "Respóndeme *a* o *b*." con los pagos de ESA entrega. */
    paymentChoices: (entrega: DeliveryType | null) => `Respóndeme ${listaO(pagos(entrega).map(negrita))}.`,
    doubt:
      m.duda ??
      `Claro 😊 ¿Qué quieres cambiar? ${cambiables.length > 0 ? `Puedes escribirme, por ejemplo, ${listaO(cambiables.map(negrita))}. ` : ""}Para cambiar cantidades dime cuántas y de cuál producto.`,
    /** Pidió un pago que no se ofrece con su entrega. */
    paymentUnavailable: (pedido: PaymentMethod, entrega: DeliveryType | null) =>
      m.pago_no_disponible ?? `Por ahora no manejamos ${PAGO_INFO[pedido].nombre} 🙏 Puedes pagar con ${listaO(pagos(entrega).map(negrita))}.`,
    /** Pidió una entrega que el negocio no ofrece. */
    deliveryUnavailable: (pedida: DeliveryType) => `Por ahora no manejamos ${ENTREGA_INFO[pedida].palabra} 🙏 Podemos hacerlo por ${listaO(entregas.map(negrita))}.`,
    deliveryHint: m.recordatorio_entrega ?? `Escríbeme si prefieres ${listaO(entregas.map(negrita))}.`,
    paymentHint: (entrega: DeliveryType | null) => m.recordatorio_pago ?? `Escríbeme cómo pagas: ${listaO(pagos(entrega).map(negrita))}.`,
  };
}

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

const ENTREGA_POR_ID = new Map<string, DeliveryType>(Object.entries(DELIVERY_BUTTONS).map(([e, b]) => [b.id, e as DeliveryType]));
const PAGO_POR_ID = new Map<string, PaymentMethod>(Object.entries(PAYMENT_BUTTONS).map(([p, b]) => [b.id, p as PaymentMethod]));
/** Títulos del resumen y de la referencia (iguales para todos los negocios). */
const FIXED_TITLES = new Map<string, string>(Object.values(CHECKOUT_BUTTONS).flatMap((list) => list.map((b) => [bare(b.title), b.id] as const)));

/** Botones que ESTE negocio puede haber enviado: sus entregas, sus pagos, la referencia y el resumen. */
function offeredButtons(o: CheckoutOpciones): Button[] {
  return [...deliveryButtons(o), ...paymentButtons(o, null), ...Object.values(CHECKOUT_BUTTONS).flat()];
}

/**
 * Id de botón del checkout: el que llegó, o el del título EXACTO (el buzón guarda solo el texto). Solo
 * botones de lo que el negocio ofrece: el título de un método que no ofrece no es un botón.
 */
function buttonOf(text: string, buttonId: string | null | undefined, o: CheckoutOpciones): string | null {
  const offered = offeredButtons(o);
  if (buttonId && buttonId.startsWith("checkout_")) return offered.some((b) => b.id === buttonId) ? buttonId : null;
  const t = bare(text);
  return offered.find((b) => bare(b.title) === t)?.id ?? null;
}

/** ¿Es el texto/id de un botón del checkout de este negocio? (un clic en un resumen viejo fuera del checkout) */
export function isCheckoutButton(text: string, buttonId: string | null | undefined, o: CheckoutOpciones): boolean {
  return buttonOf(text, buttonId, o) !== null;
}

/**
 * Nombre escrito por el cliente ("Laura Gómez", "me llamo Laura", "es Duvan", "a nombre de Laura").
 * Bloque 28: nunca un teléfono, una intención ("quiero dos aretes"), una pregunta, una risa ni un "ok".
 */
export function parseCustomerName(text: string, vocabulario: Vocabulario = VOCABULARIO_NEUTRAL): string | null {
  return leerNombre(text, vocabulario);
}

/** Nombre guardado confiable: con letras, sin ser (ni contener) un número de teléfono ni palabras que no son de un nombre. */
export function isTrustedName(name: string | null | undefined, vocabulario: Vocabulario = VOCABULARIO_NEUTRAL): name is string {
  const t = (name ?? "").trim();
  if (t.length < 2 || t.length > 60) return false;
  if (!/\p{L}/u.test(t)) return false;
  if ((t.match(/\d/g) ?? []).length >= 3) return false;
  return sinIntencionDeNombre(t, vocabulario);
}

/** Entrega elegida, solo entre las que ofrece el negocio. */
export function parseDelivery(text: string, o: CheckoutOpciones, buttonId: string | null = null): DeliveryType | null {
  const b = buttonOf(text, buttonId, o);
  const porBoton = b ? ENTREGA_POR_ID.get(b) : undefined;
  if (porBoton) return porBoton;
  const e = leerEntrega(text);
  return e && ofreceEntrega(o, e) ? e : null;
}

/** Pago elegido, solo entre los que ofrece el negocio. `entrega` resuelve "cuando llegue" / "contra entrega" (si no se ofrece => null). */
export function parsePayment(text: string, o: CheckoutOpciones, buttonId: string | null = null, entrega: DeliveryType | null = null): PaymentMethod | null {
  const b = buttonOf(text, buttonId, o);
  const porBoton = b ? PAGO_POR_ID.get(b) : undefined;
  if (porBoton) return porBoton;
  const p = leerPago(text, entrega, o);
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
  const actions = new Set(lines.map((l) => one(FIXED_TITLES.get(bare(l)) ?? null, bare(l))));
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

/**
 * Datos completos del checkout, o null. Con `o`, además, la entrega y el pago deben estar entre los que
 * el negocio OFRECE (la última verificación del backend antes de registrar el pedido).
 */
export function checkoutData(ck: CheckoutState, o?: CheckoutOpciones): CheckoutData | null {
  if (!ck.customerName || !ck.delivery || !ck.paymentMethod) return null;
  if (o && (!ofreceEntrega(o, ck.delivery) || !pagoPermitido(o, ck.paymentMethod, ck.delivery))) return null;
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

/** Bloque 32: textos del negocio para el checkout (config `negocio.pedido`). Todo opcional. */
export interface CheckoutTexts {
  paymentQuestion?: string;
  shippingNote?: string;
  /** Compra INICIAL mayorista (COP): la primera compra de un mayorista no se registra por debajo. */
  wholesaleMinimum?: number;
  confirmedNote?: string;
  /** Dirección de la tienda (resumen y mensaje final cuando recoge en tienda). */
  storeAddress?: string;
}

/** Mensaje FIJO cuando la primera compra mayorista no llega al mínimo (el pedido no se registra). */
export const wholesaleMinimumBlocked = (total: number, minimum: number) =>
  `Tu pedido suma *${formatCop(total)}* 💎\n\nPara tu primera compra al por mayor, el pedido mínimo es de *${formatCop(minimum)}*: te faltan *${formatCop(minimum - total)}*.\n\nTus productos siguen guardados: puedes agregar más referencias y, cuando quieras, escríbeme *finalizar pedido*. Si prefieres, te comunico con una asesora ✨`;

export function summaryText(order: OrderPublicView, data: CheckoutData, texts: CheckoutTexts = {}): string {
  const lines = order.lines.map((l) => `• ${l.product_name} (${l.reference}) × ${l.quantity} — ${l.subtotal === null ? "precio a consultar" : formatCop(l.subtotal)}`);
  const out = [`📋 *Resumen de tu pedido* (${order.order_id})`, "", ...lines, "", `*Total: ${formatCop(order.total)}*`];
  if (order.unpriced_units > 0) out.push("Algunos productos tienen precio a consultar: una asesora te confirma su valor.");
  out.push("", `👤 A nombre de: ${data.customerName}`);
  if (data.delivery === "tienda") {
    out.push(ENTREGA_INFO.tienda.resumen);
    if (texts.storeAddress) out.push(`📍 Dirección de la tienda: ${texts.storeAddress}`);
  }
  else {
    out.push(ENTREGA_INFO.domicilio.resumen, `📍 Dirección: ${data.address}, ${data.city}`);
    if (data.deliveryReference) out.push(`📝 Referencia: ${data.deliveryReference}`);
  }
  out.push(`💳 Pago: ${PAGO_INFO[data.paymentMethod].resumen}`);
  if (data.delivery === "domicilio" && texts.shippingNote) out.push(`🚚 ${texts.shippingNote}`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Máquina de estados
// ---------------------------------------------------------------------------

export interface CheckoutIO {
  engine: Pick<OrderEngine, "validateOrder" | "confirmOrder" | "cancelProposal" | "getOrder" | "createOrder"> & Partial<Pick<OrderEngine, "hasPurchase">>;
  tenantId: string;
  contact: OrderContact;
  channel: OrderChannel;
  requestId: string;
  turn: number;
  /** Nombre del negocio para el mensaje final (config del negocio; null = genérico). */
  businessName: string | null;
  /** Perfil del negocio: su vocabulario y las entregas/pagos que OFRECE (config explícita, nunca del modelo). */
  perfil: PerfilNegocio;
  /** Bloque 32: textos del negocio (pregunta de pago, nota de envío, mínimo mayorista, nota final). */
  texts?: CheckoutTexts;
  /** Bloque 34: el equipo lo marcó como cliente antiguo (ya compró fuera del bot): sin compra inicial. */
  alreadyCustomer?: () => Promise<boolean>;
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

/**
 * Lo que decide el NEGOCIO, no el cliente: un pago que ya no aplica a la entrega elegida se borra (se
 * vuelve a preguntar) y una opción ÚNICA se llena sola (no se pregunta). Con dos o más, nada cambia.
 */
function completar(ck: CheckoutState, o: CheckoutOpciones): CheckoutState {
  let n = ck;
  if (!n.delivery && o.entregas.length === 1) n = { ...n, delivery: o.entregas[0] };
  if (n.paymentMethod && n.delivery && !pagoPermitido(o, n.paymentMethod, n.delivery)) n = { ...n, paymentMethod: null };
  if (!n.paymentMethod && n.delivery) {
    const pagos = pagosPara(o, n.delivery);
    if (pagos.length === 1) n = { ...n, paymentMethod: pagos[0] };
  }
  return n;
}

async function ask(io: CheckoutIO, step: CheckoutStep, prefix: string | null, entrega: DeliveryType | null): Promise<string | null> {
  // Un prefijo largo (p. ej. una respuesta a una pregunta) va aparte: el cuerpo con botones admite 1024 caracteres.
  if (prefix && prefix.length > 700) {
    const first = await io.sendText(prefix);
    const rest = await ask(io, step, null, entrega);
    return first && rest ? `${first}\n\n${rest}` : (first ?? rest);
  }
  const p = (s: string) => (prefix ? `${prefix}\n\n${s}` : s);
  const o = io.perfil.opciones;
  const t = checkoutOptionTexts(o);
  switch (step) {
    case "name":
      return io.sendText(p(CHECKOUT_MESSAGES.askName));
    case "delivery":
      return io.sendMenu(p(CHECKOUT_MESSAGES.delivery), deliveryButtons(o), p(t.deliveryFallback));
    case "address":
      return io.sendText(p(CHECKOUT_MESSAGES.address));
    case "city":
      return io.sendText(p(CHECKOUT_MESSAGES.city));
    case "reference":
      return io.sendMenu(p(CHECKOUT_MESSAGES.reference), CHECKOUT_BUTTONS.reference, p(CHECKOUT_MESSAGES.referenceFallback));
    case "payment": {
      const question = io.texts?.paymentQuestion;
      return question
        ? io.sendMenu(p(question), paymentButtons(o, entrega), p(`${question}\n\n${t.paymentChoices(entrega)}`))
        : io.sendMenu(p(CHECKOUT_MESSAGES.payment), paymentButtons(o, entrega), p(`${CHECKOUT_MESSAGES.payment} ${t.paymentChoices(entrega)}`));
    }
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
 * Bloque 32 — regla de COMPRA INICIAL mayorista (config `negocio.pedido.minimo_mayorista`): si es la
 * primera compra del contacto (ningún pedido confirmado o completado) y el pedido no llega al mínimo,
 * no se registra. Devuelve el mensaje a enviar, o null si el pedido puede seguir. Si no se puede saber
 * si ya compró, se aplica la regla (la asesora puede atenderlo igual).
 */
async function minimoMayorista(io: CheckoutIO, order: OrderPublicView): Promise<string | null> {
  const minimum = io.texts?.wholesaleMinimum;
  if (!minimum || io.channel !== "wholesale" || order.channel !== "wholesale" || order.total >= minimum) return null;
  const bought =
    (io.engine.hasPurchase ? await io.engine.hasPurchase({ tenantId: io.tenantId, contact: io.contact }).catch(() => false) : false) ||
    (io.alreadyCustomer ? await io.alreadyCustomer().catch(() => false) : false);
  return bought ? null : wholesaleMinimumBlocked(order.total, minimum);
}

/** El pedido no llega a la compra inicial: se anula la propuesta y los productos vuelven al carrito. */
async function blockedByMinimum(io: CheckoutIO, state: ConversationState, order: OrderPublicView, message: string, prefix: string | null = null): Promise<CheckoutResult> {
  await io.engine.cancelProposal({ tenantId: io.tenantId, contact: io.contact, orderId: order.order_id, reason: "minimo_mayorista", requestId: io.requestId }).catch(() => null);
  return done(backToCart(state, order), await io.sendText([prefix, message].filter(Boolean).join("\n\n")), "not_confirmed");
}

/**
 * Empieza el checkout sobre una propuesta del motor (pending_confirmation) de ESTA conversación.
 * El nombre se reutiliza si hay uno confiable (nunca el teléfono).
 */
export async function startCheckout(io: CheckoutIO, state: ConversationState, order: OrderPublicView, textoCompra: string | null = null): Promise<CheckoutResult> {
  // Bloque 32: la primera compra mayorista por debajo del mínimo no empieza el registro.
  const bloqueo = await minimoMayorista(io, order);
  if (bloqueo) return blockedByMinimum(io, state, order, bloqueo);
  const known = await io.knownName().catch(() => null);
  const { vocabulario, opciones } = io.perfil;
  // Bloque 28: lo que el cliente YA dijo en el mismo mensaje ("soy Laura…, domicilio y transferencia") llena
  // campos vacíos; las preguntas del mensaje nunca cuentan. El resumen y el botón siguen siendo obligatorios.
  const pistas = textoCompra ? pistasCheckout(textoCompra, io.perfil) : {};
  const entrega = pistas.entrega && ofreceEntrega(opciones, pistas.entrega) ? pistas.entrega : null;
  let ck: CheckoutState = {
    orderId: order.order_id,
    step: "name",
    // El nombre dado en un checkout anterior de ESTA conversación (se salió con Modificar) va antes que el del contacto.
    customerName: pistas.nombre ?? (isTrustedName(state.checkoutName, vocabulario) ? state.checkoutName : isTrustedName(known, vocabulario) ? known.trim() : null),
    delivery: entrega,
    address: null,
    city: null,
    deliveryReference: null,
    paymentMethod: pistas.pago ?? null,
    summary: null,
    startedTurn: io.turn,
    pendingChange: null,
  };
  ck = completar(ck, opciones);
  ck.step = nextStep(ck);
  const next: ConversationState = { ...state, checkout: ck, activeOrderId: order.order_id, cart: [], ambiguity: null };
  if (ck.step === "summary") return summarize(io, next, ck, CHECKOUT_MESSAGES.intro);
  const reply = await ask(io, ck.step, CHECKOUT_MESSAGES.intro, ck.delivery);
  return done(next, reply, "started");
}

/** Resumen desde el MOTOR (re-valida precios/stock y renueva la propuesta si hizo falta). */
async function summarize(io: CheckoutIO, state: ConversationState, ckIn: CheckoutState, prefix: string | null): Promise<CheckoutResult> {
  const ck = completar(ckIn, io.perfil.opciones);
  const data = checkoutData(ck, io.perfil.opciones);
  if (!data) {
    const step = nextStep(ck);
    const next = { ...state, checkout: { ...ck, step } };
    return done(next, await ask(io, step, prefix, ck.delivery), "asked");
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
  // Bloque 32: si al revisar el pedido (p. ej. bajó cantidades) queda por debajo de la compra inicial.
  const bloqueo = await minimoMayorista(io, order);
  if (bloqueo) return blockedByMinimum(io, state, order, bloqueo, prefix);
  const summary = summaryText(order, data, io.texts);
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
  const menu = await ask(io, "summary", null, ck.delivery);
  return done(next, first && menu ? `${first}\n\n${menu}` : (first ?? menu), "summary");
}

async function confirm(io: CheckoutIO, state: ConversationState, ck: CheckoutState, order: OrderPublicView): Promise<CheckoutResult> {
  // Entrega y pago entre los que el negocio ofrece (si cambió su configuración, se vuelve a preguntar).
  const data = checkoutData(ck, io.perfil.opciones);
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
  if (name && isTrustedName(name, io.perfil.vocabulario)) await io.rememberName?.(name).catch(() => undefined);
  const next: ConversationState = { ...state, checkout: null, proposal: null, cart: [], ambiguity: null };
  delete next.checkoutName;
  const paused = await io.handOff("pedido confirmado").catch(() => false);
  // Bloque 32: quien recoge en tienda recibe la dirección del local al final.
  const store = state.checkout?.delivery === "tienda" ? io.texts?.storeAddress : undefined;
  const reply = await io.sendText(CHECKOUT_MESSAGES.confirmed(io.businessName, io.texts?.confirmedNote, store));
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
  const name = isTrustedName(ck.customerName, io.perfil.vocabulario) ? ck.customerName : state.checkoutName;
  const next: ConversationState = { ...backToCart(state, order), ...(name ? { checkoutName: name } : {}) };
  return done(next, await io.sendText(kind === "modify" ? CHECKOUT_MESSAGES.modify : CHECKOUT_MESSAGES.cancelled), kind === "modify" ? "modified" : "cancelled");
}

// ---------------------------------------------------------------------------
// Bloque 28 — lenguaje humano dentro del checkout
// ---------------------------------------------------------------------------

type Entrega = DeliveryType;
type Pago = PaymentMethod;
type Cambio = { tipo: "fijar" | "sumar" | "restar" | "quitar"; n: number };
type Linea = OrderPublicView["lines"][number];

/** Lo que se le recuerda al cliente en cada paso que no depende del negocio. */
const STEP_HINT: Readonly<Record<Exclude<CheckoutStep, "delivery" | "payment">, string>> = {
  name: "Escríbeme el nombre de la persona a nombre de quien registramos el pedido.",
  address: "Escríbeme la dirección (calle o carrera, número y barrio).",
  city: "Escríbeme la ciudad.",
  reference: "Escríbeme si tienes alguna referencia para la entrega (o *sin referencia*).",
  summary: "Toca ✅ Confirmar pedido, ✏️ Modificar pedido o ❌ Cancelar.",
};

/** Lo que se le recuerda al cliente en cada paso (p. ej. tras una nota de voz): entrega y pago, con lo que el negocio ofrece. */
export function checkoutStepHint(o: CheckoutOpciones, step: CheckoutStep, entrega: DeliveryType | null): string {
  if (step === "delivery") return checkoutOptionTexts(o).deliveryHint;
  if (step === "payment") return checkoutOptionTexts(o).paymentHint(entrega);
  return STEP_HINT[step];
}

/** Pregunta del cliente: se responde (solo lectura) y se repite la pregunta del paso. Nada cambia. */
async function answerAndRepeat(io: CheckoutIO, state: ConversationState, ck: CheckoutState, text: string): Promise<CheckoutResult> {
  const answer = io.answerQuestion ? await io.answerQuestion(text, ck.step).catch(() => null) : null;
  return done(state, await ask(io, ck.step, answer?.trim() || CHECKOUT_MESSAGES.questionFallback, ck.delivery), "question");
}

/**
 * Corrige entrega y/o pago (en cualquier paso) y sigue con lo que falte (o un resumen NUEVO). Lo que el
 * negocio no ofrece no se anota: se dice qué sí ofrece y se repite la pregunta del paso.
 */
async function corregir(io: CheckoutIO, state: ConversationState, ck: CheckoutState, pedido: { entrega?: Entrega; pago?: Pago }): Promise<CheckoutResult> {
  const o = io.perfil.opciones;
  const t = checkoutOptionTexts(o);
  const c: { entrega?: Entrega; pago?: Pago } = {};
  if (pedido.entrega && ofreceEntrega(o, pedido.entrega)) c.entrega = pedido.entrega;
  const entrega = c.entrega ?? ck.delivery;
  if (pedido.pago && pagoPermitido(o, pedido.pago, entrega)) c.pago = pedido.pago;
  if (!c.entrega && !c.pago) {
    const aviso = pedido.entrega && !ofreceEntrega(o, pedido.entrega) ? t.deliveryUnavailable(pedido.entrega) : t.paymentUnavailable(pedido.pago!, ck.delivery);
    return done(state, await ask(io, ck.step, aviso, ck.delivery), "invalid");
  }
  let n: CheckoutState = { ...ck, summary: null, pendingChange: null };
  if (c.entrega) n = c.entrega === "tienda" ? { ...n, delivery: "tienda", address: null, city: null, deliveryReference: null } : { ...n, delivery: "domicilio" };
  if (c.pago) n = { ...n, paymentMethod: c.pago };
  n = completar(n, o);
  const step = nextStep(n);
  const prefix = CHECKOUT_MESSAGES.noted(c);
  if (step === "summary") return summarize(io, state, { ...n, step }, prefix);
  return done({ ...state, checkout: { ...n, step } }, await ask(io, step, prefix, n.delivery), "corrected");
}

const NUMERO = (w: string): number | null => (/^\d{1,2}$/.test(w) ? Number(w) : (NUMEROS_EN_LETRAS[w] ?? null));

/** El producto del pedido al que se refiere el mensaje: el único, o el que la selección determinista señala. */
function objetivo(text: string, lines: readonly Linea[]): string | "ambiguo" {
  if (lines.length === 1) return lines[0].reference;
  const sel = resolveSelection(
    text,
    lines.map((l) => ({ reference: l.reference, name: l.product_name })),
    { typedReferences: extractReferences(text), lenguaje: true },
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
  if (!actual) return done(state, await ask(io, ck.step, checkoutOptionTexts(io.perfil.opciones).doubt, ck.delivery), "doubt");
  const base: CheckoutState = { ...ck, pendingChange: null };
  const q = Math.min(99, cambio.tipo === "fijar" ? cambio.n : cambio.tipo === "sumar" ? actual.quantity + 1 : cambio.tipo === "restar" ? actual.quantity - 1 : 0);
  const items = lines.map((l) => ({ reference: l.reference, quantity: l.reference === ref ? q : l.quantity })).filter((l) => l.quantity > 0);
  if (items.length === 0) {
    const cancel = CHECKOUT_BUTTONS.summary[2];
    return done({ ...state, checkout: base }, await io.sendMenu(CHECKOUT_MESSAGES.onlyProduct, [cancel], `${CHECKOUT_MESSAGES.onlyProduct} (escríbeme *cancelar* si ya no lo quieres)`), "only_product");
  }
  if (q === actual.quantity) return done({ ...state, checkout: base }, await ask(io, ck.step, CHECKOUT_MESSAGES.noChange(actual.product_name, q), ck.delivery), "unchanged");
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
  const n: CheckoutState = completar({ ...ck, orderId: o.order_id, summary: null, pendingChange: null }, io.perfil.opciones);
  const next: ConversationState = { ...state, activeOrderId: o.order_id };
  const step = ck.step === "summary" ? "summary" : nextStep(n);
  if (step === "summary") return summarize(io, next, { ...n, step }, CHECKOUT_MESSAGES.updated);
  return done({ ...next, checkout: { ...n, step } }, await ask(io, step, CHECKOUT_MESSAGES.updated, n.delivery), "updated");
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
  if (!cant && !quitar) return pideProducto(text, io.perfil.vocabulario) ? done(state, await ask(io, ck.step, CHECKOUT_MESSAGES.productsViaModify, ck.delivery), "products_via_modify") : null;
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

  const { vocabulario, opciones } = io.perfil;
  const textos = checkoutOptionTexts(opciones);
  const btn = buttonOf(text, input.buttonId, opciones);
  // Botón de entrega o de pago de un mensaje anterior, tocado en otro paso: corrige ESE dato.
  const btnEntrega = btn ? ENTREGA_POR_ID.get(btn) : undefined;
  const btnPago = btn ? PAGO_POR_ID.get(btn) : undefined;
  if (btnEntrega && ck.step !== "delivery") return corregir(io, state, ck, { entrega: btnEntrega });
  if (btnPago && ck.step !== "payment") return corregir(io, state, ck, { pago: btnPago });

  if (!btn) {
    if (ck.pendingChange) {
      const r = await cambiarProductos(io, state, ck, order, text);
      if (r) return r;
    }
    if (leerSalida(text) === "doubt") return done(state, await ask(io, ck.step, textos.doubt, ck.delivery), "doubt");
    if (esEspera(text)) return done(state, await io.sendText(CHECKOUT_MESSAGES.waiting), "waiting");
    if (ck.step === "address" && anunciaDireccion(text)) return done(state, await io.sendText(CHECKOUT_MESSAGES.addressAnnounce), "waiting");
    // Una PREGUNTA nunca es un dato: se responde y se repite la pregunta del paso (sin tocar nada).
    // ("link de pago" en el paso del pago, si el negocio lo ofrece, es la respuesta, no un pedido del catálogo.)
    const eligeLinkDePago = ck.step === "payment" && leerPago(text, ck.delivery, opciones) === "link_pago";
    if (esPregunta(text) || (pideCatalogo(text) && !eligeLinkDePago)) return answerAndRepeat(io, state, ck, text);
    const cambio = await cambiarProductos(io, state, ck, order, text);
    if (cambio) return cambio;
    const corr = leerCorreccion(text, ck.delivery, opciones);
    if (corr && ((corr.entrega && ck.step !== "delivery") || (corr.pago && ck.step !== "payment"))) return corregir(io, state, ck, corr);
  }

  const save = (patch: Partial<CheckoutState>) => ({ ...ck, ...patch, pendingChange: null });
  const move = async (nextCkIn: CheckoutState, prefix: string | null = null) => {
    const nextCk = completar(nextCkIn, opciones);
    const step = nextStep(nextCk);
    if (step === "summary") return summarize(io, state, nextCk, prefix);
    return done({ ...state, checkout: { ...nextCk, step } }, await ask(io, step, prefix, nextCk.delivery), "asked");
  };
  const again = async (text: string, step: CheckoutStep) => done(state, await ask(io, step, text, ck.delivery), "invalid");
  /** Otro dato que vino en el MISMO mensaje ("domicilio y transferencia"): solo llena lo vacío (y solo con un pago que se ofrece). */
  const extra = (c: CheckoutState): CheckoutState => {
    if (btn) return c;
    const x = leerCorreccion(text, c.delivery, opciones);
    return { ...c, ...(x?.pago && !c.paymentMethod && ck.step !== "payment" && pagoPermitido(opciones, x.pago, c.delivery) ? { paymentMethod: x.pago } : {}) };
  };

  switch (ck.step) {
    case "name": {
      const name = parseCustomerName(text, vocabulario);
      if (!name) return done(state, await io.sendText(CHECKOUT_MESSAGES.askNameAgain), "invalid");
      // Bloque 28: el nombre queda en el pedido en curso; se guarda en el contacto solo al confirmar.
      return move(save({ customerName: name }));
    }
    case "delivery": {
      const d = parseDelivery(text, opciones, input.buttonId);
      if (!d) return again(CHECKOUT_MESSAGES.chooseOption, "delivery");
      const patch: Partial<CheckoutState> = d === "tienda" ? { delivery: d, address: null, city: null, deliveryReference: null } : { delivery: d };
      return move(extra(save(patch)));
    }
    case "address": {
      const a = leerDireccion(text, io.perfil);
      if (a?.tipo === "vaga") return done(state, await io.sendText(CHECKOUT_MESSAGES.addressVague), "invalid");
      if (a?.tipo === "anuncio") return done(state, await io.sendText(CHECKOUT_MESSAGES.addressAnnounce), "waiting");
      if (!a || NO_REFERENCE.has(normalizar(a.valor))) return done(state, await io.sendText(CHECKOUT_MESSAGES.addressAgain), "invalid");
      // Bloque 32: si la dirección ya trae la ciudad al final, no se vuelve a preguntar.
      const conCiudad = ciudadEnDireccion(a.valor);
      if (conCiudad && leerDireccion(conCiudad.direccion, io.perfil)?.tipo === "ok") return move(save({ address: conCiudad.direccion, city: conCiudad.ciudad, step: "reference" }));
      return move(save({ address: a.valor }));
    }
    case "city": {
      const c = leerCiudad(text, io.perfil);
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
      const m = btn ? parsePayment(text, opciones, input.buttonId) : leerPago(text, ck.delivery, opciones);
      // "Contra entrega" / "cuando llegue" con un pago que no se ofrece para esa entrega: se explica qué sí.
      if (m === "no_disponible") return again(textos.paymentUnavailable(ck.delivery === "tienda" ? "pago_en_tienda" : "contra_entrega", ck.delivery), "payment");
      if (!m) return again(CHECKOUT_MESSAGES.chooseOption, "payment");
      // Autoridad del backend: un botón de un pago que no aplica a ESTA entrega no se anota.
      if (!pagoPermitido(opciones, m, ck.delivery)) return again(textos.paymentUnavailable(m, ck.delivery), "payment");
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
