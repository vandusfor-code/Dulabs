import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import type { PriceContext } from "@/lib/catalogo/domain";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { createPublicCatalogService } from "@/lib/catalogo/service";

/**
 * Carga del catálogo público para las páginas /catalogo/* (Server Components).
 * cache() por petición con argumentos PRIMITIVOS: generateMetadata y la página
 * comparten una sola consulta. Lectura con service_role SOLO en el servidor;
 * la proyección pública no incluye ids internos ni el precio del otro contexto.
 */
export const cargarCatalogoPublico = cache(
  (slug: string, context: PriceContext, token: string | undefined, q: string | undefined, categoria: string | undefined, pagina: number) =>
    createPublicCatalogService({ repo: createSupabaseCatalogRepository(supabaseAdmin()) }).getCatalog({ slug, context, token, q, categoryId: categoria, page: pagina }),
);

/** Primer valor de un searchParam (Next entrega string | string[] | undefined). */
export function param(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.trim() ? v.trim().slice(0, 100) : undefined;
}

export function paginaDe(value: string | string[] | undefined): number {
  const n = Number(param(value));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
