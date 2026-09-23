/**
 * Carrito del catálogo público — DOMINIO PURO (sin DOM, sin red, sin React).
 *
 * Pieza central del catálogo: el mismo motor en inicio, categorías, búsqueda
 * y ficha. El estado es explícito y versionado:
 *
 *   - Identidad de la línea = `reference` (DL-000184): la referencia real e
 *     inmutable de la BD, nunca el nombre visible.
 *   - `context` (detal / mayor): un carrito por catálogo Y por contexto de
 *     precio (la clave de almacenamiento incluye ambos).
 *   - Lo que viene del catálogo (nombre, precio, foto, disponibilidad y el
 *     MÁXIMO pedible) es una vista que el backend corrige con `reconcile`.
 *     Lo que decide el cliente es la cantidad, siempre acotada por ese máximo.
 *
 * CONFIANZA: el navegador solo es dueño de QUÉ referencias y CUÁNTAS
 * unidades. Al preparar el pedido el backend vuelve a resolver todo
 * (lib/catalogo/pedido.ts + servicio público `prepareOrder`): jamás se usan
 * precios ni stock del cliente.
 */
import type { PriceContext } from "@/lib/catalogo/domain";
import type { OrderItem } from "@/lib/catalogo/pedido";

export const CART_VERSION = 1;
/** Tope técnico por línea cuando el producto no controla inventario. */
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
  /** Máximo pedible decidido por el backend (stock); null/undefined = sin límite de inventario. */
  maxQuantity?: number | null;
}

export interface CartLine {
  reference: string;
  name: string;
  unitPrice: number | null;
  imageUrl: string | null;
  quantity: number;
  /** false = agotado según el backend: se muestra, pero no entra al pedido ni al total. */
  available: boolean;
  /** Máximo pedible según el backend (null = sin límite de inventario). */
  maxQuantity: number | null;
}

/**
 * Intento de envío en curso (idempotencia): la clave opaca que el backend usa
 * para derivar el id de la solicitud, ligada a las líneas exactas que se
 * enviaron. Mismo carrito => misma clave => mismo DL-ORD (doble toque,
 * reintento, volver de WhatsApp y tocar de nuevo). Carrito distinto => clave nueva.
 */
export interface CartRequest {
  key: string;
  /** Huella de las líneas enviadas (ver `requestFingerprint`). */
  items: string;
  /** Id de solicitud que devolvió el backend (para mostrarlo al volver). */
  requestId?: string;
  whatsappUrl?: string;
}

export interface CartState {
  version: typeof CART_VERSION;
  slug: string;
  context: PriceContext;
  lines: CartLine[];
  request?: CartRequest;
}

export type CartAction =
  | { type: "add"; product: CartProduct; quantity?: number }
  | { type: "setQuantity"; reference: string; quantity: number }
  | { type: "remove"; reference: string }
  | { type: "clear" }
  /** Registra el intento de envío (clave de idempotencia y, al confirmarse, la solicitud). */
  | { type: "setRequest"; request: CartRequest }
  /** Verdad del backend: actualiza lo resuelto, acota cantidades al stock y retira lo que ya no existe o no está activo. */
  | { type: "reconcile"; resolved: CartProduct[]; unknown: string[] };

export function emptyCart(slug: string, context: PriceContext): CartState {
  return { version: CART_VERSION, slug, context, lines: [] };
}

/** Máximo efectivo de una línea o producto: el stock informado por el backend, o el tope técnico. */
export function quantityLimit(item: { maxQuantity?: number | null }): number {
  const max = item.maxQuantity;
  return typeof max === "number" && Number.isFinite(max) ? Math.max(0, Math.min(MAX_QUANTITY, Math.trunc(max))) : MAX_QUANTITY;
}

function clamp(quantity: number, limit: number): number {
  if (!Number.isFinite(quantity)) return Math.min(1, limit);
  return Math.min(limit, Math.max(1, Math.trunc(quantity)));
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "add": {
      const { product } = action;
      const available = product.available ?? true;
      const limit = quantityLimit(product);
      // Nunca se agrega lo que el backend dice que no se puede vender.
      if (!available || limit < 1) return state;
      const extra = clamp(action.quantity ?? 1, limit);
      const existing = state.lines.find((l) => l.reference === product.reference);
      if (existing) {
        const quantity = Math.min(limit, existing.quantity + extra);
        return {
          ...state,
          // Se refrescan nombre/precio/foto/límite con los datos más recientes del catálogo.
          lines: state.lines.map((l) =>
            l.reference === product.reference
              ? { ...l, name: product.name, unitPrice: product.price, imageUrl: product.imageUrl, available, maxQuantity: product.maxQuantity ?? null, quantity }
              : l,
          ),
        };
      }
      if (state.lines.length >= MAX_LINES) return state;
      return {
        ...state,
        lines: [
          ...state.lines,
          { reference: product.reference, name: product.name, unitPrice: product.price, imageUrl: product.imageUrl, available, maxQuantity: product.maxQuantity ?? null, quantity: extra },
        ],
      };
    }
    case "setQuantity": {
      if (action.quantity < 1) return cartReducer(state, { type: "remove", reference: action.reference });
      return { ...state, lines: state.lines.map((l) => (l.reference === action.reference ? { ...l, quantity: clamp(action.quantity, Math.max(1, quantityLimit(l))) } : l)) };
    }
    case "remove":
      return { ...state, lines: state.lines.filter((l) => l.reference !== action.reference) };
    case "clear":
      return { ...state, lines: [], request: undefined };
    case "setRequest":
      return { ...state, request: action.request };
    case "reconcile":
      return reconcileCart(state, action.resolved, action.unknown);
  }
}

/** ¿Se puede sumar una unidad más de este producto? (feedback inmediato; la verdad la confirma el backend). */
export function canAddMore(state: CartState, product: CartProduct): boolean {
  if (product.available === false) return false;
  const line = state.lines.find((l) => l.reference === product.reference);
  return (line?.quantity ?? 0) < quantityLimit(product);
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
// Reconciliación con la verdad del backend
// ---------------------------------------------------------------------------

/** Qué cambió al reconciliar (para avisar al cliente con claridad). */
export type CartChange =
  | { kind: "removed"; reference: string; name: string }
  | { kind: "sold_out"; reference: string; name: string }
  | { kind: "reduced"; reference: string; name: string; from: number; to: number }
  | { kind: "price_changed"; reference: string; name: string; from: number | null; to: number | null };

/**
 * Aplica la verdad del backend (`resolveSelection` / `prepareOrder`): cada
 * referencia resuelta actualiza nombre, precio vigente, foto, disponibilidad
 * y máximo pedible (la cantidad se acota a ese máximo); las referencias
 * desconocidas (eliminadas o inactivas) se retiran. Las no consultadas quedan
 * como están.
 */
export function reconcileCart(state: CartState, resolved: readonly CartProduct[], unknown: readonly string[]): CartState {
  return reconcileWithChanges(state, resolved, unknown).state;
}

export function reconcileWithChanges(state: CartState, resolved: readonly CartProduct[], unknown: readonly string[]): { state: CartState; changes: CartChange[] } {
  const byRef = new Map(resolved.map((p) => [p.reference, p]));
  const gone = new Set(unknown);
  const lines: CartLine[] = [];
  const changes: CartChange[] = [];
  for (const l of state.lines) {
    if (gone.has(l.reference)) {
      changes.push({ kind: "removed", reference: l.reference, name: l.name });
      continue;
    }
    const fresh = byRef.get(l.reference);
    if (!fresh) {
      lines.push(l);
      continue;
    }
    const available = fresh.available ?? true;
    const limit = quantityLimit(fresh);
    const next: CartLine = { ...l, name: fresh.name, unitPrice: fresh.price, imageUrl: fresh.imageUrl, available, maxQuantity: fresh.maxQuantity ?? null };
    if (available && l.available && l.unitPrice !== fresh.price) changes.push({ kind: "price_changed", reference: l.reference, name: fresh.name, from: l.unitPrice, to: fresh.price });
    if (!available || limit < 1) {
      if (l.available) changes.push({ kind: "sold_out", reference: l.reference, name: fresh.name });
    } else if (l.quantity > limit) {
      changes.push({ kind: "reduced", reference: l.reference, name: fresh.name, from: l.quantity, to: limit });
      next.quantity = limit;
    }
    lines.push(next);
  }
  // Si las líneas cambiaron, el intento anterior ya no aplica (se genera una clave nueva al enviar).
  const request = state.request && state.request.items === requestFingerprint(lines) ? state.request : undefined;
  return { state: { ...state, lines, request }, changes };
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
 * Compatible con carritos guardados antes de existir `maxQuantity`.
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
  const r = d.request as Partial<CartRequest> | undefined;
  const request: CartRequest | undefined =
    r && typeof r.key === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(r.key) && typeof r.items === "string" && r.items.length <= 4000
      ? {
          key: r.key,
          items: r.items,
          ...(typeof r.requestId === "string" && /^DL-ORD-[0-9A-Z]{6}$/.test(r.requestId) ? { requestId: r.requestId } : {}),
          ...(typeof r.whatsappUrl === "string" && r.whatsappUrl.startsWith("https://wa.me/") ? { whatsappUrl: r.whatsappUrl } : {}),
        }
      : undefined;
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
    const maxQuantity = typeof l.maxQuantity === "number" && Number.isFinite(l.maxQuantity) && l.maxQuantity >= 0 ? Math.trunc(l.maxQuantity) : null;
    seen.add(l.reference);
    lines.push({
      reference: l.reference,
      name: l.name.slice(0, 200),
      unitPrice,
      imageUrl,
      quantity: clamp(l.quantity, MAX_QUANTITY),
      available: l.available !== false,
      maxQuantity,
    });
    if (lines.length >= MAX_LINES) break;
  }
  return { ...empty, lines, ...(request ? { request } : {}) };
}

// ---------------------------------------------------------------------------
// Selección confiable para el backend
// ---------------------------------------------------------------------------

/** Huella de lo que se pediría (referencia:cantidad de las líneas pedibles, en orden de referencia). */
export function requestFingerprint(lines: readonly CartLine[]): string {
  return lines
    .filter((l) => l.available)
    .map((l) => `${l.reference}:${l.quantity}`)
    .sort()
    .join(",");
}

/** Intento vigente para el carrito actual (misma huella) o null si hay que empezar uno nuevo. */
export function currentRequest(state: CartState): CartRequest | null {
  return state.request && state.request.items === requestFingerprint(state.lines) ? state.request : null;
}

/**
 * Lo ÚNICO que un backend acepta de un carrito: referencias y cantidades de
 * las líneas pedibles (`OrderItem[]`, el pedido estructurado). Sin nombres ni
 * precios: el backend los resuelve por referencia.
 */
export function selectionSnapshot(state: CartState): { version: typeof CART_VERSION; slug: string; context: PriceContext; items: OrderItem[] } {
  return {
    version: CART_VERSION,
    slug: state.slug,
    context: state.context,
    items: orderableLines(state).map((l) => ({ reference: l.reference, quantity: l.quantity })),
  };
}
