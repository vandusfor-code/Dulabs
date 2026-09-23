/**
 * Vista pedida por la URL del catálogo público: el INICIO de la tienda o el
 * LISTADO (búsqueda, categoría, página o "ver todo"). Los datos de cada vista
 * los resuelve el servicio público (getHome / getCatalog) en el servidor.
 */
export function esListado(params: { q?: string; categoria?: string; pagina?: string; todo?: string }): boolean {
  return Boolean(params.q || params.categoria || params.pagina || params.todo);
}
