/**
 * Ficha de producto del tema "joyeria": la MISMA información y las MISMAS acciones que la de siempre (precio efectivo, precio normal tachado, oferta, disponibilidad, descripción,
 * material y color, cantidad y «Agregar» con el motor único del carrito), con otra composición: migas de pan, galería vertical fija a la izquierda con vista ampliada, y el
 * detalle a la derecha con un filete dorado. NO toca el carrito, el pedido ni los precios. Server Component.
 */
import Link from "next/link";
import { formatCop } from "@/lib/business-agent-quote";
import type { Availability, CatalogCategory } from "@/lib/catalogo/domain";
import type { PublicProductDetail } from "@/lib/catalogo/publicacion";
import { AccionesProducto } from "@/components/catalogo-publico/tienda/AccionesProducto";
import { BotonVolver } from "@/components/catalogo-publico/tienda/BotonVolver";
import { GaleriaJoyeria } from "@/components/catalogo-publico/tienda/joyeria/GaleriaJoyeria";

const ESTADOS: Record<Availability, { texto: string; clase: string; punto: string }> = {
  available: { texto: "Disponible", clase: "bg-[var(--tienda-oro-suave)] text-fg", punto: "bg-[var(--tienda-oro)]" },
  low: { texto: "Últimas unidades", clase: "bg-[var(--tienda-oro-suave)] text-[var(--tienda-oro)]", punto: "bg-[var(--tienda-oro)]" },
  sold_out: { texto: "Agotado", clase: "bg-ink-2 text-mist", punto: "bg-mist" },
};

function EstadoDisponibilidad({ availability }: { availability: Availability }) {
  const e = ESTADOS[availability];
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium " + e.clase}>
      <span className={"size-1.5 rounded-full " + e.punto} aria-hidden />
      {e.texto}
    </span>
  );
}

export function FichaProductoJoyeria({ producto, categorias, basePath, listPath }: { producto: PublicProductDetail; categorias: CatalogCategory[]; basePath: string; listPath: string }) {
  const categoria = producto.categoryId ? categorias.find((c) => c.id === producto.categoryId) : undefined;
  const atributos = [
    { nombre: "Material", valor: producto.material },
    { nombre: "Color", valor: producto.color },
  ].filter((a): a is { nombre: string; valor: string } => Boolean(a.valor));

  return (
    <article className="joy-compensa">
      <header className="border-b border-[var(--joy-oro)]/30 bg-ink-2">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-5">
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
                <Link href={listPath} className="transition-colors hover:text-[var(--tienda-oro)]">
                  Catálogo
                </Link>
              </li>
              {categoria && (
                <li className="flex items-center gap-2">
                  <span className="text-[var(--joy-oro)]" aria-hidden>
                    /
                  </span>
                  <Link href={`${basePath}?categoria=${encodeURIComponent(categoria.id)}`} className="transition-colors hover:text-[var(--tienda-oro)]">
                    {categoria.name}
                  </Link>
                </li>
              )}
              {/* En el celular el nombre ya está justo debajo, en grande: la miga se queda en la categoría. */}
              <li className="hidden min-w-0 items-center gap-2 sm:flex">
                <span className="text-[var(--joy-oro)]" aria-hidden>
                  /
                </span>
                <span className="truncate font-medium text-fg" aria-current="page">
                  {producto.name}
                </span>
              </li>
            </ol>
          </nav>
          <div className="hidden lg:block">
            <BotonVolver listPath={listPath} />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 md:py-10 lg:grid-cols-2 lg:gap-14 lg:px-8 lg:py-14">
        <div className="lg:sticky lg:top-[calc(var(--joy-alto-barra)+var(--joy-alto-cab)+1.5rem)] lg:self-start">
          <GaleriaJoyeria images={producto.gallery} name={producto.name} reference={producto.reference} />
        </div>

        <div className="flex flex-col gap-5 lg:pt-2">
          <div>
            {categoria ? (
              <Link
                href={`${basePath}?categoria=${encodeURIComponent(categoria.id)}`}
                className="text-[11px] font-medium uppercase tracking-[0.3em] text-[var(--tienda-oro)] underline-offset-4 hover:underline"
              >
                {categoria.name}
              </Link>
            ) : (
              producto.categoryName && <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-mist">{producto.categoryName}</p>
            )}
            <h1 className="font-serif-tienda mt-2 text-[36px] font-medium leading-[1.05] text-fg sm:text-5xl">{producto.name}</h1>
            <p className="mt-3 font-mono text-xs tracking-tight text-mist">Ref. {producto.reference}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-3xl font-medium tabular-nums text-fg">{producto.price === null ? <span className="text-xl text-mist">Precio a consultar</span> : formatCop(producto.price)}</p>
            {producto.listPrice !== undefined && (
              <p className="text-lg tabular-nums text-mist">
                <span className="sr-only">Precio normal: </span>
                <s>{formatCop(producto.listPrice)}</s>
              </p>
            )}
            {producto.offer && <span className="rounded-full bg-[var(--tienda-oro)] px-3 py-1 text-xs font-semibold leading-none text-white">{producto.offer.label}</span>}
            <EstadoDisponibilidad availability={producto.availability} />
          </div>

          <div className="h-px w-24 bg-[var(--joy-oro)]" aria-hidden />

          {producto.offer && (
            <div className="rounded-xl border border-[var(--tienda-oro)]/40 bg-[var(--tienda-oro-suave)] px-4 py-3 text-sm">
              <p className="font-medium text-fg">
                {producto.offer.name} · {producto.offer.benefit}
              </p>
              {producto.offer.until && <p className="mt-0.5 text-mist">Vigente {producto.offer.until}</p>}
              {producto.offer.conditions && <p className="mt-1 text-[13px] text-fg/80">{producto.offer.conditions}</p>}
            </div>
          )}

          {producto.description && <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg/85">{producto.description}</p>}

          {atributos.length > 0 && (
            <dl className="divide-y divide-edge border-y border-edge">
              {atributos.map((a) => (
                <div key={a.nombre} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <dt className="text-mist">{a.nombre}</dt>
                  <dd className="text-right text-fg">{a.valor}</dd>
                </div>
              ))}
            </dl>
          )}

          <AccionesProducto product={producto} />
        </div>
      </div>
    </article>
  );
}
