/**
 * Carrito del catálogo público — DOMINIO PURO (sin DOM, sin red, sin React).
 *
 * Pieza central del catálogo: hoy alimenta la "selección + Pedir por
 * WhatsApp"; mañana, la pantalla completa de carrito. Por eso el estado es
 * explícito y versionado, y cada decisión futura tiene su lugar:
 *
 *   - Identidad de la línea = `reference` (DL-000184): la referencia real e
 *     inmutable de la BD, nunca el nombre visible. El mensaje de pedido se
 *     arma con ella.
 *   - `context` (detal / mayor): un carrito por catálogo Y por contexto de
 *     precio. El catálogo mayorista tendrá su propio carrito sin mezclar
 *     precios (la clave de almacenamiento incluye el contexto).
 *   - `unitPrice` es una FOTO del precio del catálogo al agregar (null =
 *     "precio a consultar"). La validación contra el servidor (precio vigente,
 *     producto activo, stock/disponibilidad) se hará con `reconcileCart`
 *     cuando exista ese endpoint: el tipo ya separa lo que viene del
 *     catálogo de lo que decide el cliente (la cantidad).
 *   - El agente de IA podrá leer el mismo mensaje/estructura (referencias +
 *     cantidades) sin parsear texto libre.
 */
import type { PriceContext } from "@/lib/catalogo/domain";

export const CART_VERSION = 1;
export const MAX_QUANTITY = 99;
export const MAX_LINES = 60;

/** Datos del producto tal como los entrega el catálogo público (nunca escritos a mano). */
export interface CartProduct {
  reference: string;
  name: string;
  /** Precio del contexto del catálogo; null = "precio a consultar". */
  price: number | null;
  imageUrl: string | null;
}

export interface CartLine {
  reference: string;
  name: string;
  unitPrice: number | null;
  imageUrl: string | null;
  quantity: number;
}

export interface CartState {
  version: typeof CART_VERSION;
  slug: string;
  context: PriceContext;
  lines: CartLine[];
}

export type CartAction =
  | { type: "add"; product: CartProduct; quantity?: number }
  | { type: "setQuantity"; reference: string; quantity: number }
  | { type: "remove"; reference: string }
  | { type: "clear" };

export function emptyCart(slug: string, context: PriceContext): CartState {
  return { version: CART_VERSION, slug, context, lines: [] };
}

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(quantity)));
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "add": {
      const { product } = action;
      const extra = clampQuantity(action.quantity ?? 1);
      const existing = state.lines.find((l) => l.reference === product.reference);
      if (existing) {
        const quantity = Math.min(MAX_QUANTITY, existing.quantity + extra);
        return {
          ...state,
          // Se refrescan nombre/precio/foto con los datos más recientes del catálogo.
          lines: state.lines.map((l) =>
            l.reference === product.reference ? { ...l, name: product.name, unitPrice: product.price, imageUrl: product.imageUrl, quantity } : l,
          ),
        };
      }
      if (state.lines.length >= MAX_LINES) return state;
      return {
        ...state,
        lines: [...state.lines, { reference: product.reference, name: product.name, unitPrice: product.price, imageUrl: product.imageUrl, quantity: extra }],
      };
    }
    case "setQuantity": {
      if (action.quantity < 1) return cartReducer(state, { type: "remove", reference: action.reference });
      const quantity = clampQuantity(action.quantity);
      return { ...state, lines: state.lines.map((l) => (l.reference === action.reference ? { ...l, quantity } : l)) };
    }
    case "remove":
      return { ...state, lines: state.lines.filter((l) => l.reference !== action.reference) };
    case "clear":
      return { ...state, lines: [] };
  }
}

export function totalItems(state: CartState): number {
  return state.lines.reduce((sum, l) => sum + l.quantity, 0);
}

export function lineSubtotal(line: CartLine): number | null {
  return line.unitPrice === null ? null : line.unitPrice * line.quantity;
}

/** Total de lo que tiene precio + cuántas unidades quedan "a consultar" (nunca se inventa un 0). */
export function cartTotal(state: CartState): { total: number; unpricedItems: number } {
  let total = 0;
  let unpricedItems = 0;
  for (const l of state.lines) {
    if (l.unitPrice === null) unpricedItems += l.quantity;
    else total += l.unitPrice * l.quantity;
  }
  return { total, unpricedItems };
}

// ---------------------------------------------------------------------------
// Pedido por WhatsApp
// ---------------------------------------------------------------------------

/**
 * Mensaje del pedido con los datos REALES de cada línea (nombre + referencia
 * de la BD + cantidad). El contexto mayorista lo declara para que el asesor
 * (o el agente) cotice con la lista correcta.
 */
export function cartWhatsappMessage(state: CartState): string {
  const intro =
    state.context === "wholesale"
      ? "Hola, estoy interesado(a) en estos productos (precio mayorista):"
      : "Hola, estoy interesado(a) en estos productos:";
  const lineas = state.lines.map((l) => `• ${l.name} — Ref. ${l.reference} — Cantidad: ${l.quantity}`);
  return [intro, "", ...lineas, "", `Total de productos: ${totalItems(state)}`].join("\n");
}

/** Link wa.me al número del negocio; null si no hay número válido o el carrito está vacío. */
export function cartWhatsappLink(phone: string | null, state: CartState): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8 || state.lines.length === 0) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(cartWhatsappMessage(state))}`;
}

// ---------------------------------------------------------------------------
// Persistencia (almacenamiento local del navegador)
// ---------------------------------------------------------------------------

export function cartStorageKey(slug: string, context: PriceContext): string {
  return `dulabs:catalogo:carrito:v${CART_VERSION}:${slug}:${context}`;
}

const REFERENCE_SHAPE = /^[A-Z]{1,6}-\d{6,}$/;

/**
 * Lee un carrito guardado. Tolerante: JSON corrupto, otra versión, otro
 * catálogo o líneas inválidas => se descartan (nunca rompe la página).
 */
export function parseStoredCart(raw: string | null, slug: string, context: PriceContext): CartState {
  const empty = emptyCart(slug, context);
  if (!raw) return empty;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!data || typeof data !== "object") return empty;
  const d = data as Partial<CartState>;
  if (d.version !== CART_VERSION || d.slug !== slug || d.context !== context || !Array.isArray(d.lines)) return empty;
  const seen = new Set<string>();
  const lines: CartLine[] = [];
  for (const raw of d.lines as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Partial<CartLine>;
    if (typeof l.reference !== "string" || !REFERENCE_SHAPE.test(l.reference) || seen.has(l.reference)) continue;
    if (typeof l.name !== "string" || !l.name.trim()) continue;
    if (typeof l.quantity !== "number" || !Number.isFinite(l.quantity) || l.quantity < 1) continue;
    const unitPrice = typeof l.unitPrice === "number" && Number.isFinite(l.unitPrice) && l.unitPrice >= 0 ? l.unitPrice : null;
    const imageUrl = typeof l.imageUrl === "string" && l.imageUrl.startsWith("/") ? l.imageUrl : null;
    seen.add(l.reference);
    lines.push({ reference: l.reference, name: l.name.slice(0, 200), unitPrice, imageUrl, quantity: clampQuantity(l.quantity) });
    if (lines.length >= MAX_LINES) break;
  }
  return { ...empty, lines };
}

/**
 * Punto de integración futuro: reconciliar el carrito con el catálogo
 * vigente (precio actual, producto activo, disponibilidad). `current` es lo
 * que el servidor confirme por referencia; `undefined` = ya no está
 * disponible (inactivo o eliminado) y la línea se retira. Hoy no se llama:
 * existirá cuando haya un endpoint de validación.
 */
export function reconcileCart(state: CartState, current: Map<string, CartProduct | undefined>): CartState {
  const lines: CartLine[] = [];
  for (const l of state.lines) {
    if (!current.has(l.reference)) {
      lines.push(l);
      continue;
    }
    const fresh = current.get(l.reference);
    if (!fresh) continue;
    lines.push({ ...l, name: fresh.name, unitPrice: fresh.price, imageUrl: fresh.imageUrl });
  }
  return { ...state, lines };
}
