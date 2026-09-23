/**
 * Resolución DETERMINISTA de productos por referencia — uso interno del
 * backend (webhook de WhatsApp, agente de IA, asesora). NUNCA se expone
 * como endpoint público: el `tenantId` lo aporta el backend autenticado
 * (p. ej. el webhook sabe a qué negocio pertenece el número).
 *
 *   referencia (DL-000184) -> producto real -> precios vigentes (detal y
 *   mayor) -> inventario -> disponibilidad -> imagen -> estado
 *
 * Regla del proyecto: LA IA CONVERSA, EL BACKEND DECIDE. La IA nunca calcula
 * precios ni inventario ni identifica productos por el nombre: le pide a
 * este módulo la verdad de cada referencia.
 *
 * HERRAMIENTAS para el futuro agente (contratos DETERMINISTAS, separados por
 * nivel de certeza; ninguna "adivina"):
 *
 *   resolveByReference("DL-000184")       -> found | not_found | invalid_reference
 *   resolveByExactAttributes({name, …})   -> found | ambiguous | not_found
 *                                            (igualdad exacta sin tildes/mayúsculas)
 *   searchProducts("anillo corazón")      -> candidates (NUNCA una selección:
 *                                            el agente debe confirmar con el cliente)
 *   resolveOrder(channel, items)          -> pedido validado con la verdad actual
 *                                            (mismas reglas que la tienda)
 *   extractReferences(texto)              -> referencias escritas literalmente
 *
 * Todas reciben el `tenantId` del backend autenticado: una referencia de
 * otro negocio simplemente NO existe para este.
 */
import { availabilityOf, isReference, maxOrderableUnits, normalizeSearch, type Availability, type CatalogProduct, type PriceContext, type ProductStatus } from "@/lib/catalogo/domain";
import { normalizeText } from "@/lib/catalogo/import/analisis";
import { normalizeOrderItems, prepareOrder, type OrderItem, type PreparedOrder, type ResolvedOrderProduct } from "@/lib/catalogo/pedido";
import type { CatalogRepository } from "@/lib/catalogo/repository";

export interface ProductoResuelto {
  reference: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  material: string | null;
  color: string | null;
  /** Precios vigentes; null = no definido para ese canal (nunca un 0 inventado). */
  prices: { retail: number | null; wholesale: number | null };
  /** `units` solo existe si el negocio controla inventario de ese producto. */
  stock: { tracked: boolean; units: number | null };
  status: ProductStatus;
  available: boolean;
  /** Mismas reglas que la tienda (availabilityOf): available | low | sold_out. */
  availability: Availability;
  /** Máximo pedible (stock si se controla; null = sin límite de inventario). */
  maxQuantity: number | null;
  /** Foto principal en Storage (uso interno del backend, p. ej. enviarla por WhatsApp). */
  image: { storagePath: string; url: string } | null;
}

export interface ResolucionLote {
  items: ProductoResuelto[];
  /** Referencias con formato válido que no existen en el catálogo del tenant. */
  unknown: string[];
  /** Entradas que ni siquiera tienen formato de referencia. */
  invalid: string[];
}

export const RESOLUCION_MAX = 100;
/** Máximo de candidatos de una búsqueda (el agente muestra pocas opciones, nunca el catálogo). */
export const SEARCH_MAX = 10;

export type ReferenceResult =
  | { status: "found"; product: ProductoResuelto }
  | { status: "not_found"; reference: string; message: string }
  | { status: "invalid_reference"; input: string; message: string };

export interface ExactAttributes {
  name: string;
  color?: string | null;
  material?: string | null;
  /** Nombre de la categoría (sin tildes ni mayúsculas). */
  category?: string | null;
}

export type ExactResult =
  | { status: "found"; product: ProductoResuelto }
  /** Varios productos cumplen: el agente pregunta cuál (por referencia, color, material…). */
  | { status: "ambiguous"; candidates: ProductoResuelto[] }
  | { status: "not_found"; message: string };

export interface SearchResult {
  status: "candidates";
  /** Solo productos ACTIVOS. Nunca se toma uno de estos sin confirmación del cliente. */
  candidates: ProductoResuelto[];
  query: string;
}

export interface ResolvedOrder {
  channel: PriceContext;
  order: PreparedOrder;
  /** Productos resueltos (verdad completa para el contexto del agente). */
  products: ProductoResuelto[];
}

/** Referencias escritas literalmente en un texto ("quiero el dl-000184 y el DL-000185"). Sin interpretar nada más. */
export function extractReferences(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toUpperCase().matchAll(/\b([A-Z]{1,6}-\d{6,})\b/g)) if (!out.includes(m[1]) && !m[1].startsWith("DL-ORD")) out.push(m[1]);
  return out.slice(0, RESOLUCION_MAX);
}

/** Verdad de un producto para un pedido del canal indicado (el precio del OTRO canal nunca entra). */
export function toOrderProduct(p: ProductoResuelto & { productId?: string }, channel: PriceContext): ResolvedOrderProduct {
  return {
    reference: p.reference,
    ...(p.productId ? { productId: p.productId } : {}),
    name: p.name,
    price: channel === "wholesale" ? p.prices.wholesale : p.prices.retail,
    availability: p.availability,
    maxQuantity: p.maxQuantity,
  };
}

export function createResolucionCatalogo({ repo }: { repo: CatalogRepository }) {
  async function resolverProductos(tenantId: string, products: CatalogProduct[]): Promise<ProductoResuelto[]> {
    const primaries = await repo.listPrimaryMedia(tenantId, products.map((p) => p.id));
    const byProduct = new Map(primaries.map((m) => [m.productId, m]));
    return products.map((p) => {
      const media = byProduct.get(p.id);
      const legacy = p.primaryImage?.url ? repo.storagePathFromUrl(p.primaryImage.url) : null;
      const storagePath = media?.storagePath ?? (legacy && legacy.startsWith(`${tenantId}/`) && !legacy.includes("..") ? legacy : null);
      return {
        reference: p.reference,
        name: p.name,
        description: p.description,
        categoryId: p.categoryId,
        categoryName: p.categoryName,
        material: p.material,
        color: p.color,
        prices: { retail: p.pricing.retail, wholesale: p.pricing.wholesale },
        stock: { tracked: p.tracksStock, units: p.tracksStock ? p.stock : null },
        status: p.status,
        available: availabilityOf(p) !== "sold_out",
        availability: availabilityOf(p),
        maxQuantity: maxOrderableUnits(p),
        // Solo fotos de este bucket (media del Catálogo o foto legada propia); una URL externa no se usa.
        image: storagePath ? { storagePath, url: repo.publicUrl(storagePath) } : null,
      };
    });
  }

  return {
    /** Una referencia exacta del tenant; null si no existe (sin búsquedas aproximadas). */
    async resolverReferencia(tenantId: string, reference: string): Promise<ProductoResuelto | null> {
      const ref = reference.trim().toUpperCase();
      if (!isReference(ref)) return null;
      const product = await repo.getProductByReference(tenantId, ref);
      if (!product) return null;
      const [resuelto] = await resolverProductos(tenantId, [product]);
      return resuelto;
    },

    /** Herramienta del agente: una referencia exacta, con un resultado explícito (nunca "parecidos"). */
    async resolveByReference(tenantId: string, input: string): Promise<ReferenceResult> {
      const ref = input.trim().toUpperCase();
      if (!isReference(ref)) return { status: "invalid_reference", input, message: `«${input.trim().slice(0, 40)}» no es una referencia válida (ej. DL-000184).` };
      const product = await repo.getProductByReference(tenantId, ref);
      if (!product) return { status: "not_found", reference: ref, message: `No encontramos la referencia ${ref}.` };
      const [resuelto] = await resolverProductos(tenantId, [product]);
      return { status: "found", product: resuelto };
    },

    /**
     * Herramienta del agente: productos cuyo nombre (y, si se dan, color,
     * material y categoría) es IGUAL al pedido, sin tildes ni mayúsculas. Sin
     * similitud: "anillo corazon" encuentra «Anillo Corazón», pero no «Anillo
     * corazones». Varios => "ambiguous" (el agente pregunta).
     */
    async resolveByExactAttributes(tenantId: string, attrs: ExactAttributes): Promise<ExactResult> {
      const name = normalizeText(attrs.name);
      if (!name) return { status: "not_found", message: "Falta el nombre del producto." };
      const [keys, categories] = await Promise.all([repo.listProductKeys(tenantId), attrs.category ? repo.listCategories(tenantId) : Promise.resolve([])]);
      const categoryIds = attrs.category ? new Set(categories.filter((c) => normalizeText(c.name) === normalizeText(attrs.category)).map((c) => c.id)) : null;
      const matches = keys.filter(
        (k) =>
          normalizeText(k.name) === name &&
          (attrs.color == null || normalizeText(k.color) === normalizeText(attrs.color)) &&
          (attrs.material == null || normalizeText(k.material) === normalizeText(attrs.material)) &&
          (categoryIds === null || (k.categoryId !== null && categoryIds.has(k.categoryId))),
      );
      if (matches.length === 0) return { status: "not_found", message: `No encontramos un producto llamado «${attrs.name.trim().slice(0, 80)}».` };
      const found = await repo.getProductsByReferences(
        tenantId,
        matches.slice(0, RESOLUCION_MAX).map((k) => k.reference),
      );
      const resueltos = await resolverProductos(tenantId, found);
      return resueltos.length === 1 ? { status: "found", product: resueltos[0] } : { status: "ambiguous", candidates: resueltos.slice(0, SEARCH_MAX) };
    },

    /**
     * Herramienta del agente: búsqueda por texto (nombre o referencia que
     * CONTIENE lo escrito), solo productos activos, acotada. Devuelve
     * CANDIDATOS, nunca una selección. Sin embeddings ni similitud semántica
     * (fase posterior, con este mismo contrato).
     */
    async searchProducts(tenantId: string, query: string, limit = SEARCH_MAX): Promise<SearchResult> {
      const q = normalizeSearch(query);
      if (!q) return { status: "candidates", candidates: [], query: "" };
      const { items } = await repo.listProducts(tenantId, { status: "ACTIVE", search: q, offset: 0, limit: Math.max(1, Math.min(SEARCH_MAX, limit)) });
      return { status: "candidates", candidates: await resolverProductos(tenantId, items), query: q };
    },

    /**
     * Herramienta del agente: valida un pedido estructurado ({reference,
     * quantity}[], p. ej. el leído del mensaje de WhatsApp) con la verdad
     * ACTUAL y las MISMAS reglas que la tienda (stock, agotados, precio del
     * canal). El agente nunca confía en cantidades ni precios del mensaje.
     */
    async resolveOrder(tenantId: string, channel: PriceContext, items: readonly OrderItem[]): Promise<ResolvedOrder> {
      const normalized = normalizeOrderItems(items);
      const refs = normalized.map((i) => i.reference).filter(isReference);
      const found = refs.length > 0 ? await repo.getProductsByReferences(tenantId, refs) : [];
      const activos = found.filter((p) => p.status === "ACTIVE");
      const resueltos = await resolverProductos(tenantId, activos);
      const byRef = new Map(resueltos.map((r) => [r.reference, toOrderProduct(r, channel)]));
      return { channel, order: prepareOrder(normalized, byRef), products: resueltos };
    },

    /** Lote de referencias (p. ej. las de un pedido por WhatsApp), en el orden recibido. */
    async resolverReferencias(tenantId: string, references: readonly string[]): Promise<ResolucionLote> {
      const invalid: string[] = [];
      const refs: string[] = [];
      for (const raw of references) {
        const ref = raw.trim().toUpperCase();
        if (!isReference(ref)) invalid.push(raw);
        else if (!refs.includes(ref) && refs.length < RESOLUCION_MAX) refs.push(ref);
      }
      const found = refs.length > 0 ? await repo.getProductsByReferences(tenantId, refs) : [];
      const resueltos = await resolverProductos(tenantId, found);
      const byRef = new Map(resueltos.map((r) => [r.reference, r]));
      return {
        items: refs.flatMap((r) => (byRef.has(r) ? [byRef.get(r) as ProductoResuelto] : [])),
        unknown: refs.filter((r) => !byRef.has(r)),
        invalid,
      };
    },
  };
}
