/**
 * Firmas del pedido — SOLO SERVIDOR (node:crypto). Tres piezas, todas
 * derivadas con HMAC-SHA256 de una clave del backend y SIN estado en la BD:
 *
 *  1. Cotización firmada ("quote"): los precios que el backend mostró al
 *     cliente (referencia -> precio del canal). El navegador la guarda como un
 *     dato OPACO y la devuelve al pedir; el backend verifica la firma y compara
 *     con el precio vigente => "El precio de X cambió". Así se detectan cambios
 *     de precio sin aceptar NUNCA un precio enviado por el navegador (uno
 *     alterado no pasa la firma). Ligada al negocio y al canal.
 *
 *  2. Identificador de solicitud (DL-ORD-7F42KQ): corto y legible para la
 *     conversación. DETERMINISTA a partir de (negocio, canal, clave de
 *     idempotencia del intento, líneas): el doble toque, el reintento del
 *     navegador o volver a tocar "Enviar" con el mismo carrito producen el
 *     MISMO id y el MISMO mensaje. Otro cliente (otra clave) => otro id.
 *
 *  3. Id del evento (evt_…): mismo insumo que el id de solicitud, 130 bits.
 *     Es la llave de deduplicación de quien consuma el evento (hoy un registro
 *     estructurado; mañana una tabla con UNIQUE(event_id) o una cola).
 *
 * Clave: CATALOG_ORDER_SECRET si existe; si no, se DERIVA de la clave de
 * servicio de Supabase con separación de dominio (HMAC con una etiqueta
 * propia), así no hace falta configurar nada nuevo para desplegar y la clave
 * de Supabase nunca se usa tal cual. Sin ninguna de las dos, el pedido no se
 * puede preparar (falla cerrado).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { OrderChannel, OrderItem } from "@/lib/catalogo/pedido";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Base32 Crockford de los primeros `chars` símbolos (5 bits cada uno). */
export function crockford(bytes: Uint8Array, chars: number): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      out += CROCKFORD[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
    if (out.length >= chars) break;
  }
  return out;
}

export type OrderKey = Buffer;

/** Clave de firma del backend (ver cabecera). null = no configurada. */
export function orderSigningKey(env: Record<string, string | undefined> = process.env): OrderKey | null {
  const own = env.CATALOG_ORDER_SECRET?.trim();
  if (own && own.length >= 32) return createHmac("sha256", own).update("dulabs:catalogo:pedidos:v1").digest();
  const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (service) return createHmac("sha256", service).update("dulabs:catalogo:pedidos:v1").digest();
  return null;
}

function mac(key: OrderKey, label: string, data: string): Buffer {
  return createHmac("sha256", key).update(`${label}\u0000${data}`).digest();
}

/** Líneas canónicas: referencia:cantidad ordenadas por referencia (el orden de agregado no cambia la identidad). */
export function canonicalItems(items: readonly OrderItem[]): string {
  return [...items]
    .map((i) => `${i.reference}:${i.quantity}`)
    .sort()
    .join(",");
}

export interface RequestIdentity {
  businessId: string;
  channel: OrderChannel;
  /** Clave de idempotencia del intento (la genera el navegador; opaca). */
  requestKey: string;
  items: readonly OrderItem[];
}

function identityData(i: RequestIdentity): string {
  return [i.businessId, i.channel, i.requestKey, canonicalItems(i.items)].join("|");
}

/** DL-ORD-XXXXXX (30 bits). Determinista: misma identidad => mismo id. */
export function orderRequestId(key: OrderKey, identity: RequestIdentity): string {
  return `DL-ORD-${crockford(mac(key, "order-request-id", identityData(identity)), 6)}`;
}

/** evt_ + 26 símbolos (130 bits). Determinista: la llave de deduplicación del evento. */
export function orderEventId(key: OrderKey, identity: RequestIdentity): string {
  return `evt_${crockford(mac(key, "order-event-id", identityData(identity)), 26).toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Cotización firmada
// ---------------------------------------------------------------------------

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Precios mostrados (referencia -> precio del canal o null "a consultar"), firmados para ESTE negocio y canal. */
export function signQuote(key: OrderKey, scope: { businessId: string; channel: OrderChannel }, prices: ReadonlyMap<string, number | null>): string {
  // El negocio NO viaja en la cotización (no se expone); entra solo en la firma.
  const payload = b64(JSON.stringify({ v: 1, c: scope.channel, p: [...prices.entries()].sort(([a], [b]) => (a < b ? -1 : 1)) }));
  const firma = mac(key, "order-quote", `${scope.businessId}|${payload}`).subarray(0, 18);
  return `q1.${payload}.${b64(firma)}`;
}

/**
 * Precios de una cotización VÁLIDA para este negocio y canal; null si falta,
 * está alterada, es de otro negocio o de otro canal (se trata como "sin
 * cotización": el cliente debe revisar los precios vigentes).
 */
export function readQuote(key: OrderKey, scope: { businessId: string; channel: OrderChannel }, token: string | undefined): Map<string, number | null> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "q1") return null;
  const [, payload, firma] = parts;
  const esperada = mac(key, "order-quote", `${scope.businessId}|${payload}`).subarray(0, 18);
  let recibida: Buffer;
  try {
    recibida = Buffer.from(firma, "base64url");
  } catch {
    return null;
  }
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: unknown; c?: unknown; p?: unknown };
    if (data.v !== 1 || data.c !== scope.channel || !Array.isArray(data.p)) return null;
    const out = new Map<string, number | null>();
    for (const entry of data.p) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") return null;
      const price = entry[1];
      out.set(entry[0], typeof price === "number" && Number.isFinite(price) ? price : null);
    }
    return out;
  } catch {
    return null;
  }
}
