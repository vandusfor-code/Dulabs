/**
 * Registro ESTRUCTURADO de las operaciones de pedidos (una línea JSON).
 *
 * Campos: request_id, event_id, business_id, operation, result, duration_ms,
 * error_code (+ order_id / status cuando aplica).
 *
 * NUNCA: tokens, secretos, credenciales, el texto del mensaje, nombres ni el
 * teléfono del cliente. La conversación se identifica con `contact_ref`, un
 * hash corto y no reversible en la práctica del wa_id (sirve para correlacionar
 * líneas del mismo chat sin exponer el número).
 */
import { createHash } from "node:crypto";

export interface OrderLogEntry {
  request_id: string;
  business_id: string;
  operation: string;
  result: "ok" | "error" | "duplicate" | "skipped";
  duration_ms: number;
  event_id?: string;
  error_code?: string;
  /** Por qué se omitió (result = "skipped"). */
  reason?: string;
  order_id?: string;
  status?: string;
  contact_ref?: string;
}

export type OrderLogger = (entry: OrderLogEntry) => void;

export const logOrderOperation: OrderLogger = (entry) => {
  console.info(JSON.stringify({ log: "catalog_order", ...entry }));
};

/** Hash corto del wa_id: correlaciona sin exponer el teléfono. */
export function contactRef(waId: string): string {
  return createHash("sha256").update(`dulabs:contact:${waId}`).digest("hex").slice(0, 12);
}
