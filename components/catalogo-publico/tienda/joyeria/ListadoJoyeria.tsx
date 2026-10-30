/**
 * Listado y búsqueda del tema "joyeria": SOLO presentación. Los datos, los filtros (búsqueda `?q=`, categoría `?categoria=`, página `?pagina=`), los enlaces y la paginación son los de
 * siempre (mismas direcciones: `href` de PublicCatalog); funciona sin JavaScript y cada vista se puede compartir.
 *
 * Sin búsqueda por texto y con las opciones de filtro disponibles (`facetas`), el panel de filtros de la referencia (FiltrosJoyeria): línea (si el negocio las tiene), categoría, color, material y rango de precio, con su
 * conteo por opción (escritorio: columna fija; celular: botón «Filtrar» y hoja inferior). Con búsqueda por texto, o si el catálogo es demasiado grande para contar, la columna de categorías
 * y la fila deslizable de siempre. Server Component.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { href } from "@/components/catalogo-publico/PublicCatalog";
import { EnlaceIntencion } from "@/components/catalogo-publico/tienda/EnlaceIntencion";
import { FiltrosJoyeria } from "@/components/catalogo-publico/tienda/joyeria/FiltrosJoyeria";
import { indice } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import { SIN_FILTROS, hayFiltros as hayFiltrosDe, urlFiltros, type FacetasCatalogo, type FiltrosCatalogo } from "@/lib/catalogo/filtros";
import type { LineaConfig } from "@/lib/catalogo/lineas";
import type { PublicCatalogPage, PublicCatalogProduct } from "@/lib/catalogo/publicacion";

function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

const PAGINA = "joy-boton-linea inline-flex h-11 items-center rounded-lg border px-5 text-sm tracking-[0.06em]";
/** Paso de paginación que no existe (primera o última página): se ve como inactivo, con contraste de texto suficiente. */
const PAGINA_INACTIVA = "inline-flex h-11 cursor-not-allowed items-center rounded-lg border border-dashed border-edge px-5 text-sm tracking-[0.06em] text-mist";

export function ListadoJoyeria({
  data,
  basePath,
  q,
  categoria,
  listPath,
  titulo,
  tile,
  filtros = SIN_FILTROS,
  facetas = null,
  lineas = [],
}: {
  data: PublicCatalogPage;
  basePath: string;
  q?: string;
  categoria?: string;
  listPath: string;
  titulo: string;
  tile: (product: PublicCatalogProduct, posicion: number) => ReactNode;
  /** Filtros de la dirección (categorías, color, material, precio): los que el servidor aplicó a `data`. Solo cuentan sin búsqueda por texto. */
  filtros?: FiltrosCatalogo;
  /** Opciones de filtro con sus conteos; null = sin panel de filtros (búsqueda por texto, o un catálogo demasiado grande para contar). */
  facetas?: FacetasCatalogo | null;
  /** Las líneas del negocio (Plata, Rodio…). Con UNA elegida en la dirección, la página es la de esa línea: su nombre, y las categorías (TODAS, tenga o no piezas) para moverse dentro de ella. */
  lineas?: readonly LineaConfig[];
}) {
  const conPanel = !q && facetas !== null;
  const filtrado = conPanel && hayFiltrosDe(filtros);
  const hayFiltros = Boolean(q || categoria) || filtrado;
  const totalPaginas = data.pageCount;
  const idCategoria = conPanel ? (filtros.categorias.length === 1 ? filtros.categorias[0] : undefined) : categoria;
  const categoriaActual = idCategoria ? data.categories.find((c) => c.id === idCategoria)?.name : undefined;
  // La página de una línea: una sola línea elegida (con varias es un filtro más, como siempre). El conteo de cada categoría dentro de ella lo trae el servidor en `facetas.lineas`.
  const claveLinea = conPanel && filtros.lineas?.length === 1 ? filtros.lineas[0] : undefined;
  const lineaActual = claveLinea ? lineas.find((l) => l.clave === claveLinea) : undefined;
  const conteoLinea = lineaActual ? facetas?.lineas?.find((l) => l.clave === lineaActual.clave) : undefined;
  const cuenta = data.total === 1 ? "1 producto" : `${data.total.toLocaleString("es-CO")} productos`;
  const enlacePagina = (pagina: number) => (conPanel ? urlFiltros(basePath, filtros, pagina) : href(basePath, { q, categoria, pagina }));

  const sinFiltro = q ? href(basePath, { q }) : listPath;
  const enlaceCategoria = (activo: boolean, contenido: ReactNode, destino: string, clase: string) => (
    <EnlaceIntencion href={destino} className={clase} aria-current={activo ? "page" : undefined}>
      {contenido}
    </EnlaceIntencion>
  );

  // La lista de productos, los avisos y la paginación: lo mismo con o sin panel de filtros.
  const resultados = (
    <>
      {data.search?.relaxed && data.products.length > 0 && (
        <p className="mb-6 rounded-xl border border-edge bg-card px-4 py-3 text-sm text-mist">Ningún producto tiene todas las palabras que buscaste; estos tienen al menos una.</p>
      )}

      {data.products.length === 0 ? (
        <div className="rounded-xl border border-edge bg-card px-6 py-20 text-center">
          <p className="font-serif-tienda text-2xl text-fg">
            {hayFiltros ? (conPanel ? "No encontramos productos con esos filtros" : "No encontramos productos con esa búsqueda") : "Pronto verás productos aquí"}
          </p>
          {hayFiltros && (
            <Link href={listPath} className="mt-4 inline-block text-sm text-[var(--tienda-oro)] underline-offset-4 hover:underline">
              Ver todo el catálogo
            </Link>
          )}
        </div>
      ) : (
        <>
          <h2 className="sr-only">Productos</h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
            {data.products.map((p, i) => (
              <li key={p.reference} className="joy-item" style={indice(i % 4)}>
                {tile(p, i)}
              </li>
            ))}
          </ul>
        </>
      )}

      {data.search?.capped && data.page === totalPaginas && (
        <p className="mt-10 text-center text-sm text-mist">Estos son los resultados más parecidos a tu búsqueda. Agrega otra palabra (color, material…) para encontrar el resto.</p>
      )}

      {totalPaginas > 1 && (
        <nav className="mt-12 flex items-center justify-center gap-3 text-sm" aria-label="Paginación">
          {data.page > 1 ? (
            <Link href={enlacePagina(data.page - 1)} className={PAGINA}>
              Anterior
            </Link>
          ) : (
            <span className={PAGINA_INACTIVA} aria-disabled="true">
              Anterior
            </span>
          )}
          <span className="tabular-nums text-mist">
            Página {data.page} de {totalPaginas}
          </span>
          {data.page < totalPaginas ? (
            <Link href={enlacePagina(data.page + 1)} className={PAGINA}>
              Siguiente
            </Link>
          ) : (
            <span className={PAGINA_INACTIVA} aria-disabled="true">
              Siguiente
            </span>
          )}
        </nav>
      )}
    </>
  );

  return (
    <div className="joy-compensa">
      <header className="border-b border-[var(--joy-oro)]/30 bg-ink-2">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
          <nav aria-label="Migas de pan" className="text-xs">
            <ol className="flex flex-wrap items-center gap-2 text-mist">
              <li>
                <Link href={basePath} className="transition-colors hover:text-[var(--tienda-oro)]">
                  Inicio
                </Link>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-[var(--joy-oro)]" aria-hidden>
                  /
                </span>
                {hayFiltros ? (
                  <Link href={listPath} className="transition-colors hover:text-[var(--tienda-oro)]">
                    Catálogo
                  </Link>
                ) : (
                  <span className="font-medium text-fg" aria-current="page">
                    Catálogo
                  </span>
                )}
              </li>
              {hayFiltros && lineaActual && (
                <>
                  <li className="flex items-center gap-2">
                    <span className="text-[var(--joy-oro)]" aria-hidden>
                      /
                    </span>
                    {categoriaActual ? (
                      <Link href={urlFiltros(basePath, { ...SIN_FILTROS, lineas: [lineaActual.clave] })} className="transition-colors hover:text-[var(--tienda-oro)]">
                        {lineaActual.etiqueta}
                      </Link>
                    ) : (
                      <span className="font-medium text-fg" aria-current="page">
                        {lineaActual.etiqueta}
                      </span>
                    )}
                  </li>
                  {categoriaActual && (
                    <li className="flex items-center gap-2">
                      <span className="text-[var(--joy-oro)]" aria-hidden>
                        /
                      </span>
                      <span className="font-medium text-fg" aria-current="page">
                        {categoriaActual}
                      </span>
                    </li>
                  )}
                </>
              )}
              {hayFiltros && !lineaActual && (
                <li className="flex items-center gap-2">
                  <span className="text-[var(--joy-oro)]" aria-hidden>
                    /
                  </span>
                  <span className="font-medium text-fg" aria-current="page">
                    {q ? `Búsqueda: ${q}` : (categoriaActual ?? (filtrado ? "Filtros" : "Categoría"))}
                  </span>
                </li>
              )}
            </ol>
          </nav>
          <div className="max-w-3xl">
            <h1 className="font-serif-tienda text-[34px] font-medium leading-tight tracking-[0.04em] text-fg sm:text-[44px]">{titulo}</h1>
            <p className="mt-2 text-sm leading-6 text-mist sm:text-base">{cuenta}</p>
          </div>
          {/* Las categorías de la línea: en el celular una sola fila que se desliza (como las del listado de siempre); desde la tableta, todas a la vista en varias filas. */}
          {lineaActual && data.categories.length > 0 && (
            <nav aria-label={`Categorías de ${lineaActual.etiqueta}`} className="tienda-scroll -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              <EnlaceIntencion href={urlFiltros(basePath, { ...filtros, categorias: [] })} className={cn("joy-chip", !idCategoria && "joy-chip-activo")} aria-current={!idCategoria ? "page" : undefined}>
                Toda la línea
              </EnlaceIntencion>
              {data.categories.map((c) => {
                const n = conteoLinea?.categorias.find((x) => x.id === c.id)?.n ?? 0;
                const activa = idCategoria === c.id;
                return (
                  <EnlaceIntencion key={c.id} href={urlFiltros(basePath, { ...filtros, categorias: [c.id] })} className={cn("joy-chip", activa && "joy-chip-activo")} aria-current={activa ? "page" : undefined}>
                    {c.name}
                    {n > 0 && (
                      <>
                        {" "}
                        <span className="tabular-nums opacity-70">({n})</span>
                      </>
                    )}
                  </EnlaceIntencion>
                );
              })}
            </nav>
          )}
        </div>
      </header>

      <section className="py-8 lg:py-12">
        {conPanel ? (
          <FiltrosJoyeria basePath={basePath} filtros={filtros} facetas={facetas} cuenta={cuenta}>
            {resultados}
          </FiltrosJoyeria>
        ) : (
          <div className="mx-auto flex max-w-7xl gap-10 px-4 sm:px-6 lg:px-8">
            {data.categories.length > 0 && (
              <aside className="hidden w-60 shrink-0 lg:block" aria-label="Categorías">
                <div className="sticky top-[calc(var(--joy-alto-barra)+var(--joy-alto-cab)+1.5rem)] space-y-5">
                  <h2 className="text-xs font-medium uppercase tracking-[0.16em] text-fg">Categorías</h2>
                  <ul className="space-y-1" role="list">
                    <li>{enlaceCategoria(!categoria, "Todo", sinFiltro, cn("joy-cat-lateral", !categoria && "joy-cat-lateral-activa"))}</li>
                    {data.categories.map((c) => (
                      <li key={c.id}>{enlaceCategoria(categoria === c.id, c.name, href(basePath, { q, categoria: c.id }), cn("joy-cat-lateral", categoria === c.id && "joy-cat-lateral-activa"))}</li>
                    ))}
                  </ul>
                  {hayFiltros && (
                    <Link href={listPath} className="inline-flex items-center gap-1 text-sm text-mist transition-colors hover:text-fg">
                      <X className="size-3.5" aria-hidden />
                      Quitar filtros
                    </Link>
                  )}
                </div>
              </aside>
            )}

            <div className="min-w-0 flex-1">
              {data.categories.length > 0 && (
                <nav aria-label="Categorías" className="tienda-scroll -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:hidden">
                  {enlaceCategoria(!categoria, "Todo", sinFiltro, cn("joy-chip", !categoria && "joy-chip-activo"))}
                  {data.categories.map((c) => (
                    <span key={c.id} className="contents">
                      {enlaceCategoria(categoria === c.id, c.name, href(basePath, { q, categoria: c.id }), cn("joy-chip", categoria === c.id && "joy-chip-activo"))}
                    </span>
                  ))}
                </nav>
              )}

              <div className="mb-6 flex items-center justify-between text-sm text-mist">
                <span>{cuenta}</span>
                {hayFiltros && (
                  <Link href={listPath} className="inline-flex items-center gap-1 transition-colors hover:text-fg lg:hidden">
                    <X className="size-3.5" aria-hidden />
                    Quitar filtros
                  </Link>
                )}
              </div>

              {resultados}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
