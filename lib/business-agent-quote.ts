/**
 * Cotización del Business Agent (R6) — cálculo DETERMINISTA en el backend.
 *
 * REGLA CENTRAL: la IA NUNCA calcula ni redacta precios. Solo transforma la
 * intención del cliente en una lista estructurada ("Manicure x2; Pedicure x1").
 * Este módulo (PURO, sin I/O) es la única autoridad sobre:
 *   - qué ítem del catálogo REAL del tenant corresponde a cada nombre pedido;
 *   - el precio unitario (el del catálogo, nunca el que "recuerde" el modelo);
 *   - subtotal por línea y total (enteros COP);
 *   - qué queda sin resolver (no existe / ambiguo / sin precio fijo / sin stock).
 * El catálogo lo carga el executor desde las tablas del tenant (dulabs_servicios /
 * dulabs_inventario_productos); aquí llega ya como datos.
 *
 * No existen reglas de descuento/impuestos configurables en el producto todavía:
 * la cotización es SUBTOTAL = TOTAL (suma de precio × cantidad) y así se indica.
 */

export type QuoteItemType = "servicio" | "producto";

export interface QuoteCatalogItem {
  tipo: QuoteItemType;
  id: string;
  nombre: string;
  /** COP entero, o null si el servicio no tiene precio fijo. */
  precio: number | null;
  /** Solo productos: unidades disponibles. */
  stock?: number;
}

export interface QuoteRequestItem {
  nombre: string;
  cantidad: number;
}

export interface QuoteLine {
  tipo: QuoteItemType;
  id: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number | null;
  /** null cuando el ítem no tiene precio fijo (no se inventa uno). */
  subtotal: number | null;
  /** Solo productos: false si la cantidad pedida supera el stock. */
  stockSuficiente?: boolean;
  stockDisponible?: number;
}

export interface Quote {
  lineas: QuoteLine[];
  /** Nombres pedidos que no existen en el catálogo del negocio. */
  noEncontrados: string[];
  /** Nombres pedidos que coinciden con varios ítems (el cliente debe precisar). */
  ambiguos: Array<{ pedido: string; opciones: string[] }>;
  /** Pedidos con una cantidad inválida (0, negativa, decimal, excesiva). */
  cantidadInvalida: string[];
  /** Suma de las líneas CON precio. */
  subtotal: number;
  /** = subtotal (no hay descuentos ni impuestos configurables todavía). */
  total: number;
  /** false si alguna línea no tiene precio fijo: el total es parcial. */
  completa: boolean;
  hayStockInsuficiente: boolean;
}

export const QUOTE_LIMITS = {
  maxItems: 20,
  maxCantidad: 999,
  maxTextLength: 600,
} as const;

/** Minúsculas, sin tildes ni ñ ("unas" = "uñas"), solo [a-z0-9 ] con espacios colapsados. */
export function normalizeQuoteName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

export interface ParsedQuoteItems {
  items: QuoteRequestItem[];
  cantidadInvalida: string[];
  /** true si había más ítems que QUOTE_LIMITS.maxItems (se recortó). */
  truncado: boolean;
}

/**
 * "Manicure x2; Pedicure" | "2 manicure, 1 pedicure" | "corte:3" -> ítems. Separadores: `;`,
 * salto de línea y `|`; si no hay ninguno, también la coma. Sin cantidad => 1. Una cantidad
 * inválida NO se corrige: se reporta (el cliente debe confirmarla).
 */
export function parseQuoteItems(raw: string | undefined): ParsedQuoteItems {
  const text = (raw ?? "").slice(0, QUOTE_LIMITS.maxTextLength).trim();
  if (!text) return { items: [], cantidadInvalida: [], truncado: false };

  const separador = /[;\n|]/.test(text) ? /[;\n|]+/ : /,/;
  const partes = text.split(separador).map((p) => p.trim()).filter(Boolean);

  const items: QuoteRequestItem[] = [];
  const cantidadInvalida: string[] = [];
  for (const parte of partes) {
    let nombre = parte;
    let cantidadRaw = "1";
    let m: RegExpExecArray | null;
    if ((m = /^(.+?)\s*[x×*]\s*(-?\d+(?:[.,]\d+)?)$/i.exec(parte))) {
      nombre = m[1]!;
      cantidadRaw = m[2]!;
    } else if ((m = /^(-?\d+(?:[.,]\d+)?)\s*[x×]?\s+(.+)$/i.exec(parte))) {
      cantidadRaw = m[1]!;
      nombre = m[2]!;
    } else if ((m = /^(.+?)\s*:\s*(-?\d+(?:[.,]\d+)?)$/.exec(parte))) {
      nombre = m[1]!;
      cantidadRaw = m[2]!;
    }
    nombre = nombre.trim();
    if (!nombre) continue;
    const n = Number(cantidadRaw.replace(",", "."));
    if (!Number.isInteger(n) || n < 1 || n > QUOTE_LIMITS.maxCantidad) {
      cantidadInvalida.push(nombre);
      continue;
    }
    items.push({ nombre, cantidad: n });
  }
  const truncado = items.length > QUOTE_LIMITS.maxItems;
  return { items: items.slice(0, QUOTE_LIMITS.maxItems), cantidadInvalida, truncado };
}

type Match = { kind: "one"; item: QuoteCatalogItem } | { kind: "none" } | { kind: "many"; items: QuoteCatalogItem[] };

function resolveItem(catalog: QuoteCatalogItem[], pedido: string): Match {
  const q = normalizeQuoteName(pedido);
  if (!q) return { kind: "none" };

  const exact = catalog.filter((c) => normalizeQuoteName(c.nombre) === q);
  if (exact.length === 1) return { kind: "one", item: exact[0]! };
  if (exact.length > 1) return { kind: "many", items: exact };

  // Contención en cualquier sentido, solo con consultas de >= 3 letras (evita "de", "la"...).
  if (q.length >= 3) {
    const parcial = catalog.filter((c) => {
      const n = normalizeQuoteName(c.nombre);
      return n.includes(q) || q.includes(n);
    });
    if (parcial.length === 1) return { kind: "one", item: parcial[0]! };
    if (parcial.length > 1) return { kind: "many", items: parcial };
  }
  return { kind: "none" };
}

/** Arma la cotización. PURA y determinista: mismas entradas => misma salida. */
export function buildQuote(catalog: QuoteCatalogItem[], items: QuoteRequestItem[], cantidadInvalida: string[] = []): Quote {
  const lineas: QuoteLine[] = [];
  const noEncontrados: string[] = [];
  const ambiguos: Quote["ambiguos"] = [];

  for (const it of items) {
    const r = resolveItem(catalog, it.nombre);
    if (r.kind === "none") {
      noEncontrados.push(it.nombre);
      continue;
    }
    if (r.kind === "many") {
      ambiguos.push({ pedido: it.nombre, opciones: r.items.map((c) => c.nombre) });
      continue;
    }
    const c = r.item;
    // Un mismo ítem pedido dos veces se acumula en una sola línea (no se duplica).
    const previa = lineas.find((l) => l.tipo === c.tipo && l.id === c.id);
    const cantidad = (previa?.cantidad ?? 0) + it.cantidad;
    const linea: QuoteLine = {
      tipo: c.tipo,
      id: c.id,
      nombre: c.nombre,
      cantidad,
      precioUnitario: c.precio,
      subtotal: c.precio === null ? null : c.precio * cantidad,
      ...(c.tipo === "producto" && typeof c.stock === "number"
        ? { stockSuficiente: cantidad <= c.stock, stockDisponible: c.stock }
        : {}),
    };
    if (previa) Object.assign(previa, linea);
    else lineas.push(linea);
  }

  const subtotal = lineas.reduce((acc, l) => acc + (l.subtotal ?? 0), 0);
  return {
    lineas,
    noEncontrados,
    ambiguos,
    cantidadInvalida,
    subtotal,
    total: subtotal,
    completa: lineas.every((l) => l.subtotal !== null),
    hayStockInsuficiente: lineas.some((l) => l.stockSuficiente === false),
  };
}

export function formatCop(n: number): string {
  return `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/**
 * Texto DETERMINISTA de la cotización (la IA lo presenta tal cual). Sin palabras de
 * dominio "sensibles" para el filtro de afirmaciones (nada de reservar/agendar/pago).
 */
export function formatQuoteText(q: Quote): string {
  const out: string[] = [];
  for (const l of q.lineas) {
    const unit = l.precioUnitario === null ? "precio a confirmar" : `${formatCop(l.precioUnitario)} c/u`;
    const sub = l.subtotal === null ? "precio a confirmar" : formatCop(l.subtotal);
    out.push(`• ${l.nombre} x${l.cantidad} — ${unit} = ${sub}`);
    if (l.stockSuficiente === false) {
      out.push(`  ⚠️ Solo hay ${l.stockDisponible ?? 0} disponible(s) de ${l.nombre}.`);
    }
  }
  if (q.lineas.length > 0) {
    out.push(q.completa ? `Total: ${formatCop(q.total)}` : `Total parcial: ${formatCop(q.total)} (falta el precio de algún ítem, se confirma con el equipo)`);
  }
  if (q.noEncontrados.length > 0) out.push(`No encontré en el catálogo: ${q.noEncontrados.join(", ")}.`);
  for (const a of q.ambiguos) out.push(`"${a.pedido}" puede ser: ${a.opciones.join(" / ")}. ¿Cuál prefieres?`);
  if (q.cantidadInvalida.length > 0) out.push(`Revisa la cantidad de: ${q.cantidadInvalida.join(", ")}.`);
  return out.join("\n");
}
