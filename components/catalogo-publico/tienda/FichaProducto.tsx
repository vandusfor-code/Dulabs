/**
 * Ficha de un producto de la tienda, COMPARTIDA por los dos canales (detal y
 * mayorista): recibe la proyección pública del canal (precio del canal,
 * disponibilidad discreta) y la raíz de la tienda de ese canal, así los links
 * y el carrito nunca mezclan canales. Server Component.
 */
import Link from "next/link";
import { formatCop } from "@/lib/business-agent-quote";
import type { Availability, CatalogCategory } from "@/lib/catalogo/domain";
import type { PublicProductDetail } from "@/lib/catalogo/publicacion";
import { AccionesProducto } from "@/components/catalogo-publico/tienda/AccionesProducto";
import { BotonVolver } from "@/components/catalogo-publico/tienda/BotonVolver";
import { GaleriaProducto } from "@/components/catalogo-publico/tienda/GaleriaProducto";

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

export function FichaProducto({ producto, categorias, basePath, listPath }: { producto: PublicProductDetail; categorias: CatalogCategory[]; basePath: string; listPath: string }) {
  const categoria = producto.categoryId ? categorias.find((c) => c.id === producto.categoryId) : undefined;
  const atributos = [
    { nombre: "Material", valor: producto.material },
    { nombre: "Color", valor: producto.color },
  ].filter((a): a is { nombre: string; valor: string } => Boolean(a.valor));

  return (
    <article className="pt-2 sm:pt-6">
      <BotonVolver listPath={listPath} />
      <div className="mt-2 grid gap-6 md:mt-4 md:grid-cols-2 md:gap-10 lg:gap-14">
        <GaleriaProducto images={producto.gallery} name={producto.name} reference={producto.reference} />

        <div className="flex flex-col gap-5 md:py-2">
          <div>
            {categoria ? (
              <Link
                href={`${basePath}?categoria=${encodeURIComponent(categoria.id)}`}
                className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--tienda-oro)] underline-offset-4 hover:underline"
              >
                {categoria.name}
              </Link>
            ) : (
              producto.categoryName && <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-mist">{producto.categoryName}</p>
            )}
            <h1 className="font-serif-tienda mt-1.5 text-[34px] font-medium leading-[1.05] text-fg sm:text-5xl">{producto.name}</h1>
            <p className="mt-2 font-mono text-xs tracking-tight text-mist">Ref. {producto.reference}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-2xl font-semibold tabular-nums text-fg">{producto.price === null ? <span className="text-lg font-medium text-mist">Precio a consultar</span> : formatCop(producto.price)}</p>
            {producto.listPrice !== undefined && (
              <p className="text-lg tabular-nums text-mist">
                <span className="sr-only">Precio normal: </span>
                <s>{formatCop(producto.listPrice)}</s>
              </p>
            )}
            {producto.offer && <span className="rounded-full bg-[var(--tienda-oro)] px-3 py-1 text-xs font-semibold leading-none text-white">{producto.offer.label}</span>}
            <EstadoDisponibilidad availability={producto.availability} />
          </div>

          {producto.offer && (
            <div className="rounded-[20px] border border-[var(--tienda-oro)]/40 bg-[var(--tienda-oro-suave)] px-4 py-3 text-sm">
              <p className="font-medium text-fg">
                {producto.offer.name} · {producto.offer.benefit}
              </p>
              {producto.offer.until && <p className="mt-0.5 text-mist">Vigente {producto.offer.until}</p>}
              {producto.offer.conditions && <p className="mt-1 text-[13px] text-fg/80">{producto.offer.conditions}</p>}
            </div>
          )}

          {producto.description && <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg/85">{producto.description}</p>}

          {atributos.length > 0 && (
            <dl className="divide-y divide-edge rounded-[20px] border border-edge bg-card px-4">
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
