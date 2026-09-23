/**
 * Catálogo público (HTML server-rendered): la vitrina que ven los clientes.
 * Es una REPRESENTACIÓN del catálogo de DuLabs, nunca su fuente de verdad.
 * Búsqueda, categorías y paginación viven en la URL (links normales y un form
 * GET): funciona sin JavaScript y cada vista se puede compartir.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import type { PublicCatalogPage, PublicCatalogProduct } from "@/lib/catalogo/publicacion";

function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

function href(basePath: string, params: { q?: string; categoria?: string; pagina?: number }): string {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.categoria) qs.set("categoria", params.categoria);
  if (params.pagina && params.pagina > 1) qs.set("pagina", String(params.pagina));
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export function PublicCatalog({
  data,
  basePath,
  q,
  categoria,
  compact = false,
  listPath,
  tile,
}: {
  data: PublicCatalogPage;
  basePath: string;
  q?: string;
  categoria?: string;
  /** Dentro de la tienda (que ya muestra la marca en su header): sin cabecera de marca ni pie propios. */
  compact?: boolean;
  /** Destino de "Todo" / "Quitar filtros" (el listado completo). Por defecto, basePath. */
  listPath?: string;
  /**
   * Tarjeta de producto (la de la tienda, con carrito). Obligatoria: todo
   * pedido pasa por el carrito y la validación del servidor; ya no existe un
   * link directo a WhatsApp por producto.
   */
  tile: (product: PublicCatalogProduct) => ReactNode;
}) {
  const todo = listPath ?? basePath;
  const totalPaginas = Math.max(1, Math.ceil(data.total / data.pageSize));
  const hayFiltros = Boolean(q || categoria);
  const mayor = data.context === "wholesale";

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
      <header className={cn("flex flex-col border-b border-edge", compact ? "gap-4 py-5 sm:py-8" : "gap-6 py-8 sm:py-12")}>
        {!compact && (
          <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-mist">Catálogo</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{data.business.name}</h1>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-edge px-3 py-1 text-xs text-mist">
            <span className={cn("size-1.5 rounded-full", mayor ? "bg-amber-300" : "bg-fg")} />
            {mayor ? "Precios al por mayor" : "Precios al detal"}
          </p>
          </div>
        )}

        {!compact && (
        <form action={basePath} method="get" className="relative max-w-xl" role="search">
          {categoria && <input type="hidden" name="categoria" value={categoria} />}
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-mist" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar por nombre o referencia"
            aria-label="Buscar productos"
            className="w-full rounded-xl border border-edge bg-card py-3 pl-10 pr-4 text-sm text-fg outline-none transition-colors placeholder:text-mist/70 focus:border-fg/40"
          />
        </form>
        )}

        {data.categories.length > 0 && (
          <nav aria-label="Categorías" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            <Link
              href={q ? href(basePath, { q }) : todo}
              className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors", !categoria ? "border-fg bg-fg font-medium text-ink" : "border-edge text-mist hover:border-fg/40 hover:text-fg")}
            >
              Todo
            </Link>
            {data.categories.map((c) => (
              <Link
                key={c.id}
                href={href(basePath, { q, categoria: c.id })}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  categoria === c.id ? "border-fg bg-fg font-medium text-ink" : "border-edge text-mist hover:border-fg/40 hover:text-fg",
                )}
              >
                {c.name}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <div className="flex items-center justify-between py-5 text-sm text-mist">
        <span>{data.total === 1 ? "1 producto" : `${data.total.toLocaleString("es-CO")} productos`}</span>
        {hayFiltros && (
          <Link href={todo} className="inline-flex items-center gap-1 hover:text-fg">
            <X className="size-3.5" />
            Quitar filtros
          </Link>
        )}
      </div>

      {data.products.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-card px-6 py-20 text-center">
          <p className="text-base font-medium text-fg">{hayFiltros ? "No encontramos productos con esa búsqueda" : "Pronto verás productos aquí"}</p>
          {hayFiltros && (
            <Link href={todo} className="mt-3 inline-block text-sm text-mist underline-offset-4 hover:text-fg hover:underline">
              Ver todo el catálogo
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
          {data.products.map((p) => (
            <div key={p.reference}>{tile(p)}</div>
          ))}
        </div>
      )}

      {totalPaginas > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-3 text-sm" aria-label="Paginación">
          {data.page > 1 ? (
            <Link href={href(basePath, { q, categoria, pagina: data.page - 1 })} className="rounded-lg border border-edge px-4 py-2 text-fg hover:border-fg/40">
              Anterior
            </Link>
          ) : (
            <span className="rounded-lg border border-edge px-4 py-2 text-mist/40">Anterior</span>
          )}
          <span className="tabular-nums text-mist">
            Página {data.page} de {totalPaginas}
          </span>
          {data.page < totalPaginas ? (
            <Link href={href(basePath, { q, categoria, pagina: data.page + 1 })} className="rounded-lg border border-edge px-4 py-2 text-fg hover:border-fg/40">
              Siguiente
            </Link>
          ) : (
            <span className="rounded-lg border border-edge px-4 py-2 text-mist/40">Siguiente</span>
          )}
        </nav>
      )}

      {!compact && (
      <footer className="mt-16 border-t border-edge pt-6 text-center text-xs text-mist">
        Catálogo creado con{" "}
        <a href="https://www.dulabs.co" className="text-fg hover:underline">
          DuLabs
        </a>
      </footer>
      )}
    </div>
  );
}
