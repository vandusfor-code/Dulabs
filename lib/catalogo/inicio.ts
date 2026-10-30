/**
 * Vista pedida por la URL del catálogo público: el INICIO de la tienda o el
 * LISTADO (búsqueda, categoría, página, "ver todo" o los filtros de la joyería: línea, color, material y precio). Los datos de cada vista
 * los resuelve el servicio público (getHome / getCatalog) en el servidor.
 */
export const PARAMS_LISTADO = ["q", "categoria", "pagina", "todo", "linea", "color", "material", "precio_min", "precio_max"] as const;

export function esListado(params: Partial<Record<(typeof PARAMS_LISTADO)[number], string | null | undefined>>): boolean {
  return PARAMS_LISTADO.some((nombre) => Boolean(params[nombre]));
}

/** Lo mismo leído de la dirección del navegador (`useSearchParams()`): el marco de la tienda y el servidor deciden igual entre inicio y listado. */
export function esListadoDeUrl(params: { get(nombre: string): string | null }): boolean {
  return PARAMS_LISTADO.some((nombre) => Boolean(params.get(nombre)));
}
