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
 */
import { availabilityOf, isReference, maxOrderableUnits, type Availability, type CatalogProduct, type ProductStatus } from "@/lib/catalogo/domain";
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
