/**
 * Lectura DETERMINISTA del mensaje de pedido que genera el catálogo
 * (orderWhatsappMessage en lib/catalogo/pedido.ts) cuando llega por WhatsApp.
 *
 * Solo extrae lo que el cliente escribió: referencias, cantidades, el id de
 * solicitud (DL-ORD-…) y si el texto DICE "precio mayorista". Nunca decide
 * precio, disponibilidad, producto, descuento ni total: eso lo resuelve el
 * motor contra el catálogo actual.
 *
 * Diferencia con parseOrderMessage (Fase 6): aquí una cantidad ilegible, 0,
 * negativa o mayor al máximo NO se ajusta en silencio: se reporta
 * (`invalid`) para que el pedido quede con ese problema a la vista.
 *
 * El texto lo puede editar el cliente antes de enviarlo: todo lo de aquí es
 * una PISTA. Si hay una solicitud estructurada guardada, manda la guardada.
 */
import { ORDER_MAX_LINES, ORDER_MAX_QUANTITY, ORDER_REQUEST_ID_PATTERN, type OrderItem } from "@/lib/catalogo/pedido";

export interface ParsedWhatsappOrder {
  requestId: string | null;
  /** El texto dice "(precio mayorista)". NO autoriza precio mayorista: solo el link con token lo hace. */
  claimsWholesale: boolean;
  /** Líneas legibles (referencia + cantidad 1..99), duplicados sumados. */
  items: OrderItem[];
  /** Líneas con referencia pero cantidad ilegible o fuera de rango. */
  invalid: Array<{ reference: string; reason: "unreadable" | "out_of_range" }>;
}

const REFERENCIA = /\b([A-Z]{1,6}-\d{6,})\b/;
// "• DL-000184 · Nombre — 2 unidades" (actual) / "• Nombre — Ref. DL-000184 — Cantidad: 2" (Fase 2).
const CANTIDAD_ACTUAL = /[—–-]\s*(-?\d+)\s+unidad(?:es)?\b/;
const CANTIDAD_LEGADA = /Cantidad:\s*(-?\d+)/;
const MAX_TEXT = 8000;

/** null = el texto no es un pedido del catálogo (ni líneas con referencia ni id de solicitud). */
export function parseWhatsappOrderText(text: string): ParsedWhatsappOrder | null {
  const body = text.slice(0, MAX_TEXT);
  const requestId = ORDER_REQUEST_ID_PATTERN.exec(body)?.[0] ?? null;
  const totals = new Map<string, number>();
  const invalid: ParsedWhatsappOrder["invalid"] = [];

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("•")) continue;
    const upper = line.toUpperCase();
    const ref = REFERENCIA.exec(upper.replace(/\bDL-ORD-[0-9A-Z]+\b/g, ""))?.[1];
    if (!ref) continue;
    // La cantidad se busca DESPUÉS de la referencia (el nombre puede tener guiones y números).
    const after = upper.slice(upper.indexOf(ref) + ref.length);
    const match = CANTIDAD_ACTUAL.exec(after.toLowerCase()) ?? CANTIDAD_LEGADA.exec(line);
    if (!match) {
      invalid.push({ reference: ref, reason: "unreadable" });
      continue;
    }
    const quantity = Number(match[1]);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > ORDER_MAX_QUANTITY) {
      invalid.push({ reference: ref, reason: "out_of_range" });
      continue;
    }
    totals.set(ref, (totals.get(ref) ?? 0) + quantity);
  }

  const items: OrderItem[] = [];
  for (const [reference, quantity] of totals) {
    // Sumar líneas repetidas no puede superar el máximo en silencio.
    if (quantity > ORDER_MAX_QUANTITY) invalid.push({ reference, reason: "out_of_range" });
    else if (items.length < ORDER_MAX_LINES) items.push({ reference, quantity });
  }
  if (!requestId && items.length === 0 && invalid.length === 0) return null;
  return { requestId, claimsWholesale: /\(precio mayorista\)/i.test(body), items, invalid };
}
