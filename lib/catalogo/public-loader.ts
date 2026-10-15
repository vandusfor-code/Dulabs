import { unstable_cache } from "next/cache";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import type { PriceContext } from "@/lib/catalogo/domain";
import { filtrosDeTexto } from "@/lib/catalogo/filtros";
import { createPublicCatalogService, type OpcionesInicio } from "@/lib/catalogo/service";
import type { CatalogStorefrontConfig } from "@/lib/catalogo/vitrina";
import type { OpcionesPaginaMayoristas } from "@/lib/cms-comercial/pagina-mayoristas";
import { cargarPaginaMayoristas as cargarPaginaMayoristasPublica } from "@/lib/cms-comercial/pagina-mayoristas-publica";
import { repositorioConPrecios } from "@/lib/cms-comercial/precios-supabase";
import { crearDepsPublicasCms } from "@/lib/cms-comercial/publico-supabase";
import type { ContextoVitrina } from "@/lib/cms-comercial/vitrina";
import { cargarVitrinaInicio as cargarVitrinaPublica } from "@/lib/cms-comercial/vitrina-publica";

/**
 * Carga del catálogo público para las páginas /catalogo/* (Server Components).
 * cache() por petición con argumentos PRIMITIVOS: generateMetadata y la página
 * comparten una sola consulta. Lectura con service_role SOLO en el servidor;
 * la proyección pública no incluye ids internos ni el precio del otro contexto.
 */
const servicio = () => createPublicCatalogService({ repo: repositorioConPrecios(supabaseAdmin()) });

/**
 * `filtros` (texto de `textoDeFiltros`) y `opciones` son del tema "joyeria": el listado filtrado por categorías, color, material y precio, y las opciones de esos filtros con sus
 * conteos (`facets`), que comparten una sola lectura de los productos activos. Sin ellos, el listado es exactamente el de siempre.
 */
export const cargarCatalogoPublico = cache(
  (slug: string, context: PriceContext, token: string | undefined, q: string | undefined, categoria: string | undefined, pagina: number, filtros?: string, opciones?: boolean) =>
    servicio().getCatalog({ slug, context, token, q, categoryId: categoria, page: pagina, ...(filtros ? { filters: filtrosDeTexto(filtros) } : {}), ...(opciones ? { facets: true } : {}) }),
);

/** Marco de la tienda (layout): identidad, categorías y WhatsApp. Compartido con las páginas de la misma petición. */
export const cargarTienda = cache((slug: string) => servicio().getStorefront(slug));

/** Inicio: destacados + categorías con portada. */
export const cargarInicio = cache((slug: string) => servicio().getHome(slug));

/**
 * Vitrina del inicio clásico: la publicada en el CMS comercial (portada, banner, destacados, categorías, campaña) o, sin nada publicado, con el módulo
 * apagado o ante cualquier problema, la de siempre. NUNCA lanza: la tienda no depende del CMS para verse. El negocio sale de la publicación (slug).
 */
export const cargarVitrinaInicio = (registro: CatalogStorefrontConfig, ctx: Omit<ContextoVitrina, "ahora">) => cargarVitrinaPublica(crearDepsPublicasCms(), registro, ctx);

/**
 * Página «Mayoristas» del tema "joyeria": lo publicado en el CMS con tema «Mayoristas» para el público de la tienda al detal (las mismas reglas que ARIA). NUNCA lanza: sin CMS, sin nada publicado o ante
 * cualquier problema devuelve null y la página se dibuja con el texto de la tienda y su botón de WhatsApp.
 */
export const cargarPaginaMayoristas = (slug: string, opciones: OpcionesPaginaMayoristas) => cargarPaginaMayoristasPublica(crearDepsPublicasCms(), slug, opciones);

/** Inicio con lo que el CMS eligió (destacados, categorías, productos de la campaña). Sin opciones, igual que `cargarInicio`. */
export const cargarInicioElegido = (slug: string, opciones: OpcionesInicio) => servicio().getHome(slug, opciones);

/**
 * Acabados (colores con productos) de la franja del inicio del tema "joyeria". Es una lectura liviana de TODOS los productos activos, así que se guarda 10 minutos entre peticiones:
 * los colores del catálogo casi nunca cambian y el inicio no debe leer el catálogo entero en cada visita. NUNCA lanza: sin datos, la franja no se dibuja.
 */
const acabadosGuardados = unstable_cache((slug: string) => servicio().getAcabados(slug), ["catalogo-acabados"], { revalidate: 600, tags: ["catalogo-acabados"] });
export async function cargarAcabados(slug: string) {
  try {
    return await acabadosGuardados(slug);
  } catch (error) {
    console.error("[catalogo/acabados] no se pudieron leer; el inicio se dibuja sin la franja:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Ficha pública de un producto (detal) por referencia. */
export const cargarProducto = cache((slug: string, referencia: string) => servicio().getProduct({ slug, reference: referencia }));

/** Marco de la tienda mayorista (exige el token exacto). */
export const cargarTiendaMayor = cache((slug: string, token: string) => servicio().getWholesaleStorefront(slug, token));

/** Ficha mayorista de un producto (precio mayor; exige el token exacto). */
export const cargarProductoMayor = cache((slug: string, token: string, referencia: string) =>
  servicio().getProduct({ slug, reference: referencia, context: "wholesale", token }),
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
