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

/** Validación estricta del pedido que llega del navegador: nada de precios, nombres ni ids. */
export const orderRequestSchema = z
  .object({
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
  name: string;
  price: number | null;
  availability: Availability;
  /** Máximo pedible (stock); null = sin límite de inventario. */
  maxQuantity: number | null;
}

export type OrderAdjustment =
  | { kind: "not_found"; reference: string; requested: number }
  | { kind: "sold_out"; reference: string; name: string; requested: number }
  | { kind: "quantity_reduced"; reference: string; name: string; requested: number; granted: number };

export interface OrderLine {
  reference: string;
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
export function prepareOrder(items: readonly OrderItem[], resolved: ReadonlyMap<string, ResolvedOrderProduct>): PreparedOrder {
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
    lines.push({ reference: product.reference, name: product.name, quantity, unitPrice: product.price, subtotal: product.price === null ? null : product.price * quantity });
  }
  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0);
  const total = lines.reduce((sum, l) => sum + (l.subtotal ?? 0), 0);
  const unpricedUnits = lines.filter((l) => l.unitPrice === null).reduce((sum, l) => sum + l.quantity, 0);
  return { lines, adjustments, totalUnits, total, unpricedUnits };
}

// ---------------------------------------------------------------------------
// Mensaje de WhatsApp — formato CENTRALIZADO (solo el backend lo arma)
// ---------------------------------------------------------------------------

const unidades = (n: number) => `${n} ${n === 1 ? "unidad" : "unidades"}`;

/**
 * Mensaje del pedido para WhatsApp. La referencia va primero en cada línea
 * (es la identidad que el webhook/agente leerá); el nombre acompaña para la
 * asesora humana. Para evolucionar el formato, se cambia solo aquí (y su
 * lector `parseOrderMessage` se mantiene compatible).
 */
export function orderWhatsappMessage(lines: readonly Pick<OrderLine, "reference" | "name" | "quantity">[], context: PriceContext): string {
  const intro = context === "wholesale" ? "Hola, me interesan estos productos (precio mayorista):" : "Hola, me interesan estos productos:";
  const detalle = lines.map((l) => `• ${l.reference} · ${l.name} — ${unidades(l.quantity)}`);
  return [intro, "", ...detalle, "", "Quiero información para realizar la compra."].join("\n");
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
export function parseOrderMessage(text: string): { context: PriceContext | null; items: OrderItem[] } {
  const raw: OrderItem[] = [];
  for (const re of [LINEA_ACTUAL, LINEA_LEGADA]) {
    for (const match of text.matchAll(re)) raw.push({ reference: match[1], quantity: Math.max(1, Math.min(ORDER_MAX_QUANTITY, Number(match[2]))) });
  }
  const items = normalizeOrderItems(raw);
  const context: PriceContext | null = items.length === 0 ? null : /\(precio mayorista\)/.test(text) ? "wholesale" : "retail";
  return { context, items };
}
