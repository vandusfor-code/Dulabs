/**
 * Pedido estructurado del catálogo — DOMINIO PURO (sin red ni BD).
 *
 * Contrato ÚNICO entre la tienda, WhatsApp y (mañana) el webhook y el agente:
 *
 *   { items: [{ reference: "DL-000184", quantity: 2 }, …] }
 *
 * La referencia es la identidad del producto; nunca el nombre. El navegador
 * solo aporta este pedido; el backend lo PREPARA contra la verdad del
 * catálogo (producto real -> precio vigente -> stock vigente ->
 * disponibilidad) y solo un pedido sin ajustes pendientes se envía.
 *
 *   WhatsApp -> webhook -> parseOrderMessage -> pedido estructurado ->
 *   resolver referencias (lib/catalogo/resolucion.ts) -> contexto para el agente
 */
import { z } from "zod";
import { formatCop } from "@/lib/business-agent-quote";
import type { Availability, PriceContext } from "@/lib/catalogo/domain";

/** Límites del pedido (iguales a los del carrito). */
export const ORDER_MAX_QUANTITY = 99;
export const ORDER_MAX_LINES = 60;

export interface OrderItem {
  reference: string;
  quantity: number;
}

export interface OrderRequest {
  items: OrderItem[];
}

/** Canal de venta del pedido: lo decide la publicación autorizada (link detal o link mayorista con token), nunca el navegador. */
export type OrderChannel = PriceContext;

/** Moneda del catálogo (precios enteros en pesos colombianos). */
export const ORDER_CURRENCY = "COP" as const;

/** Clave de idempotencia que genera el navegador por intento de envío (ver pedido-firma.ts). */
export const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** Tope de la cotización firmada que el navegador devuelve (60 líneas holgadas). */
export const QUOTE_MAX_CHARS = 8000;

/**
 * Validación estricta de lo que llega del navegador: referencias y cantidades
 * (+ dos datos OPACOS que emitió el propio backend: la cotización firmada que
 * el cliente vio y la clave de idempotencia del intento). Nunca precios,
 * nombres, ids, negocio ni canal.
 */
export const orderRequestSchema = z
  .object({
    quote: z.string().max(QUOTE_MAX_CHARS).optional(),
    requestKey: z.string().regex(REQUEST_KEY_PATTERN).optional(),
    items: z
      .array(
        z
          .object({
            reference: z.string().trim().min(1).max(24),
            quantity: z.number().int().min(1).max(ORDER_MAX_QUANTITY),
          })
          .strict(),
      )
      .min(1, { message: "Tu selección está vacía." })
      .max(ORDER_MAX_LINES),
  })
  .strict();

/** Verdad del backend sobre una referencia, en el contexto de precio del pedido. */
export interface ResolvedOrderProduct {
  reference: string;
  /** Id interno (solo backend: nunca sale en respuestas públicas ni en el mensaje). */
  productId?: string;
  name: string;
  price: number | null;
  availability: Availability;
  /** Máximo pedible (stock); null = sin límite de inventario. */
  maxQuantity: number | null;
}

/**
 * Por qué un pedido no se puede enviar tal cual. Cualquiera de estos detiene
 * el envío (validación ATÓMICA): el cliente ve exactamente qué pasó y corrige.
 *   - not_found: no existe, se desactivó o no es de este catálogo (para el
 *     cliente es lo mismo: "ya no está disponible");
 *   - sold_out / quantity_reduced: inventario;
 *   - price_changed: el precio vigente no es el que el cliente vio (según la
 *     cotización firmada por el backend, nunca un precio enviado por él).
 */
export type OrderAdjustment =
  | { kind: "not_found"; reference: string; requested: number }
  | { kind: "sold_out"; reference: string; name: string; requested: number }
  | { kind: "quantity_reduced"; reference: string; name: string; requested: number; granted: number }
  | { kind: "price_changed"; reference: string; name: string; before: number | null; after: number | null };

export interface OrderLine {
  reference: string;
  /** Id interno (solo backend). */
  productId?: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  subtotal: number | null;
}

export interface PreparedOrder {
  lines: OrderLine[];
  /** Diferencias entre lo pedido y lo posible. Vacío = el pedido se puede enviar tal cual. */
  adjustments: OrderAdjustment[];
  totalUnits: number;
  /** Suma de lo que tiene precio (COP). */
  total: number;
  /** Unidades con precio a consultar (nunca se suma un 0 inventado). */
  unpricedUnits: number;
}

/** Normaliza el pedido: referencias en mayúscula, duplicados sumados (con tope). */
export function normalizeOrderItems(items: readonly OrderItem[]): OrderItem[] {
  const out: OrderItem[] = [];
  for (const item of items) {
    const reference = item.reference.trim().toUpperCase();
    const existing = out.find((i) => i.reference === reference);
    if (existing) existing.quantity = Math.min(ORDER_MAX_QUANTITY, existing.quantity + item.quantity);
    else if (out.length < ORDER_MAX_LINES) out.push({ reference, quantity: Math.min(ORDER_MAX_QUANTITY, item.quantity) });
  }
  return out;
}

/**
 * Prepara el pedido contra la verdad del backend. Determinista: mismo pedido
 * + mismo catálogo => mismo resultado. Nunca concede más unidades que el stock
 * ni incluye productos agotados, inactivos o de otro negocio (no resueltos).
 */
export function prepareOrder(
  items: readonly OrderItem[],
  resolved: ReadonlyMap<string, ResolvedOrderProduct>,
  /** Precios que el cliente vio (de la cotización FIRMADA por el backend). Sin ella no se evalúan cambios de precio. */
  quoted?: ReadonlyMap<string, number | null> | null,
): PreparedOrder {
  const lines: OrderLine[] = [];
  const adjustments: OrderAdjustment[] = [];
  for (const item of normalizeOrderItems(items)) {
    const product = resolved.get(item.reference);
    if (!product) {
      adjustments.push({ kind: "not_found", reference: item.reference, requested: item.quantity });
      continue;
    }
    const limit = product.availability === "sold_out" ? 0 : Math.min(ORDER_MAX_QUANTITY, product.maxQuantity ?? ORDER_MAX_QUANTITY);
    if (limit < 1) {
      adjustments.push({ kind: "sold_out", reference: item.reference, name: product.name, requested: item.quantity });
      continue;
    }
    const quantity = Math.min(item.quantity, limit);
    if (quantity < item.quantity) adjustments.push({ kind: "quantity_reduced", reference: item.reference, name: product.name, requested: item.quantity, granted: quantity });
    if (quoted?.has(product.reference) && quoted.get(product.reference) !== product.price) {
      adjustments.push({ kind: "price_changed", reference: product.reference, name: product.name, before: quoted.get(product.reference) ?? null, after: product.price });
    }
    lines.push({
      reference: product.reference,
      ...(product.productId ? { productId: product.productId } : {}),
      name: product.name,
      quantity,
      unitPrice: product.price,
      subtotal: product.price === null ? null : product.price * quantity,
    });
  }
  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0);
  const total = lines.reduce((sum, l) => sum + (l.subtotal ?? 0), 0);
  const unpricedUnits = lines.filter((l) => l.unitPrice === null).reduce((sum, l) => sum + l.quantity, 0);
  return { lines, adjustments, totalUnits, total, unpricedUnits };
}

// ---------------------------------------------------------------------------
// Borrador de pedido (OrderDraft): la intención del cliente, NO una venta
// ---------------------------------------------------------------------------

/**
 * Solicitud de pedido validada por el backend. Es la INTENCIÓN del cliente
 * antes de hablar con el negocio: no descuenta stock, no reserva nada y no es
 * una venta. Todo lo que contiene lo calculó el servidor (precios del canal,
 * subtotales, total); del navegador solo vinieron referencias y cantidades.
 */
export interface OrderDraft {
  /** Identificador corto y legible para la conversación (DL-ORD-7F42KQ). No reemplaza las referencias. */
  requestId: string;
  /** Negocio y publicación (una publicación por negocio). `businessId` es interno: nunca sale al navegador. */
  businessId: string;
  publication: { slug: string; publicName: string };
  channel: OrderChannel;
  currency: typeof ORDER_CURRENCY;
  items: Array<Required<Pick<OrderLine, "reference" | "name" | "quantity">> & { productId: string | null; unitPrice: number | null; subtotal: number | null }>;
  /** Líneas distintas. */
  totalProducts: number;
  totalUnits: number;
  /** Suma de lo que tiene precio. */
  total: number;
  /** Unidades con precio a consultar (nunca se suma un 0 inventado). */
  unpricedUnits: number;
  createdAt: string;
}

export function buildOrderDraft(input: {
  requestId: string;
  businessId: string;
  publication: { slug: string; publicName: string };
  channel: OrderChannel;
  order: PreparedOrder;
  now: Date;
}): OrderDraft {
  const { order } = input;
  return {
    requestId: input.requestId,
    businessId: input.businessId,
    publication: { slug: input.publication.slug, publicName: input.publication.publicName },
    channel: input.channel,
    currency: ORDER_CURRENCY,
    items: order.lines.map((l) => ({ reference: l.reference, productId: l.productId ?? null, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, subtotal: l.subtotal })),
    totalProducts: order.lines.length,
    totalUnits: order.totalUnits,
    total: order.total,
    unpricedUnits: order.unpricedUnits,
    createdAt: input.now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mensaje de WhatsApp — formato CENTRALIZADO (solo el backend lo arma)
// ---------------------------------------------------------------------------

const unidades = (n: number) => `${n} ${n === 1 ? "unidad" : "unidades"}`;
/** Mismo formato de pesos que la tienda ("$1.250.000"): una sola regla. */
const pesos = formatCop;

/** Identificador de solicitud: "DL-ORD-" + base32 Crockford (sin I, L, O, U). */
export const ORDER_REQUEST_ID_PATTERN = /\bDL-ORD-[0-9A-HJKMNP-TV-Z]{6}\b/;

/**
 * Mensaje del pedido para WhatsApp. Cada línea lleva REFERENCIA + PRODUCTO +
 * CANTIDAD (la referencia primero: es lo que el webhook/agente lee; el nombre
 * es para la persona). Sin precios por línea: el precio lo confirma el
 * negocio con la verdad del catálogo; el total va como referencia
 * ("estimado"). Para evolucionar el formato se cambia SOLO aquí, y su lector
 * `parseOrderMessage` se mantiene compatible con los formatos anteriores.
 */
export function orderWhatsappMessage(
  lines: readonly Pick<OrderLine, "reference" | "name" | "quantity">[],
  context: PriceContext,
  extra?: { requestId?: string; total?: number; unpricedUnits?: number },
): string {
  const intro = context === "wholesale" ? "Hola, me interesan estos productos (precio mayorista):" : "Hola, me interesan estos productos:";
  const detalle = lines.map((l) => `• ${l.reference} · ${l.name} — ${unidades(l.quantity)}`);
  const unidadesTotal = lines.reduce((sum, l) => sum + l.quantity, 0);
  const resumen = [`Total de productos: ${lines.length}`, `Unidades: ${unidadesTotal}`];
  if (extra?.total !== undefined && extra.total > 0) {
    const consultar = extra.unpricedUnits ? ` + ${extra.unpricedUnits === 1 ? "1 producto" : `${extra.unpricedUnits} productos`} con precio a consultar` : "";
    resumen.push(`Total estimado: ${pesos(extra.total)}${consultar}`);
  }
  const cierre = extra?.requestId ? [`Solicitud: ${extra.requestId}`, "Quisiera información para realizar el pedido."] : ["Quisiera información para realizar el pedido."];
  return [intro, "", ...detalle, "", ...resumen, "", ...cierre].join("\n");
}

/** Link wa.me al número del negocio; null si no hay número válido. */
export function whatsappUrl(phone: string | null, text: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// Línea actual: "• DL-000184 · Nombre — 2 unidades". Legado (Fase 2): "• Nombre — Ref. DL-000184 — Cantidad: 2".
const LINEA_ACTUAL = /(?:^|\n)\s*•\s*([A-Z]{1,6}-\d{6,})\b[^\n]*?[—–-]\s*(\d{1,3})\s+unidad(?:es)?\b/g;
const LINEA_LEGADA = /Ref\.\s*([A-Z]{1,6}-\d{6,})\s*[—–-]\s*Cantidad:\s*(\d{1,3})/g;

/**
 * Lee de forma DETERMINISTA un mensaje de pedido generado por el catálogo ->
 * pedido estructurado + contexto. Para el webhook: nunca interpreta nombres ni
 * texto libre, solo las líneas con referencia y cantidad.
 */
export function parseOrderMessage(text: string): { context: PriceContext | null; items: OrderItem[]; requestId: string | null } {
  const raw: OrderItem[] = [];
  for (const re of [LINEA_ACTUAL, LINEA_LEGADA]) {
    for (const match of text.matchAll(re)) raw.push({ reference: match[1], quantity: Math.max(1, Math.min(ORDER_MAX_QUANTITY, Number(match[2]))) });
  }
  const items = normalizeOrderItems(raw);
  const context: PriceContext | null = items.length === 0 ? null : /\(precio mayorista\)/.test(text) ? "wholesale" : "retail";
  // OJO: el texto lo puede editar el cliente antes de enviarlo. El canal y el
  // id aquí son PISTAS: el agente confirma el canal con la solicitud emitida
  // por el backend (evento) y vuelve a resolver cada referencia.
  const requestId = ORDER_REQUEST_ID_PATTERN.exec(text)?.[0] ?? null;
  return { context, items, requestId };
}
