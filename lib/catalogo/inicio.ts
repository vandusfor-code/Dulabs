/**
 * Vista pedida por la URL del catálogo público: el INICIO de la tienda o el
 * LISTADO (búsqueda, categoría, página, "ver todo" o los filtros de la joyería: para quién, línea, color, material y precio). Los datos de cada vista
 * los resuelve el servicio público (getHome / getCatalog) en el servidor.
 */
export const PARAMS_LISTADO = ["q", "categoria", "pagina", "todo", "genero", "linea", "color", "material", "precio_min", "precio_max"] as const;

/**
 * Los parámetros que abren el LISTADO. `genero` NO: solo dice de qué lado de la tienda se está. `?genero=hombre` es el INICIO del lado de hombre (su portada, sus categorías y sus destacados) y el listado
 * de ese lado lleva `todo=1` o algún filtro (`?genero=hombre&todo=1`), igual que el de mujer lleva `?todo=1`.
 */
const ABREN_LISTADO = PARAMS_LISTADO.filter((nombre) => nombre !== "genero");

export function esListado(params: Partial<Record<(typeof PARAMS_LISTADO)[number], string | null | undefined>>): boolean {
  return ABREN_LISTADO.some((nombre) => Boolean(params[nombre]));
}

/** Lo mismo leído de la dirección del navegador (`useSearchParams()`): el marco de la tienda y el servidor deciden igual entre inicio y listado. */
export function esListadoDeUrl(params: { get(nombre: string): string | null }): boolean {
  return ABREN_LISTADO.some((nombre) => Boolean(params.get(nombre)));
}
