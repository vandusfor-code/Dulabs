/**
 * Eventos CANÓNICOS de pedidos — contrato VERSIONADO para cualquier
 * consumidor (webhook, cola, agente, CRM, automatizaciones).
 *
 *   {
 *     event_id, event_type, version: 2, occurred_at,
 *     business: { id }, customer: { phone_number_id, wa_id } | null,
 *     channel, source, order: { … snapshot … }, transition?: { … }
 *   }
 *
 * - `order` es el snapshot ESTRUCTURADO que el backend resolvió: ningún
 *   consumidor necesita (ni debe) reconstruir nada desde el texto de WhatsApp.
 * - `event_id` es la llave de deduplicación (INSERT … ON CONFLICT DO NOTHING).
 *   Creación: determinista por negocio + clave de idempotencia (un reintento
 *   emite el MISMO evento). Transiciones: una por cambio real de estado (la
 *   transición es atómica con compare-and-set: un reintento que no cambia
 *   nada no emite nada).
 * - `version`: cambios incompatibles => versión nueva; los consumidores
 *   validan con el esquema de la versión que entienden.
 * - Datos personales: `customer` identifica la conversación (necesario para
 *   la asesora/CRM); estos eventos NUNCA van a los registros tal cual (ver
 *   logOrderEventSink, que los resume sin el teléfono).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { ORDER_SOURCES, ORDER_STATUSES, type Order, type OrderActor, type OrderStatus } from "@/lib/catalogo/pedidos/contrato";
import { crockford } from "@/lib/catalogo/pedido-firma";

export const ORDER_EVENT_TYPES = ["catalog.order_request.created", "order.created", "order.status_changed", "order.handoff_requested"] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

const reference = z.string().regex(/^[A-Z]{1,6}-\d{6,}$/);
const money = z.number().int().min(0).nullable();

export const orderSnapshotSchema = z
  .object({
    order_id: z.string().regex(/^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$/),
    status: z.enum(ORDER_STATUSES),
    lines: z.array(
      z.object({ reference, product_name: z.string(), quantity: z.number().int().min(1), unit_price: money, subtotal: money }).strict(),
    ),
    total_units: z.number().int().min(0),
    total: z.number().int().min(0),
    unpriced_units: z.number().int().min(0),
    currency: z.literal("COP"),
    created_at: z.iso.datetime(),
  })
  .strict();

export const orderEventV2Schema = z
  .object({
    event_id: z.string().regex(/^evt_[0-9a-z]{26}$/),
    event_type: z.enum(ORDER_EVENT_TYPES),
    version: z.literal(2),
    occurred_at: z.iso.datetime(),
    business: z.object({ id: z.uuid() }).strict(),
    customer: z.object({ phone_number_id: z.string().min(1), wa_id: z.string().regex(/^\d{6,20}$/) }).strict().nullable(),
    channel: z.enum(["retail", "wholesale"]),
    source: z.enum(ORDER_SOURCES),
    order: orderSnapshotSchema,
    transition: z
      .object({ from: z.enum(ORDER_STATUSES), to: z.enum(ORDER_STATUSES), actor: z.enum(["system", "agent", "human"]), reason: z.string().max(500).nullable() })
      .strict()
      .optional(),
  })
  .strict();

export type OrderEvent = z.infer<typeof orderEventV2Schema>;

/** evt_ + 26 símbolos base32 de un hash (determinista para el mismo insumo). */
export function eventIdFrom(...parts: string[]): string {
  return `evt_${crockford(createHash("sha256").update(parts.join("\u0000")).digest(), 26).toLowerCase()}`;
}

export function orderSnapshot(o: Order): OrderEvent["order"] {
  return {
    order_id: o.orderId,
    status: o.status,
    lines: o.lines.map((l) => ({ reference: l.reference, product_name: l.productName, quantity: l.quantity, unit_price: l.unitPrice, subtotal: l.subtotal })),
    total_units: o.totalUnits,
    total: o.total,
    unpriced_units: o.unpricedUnits,
    currency: o.currency,
    created_at: o.createdAt,
  };
}

export function orderEvent(
  type: OrderEventType,
  order: Order,
  opts: { eventId: string; occurredAt: string; transition?: { from: OrderStatus; to: OrderStatus; actor: OrderActor; reason?: string | null } },
): OrderEvent {
  return {
    event_id: opts.eventId,
    event_type: type,
    version: 2,
    occurred_at: opts.occurredAt,
    business: { id: order.businessId },
    customer: order.contact ? { phone_number_id: order.contact.phoneNumberId, wa_id: order.contact.waId } : null,
    channel: order.channel,
    source: order.source,
    order: orderSnapshot(order),
    ...(opts.transition ? { transition: { ...opts.transition, reason: opts.transition.reason ?? null } } : {}),
  };
}

/** Puerto de salida. Publicar es "mejor esfuerzo": nunca rompe la operación que lo originó. */
export interface OrderEventSink {
  publish(event: OrderEvent): Promise<void>;
}

/**
 * Adaptador por defecto: registro estructurado SIN datos personales (el
 * teléfono del cliente no se escribe; queda en el almacén de eventos de la
 * BD, con acceso restringido).
 */
export const logOrderEventSink: OrderEventSink = {
  async publish(event) {
    console.info(
      JSON.stringify({
        log: "catalog_event",
        event_id: event.event_id,
        event_type: event.event_type,
        version: event.version,
        occurred_at: event.occurred_at,
        business_id: event.business.id,
        channel: event.channel,
        source: event.source,
        order_id: event.order.order_id,
        status: event.order.status,
        lines: event.order.lines.length,
        total: event.order.total,
        has_customer: event.customer !== null,
        ...(event.transition ? { transition: `${event.transition.from}->${event.transition.to}`, actor: event.transition.actor } : {}),
      }),
    );
  },
};

/** Adaptador de pruebas: valida con el esquema y deduplica por event_id, como un almacén real. */
export function memoryOrderEventSink(): OrderEventSink & { events: OrderEvent[]; published: number } {
  const events: OrderEvent[] = [];
  const sink = {
    events,
    published: 0,
    async publish(event: OrderEvent) {
      sink.published++;
      if (!events.some((e) => e.event_id === event.event_id)) events.push(orderEventV2Schema.parse(event));
    },
  };
  return sink;
}
