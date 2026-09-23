/**
 * Pantalla de INICIO del catálogo público — derivación pura a partir de la
 * página del catálogo que ya entrega el servicio público (sin consultas
 * nuevas, sin datos inventados):
 *   - destacados: los productos activos más recientes, con foto primero
 *     (el catálogo aún no tiene un campo "destacado");
 *   - categorías: las reales del negocio, cada una con la foto de uno de sus
 *     productos cuando existe (si no, la vista muestra su inicial).
 */
import type { CatalogCategory } from "@/lib/catalogo/domain";
import type { PublicCatalogPage, PublicCatalogProduct } from "@/lib/catalogo/publicacion";

export const DESTACADOS_MAX = 8;

export interface CategoriaInicio extends CatalogCategory {
  imageUrl: string | null;
}

export interface Inicio {
  destacados: PublicCatalogProduct[];
  categorias: CategoriaInicio[];
}

const clave = (s: string) => s.trim().toLocaleLowerCase("es");

export function armarInicio(page: Pick<PublicCatalogPage, "products" | "categories">): Inicio {
  // Orden estable: los que tienen foto primero, conservando "más recientes primero".
  const destacados = [...page.products]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Number(!a.p.thumbUrl) - Number(!b.p.thumbUrl) || a.i - b.i)
    .slice(0, DESTACADOS_MAX)
    .map(({ p }) => p);

  const fotoPorCategoria = new Map<string, string>();
  for (const p of page.products) {
    if (!p.categoryName || !p.thumbUrl) continue;
    const k = clave(p.categoryName);
    if (!fotoPorCategoria.has(k)) fotoPorCategoria.set(k, p.thumbUrl);
  }
  const categorias = page.categories.map((c) => ({ ...c, imageUrl: fotoPorCategoria.get(clave(c.name)) ?? null }));

  return { destacados, categorias };
}

/** ¿La URL pide el listado (búsqueda, categoría, página o "ver todo") en vez del inicio? */
export function esListado(params: { q?: string; categoria?: string; pagina?: string; todo?: string }): boolean {
  return Boolean(params.q || params.categoria || params.pagina || params.todo);
}
