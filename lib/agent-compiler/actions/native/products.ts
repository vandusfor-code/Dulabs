// DuLabs Business — Business Agent 2.0, FASE 8 — resolución de productos contra el INVENTARIO REAL del negocio.
//
// El modelo solo señala lo que el cliente dijo ("camisa negra"); aquí el backend decide, de forma determinista, qué
// producto real es, si existe, si hay varios parecidos, y su precio y stock (dulabs_inventario_productos del tenant,
// vía el store de catálogo del Business Agent). Nunca se inventa un producto, un precio ni una existencia:
//
//   exact         nombre idéntico
//   normalized    igual sin tildes/mayúsculas/puntuación
//   partial       lo que dijo está contenido en UN solo producto ("camisa negra" → "Camisa negra algodón")
//   ambiguous     contenido en VARIOS → se listan (nunca se elige por el cliente)
//   not_found     nada coincide → se dice que no está en el inventario
//   out_of_stock  existe pero el stock controlado es 0
//
// "¿Hay talla M?" tras hablar de "Camisa negra": se busca también "Camisa negra talla M" (contexto del backend).

import { foldText } from "@/lib/agent-compiler/understanding/slots";

export interface InventoryProduct {
  name: string;
  /** Moneda del negocio, entero. null = sin precio fijo. */
  price: number | null;
  /** Unidades; ausente = el negocio no controla stock de ese producto (no se afirma cantidad). */
  stock?: number;
}

export interface ProductInventoryPort {
  /** Productos ACTIVOS del tenant dado (tenant-scoped por construcción). */
  list(tenantId: string): Promise<InventoryProduct[]>;
}

export type ProductMatchKind = "exact" | "normalized" | "partial" | "ambiguous" | "not_found" | "out_of_stock";

export interface ProductResolution {
  kind: ProductMatchKind;
  product?: InventoryProduct;
  options?: string[];
  /** Consulta efectiva (con contexto si se usó). */
  query: string;
  usedContext: boolean;
}

export const MAX_PRODUCT_OPTIONS = 6;

function tokens(text: string): string[] {
  return foldText(text)
    .replace(/[^a-z0-9ñ ]/g, " ")
    .split(" ")
    .filter((t) => t && !["el", "la", "los", "las", "un", "una", "de", "del", "tienen", "tienes", "hay", "busco", "quiero"].includes(t))
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}

function matchOnce(query: string, products: readonly InventoryProduct[]): Omit<ProductResolution, "query" | "usedContext"> {
  const exact = products.filter((p) => p.name.trim() === query.trim());
  if (exact.length === 1) return { kind: "exact", product: exact[0]! };
  const norm = foldText(query);
  const normalized = products.filter((p) => foldText(p.name) === norm);
  if (normalized.length === 1) return { kind: "normalized", product: normalized[0]! };
  const q = tokens(query);
  if (q.length === 0) return { kind: "not_found" };
  const containing = products.filter((p) => {
    const pt = tokens(p.name);
    return q.every((t) => pt.includes(t));
  });
  if (containing.length === 1) return { kind: "partial", product: containing[0]! };
  if (containing.length > 1) return { kind: "ambiguous", options: containing.slice(0, MAX_PRODUCT_OPTIONS).map((p) => p.name) };
  return { kind: "not_found" };
}

/** Resolución determinista. `context` = último producto que el backend resolvió en esta conversación. */
export function resolveProduct(query: string, products: readonly InventoryProduct[], context?: string): ProductResolution {
  let r = matchOnce(query, products);
  let effective = query;
  let usedContext = false;
  if (r.kind === "not_found" && context && foldText(context) !== foldText(query)) {
    const combined = `${context} ${query}`;
    const rc = matchOnce(combined, products);
    if (rc.kind !== "not_found") {
      r = rc;
      effective = combined;
      usedContext = true;
    }
  }
  if (r.product && typeof r.product.stock === "number" && r.product.stock <= 0) return { kind: "out_of_stock", product: r.product, query: effective, usedContext };
  return { ...r, query: effective, usedContext };
}
