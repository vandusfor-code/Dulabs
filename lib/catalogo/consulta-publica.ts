/**
 * La consulta que la tienda pública le hace al servicio del catálogo (listado, filtros y opciones de los filtros), armada aparte del cargador para poder probarla sin red ni base de datos. Es
 * donde se juntan lo que trae la dirección (búsqueda, categoría, página, filtros) y lo que es de cada tienda (sus LÍNEAS, de su configuración): si aquí se olvidara pasar las líneas, `?linea=plata`
 * se ignoraría en silencio y el panel no ofrecería «Línea». Puro: sin I/O.
 */
import type { PriceContext } from "@/lib/catalogo/domain";
import { filtrosDeTexto } from "@/lib/catalogo/filtros";
import { lineasDeLaTienda } from "@/lib/catalogo/joyeria";
import type { PublicCatalogQuery } from "@/lib/catalogo/service";

export function consultaDeCatalogoPublico(a: {
  slug: string;
  context: PriceContext;
  token: string | undefined;
  q: string | undefined;
  categoria: string | undefined;
  pagina: number;
  /** Los filtros de la dirección como texto estable (`textoDeFiltros`). */
  filtros?: string;
  /** Pide además las opciones de los filtros con sus conteos. */
  opciones?: boolean;
}): PublicCatalogQuery {
  // Las líneas (Plata, Rodio…) son de la tienda de ese negocio: salen de su configuración. Sin ellas, una `?linea=` se ignora y todo es como siempre.
  const lineas = lineasDeLaTienda(a.slug);
  return {
    slug: a.slug,
    context: a.context,
    token: a.token,
    q: a.q,
    categoryId: a.categoria,
    page: a.pagina,
    ...(a.filtros ? { filters: filtrosDeTexto(a.filtros) } : {}),
    ...(a.opciones ? { facets: true } : {}),
    ...(lineas.length > 0 ? { lineas } : {}),
  };
}
