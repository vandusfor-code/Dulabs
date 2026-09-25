/**
 * MOTOR DE PEDIDOS — el backend decide; la IA conversa.
 *
 * Única puerta para crear, validar, proponer, confirmar y pasar a una asesora
 * un pedido, venga de donde venga (tienda, WhatsApp, agente). Garantías:
 *
 *   - El negocio (tenant), el canal y la conversación los pone QUIEN LLAMA
 *     desde el backend (webhook, sesión); nunca vienen de la IA ni del texto.
 *   - Cada línea se resuelve contra el catálogo ACTUAL del negocio: producto
 *     real, activo, precio del canal, stock. Subtotales y total los calcula
 *     este módulo; ningún precio de entrada se acepta.
 *   - Idempotencia: la clave (con su huella de contenido) nunca produce dos
 *     pedidos; la misma clave con otro contenido => CONFLICT.
 *   - Estados: solo transiciones de contrato.ts, con compare-and-set en la BD.
 *   - Confirmar exige la propuesta CONCRETA vigente (id + total), no un "sí".
 *   - No descuenta stock, no reserva, no cobra (fases posteriores).
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { CatalogRepository } from "@/lib/catalogo/repository";
import { normalizeOrderItems, type OrderItem } from "@/lib/catalogo/pedido";
import { canonicalItems, crockford, type OrderKey } from "@/lib/catalogo/pedido-firma";
import { formatCop } from "@/lib/business-agent-quote";
import { createResolucionCatalogo } from "@/lib/catalogo/resolucion";
import {
  CONFIRMATION_TTL_MS,
  TERMINAL_STATUSES,
  canCancelStage,
  canCompleteStage,
  nextStage,
  type DeliveryType,
  type Order,
  type OrderActor,
  type OrderChannel,
  type OrderConfirmation,
  type OrderIssue,
  type OrderLine,
  type OrderSource,
  type OrderStage,
  type OrderStatus,
  type PaymentMethod,
} from "@/lib/catalogo/pedidos/contrato";
import { eventIdFrom, logOrderEventSink, orderEvent, type OrderEvent, type OrderEventSink, type OrderEventType } from "@/lib/catalogo/pedidos/eventos";
import { contactRef, logOrderOperation, type OrderLogger } from "@/lib/catalogo/pedidos/log";
import { InvalidTransition, ProductNotSellable, PublicIdTaken, StockUnavailable, applyChanges, type NewOrder, type OrderChanges, type OrderContact, type OrderCursor, type OrdersRepository, type PanelQuery, type ReservationSummary } from "@/lib/catalogo/pedidos/repositorio";
import { parseWhatsappOrderText } from "@/lib/catalogo/pedidos/whatsapp";

/** Errores DETERMINISTAS (mismo insumo => mismo código). El mensaje es apto para el cliente. */
export const ORDER_ERROR_CODES = [
  "INVALID_INPUT",
  "FORBIDDEN",
  "NOT_FOUND",
  "REFERENCE_NOT_FOUND",
  "PRODUCT_UNAVAILABLE",
  "AMBIGUOUS",
  "OUT_OF_STOCK",
  "PRICE_CHANGED",
  "ORDER_HAS_ISSUES",
  "INVALID_TRANSITION",
  "CONFIRMATION_MISMATCH",
  "CONFIRMATION_EXPIRED",
  "CONFLICT",
  "UNAVAILABLE",
] as const;
export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number];

export class OrderError extends Error {
  constructor(
    readonly code: OrderErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Puerto del traspaso a una persona (en producción: pausa de la IA en ESE chat + estado "pending"). */
export interface HumanHandoffPort {
  /** `until: "released"` = hasta que una persona la libere (Bloque 27: pedido confirmado); por defecto, la pausa estándar. */
  pauseConversation(input: { tenantId: string; contact: OrderContact; reason: string; until?: "released" }): Promise<{ ok: boolean }>;
}

export interface OrderEngineDeps {
  orders: OrdersRepository;
  catalog: CatalogRepository;
  /** Clave del backend (HMAC) para derivar ids públicos. */
  key: OrderKey;
  sink?: OrderEventSink;
  handoff?: HumanHandoffPort;
  log?: OrderLogger;
  now?: () => Date;
}

export interface Evaluation {
  lines: OrderLine[];
  issues: OrderIssue[];
  totalUnits: number;
  total: number;
  unpricedUnits: number;
}

/** Qué sigue (para el agente): proponer/confirmar, resolver problemas, esperar a la asesora o nada. */
export type NextStep = "confirm" | "resolve_issues" | "wait_human" | "none";

export function nextStepOf(o: Order): NextStep {
  if (o.status === "pending_confirmation") return "confirm";
  if (o.status === "draft") return "resolve_issues";
  if (o.status === "handoff") return "wait_human";
  return "none";
}

/** Problemas que dependen de lo que el cliente ESCRIBIÓ (no del catálogo): re-validar no los borra. */
const STICKY: ReadonlySet<OrderIssue["code"]> = new Set(["reference_not_found", "invalid_quantity", "message_mismatch", "wholesale_unverified"]);
export const OPEN_STATUSES: readonly OrderStatus[] = ["draft", "validated", "pending_confirmation", "confirmed", "handoff"];
/** Estados finales: el historial del panel (Bloque 21). Su reserva ya se consumió o se liberó. */
export const CLOSED_STATUSES = ["completed", "cancelled", "expired", "rejected"] as const satisfies readonly OrderStatus[];
export type ClosedStatus = (typeof CLOSED_STATUSES)[number];
/**
 * Bloque 23 — un pedido de conversación SIN confirmar (borrador, validado o propuesta sin "sí") que
 * no cambió en este plazo se da por abandonado y vence (actor sistema). No queda "abierto" para
 * siempre en el panel ni como pedido activo de la conversación semanas después. Mismo plazo que la
 * reserva de un pedido confirmado. Los pedidos con una asesora (handoff) nunca vencen solos.
 */
export const ABANDONED_ORDER_MS = 72 * 60 * 60 * 1000;
export const ABANDONABLE_STATUSES: readonly OrderStatus[] = ["draft", "validated", "pending_confirmation"];

/** sha256 de lo pedido (canal + referencias:cantidades normalizadas). */
export function requestFingerprint(channel: OrderChannel, items: readonly OrderItem[]): string {
  return createHash("sha256").update(`${channel}|${canonicalItems(normalizeOrderItems(items))}`).digest("hex");
}

/** Clave de idempotencia de una conversación: el hash evita guardar el teléfono en la clave y separa conversaciones. */
export function conversationKey(prefix: "agent" | "wa", contact: OrderContact, clientKey: string): string {
  return `${prefix}:${crockford(createHash("sha256").update(`${contact.phoneNumberId}|${contact.waId}|${clientKey}`).digest(), 32)}`;
}

const pesos = (n: number | null) => (n === null ? "precio a consultar" : formatCop(n));

/** Problemas a partir de lo que dijo la BD al apartar el stock (solo los que la evaluación no vio ya). */
function issuesFromReservation(err: StockUnavailable | ProductNotSellable, seen: readonly OrderIssue[]): OrderIssue[] {
  const known = new Set(seen.map((i) => ("reference" in i ? i.reference : "")));
  if (err instanceof ProductNotSellable) {
    return err.references.filter((r) => !known.has(r)).map((reference) => ({ code: "product_unavailable" as const, reference, message: `El producto ${reference} ya no está disponible.` }));
  }
  return err.shortages
    .filter((x) => !known.has(x.reference))
    .map((x) =>
      x.available <= 0
        ? { code: "sold_out" as const, reference: x.reference, message: `El producto ${x.reference} se agotó.` }
        : { code: "insufficient_stock" as const, reference: x.reference, requested: x.requested, available: x.available, message: `De ${x.reference} quedan ${x.available} ${x.available === 1 ? "unidad" : "unidades"}; pediste ${x.requested}.` },
    );
}

function codeForIssues(issues: readonly OrderIssue[]): OrderErrorCode {
  const codes = new Set(issues.map((i) => i.code));
  if (codes.has("price_changed")) return "PRICE_CHANGED";
  if (codes.has("sold_out") || codes.has("insufficient_stock")) return "OUT_OF_STOCK";
  if (codes.has("product_unavailable")) return "PRODUCT_UNAVAILABLE";
  if (codes.has("reference_not_found")) return "REFERENCE_NOT_FOUND";
  return "ORDER_HAS_ISSUES";
}

const sameContact = (a: OrderContact | null, b: OrderContact) => a !== null && a.waId === b.waId && a.phoneNumberId === b.phoneNumberId;

/**
 * Bloque 27 — datos que el checkout conversacional reunió (el BACKEND los validó paso a paso; la IA
 * no los escribe). Se guardan en la MISMA transición que confirma y aparta el stock.
 */
export interface CheckoutData {
  customerName: string;
  paymentMethod: PaymentMethod;
  delivery: DeliveryType;
  address: string | null;
  city: string | null;
  deliveryReference: string | null;
}

/** Motivo del traspaso automático tras un pedido confirmado por el checkout. */
export const CHECKOUT_HANDOFF_REASON = "pedido confirmado";

export function validCheckout(c: CheckoutData): boolean {
  const name = c.customerName.trim();
  if (name.length < 2 || name.length > 120 || /^[+\d\s()-]+$/.test(name)) return false;
  if (c.delivery === "domicilio") {
    if (!c.address || c.address.trim().length < 3 || c.address.length > 300) return false;
    if (!c.city || c.city.trim().length < 2 || c.city.length > 80) return false;
  }
  if (c.deliveryReference !== null && c.deliveryReference.length > 300) return false;
  return true;
}

export function createOrderEngine(deps: OrderEngineDeps) {
  const now = deps.now ?? (() => new Date());
  const sink = deps.sink ?? logOrderEventSink;
  const log = deps.log ?? logOrderOperation;
  const resolucion = createResolucionCatalogo({ repo: deps.catalog });

  async function publish(event: OrderEvent) {
    // La BD ya guardó el evento en la misma transacción; esto es la copia a registros (mejor esfuerzo).
    await sink.publish(event).catch((err: unknown) => console.error("[catalogo/pedidos] no se pudo publicar el evento:", err instanceof Error ? err.message : err));
  }

  async function requireAvailable() {
    if (!(await deps.orders.available())) throw new OrderError("UNAVAILABLE", "Los pedidos por WhatsApp todavía no están activados para este negocio.");
  }

  /** Mide y registra una operación (sin datos personales). */
  async function traced<T extends { order?: Order | null; eventId?: string; result?: "ok" | "duplicate" | "skipped" }>(
    operation: string,
    ctx: { tenantId: string; requestId?: string; contact?: OrderContact | null },
    fn: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    const base = {
      request_id: ctx.requestId ?? randomUUID(),
      business_id: ctx.tenantId,
      operation,
      ...(ctx.contact ? { contact_ref: contactRef(ctx.contact.waId) } : {}),
    };
    try {
      const out = await fn();
      log({
        ...base,
        result: out.result ?? "ok",
        duration_ms: Date.now() - started,
        ...(out.eventId ? { event_id: out.eventId } : {}),
        ...(out.order ? { order_id: out.order.orderId, status: out.order.status } : {}),
      });
      return out;
    } catch (err) {
      log({ ...base, result: "error", duration_ms: Date.now() - started, error_code: err instanceof OrderError ? err.code : "INTERNAL" });
      throw err;
    }
  }

  /**
   * Evalúa lo pedido contra el catálogo ACTUAL del negocio. Determinista.
   * Las líneas conservan la cantidad PEDIDA (nunca se reduce en silencio):
   * si no alcanza el stock, queda el problema a la vista.
   */
  async function evaluate(
    tenantId: string,
    channel: OrderChannel,
    items: readonly OrderItem[],
    previousPrices?: ReadonlyMap<string, number | null>,
    sticky: readonly OrderIssue[] = [],
  ): Promise<Evaluation> {
    const normalized = normalizeOrderItems(items);
    const lote = await resolucion.resolverReferencias(
      tenantId,
      normalized.map((i) => i.reference),
    );
    const byRef = new Map(lote.items.map((p) => [p.reference, p]));
    const issues: OrderIssue[] = sticky.filter((i) => STICKY.has(i.code));
    const lines: OrderLine[] = [];
    for (const item of normalized) {
      const p = byRef.get(item.reference);
      if (!p) {
        if (!issues.some((i) => i.code === "reference_not_found" && i.reference === item.reference)) {
          issues.push({ code: "reference_not_found", reference: item.reference, message: `No encontramos la referencia ${item.reference}.` });
        }
        continue;
      }
      // Precio del canal del pedido; el del otro canal nunca entra.
      const unitPrice = channel === "wholesale" ? p.prices.wholesale : p.prices.retail;
      lines.push({ reference: p.reference, productName: p.name, quantity: item.quantity, unitPrice, subtotal: unitPrice === null ? null : unitPrice * item.quantity });
      if (p.status !== "ACTIVE") {
        issues.push({ code: "product_unavailable", reference: p.reference, message: `La referencia ${p.reference} ya no está disponible.` });
      } else if (p.availability === "sold_out") {
        issues.push({ code: "sold_out", reference: p.reference, message: `${p.reference} (${p.name}) está agotado.` });
      } else if (p.maxQuantity !== null && item.quantity > p.maxQuantity) {
        issues.push({
          code: "insufficient_stock",
          reference: p.reference,
          requested: item.quantity,
          available: p.maxQuantity,
          message: `De ${p.reference} (${p.name}) hay ${p.maxQuantity} ${p.maxQuantity === 1 ? "unidad disponible" : "unidades disponibles"}; pediste ${item.quantity}.`,
        });
      }
      if (previousPrices?.has(p.reference) && previousPrices.get(p.reference) !== unitPrice) {
        const before = previousPrices.get(p.reference) ?? null;
        issues.push({ code: "price_changed", reference: p.reference, before, after: unitPrice, message: `El precio de ${p.reference} cambió de ${pesos(before)} a ${pesos(unitPrice)}.` });
      }
    }
    return {
      lines,
      issues,
      totalUnits: lines.reduce((s, l) => s + l.quantity, 0),
      total: lines.reduce((s, l) => s + (l.subtotal ?? 0), 0),
      unpricedUnits: lines.filter((l) => l.unitPrice === null).reduce((s, l) => s + l.quantity, 0),
    };
  }

  const evaluationChanges = (ev: Evaluation) => ({
    lines: ev.lines,
    issues: ev.issues,
    totalUnits: ev.totalUnits,
    total: ev.total,
    unpricedUnits: ev.unpricedUnits,
  });

  function newConfirmation(ev: { total: number; unpricedUnits: number }): OrderConfirmation {
    return {
      id: `cf_${crockford(randomBytes(12), 16).toLowerCase()}`,
      total: ev.total,
      unpricedUnits: ev.unpricedUnits,
      expiresAt: new Date(now().getTime() + CONFIRMATION_TTL_MS).toISOString(),
    };
  }

  function publicIdFor(tenantId: string, idempotencyKey: string, attempt: number): string {
    return `DL-ORD-${crockford(createHmac("sha256", deps.key).update(`order-public-id\u0000${tenantId}|${idempotencyKey}|${attempt}`).digest(), 6)}`;
  }

  /** Inserta (idempotente) re-derivando el id público si choca con otro pedido del negocio. */
  async function insert(base: Omit<NewOrder, "orderId">, idFor: (attempt: number) => string): Promise<{ created: boolean; order: Order; eventId: string }> {
    const type: OrderEventType = base.source === "catalog" ? "catalog.order_request.created" : "order.created";
    const eventId = eventIdFrom("order-created", base.businessId, base.idempotencyKey);
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate: NewOrder = { ...base, orderId: idFor(attempt) };
      const event = orderEvent(type, { ...candidate, id: "", handoff: null, checkout: null, confirmedAt: null, updatedAt: candidate.createdAt }, { eventId, occurredAt: candidate.createdAt });
      try {
        const result = await deps.orders.create(candidate, event);
        if (result.created) await publish(event);
        return { ...result, eventId };
      } catch (err) {
        if (!(err instanceof PublicIdTaken)) throw err;
      }
    }
    throw new OrderError("CONFLICT", "No pudimos registrar el pedido. Intenta de nuevo.");
  }

  /** Transición con compare-and-set; el evento se arma con el resultado y se escribe en la MISMA transacción. */
  async function move(order: Order, to: OrderStatus, actor: OrderActor, changes: OrderChanges, opts: { reason?: string | null; type?: OrderEventType; memberId?: number | null } = {}) {
    const at = now().toISOString();
    const next = applyChanges(order, to, changes, at);
    const event =
      order.status === to
        ? null
        : orderEvent(opts.type ?? "order.status_changed", next, {
            eventId: eventIdFrom("transition", order.id, order.status, to, at, randomUUID()),
            occurredAt: at,
            transition: { from: order.status, to, actor, reason: opts.reason ?? null },
          });
    const updated = await deps.orders.transition({ businessId: order.businessId, id: order.id, from: order.status, to, actor, changes, event, memberId: opts.memberId ?? null });
    if (!updated) throw new OrderError("CONFLICT", "El pedido cambió mientras lo procesábamos. Consulta el pedido de nuevo.");
    if (event) await publish(event);
    return { order: updated, eventId: event?.event_id };
  }

  /**
   * Bloque 23 — vence los pedidos de conversación sin confirmar que llevan ABANDONED_ORDER_MS sin
   * cambios (ver ABANDONABLE_STATUSES). Cada uno por la transición normal (compare-and-set +
   * evento): si el pedido cambió mientras tanto (el cliente escribió), NO se vence. Idempotente.
   */
  async function expireAbandoned(input: { businessId?: string; limit?: number }): Promise<number> {
    if (!(await deps.orders.available())) return 0;
    const stale = await deps.orders.listStale({
      statuses: ABANDONABLE_STATUSES,
      updatedBefore: new Date(now().getTime() - ABANDONED_ORDER_MS).toISOString(),
      businessId: input.businessId,
      limit: input.limit ?? 200,
    });
    let n = 0;
    for (const order of stale) {
      try {
        await move(order, "expired", "system", { confirmation: null }, { reason: "abandoned" });
        n++;
      } catch (err) {
        if (!(err instanceof OrderError && err.code === "CONFLICT")) console.error("[catalogo/pedidos] vencer abandonado:", err instanceof Error ? err.message : "?");
      }
    }
    return n;
  }

  /** Pedido del negocio Y de esta conversación; cualquier otro caso es "no existe" (no se revela nada). */
  async function load(tenantId: string, contact: OrderContact, orderId: string): Promise<Order> {
    const order = await deps.orders.getByOrderId(tenantId, orderId);
    if (!order || !sameContact(order.contact, contact)) throw new OrderError("NOT_FOUND", `No encontramos el pedido ${orderId}.`);
    return order;
  }

  const previousPrices = (o: Order) => new Map(o.lines.map((l) => [l.reference, l.unitPrice]));
  const itemsOf = (o: Order): OrderItem[] => o.lines.map((l) => ({ reference: l.reference, quantity: l.quantity }));

  /**
   * Re-evalúa un pedido abierto y lo lleva al estado que corresponde:
   *   con problemas => draft (sin propuesta);
   *   sin problemas y con contacto => pending_confirmation con propuesta vigente.
   */
  async function revalidate(order: Order, actor: OrderActor, extraSticky: OrderIssue[] = [], claim?: OrderContact) {
    const ev = await evaluate(order.businessId, order.channel, itemsOf(order), previousPrices(order), [...order.issues, ...extraSticky]);
    const contactChange: OrderChanges = claim ? { contact: claim } : {};
    if (ev.issues.length > 0) {
      return move(order, "draft", "system", { ...evaluationChanges(ev), confirmation: null, ...contactChange }, { reason: codeForIssues(ev.issues) });
    }
    let current = order;
    let eventId: string | undefined;
    if (current.status === "draft") ({ order: current, eventId } = await move(current, "validated", "system", { ...evaluationChanges(ev), ...contactChange }));
    const contact = claim ?? current.contact;
    // Sin conversación no hay a quién proponerle (p. ej. solicitud del catálogo aún no enviada).
    if (!contact) return { order: current, eventId };
    const vigente =
      current.status === "pending_confirmation" &&
      current.confirmation !== null &&
      new Date(current.confirmation.expiresAt).getTime() > now().getTime() &&
      current.confirmation.total === ev.total &&
      current.confirmation.unpricedUnits === ev.unpricedUnits;
    if (vigente) return { order: current, eventId };
    const propose: OrderChanges = { ...evaluationChanges(ev), confirmation: newConfirmation(ev), ...(current.status === "validated" ? contactChange : {}) };
    return move(current, "pending_confirmation", current.status === "pending_confirmation" ? "system" : actor, propose, { reason: "proposal" });
  }

  return {
    evaluate,

    async available(): Promise<boolean> {
      return deps.orders.available();
    },

    /**
     * Crea (idempotente) un pedido de una conversación: el agente o un mensaje
     * de WhatsApp. Sin problemas => queda PROPUESTO (pending_confirmation) con
     * el total calculado aquí; con problemas => draft con cada problema.
     */
    async createOrder(input: {
      tenantId: string;
      channel: OrderChannel;
      source: Exclude<OrderSource, "catalog">;
      contact: OrderContact;
      items: readonly OrderItem[];
      /** Ya con espacio de nombres por conversación (conversationKey). */
      idempotencyKey: string;
      stickyIssues?: OrderIssue[];
      requestId?: string;
    }): Promise<{ created: boolean; order: Order }> {
      return traced("create_order", { tenantId: input.tenantId, requestId: input.requestId, contact: input.contact }, async () => {
        await requireAvailable();
        const fingerprint = requestFingerprint(input.channel, input.items);
        const ev = await evaluate(input.tenantId, input.channel, input.items, undefined, input.stickyIssues ?? []);
        // Bloque 23: ningún producto de la selección existe (p. ej. todos se borraron del catálogo):
        // no se guarda un pedido vacío (sería basura operativa); se informa qué referencias faltan.
        if (ev.lines.length === 0) {
          throw new OrderError("REFERENCE_NOT_FOUND", "Ninguno de los productos de la selección existe en el catálogo.", {
            references: ev.issues.flatMap((i) => ("reference" in i && i.code === "reference_not_found" ? [i.reference] : [])),
            issues: ev.issues.map((i) => ({ code: i.code, message: i.message })),
          });
        }
        const clean = ev.issues.length === 0;
        const at = now().toISOString();
        const result = await insert(
          {
            businessId: input.tenantId,
            channel: input.channel,
            source: input.source,
            status: clean ? "pending_confirmation" : "draft",
            contact: input.contact,
            ...evaluationChanges(ev),
            currency: "COP",
            confirmation: clean ? newConfirmation(ev) : null,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
            createdAt: at,
          },
          (attempt) => publicIdFor(input.tenantId, input.idempotencyKey, attempt),
        );
        if (!result.created && (result.order.requestFingerprint !== fingerprint || !sameContact(result.order.contact, input.contact))) {
          throw new OrderError("CONFLICT", "Esa clave de idempotencia ya se usó con otro pedido.");
        }
        return {
          created: result.created,
          order: result.order,
          eventId: result.created ? result.eventId : undefined,
          result: result.created ? ("ok" as const) : ("duplicate" as const),
        };
      });
    },

    /**
     * Guarda la solicitud del catálogo (ya validada por la tienda con las
     * mismas reglas) antes de abrir WhatsApp. null = persistencia no activada
     * (migración pendiente): la tienda sigue igual que antes.
     */
    async recordCatalogRequest(input: {
      tenantId: string;
      channel: OrderChannel;
      lines: readonly OrderLine[];
      idempotencyKey: string;
      orderIdFor: (attempt: number) => string;
    }): Promise<Order | null> {
      if (!(await deps.orders.available())) return null;
      return (
        await traced("record_catalog_request", { tenantId: input.tenantId }, async () => {
          const lines = input.lines.map((l) => ({ reference: l.reference, productName: l.productName, quantity: l.quantity, unitPrice: l.unitPrice, subtotal: l.subtotal }));
          const result = await insert(
            {
              businessId: input.tenantId,
              channel: input.channel,
              source: "catalog",
              status: "validated",
              contact: null,
              lines,
              totalUnits: lines.reduce((s, l) => s + l.quantity, 0),
              total: lines.reduce((s, l) => s + (l.subtotal ?? 0), 0),
              unpricedUnits: lines.filter((l) => l.unitPrice === null).reduce((s, l) => s + l.quantity, 0),
              currency: "COP",
              issues: [],
              confirmation: null,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: requestFingerprint(input.channel, lines),
              createdAt: now().toISOString(),
            },
            input.orderIdFor,
          );
          return { order: result.order, eventId: result.created ? result.eventId : undefined, result: result.created ? ("ok" as const) : ("duplicate" as const) };
        })
      ).order;
    },

    /** Pedido de ESTA conversación (por id, o el abierto más reciente). */
    async getOrder(input: { tenantId: string; contact: OrderContact; orderId?: string; requestId?: string }): Promise<Order> {
      return (
        await traced("get_order", input, async () => {
          await requireAvailable();
          if (input.orderId) return { order: await load(input.tenantId, input.contact, input.orderId) };
          const order = await deps.orders.latestForContact(input.tenantId, input.contact, OPEN_STATUSES);
          if (!order) throw new OrderError("NOT_FOUND", "No hay un pedido abierto en esta conversación.");
          return { order };
        })
      ).order;
    },

    /** Re-valida contra el catálogo actual y, si todo está bien, emite/renueva la propuesta. */
    async validateOrder(input: { tenantId: string; contact: OrderContact; orderId: string; actor: OrderActor; requestId?: string }): Promise<Order> {
      return (
        await traced("validate_order", input, async () => {
          await requireAvailable();
          const order = await load(input.tenantId, input.contact, input.orderId);
          if (!["draft", "validated", "pending_confirmation"].includes(order.status)) return { order, result: "skipped" as const };
          return revalidate(order, input.actor);
        })
      ).order;
    },

    /**
     * Confirma la propuesta VIGENTE: exige su id (no cualquier "sí"), que no
     * haya vencido y que precios y stock sigan iguales. Si algo cambió, el
     * pedido vuelve a draft con el problema y NO se confirma.
     */
    async confirmOrder(input: {
      tenantId: string;
      contact: OrderContact;
      orderId: string;
      confirmationId: string;
      actor: OrderActor;
      requestId?: string;
      /** Bloque 27: datos del checkout (se guardan en la MISMA transacción que confirma y aparta el stock). */
      checkout?: CheckoutData;
      /** Bloque 27: modalidad con la que se armó el resumen; si el pedido tiene otra, no se confirma. */
      expectedChannel?: OrderChannel;
    }): Promise<Order> {
      return (
        await traced("confirm_order", input, async () => {
          await requireAvailable();
          if (input.checkout && !validCheckout(input.checkout)) throw new OrderError("INVALID_INPUT", "Faltan datos del pedido.");
          const order = await load(input.tenantId, input.contact, input.orderId);
          if (order.status === "confirmed" && order.confirmation?.id === input.confirmationId) return { order, result: "duplicate" as const };
          if (order.status !== "pending_confirmation") {
            throw new OrderError("INVALID_TRANSITION", `El pedido ${order.orderId} no está esperando confirmación (estado: ${order.status}).`);
          }
          if (!order.confirmation || order.confirmation.id !== input.confirmationId) {
            throw new OrderError("CONFIRMATION_MISMATCH", "Esa confirmación no corresponde a la propuesta vigente del pedido.");
          }
          if (new Date(order.confirmation.expiresAt).getTime() <= now().getTime()) {
            throw new OrderError("CONFIRMATION_EXPIRED", "La propuesta venció. Hay que validar el pedido de nuevo antes de confirmarlo.");
          }
          if (input.expectedChannel && order.channel !== input.expectedChannel) {
            throw new OrderError("CONFIRMATION_MISMATCH", "Esa confirmación no corresponde a la propuesta vigente del pedido.");
          }
          const ev = await evaluate(order.businessId, order.channel, itemsOf(order), previousPrices(order), order.issues);
          if (ev.issues.length > 0 || ev.total !== order.confirmation.total || ev.unpricedUnits !== order.confirmation.unpricedUnits) {
            const moved = await move(order, "draft", "system", { ...evaluationChanges(ev), confirmation: null }, { reason: codeForIssues(ev.issues) });
            throw new OrderError(codeForIssues(ev.issues), ev.issues[0]?.message ?? "El pedido cambió; hay que validarlo de nuevo.", {
              order_id: moved.order.orderId,
              issues: ev.issues.map((i) => ({ code: i.code, message: i.message })),
            });
          }
          try {
            // La BD aparta el stock en la MISMA transacción (todo o nada): si no alcanza, nada cambia.
            const at = now().toISOString();
            const checkoutChanges: OrderChanges = input.checkout
              ? {
                  checkout: {
                    customerName: input.checkout.customerName.trim(),
                    paymentMethod: input.checkout.paymentMethod,
                    paymentStatus: "pendiente",
                    delivery: input.checkout.delivery,
                    address: input.checkout.delivery === "domicilio" ? input.checkout.address?.trim() ?? null : null,
                    city: input.checkout.delivery === "domicilio" ? input.checkout.city?.trim() ?? null : null,
                    deliveryReference: input.checkout.delivery === "domicilio" ? input.checkout.deliveryReference?.trim() || null : null,
                    stage: "confirmado",
                  },
                  confirmedAt: at,
                  // La asesora sigue la conversación (el pedido queda CONFIRMADO: la reserva sigue su plazo).
                  handoff: { reason: CHECKOUT_HANDOFF_REASON, context: null, requestedBy: "system", at },
                }
              : { confirmedAt: at };
            return await move(order, "confirmed", input.actor, checkoutChanges, { reason: "customer_confirmed" });
          } catch (err) {
            if (!(err instanceof StockUnavailable) && !(err instanceof ProductNotSellable)) throw err;
            // Otro cliente se llevó las unidades entre la validación y la confirmación: el pedido vuelve a
            // borrador con el problema real (lo que dice la BD manda sobre la evaluación anterior).
            const fresh = await evaluate(order.businessId, order.channel, itemsOf(order), previousPrices(order), order.issues);
            const issues = [...fresh.issues, ...issuesFromReservation(err, fresh.issues)];
            const moved = await move(order, "draft", "system", { ...evaluationChanges(fresh), issues, confirmation: null }, { reason: codeForIssues(issues) });
            throw new OrderError(codeForIssues(issues), issues[0]?.message ?? "Ya no hay unidades suficientes para confirmar el pedido.", {
              order_id: moved.order.orderId,
              issues: issues.map((i) => ({ code: i.code, message: i.message })),
            });
          }
        })
      ).order;
    },

    /**
     * La ASESORA cierra un pedido desde el panel (actor humano, negocio de la sesión):
     *   complete  confirmed | handoff            => completed (la reserva se consume)
     *   cancel    pending_confirmation | confirmed | handoff | draft | validated => cancelled (el stock vuelve)
     * Idempotente: repetir la misma acción sobre un pedido ya cerrado así devuelve el pedido tal cual.
     */
    async closeOrder(input: {
      tenantId: string;
      orderId: string;
      action: "complete" | "cancel" | "reject";
      requestId?: string;
      /** Bloque 27: quién del equipo (historial) y por qué (obligatorio para cancelar/rechazar desde "Pedidos"). */
      memberId?: number | null;
      reason?: string | null;
      /** Bloque 27: estado que la persona VIO al decidir (compare-and-set; otro estado = conflicto). */
      expectedStatus?: OrderStatus;
    }): Promise<{ order: Order; result: "ok" | "duplicate" }> {
      const opName = input.action === "complete" ? "complete_order" : input.action === "reject" ? "reject_order" : "cancel_order";
      return traced(opName, input, async () => {
        await requireAvailable();
        const order = await deps.orders.getByOrderId(input.tenantId, input.orderId);
        if (!order) throw new OrderError("NOT_FOUND", `No encontramos el pedido ${input.orderId}.`);
        const target: OrderStatus = input.action === "complete" ? "completed" : input.action === "reject" ? "rejected" : "cancelled";
        if (order.status === target) return { order, result: "duplicate" as const };
        if (input.expectedStatus && order.status !== input.expectedStatus) {
          throw new OrderError("CONFLICT", "El pedido cambió mientras lo procesábamos. Consulta el pedido de nuevo.");
        }
        const allowed: readonly OrderStatus[] =
          input.action === "cancel" ? ["draft", "validated", "pending_confirmation", "confirmed", "handoff"] : ["confirmed", "handoff"];
        const verb = input.action === "complete" ? "completar" : input.action === "reject" ? "rechazar" : "cancelar";
        if (!allowed.includes(order.status)) {
          throw new OrderError("INVALID_TRANSITION", `El pedido ${order.orderId} está ${order.status}: no se puede ${verb}.`);
        }
        if (input.action === "complete" && order.checkout && !canCompleteStage(order.checkout.stage, order.checkout.paymentStatus)) {
          throw new OrderError(
            "INVALID_TRANSITION",
            order.checkout.paymentStatus !== "recibido" ? `El pedido ${order.orderId} aún no tiene el pago recibido.` : `El pedido ${order.orderId} aún no está entregado.`,
          );
        }
        if (input.action !== "complete" && order.checkout && order.status === "confirmed" && !canCancelStage(order.checkout.stage)) {
          throw new OrderError("INVALID_TRANSITION", `El pedido ${order.orderId} ya salió (${order.checkout.stage}): no se puede ${verb}.`);
        }
        const reason =
          input.reason?.trim().slice(0, 500) || (input.action === "complete" ? "closed_by_advisor" : input.action === "reject" ? "rejected_by_company" : "cancelled_by_advisor");
        try {
          const moved = await move(order, target, "human", input.action === "complete" ? {} : { confirmation: null }, { reason, memberId: input.memberId ?? null });
          return { order: moved.order, eventId: moved.eventId, result: "ok" as const };
        } catch (err) {
          if (err instanceof InvalidTransition) throw new OrderError("INVALID_TRANSITION", `El pedido ${order.orderId} no se puede ${verb} ahora.`);
          throw err;
        }
      });
    },

    /**
     * Bloque 27 — una persona del equipo avanza la ETAPA operativa de un pedido del checkout:
     * confirmado -> en preparación -> enviado (solo domicilio) -> entregado (recoger: en preparación ->
     * entregado). Compare-and-set sobre la etapa que la persona vio: repetir el mismo clic no hace
     * nada; otra etapa = conflicto. Independiente del pago.
     */
    async advanceStage(input: { tenantId: string; orderId: string; from: OrderStage; to: OrderStage; memberId: number; reason?: string | null; requestId?: string }): Promise<{ order: Order; result: "ok" | "duplicate" }> {
      return traced("advance_stage", input, async () => {
        await requireAvailable();
        const order = await deps.orders.getByOrderId(input.tenantId, input.orderId);
        if (!order) throw new OrderError("NOT_FOUND", `No encontramos el pedido ${input.orderId}.`);
        if (!order.checkout) throw new OrderError("INVALID_TRANSITION", `El pedido ${order.orderId} no tiene etapas de operación.`);
        if (order.checkout.stage === input.to) return { order, result: "duplicate" as const };
        if (nextStage(input.from, order.checkout.delivery) !== input.to) {
          throw new OrderError(
            "INVALID_TRANSITION",
            input.to === "enviado" ? "Solo los pedidos a domicilio se marcan como enviados." : input.to === "entregado" && input.from === "en_preparacion" ? "Un pedido a domicilio se marca enviado antes de entregado." : "Ese cambio de etapa no está permitido.",
          );
        }
        let r;
        try {
          r = await deps.orders.setStage({
            businessId: input.tenantId,
            orderId: input.orderId,
            from: input.from,
            to: input.to,
            memberId: input.memberId,
            reason: input.reason?.trim().slice(0, 500) || null,
            eventId: eventIdFrom("stage", order.id, input.from, input.to),
          });
        } catch (err) {
          if (err instanceof InvalidTransition) throw new OrderError("INVALID_TRANSITION", "Ese cambio de etapa no está permitido.");
          throw err;
        }
        if (r.result === "no_encontrado") throw new OrderError("NOT_FOUND", `No encontramos el pedido ${input.orderId}.`);
        if (r.result === "conflicto") throw new OrderError("CONFLICT", "El pedido cambió mientras lo procesábamos. Consulta el pedido de nuevo.");
        return { order: r.order, result: r.result === "ok" ? ("ok" as const) : ("duplicate" as const) };
      });
    },

    /**
     * Bloque 27 — una persona del equipo registra el PAGO RECIBIDO (eje independiente de la etapa: se
     * puede registrar en cualquier etapa del pedido activo). Repetirlo no hace nada.
     */
    async markPaymentReceived(input: { tenantId: string; orderId: string; memberId: number; reason?: string | null; requestId?: string }): Promise<{ order: Order; result: "ok" | "duplicate" }> {
      return traced("payment_received", input, async () => {
        await requireAvailable();
        const order = await deps.orders.getByOrderId(input.tenantId, input.orderId);
        if (!order) throw new OrderError("NOT_FOUND", `No encontramos el pedido ${input.orderId}.`);
        if (!order.checkout) throw new OrderError("INVALID_TRANSITION", `El pedido ${order.orderId} no tiene estado de pago.`);
        if (order.checkout.paymentStatus === "recibido") return { order, result: "duplicate" as const };
        if (order.status !== "confirmed") throw new OrderError("INVALID_TRANSITION", `El pedido ${order.orderId} está ${order.status}: no se registra el pago.`);
        let r;
        try {
          r = await deps.orders.setPaymentReceived({
            businessId: input.tenantId,
            orderId: input.orderId,
            memberId: input.memberId,
            reason: input.reason?.trim().slice(0, 500) || null,
            eventId: eventIdFrom("payment", order.id, "recibido"),
          });
        } catch (err) {
          if (err instanceof InvalidTransition) throw new OrderError("INVALID_TRANSITION", "No se puede registrar el pago en este momento.");
          throw err;
        }
        if (r.result === "no_encontrado") throw new OrderError("NOT_FOUND", `No encontramos el pedido ${input.orderId}.`);
        if (r.result === "conflicto") throw new OrderError("CONFLICT", "El pedido cambió mientras lo procesábamos. Consulta el pedido de nuevo.");
        return { order: r.order, result: r.result === "ok" ? ("ok" as const) : ("duplicate" as const) };
      });
    },

    /**
     * Bloque 27 — el cliente MODIFICA o CANCELA en el checkout: la propuesta de ESTA conversación se
     * cancela (actor sistema). Nunca toca stock: una propuesta no tiene reserva. Un pedido ya
     * confirmado no se cancela por aquí (eso lo decide una persona del equipo). Idempotente.
     */
    async cancelProposal(input: { tenantId: string; contact: OrderContact; orderId: string; reason: string; requestId?: string }): Promise<Order> {
      return (
        await traced("cancel_proposal", input, async () => {
          await requireAvailable();
          const order = await load(input.tenantId, input.contact, input.orderId);
          if (order.status === "cancelled") return { order, result: "duplicate" as const };
          if (!ABANDONABLE_STATUSES.includes(order.status)) {
            throw new OrderError("INVALID_TRANSITION", `El pedido ${order.orderId} ya no es una propuesta (estado: ${order.status}).`);
          }
          return move(order, "cancelled", "system", { confirmation: null }, { reason: input.reason.slice(0, 500) });
        })
      ).order;
    },

    /**
     * Bloque 27 — panel "Pedidos": pedidos YA confirmados del negocio (con o sin checkout), por
     * última actualización, con filtros y cursor. Antes de leer se vence lo que ya pasó su plazo.
     */
    async panelOrders(tenantId: string, query: Omit<PanelQuery, "limit"> & { limit: number }): Promise<{ items: Array<{ order: Order; reservations: ReservationSummary[] }>; next: { updatedAt: string; orderId: string } | null }> {
      await requireAvailable();
      await deps.orders.expireReservations(200).catch((err: unknown) => console.error("[catalogo/pedidos] vencer reservas:", err instanceof Error ? err.message : "?"));
      const limit = Math.min(Math.max(Math.trunc(query.limit), 1), 100);
      const rows = await deps.orders.listPanel(tenantId, { ...query, limit: limit + 1 });
      const page = rows.slice(0, limit);
      const reservations = await deps.orders.reservationsFor(tenantId, page.map((r) => r.order.id));
      const last = page.at(-1);
      return {
        items: page.map(({ order }) => ({ order, reservations: reservations.filter((r) => r.orderId === order.id) })),
        next: rows.length > limit && last ? { updatedAt: last.updatedAtRaw, orderId: last.order.orderId } : null,
      };
    },

    /** Bloque 27 — un pedido del negocio para el panel (null = no existe en ESTE negocio). */
    async panelOrder(tenantId: string, orderId: string): Promise<{ order: Order; reservations: ReservationSummary[] } | null> {
      await requireAvailable();
      const order = await deps.orders.getByOrderId(tenantId, orderId);
      if (!order) return null;
      return { order, reservations: await deps.orders.reservationsFor(tenantId, [order.id]) };
    },

    /** Bloque 27 — historial inmutable del pedido (panel "Pedidos"). */
    async orderHistory(tenantId: string, order: Order) {
      return deps.orders.historyFor(tenantId, order.id);
    },

    /**
     * Bloque 23 — vence los pedidos de conversación sin confirmar que llevan ABANDONED_ORDER_MS sin
     * cambios (ver ABANDONABLE_STATUSES). Cada uno por la transición normal (compare-and-set +
     * evento): si el pedido cambió mientras tanto (el cliente escribió), NO se vence. Idempotente.
     */
    expireAbandonedOrders: (input: { businessId?: string; limit?: number } = {}) => expireAbandoned(input),

    /** Pedidos abiertos del negocio con su reserva de stock (panel de la asesora). */
    async listOpenOrders(tenantId: string, limit = 100): Promise<Array<{ order: Order; reservations: ReservationSummary[] }>> {
      await requireAvailable();
      // Al abrir el panel se vence lo que ya pasó su plazo (no depende solo del cron): lo que la
      // asesora ve es el stock real. Idempotente y barato (índice de reservas activas por vencimiento).
      await deps.orders.expireReservations(200).catch((err: unknown) => console.error("[catalogo/pedidos] vencer reservas:", err instanceof Error ? err.message : "?"));
      // Bloque 23: tampoco se muestran propuestas abandonadas hace días como si siguieran abiertas.
      await expireAbandoned({ businessId: tenantId, limit: 100 }).catch((err: unknown) => console.error("[catalogo/pedidos] vencer abandonados:", err instanceof Error ? err.message : "?"));
      const orders = await deps.orders.listForBusiness(tenantId, ["pending_confirmation", "confirmed", "handoff"], limit);
      const reservations = await deps.orders.reservationsFor(tenantId, orders.map((o) => o.id));
      return orders.map((order) => ({ order, reservations: reservations.filter((r) => r.orderId === order.id) }));
    },

    /**
     * Historial del panel (Bloque 21): pedidos cerrados, más recientes primero, de a `limit` por
     * página con cursor (keyset). Una consulta de pedidos + una de reservas por página, sea la
     * primera o la número mil. `next` = cursor de la página siguiente (null si no hay más).
     */
    async listClosedOrders(
      tenantId: string,
      input: { status?: ClosedStatus; cursor: OrderCursor | null; limit: number },
    ): Promise<{ items: Array<{ order: Order; reservations: ReservationSummary[] }>; next: OrderCursor | null }> {
      await requireAvailable();
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100);
      const rows = await deps.orders.listClosed(tenantId, { statuses: input.status ? [input.status] : CLOSED_STATUSES, before: input.cursor, limit: limit + 1 });
      const page = rows.slice(0, limit);
      const reservations = await deps.orders.reservationsFor(tenantId, page.map((r) => r.order.id));
      const last = page.at(-1);
      return {
        items: page.map(({ order }) => ({ order, reservations: reservations.filter((r) => r.orderId === order.id) })),
        next: rows.length > limit && last ? { createdAt: last.createdAtRaw, orderId: last.order.orderId } : null,
      };
    },

    /** Cron: vence los pedidos confirmados cuya reserva pasó su plazo (el stock vuelve en la BD). */
    async expireReservations(limit = 200): Promise<number> {
      if (!(await deps.orders.available())) return 0;
      return deps.orders.expireReservations(limit);
    },

    /**
     * Pasa la conversación (y el pedido, si se indica) a una asesora: la IA
     * deja de responder en ESE chat. Idempotente.
     */
    async requestHandoff(input: {
      tenantId: string;
      contact: OrderContact;
      reason: string;
      context?: string | null;
      orderId?: string;
      actor: OrderActor;
      requestId?: string;
      /** Bloque 27: "released" = la IA calla hasta que una persona la libere (pedido confirmado). */
      pauseUntil?: "released";
    }): Promise<{ order: Order | null; paused: boolean }> {
      return traced("handoff_to_human", input, async () => {
        let order: Order | null = null;
        let eventId: string | undefined;
        if (input.orderId) {
          await requireAvailable();
          order = await load(input.tenantId, input.contact, input.orderId);
          if (TERMINAL_STATUSES.has(order.status)) throw new OrderError("INVALID_TRANSITION", `El pedido ${order.orderId} ya está cerrado (${order.status}).`);
          // Bloque 27: la atención es de la CONVERSACIÓN; un pedido del checkout sigue su propio ciclo
          // (su reserva y su vencimiento no dependen de que una asesora lo atienda).
          if (order.status !== "handoff" && !order.checkout) {
            ({ order, eventId } = await move(
              order,
              "handoff",
              input.actor,
              { handoff: { reason: input.reason, context: input.context ?? null, requestedBy: input.actor, at: now().toISOString() }, confirmation: null },
              { reason: input.reason, type: "order.handoff_requested" },
            ));
          }
        }
        if (!deps.handoff) throw new OrderError("UNAVAILABLE", "No se pudo avisar a una asesora en este momento.");
        const paused = await deps.handoff.pauseConversation({ tenantId: input.tenantId, contact: input.contact, reason: input.reason, ...(input.pauseUntil ? { until: input.pauseUntil } : {}) });
        if (!paused.ok) throw new OrderError("UNAVAILABLE", "No se pudo avisar a una asesora en este momento. Intenta de nuevo.");
        return { order, paused: true, eventId };
      });
    },

    /**
     * Mensaje de pedido que llegó por WhatsApp (ver lib/catalogo/pedidos/intake.ts):
     *
     *   con "Solicitud: DL-ORD-…" de una solicitud del catálogo SIN reclamar
     *     => se vincula a esta conversación (una sola vez), manda lo guardado
     *        (si el texto difiere: problema "message_mismatch"), se re-valida
     *        con el catálogo actual y queda propuesta o en draft;
     *   sin id (o de otra conversación, o vencida)
     *     => pedido nuevo desde las líneas del texto, canal DETAL (el texto no
     *        autoriza precio mayorista: "wholesale_unverified").
     *
     * Idempotente por wamid (reintentos de Meta) y por contacto (reenvíos).
     */
    async receiveWhatsappOrder(input: { tenantId: string; contact: OrderContact; messageId: string; text: string; requestId?: string }): Promise<
      { kind: "not_an_order" } | { kind: "created" | "claimed" | "duplicate"; order: Order }
    > {
      const parsed = parseWhatsappOrderText(input.text);
      if (!parsed) return { kind: "not_an_order" };
      return traced("whatsapp_order", input, async () => {
        await requireAvailable();
        const invalidIssues: OrderIssue[] = parsed.invalid.map((i) => ({
          code: "invalid_quantity",
          reference: i.reference,
          message: i.reason === "unreadable" ? `No pudimos leer la cantidad de ${i.reference}.` : `La cantidad de ${i.reference} no es válida (debe ser entre 1 y 99).`,
        }));

        if (parsed.requestId) {
          const existing = await deps.orders.getByOrderId(input.tenantId, parsed.requestId);
          if (existing && sameContact(existing.contact, input.contact)) return { kind: "duplicate" as const, order: existing, result: "duplicate" as const };
          if (existing && existing.source === "catalog" && existing.contact === null && (existing.status === "validated" || existing.status === "draft")) {
            const textoCoincide =
              invalidIssues.length === 0 &&
              canonicalItems(parsed.items) === canonicalItems(itemsOf(existing)) &&
              parsed.claimsWholesale === (existing.channel === "wholesale");
            const mismatch: OrderIssue[] = textoCoincide
              ? []
              : [{ code: "message_mismatch", message: "El mensaje no coincide con la solicitud enviada desde el catálogo; se tomó la solicitud original." }];
            try {
              const claimed = await revalidate(existing, "system", mismatch, input.contact);
              return { kind: "claimed" as const, order: claimed.order, eventId: claimed.eventId };
            } catch (err) {
              // Otra conversación la reclamó en paralelo: este mensaje sigue como pedido propio (abajo).
              if (!(err instanceof OrderError && err.code === "CONFLICT")) throw err;
            }
          }
        }

        if (parsed.items.length === 0 && invalidIssues.length === 0) return { kind: "not_an_order" as const, result: "skipped" as const };
        const sticky: OrderIssue[] = [...invalidIssues];
        if (parsed.claimsWholesale) {
          sticky.push({ code: "wholesale_unverified", message: "El mensaje pide precio mayorista, pero no llegó desde el catálogo mayorista: se calculó con precio al detal." });
        }
        const key = conversationKey("wa", input.contact, input.messageId);
        const fingerprint = requestFingerprint("retail", parsed.items);
        const ev = await evaluate(input.tenantId, "retail", parsed.items, undefined, sticky);
        const clean = ev.issues.length === 0 && ev.lines.length > 0;
        const result = await insert(
          {
            businessId: input.tenantId,
            channel: "retail",
            source: "whatsapp",
            status: clean ? "pending_confirmation" : "draft",
            contact: input.contact,
            ...evaluationChanges(ev),
            currency: "COP",
            confirmation: clean ? newConfirmation(ev) : null,
            idempotencyKey: key,
            requestFingerprint: fingerprint,
            createdAt: now().toISOString(),
          },
          (attempt) => publicIdFor(input.tenantId, key, attempt),
        );
        return {
          kind: result.created ? ("created" as const) : ("duplicate" as const),
          order: result.order,
          eventId: result.created ? result.eventId : undefined,
          result: result.created ? ("ok" as const) : ("duplicate" as const),
        };
      });
    },
  };
}

export type OrderEngine = ReturnType<typeof createOrderEngine>;
