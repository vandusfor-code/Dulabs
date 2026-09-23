/**
 * Evento de dominio `catalog.order_request.created` — CONTRATO para lo que
 * venga después (webhook del agente, bandeja de la asesora, métricas).
 *
 * Se emite cuando el backend validó una solicitud de pedido y entregó el link
 * de WhatsApp. No significa venta: no descuenta stock ni reserva nada.
 *
 * Idempotencia: `event_id` y `order_request_id` son DETERMINISTAS por intento
 * (negocio + canal + clave de idempotencia + líneas; ver pedido-firma.ts). Un
 * doble toque o un reintento emiten el MISMO evento; el consumidor deduplica
 * por `event_id` (p. ej. INSERT … ON CONFLICT (event_id) DO NOTHING).
 *
 * Sin infraestructura nueva: el puerto `OrderRequestEventSink` hoy escribe un
 * registro estructurado (una línea JSON). Cambiar a una tabla o a una cola es
 * cambiar el adaptador, no el dominio ni el contrato.
 */
import { z } from "zod";
import { ORDER_CURRENCY, type OrderDraft } from "@/lib/catalogo/pedido";

export const ORDER_REQUEST_CREATED = "catalog.order_request.created" as const;

const reference = z.string().regex(/^[A-Z]{1,6}-\d{6,}$/);
const money = z.number().int().min(0).nullable();

/** Esquema del evento (versión 1). Quien lo consuma lo valida con esto: nunca confía a ciegas. */
export const orderRequestCreatedSchema = z
  .object({
    type: z.literal(ORDER_REQUEST_CREATED),
    version: z.literal(1),
    event_id: z.string().regex(/^evt_[0-9a-z]{26}$/),
    occurred_at: z.iso.datetime(),
    business_id: z.uuid(),
    /** Publicación que originó el pedido (una por negocio): su slug público. */
    publication_id: z.string().min(1).max(50),
    channel: z.enum(["retail", "wholesale"]),
    order_request_id: z.string().regex(/^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$/),
    currency: z.literal(ORDER_CURRENCY),
    items: z
      .array(
        z
          .object({
            reference,
            quantity: z.number().int().min(1),
            // Informativos (lo que el backend calculó al emitir): el agente vuelve a resolver la verdad.
            name: z.string(),
            unit_price: money,
            subtotal: money,
          })
          .strict(),
      )
      .min(1),
    totals: z.object({ products: z.number().int().min(1), units: z.number().int().min(1), amount: z.number().int().min(0), unpriced_units: z.number().int().min(0) }).strict(),
  })
  .strict();

export type OrderRequestCreated = z.infer<typeof orderRequestCreatedSchema>;

export function orderRequestCreatedEvent(draft: OrderDraft, eventId: string): OrderRequestCreated {
  return {
    type: ORDER_REQUEST_CREATED,
    version: 1,
    event_id: eventId,
    occurred_at: draft.createdAt,
    business_id: draft.businessId,
    publication_id: draft.publication.slug,
    channel: draft.channel,
    order_request_id: draft.requestId,
    currency: draft.currency,
    items: draft.items.map((i) => ({ reference: i.reference, quantity: i.quantity, name: i.name, unit_price: i.unitPrice, subtotal: i.subtotal })),
    totals: { products: draft.totalProducts, units: draft.totalUnits, amount: draft.total, unpriced_units: draft.unpricedUnits },
  };
}

/** Puerto de salida de eventos. Nunca debe romper el pedido del cliente: publicar es "mejor esfuerzo" hasta que exista un almacén. */
export interface OrderRequestEventSink {
  publish(event: OrderRequestCreated): Promise<void>;
}

/** Adaptador actual: una línea JSON en los registros del servidor (Vercel). Sin datos personales: el cliente aún no se identifica. */
export const logOrderRequestSink: OrderRequestEventSink = {
  async publish(event) {
    console.info(JSON.stringify({ log: "catalog_event", ...event }));
  },
};

/** Adaptador de pruebas: guarda lo publicado y deduplica por event_id, como lo hará el almacén real. */
export function memoryOrderRequestSink(): OrderRequestEventSink & { events: OrderRequestCreated[]; published: number } {
  const events: OrderRequestCreated[] = [];
  const sink = {
    events,
    published: 0,
    async publish(event: OrderRequestCreated) {
      sink.published++;
      if (!events.some((e) => e.event_id === event.event_id)) events.push(orderRequestCreatedSchema.parse(event));
    },
  };
  return sink;
}
