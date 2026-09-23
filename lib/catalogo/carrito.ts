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
 *     "precio a consultar"); el backend la corrige con `reconcile` (precio
 *     vigente, producto activo, disponibilidad).
 *   - El agente de IA podrá leer el mismo mensaje/estructura (referencias +
 *     cantidades) sin parsear texto libre.
 *
 * CONFIANZA: el navegador solo es dueño de QUÉ referencias y CUÁNTAS
 * unidades. Nombre, precio, foto y disponibilidad son una vista que el
 * backend reconcilia (`reconcile`, con ResolvedSelection del servicio
 * público). Lo que un backend debe aceptar de un carrito es
 * `selectionSnapshot` (referencia + cantidad), jamás precios del cliente.
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
  /** Decidido por el backend. Por defecto true. */
  available?: boolean;
}

export interface CartLine {
  reference: string;
  name: string;
  unitPrice: number | null;
  imageUrl: string | null;
  quantity: number;
  /** false = agotado según el backend: se muestra, pero no entra al pedido ni al total. */
  available: boolean;
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
  | { type: "clear" }
  /** Verdad del backend: actualiza lo resuelto y retira lo que ya no existe o no está activo. */
  | { type: "reconcile"; resolved: CartProduct[]; unknown: string[] };

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
            l.reference === product.reference
              ? { ...l, name: product.name, unitPrice: product.price, imageUrl: product.imageUrl, available: product.available ?? true, quantity }
              : l,
          ),
        };
      }
      if (state.lines.length >= MAX_LINES) return state;
      return {
        ...state,
        lines: [
          ...state.lines,
          { reference: product.reference, name: product.name, unitPrice: product.price, imageUrl: product.imageUrl, available: product.available ?? true, quantity: extra },
        ],
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
    case "reconcile":
      return reconcileCart(state, action.resolved, action.unknown);
  }
}

/** Unidades en el carrito (contador del header), incluidas las agotadas que el cliente aún no retira. */
export function totalItems(state: CartState): number {
  return state.lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** Líneas que se pueden pedir (disponibles según el backend). */
export function orderableLines(state: CartState): CartLine[] {
  return state.lines.filter((l) => l.available);
}

export function lineSubtotal(line: CartLine): number | null {
  return line.unitPrice === null ? null : line.unitPrice * line.quantity;
}

/** Total de lo que tiene precio + cuántas unidades quedan "a consultar" (nunca se inventa un 0). */
export function cartTotal(state: CartState): { total: number; unpricedItems: number } {
  let total = 0;
  let unpricedItems = 0;
  for (const l of orderableLines(state)) {
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
  const pedibles = orderableLines(state);
  const lineas = pedibles.map((l) => `• ${l.name} — Ref. ${l.reference} — Cantidad: ${l.quantity}`);
  const total = pedibles.reduce((sum, l) => sum + l.quantity, 0);
  return [intro, "", ...lineas, "", `Total de productos: ${total}`].join("\n");
}

/** Link wa.me al número del negocio; null si no hay número válido o el carrito está vacío. */
export function cartWhatsappLink(phone: string | null, state: CartState): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8 || orderableLines(state).length === 0) return null;
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
    const available = l.available !== false;
    lines.push({ reference: l.reference, name: l.name.slice(0, 200), unitPrice, imageUrl, quantity: clampQuantity(l.quantity), available });
    if (lines.length >= MAX_LINES) break;
  }
  return { ...empty, lines };
}

/**
 * Reconciliación con la VERDAD del backend (servicio público
 * `resolveSelection`): cada referencia resuelta actualiza nombre, precio
 * vigente, foto y disponibilidad; las referencias que el backend declara
 * desconocidas (eliminadas o inactivas) se retiran. Las que no se
 * consultaron quedan como están.
 */
export function reconcileCart(state: CartState, resolved: readonly CartProduct[], unknown: readonly string[]): CartState {
  const byRef = new Map(resolved.map((p) => [p.reference, p]));
  const gone = new Set(unknown);
  const lines: CartLine[] = [];
  for (const l of state.lines) {
    if (gone.has(l.reference)) continue;
    const fresh = byRef.get(l.reference);
    lines.push(fresh ? { ...l, name: fresh.name, unitPrice: fresh.price, imageUrl: fresh.imageUrl, available: fresh.available ?? true } : l);
  }
  return { ...state, lines };
}

// ---------------------------------------------------------------------------
// Selección confiable para el backend (pedido / WhatsApp / agente)
// ---------------------------------------------------------------------------

export interface SelectionItem {
  reference: string;
  quantity: number;
}

/**
 * Lo ÚNICO que un backend debe aceptar de un carrito: referencias y
 * cantidades de las líneas pedibles. Sin nombres ni precios: el backend los
 * resuelve por referencia. Base del futuro snapshot/identificador de
 * selección que viajará con el pedido.
 */
export function selectionSnapshot(state: CartState): { version: typeof CART_VERSION; slug: string; context: PriceContext; items: SelectionItem[] } {
  return {
    version: CART_VERSION,
    slug: state.slug,
    context: state.context,
    items: orderableLines(state).map((l) => ({ reference: l.reference, quantity: l.quantity })),
  };
}

const LINEA_PEDIDO = /Ref\.\s*([A-Z]{1,6}-\d{6,})\s*[—–-]\s*Cantidad:\s*(\d{1,3})/g;

/**
 * Lee de forma DETERMINISTA un mensaje de pedido generado por el catálogo
 * (`cartWhatsappMessage`) -> [{referencia, cantidad}] + contexto. Para el
 * webhook: nunca interpreta nombres ni texto libre, solo "Ref. X — Cantidad: N".
 */
export function parseSelectionMessage(text: string): { context: PriceContext | null; items: SelectionItem[] } {
  const items: SelectionItem[] = [];
  for (const match of text.matchAll(LINEA_PEDIDO)) {
    const reference = match[1];
    const quantity = clampQuantity(Number(match[2]));
    const existing = items.find((i) => i.reference === reference);
    if (existing) existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + quantity);
    else items.push({ reference, quantity });
  }
  const context: PriceContext | null = items.length === 0 ? null : /\(precio mayorista\)/.test(text) ? "wholesale" : "retail";
  return { context, items };
}
