/**
 * Pedido CANÓNICO del catálogo — contrato único para catálogo, WhatsApp,
 * agente, asesora y automatizaciones. PURO (sin red ni BD).
 *
 * Quién decide qué:
 *   - El BACKEND resuelve y fija: negocio, canal, producto, precio unitario,
 *     subtotal, total, stock, estado. Nada de eso lo puede establecer el
 *     cliente ni la IA (los esquemas de entrada de las herramientas ni
 *     siquiera tienen esos campos).
 *   - El cliente/IA solo aportan: referencias, cantidades, una clave de
 *     idempotencia, un motivo (handoff) y la confirmación de una propuesta
 *     concreta que el backend emitió.
 *
 * IDs: `order_id` público (DL-ORD-XXXXXX) es lo único que ve el cliente. El
 * id interno, el negocio y el contacto nunca salen en vistas públicas.
 */

export const ORDER_STATUSES = ["draft", "validated", "pending_confirmation", "pending_acceptance", "confirmed", "handoff", "completed", "cancelled", "expired", "rejected"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ["catalog", "whatsapp", "agent", "manual"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export type OrderChannel = "retail" | "wholesale";

/**
 * Quién pide una transición:
 *   - system: backend (catálogo, webhook, vencimientos);
 *   - agent: el agente de IA, SOLO a través de sus herramientas;
 *   - human: una persona del negocio (asesora) desde el dashboard.
 * El cliente nunca transiciona directamente: su intención llega por el
 * agente o por el webhook, y el backend valida.
 */
export type OrderActor = "system" | "agent" | "human";

/**
 * Máquina de estados. Cualquier transición que no esté aquí es IMPOSIBLE
 * (el motor y la BD la rechazan).
 *
 *   draft ─► validated ─► pending_confirmation ─► confirmed ─► completed
 *     │          │                │                   │
 *     │          │                ├──► handoff ◄──────┘
 *     ▼          ▼                ▼       │
 *  cancelled / expired   (terminales)     └─► confirmed / completed / cancelled (humano)
 *
 * - draft: capturado con problemas (referencia inexistente, sin stock…): aún no se puede proponer.
 * - validated: todo resuelto contra el catálogo actual (p. ej. la solicitud del catálogo antes de llegar por WhatsApp).
 * - pending_confirmation: el backend emitió una propuesta concreta (total) y espera un "sí" A ESA propuesta.
 * - confirmed: el cliente confirmó esa propuesta. No descuenta stock ni cobra (fase posterior).
 * - handoff: una asesora toma el pedido.
 * - completed / cancelled / expired: terminales.
 * - rejected (Bloque 27): la EMPRESA rechaza el pedido (cancelled = lo cancela el cliente o la
 *   operación). Terminal; libera la reserva igual que cancelar.
 * Bloque 27: el checkout conversacional confirma como `agent` (la conversación, tras el "Confirmar"
 * explícito del cliente; el sistema nunca confirma por el cliente) y el SISTEMA cancela una
 * propuesta sin reserva (el cliente cancela o modifica el checkout).
 * Fase 3B — pending_acceptance: datos completos y aviso obligatorio enviado, pero NO es una venta
 * (sin confirmedAt, etapa ni pago). Solo una persona del negocio lo acepta (-> confirmed), lo cancela
 * o lo rechaza; vence (sistema) solo si el pedido trae un vencimiento explícito.
 */
const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, readonly OrderActor[]>>> = {
  draft: { validated: ["system"], handoff: ["system", "agent", "human"], cancelled: ["system", "human"], expired: ["system"] },
  validated: { pending_confirmation: ["system", "agent"], draft: ["system"], handoff: ["system", "agent", "human"], cancelled: ["system", "human"], expired: ["system"] },
  pending_confirmation: {
    confirmed: ["agent", "human"],
    pending_acceptance: ["agent"],
    draft: ["system"],
    handoff: ["system", "agent", "human"],
    cancelled: ["human", "system"],
    expired: ["system"],
  },
  pending_acceptance: { confirmed: ["human"], cancelled: ["human"], rejected: ["human"], expired: ["system"] },
  // expired (system): la reserva de stock venció sin cerrar la venta (Bloque 19, cron horario).
  confirmed: { handoff: ["system", "agent", "human"], completed: ["human"], cancelled: ["human"], rejected: ["human"], expired: ["system"] },
  handoff: { confirmed: ["human"], completed: ["human"], cancelled: ["human"], rejected: ["human"] },
  completed: {},
  cancelled: {},
  expired: {},
  rejected: {},
};

export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set(["completed", "cancelled", "expired", "rejected"]);

// ---------------------------------------------------------------------------
// Bloque 27 — datos del checkout y operación del pedido
// ---------------------------------------------------------------------------

/**
 * Catálogo CERRADO de métodos de pago de la plataforma (mismo CHECK de la BD: migración
 * 20261205000000). Cada negocio ofrece un subconjunto (dulabs_agente_runtime_config.checkout_opciones).
 */
export const PAYMENT_METHODS = ["pago_en_tienda", "transferencia", "contra_entrega", "link_pago"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** El MÉTODO no es el pago: pendiente hasta que una persona del equipo registra el pago recibido. */
export const PAYMENT_STATUSES = ["pendiente", "recibido"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
/** Fase 3B: oficina_transportadora = el cliente reclama en una oficina de la transportadora (nunca se nombra una aquí). */
export const DELIVERY_TYPES = ["tienda", "domicilio", "oficina_transportadora"] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];
/**
 * Etapa operativa del pedido mientras está activo (confirmed). Eje INDEPENDIENTE del pago:
 *   confirmado -> en_preparacion -> enviado (domicilio u oficina de transportadora) -> entregado
 * (recoger en tienda: en_preparacion -> entregado). "Confirmado" NO significa pagado.
 */
export const ORDER_STAGES = ["confirmado", "en_preparacion", "enviado", "entregado"] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

/** Siguiente etapa permitida (misma regla que la BD: solo hacia adelante, de a un paso). */
export function nextStage(stage: OrderStage, delivery: DeliveryType): OrderStage | null {
  if (stage === "confirmado") return "en_preparacion";
  if (stage === "en_preparacion") return delivery === "tienda" ? "entregado" : "enviado";
  if (stage === "enviado") return "entregado";
  return null;
}

/** Cierre comercial: el pedido se entregó Y el pago se recibió (misma regla que la BD). */
export function canCompleteStage(stage: OrderStage, payment: PaymentStatus): boolean {
  return stage === "entregado" && payment === "recibido";
}

/** Antes de salir de la tienda (confirmado / en preparación) se puede cancelar o rechazar; después, no. */
export function canCancelStage(stage: OrderStage): boolean {
  return stage === "confirmado" || stage === "en_preparacion";
}

/** La reserva de 72 h solo vence si nadie del equipo tocó el pedido (sigue confirmado y sin pago). */
export function reservationCanExpire(stage: OrderStage, payment: PaymentStatus): boolean {
  return stage === "confirmado" && payment === "pendiente";
}

export interface OrderCheckout {
  customerName: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  delivery: DeliveryType;
  /** Solo domicilio (obligatorios) y referencia opcional. */
  address: string | null;
  city: string | null;
  deliveryReference: string | null;
  stage: OrderStage;
  /** Fase 3B: datos que solo pide un negocio que los configura (ausentes/null en los pedidos de siempre). */
  contactPhone?: string | null;
  department?: string | null;
  neighborhood?: string | null;
  carrierOffice?: string | null;
}

/**
 * Fase 3B — datos del checkout de un pedido que NO es venta: pendiente de aceptación, o cerrado sin
 * haberse aceptado (cancelado, rechazado o vencido). Sin etapa, sin estado de pago y sin confirmedAt.
 */
export interface OrderAcceptance {
  customerName: string;
  paymentMethod: PaymentMethod;
  delivery: DeliveryType;
  address: string | null;
  city: string | null;
  deliveryReference: string | null;
  contactPhone: string | null;
  department: string | null;
  neighborhood: string | null;
  carrierOffice: string | null;
  /** Cuándo salió el aviso obligatorio (null = no salió). */
  noticeSentAt: string | null;
  /** Cuándo el cliente respondió que sí después del aviso. Informativo: no acepta nada. */
  customerReplyAt: string | null;
  /** Política de reserva fijada al enviarlo: null = sin reserva. */
  reservationMinutes: number | null;
  /** Vencimiento: null = no vence solo. */
  expiresAt: string | null;
}

/**
 * Fase 3B — políticas con que un pedido se envía a aceptación. TODAS explícitas: el motor no tiene
 * valores por defecto (son decisiones del negocio) y rechaza un envío sin ellas.
 */
export interface AcceptancePolicy {
  /** Stock mientras espera: sin reserva, o reserva con plazo propio (nunca las 72 h de los confirmados). */
  reservation: { kind: "none" } | { kind: "ttl"; minutes: number };
  /** Si nadie lo acepta ni lo cierra: no vence, o vence tras un plazo. */
  expiration: { kind: "none" } | { kind: "after"; minutes: number };
  /** Documento de identidad (solo con entrega en oficina de transportadora). */
  document: { kind: "not_collected" } | { kind: "required_for_office"; allowedTypes: readonly string[]; retention: { kind: "no_automatic_deletion" } | { kind: "days"; days: number } };
}

/** Fase 3B — plazo de la reserva al ACEPTAR: el de la plataforma (como cualquier confirmado) o uno propio. */
export type AcceptedReservation = { kind: "platform" } | { kind: "ttl"; minutes: number };

/** Límites técnicos de los plazos (minutos): 1 minuto a 30 días. No son una política. */
export const POLICY_MINUTES_MAX = 43_200;

export function canTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

/** Tabla completa (para documentación y tests). */
export function allowedTransitions(): Array<{ from: OrderStatus; to: OrderStatus; actors: readonly OrderActor[] }> {
  return ORDER_STATUSES.flatMap((from) => Object.entries(TRANSITIONS[from]).map(([to, actors]) => ({ from, to: to as OrderStatus, actors: actors ?? [] })));
}

/** La oferta que fijó el precio de una línea (evidencia del pedido: qué se mostró y se cobró). */
export interface OrderLineOffer {
  key: string;
  name: string;
  version: number;
}

export interface OrderLine {
  reference: string;
  /** Nombre resuelto por el servidor en el momento de validar (descriptivo; la identidad es la referencia). */
  productName: string;
  quantity: number;
  /** Precio EFECTIVO del canal (el de lista o el de la oferta vigente que aplica); null = "a consultar" (nunca un 0 inventado). */
  unitPrice: number | null;
  subtotal: number | null;
  /** Evidencia de la oferta: precio de lista y oferta aplicada. Solo existen cuando `unitPrice` es el de una oferta vigente. */
  listPrice?: number;
  offer?: OrderLineOffer;
}

/** Problema detectado al validar (determinista, listo para mostrar). */
export type OrderIssue =
  | { code: "reference_not_found"; reference: string; message: string }
  /** Existe pero está inactivo (retirado de la venta). */
  | { code: "product_unavailable"; reference: string; message: string }
  /** Cantidad escrita fuera de rango (0, negativa, gigante): nunca se "corrige" en silencio. */
  | { code: "invalid_quantity"; reference: string; message: string }
  | { code: "sold_out"; reference: string; message: string }
  | { code: "insufficient_stock"; reference: string; requested: number; available: number; message: string }
  | { code: "price_changed"; reference: string; before: number | null; after: number | null; message: string }
  | { code: "message_mismatch"; message: string }
  | { code: "wholesale_unverified"; message: string };

/** Propuesta concreta que el cliente debe aceptar (ver confirmOrder). */
export interface OrderConfirmation {
  /** Id opaco de la propuesta: confirmar exige ESTE id (no cualquier "sí"). */
  id: string;
  total: number;
  unpricedUnits: number;
  expiresAt: string;
}

export interface OrderHandoff {
  reason: string;
  /** Resumen breve para la asesora (lo que el cliente quiere); sin datos sensibles. */
  context: string | null;
  requestedBy: OrderActor;
  at: string;
}

/** Pedido interno (backend). Nunca se serializa tal cual hacia el cliente. */
export interface Order {
  /** Id interno (UUID). */
  id: string;
  /** Id público (DL-ORD-XXXXXX). */
  orderId: string;
  businessId: string;
  channel: OrderChannel;
  source: OrderSource;
  status: OrderStatus;
  /** Contacto de WhatsApp (conversación = número del negocio + wa_id del cliente). null = aún sin contacto (p. ej. solicitud del catálogo). */
  contact: { phoneNumberId: string; waId: string } | null;
  lines: OrderLine[];
  totalUnits: number;
  total: number;
  unpricedUnits: number;
  currency: "COP";
  issues: OrderIssue[];
  confirmation: OrderConfirmation | null;
  handoff: OrderHandoff | null;
  /** Bloque 27: datos del checkout conversacional (null = pedido sin checkout, p. ej. anterior al Bloque 27). */
  checkout: OrderCheckout | null;
  /** Fase 3B: datos del checkout de un pedido que NO es venta (pendiente de aceptación o cerrado sin aceptar). */
  acceptance?: OrderAcceptance | null;
  /** Cuándo quedó confirmado (null = nunca se confirmó). */
  confirmedAt: string | null;
  idempotencyKey: string;
  /** sha256 de lo pedido (referencias:cantidades). Misma clave + otra huella => CONFLICT. */
  requestFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lo ÚNICO que ve el cliente (o la IA para contárselo): sin negocio, id interno ni contacto. */
export interface OrderPublicView {
  order_id: string;
  channel: OrderChannel;
  status: OrderStatus;
  /** `list_price` y `offer` solo existen en las líneas cuyo precio es el de una oferta vigente (`offer` = el nombre público de la oferta). */
  lines: Array<{ reference: string; product_name: string; quantity: number; unit_price: number | null; subtotal: number | null; list_price?: number; offer?: string }>;
  total_units: number;
  total: number;
  unpriced_units: number;
  currency: "COP";
  issues: Array<{ code: OrderIssue["code"]; message: string }>;
  confirmation: { id: string; total: number; expires_at: string } | null;
  created_at: string;
}

export function publicView(o: Order): OrderPublicView {
  return {
    order_id: o.orderId,
    channel: o.channel,
    status: o.status,
    lines: o.lines.map((l) => ({
      reference: l.reference,
      product_name: l.productName,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      subtotal: l.subtotal,
      ...(l.listPrice !== undefined && l.offer ? { list_price: l.listPrice, offer: l.offer.name } : {}),
    })),
    total_units: o.totalUnits,
    total: o.total,
    unpriced_units: o.unpricedUnits,
    currency: o.currency,
    issues: o.issues.map((i) => ({ code: i.code, message: i.message })),
    confirmation: o.confirmation ? { id: o.confirmation.id, total: o.confirmation.total, expires_at: o.confirmation.expiresAt } : null,
    created_at: o.createdAt,
  };
}

/** Vigencia de una propuesta: pasado esto, confirmar exige una propuesta nueva (precios/stock pueden haber cambiado). */
export const CONFIRMATION_TTL_MS = 30 * 60 * 1000;