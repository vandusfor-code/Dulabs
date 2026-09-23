/**
 * Tarjeta de producto de la tienda: la MISMA en inicio, listado y búsqueda.
 * Foto y nombre abren la ficha del producto; "+" agrega con el motor único
 * del carrito. Server Component (solo el "+" es interactivo).
 */
import Link from "next/link";
import { ImageOff } from "lucide-react";
import { formatCop } from "@/lib/business-agent-quote";
import { productPathIn, type PublicCatalogProduct } from "@/lib/catalogo/publicacion";
import { AgregarAlCarrito } from "@/components/catalogo-publico/tienda/AgregarAlCarrito";

/** `basePath`: raíz de la tienda del canal (detal o mayorista), para que la ficha conserve el canal. */
export function TarjetaProducto({ product, basePath }: { product: PublicCatalogProduct; basePath: string }) {
  const href = productPathIn(basePath, product.reference);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[20px] border border-edge/80 bg-card shadow-[0_1px_2px_rgba(60,40,20,0.04)] transition-transform duration-150 active:scale-[0.985]">
      <Link href={href} className="block aspect-square overflow-hidden bg-ink-2" tabIndex={-1} aria-hidden>
        {product.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- miniatura pública ya optimizada (WebP ≤ 400 px) en la carga
          <img
            src={product.thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={400}
            height={400}
            className={"size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" + (product.available ? "" : " opacity-60 grayscale-[35%]")}
          />
        ) : (
          <span className="flex size-full items-center justify-center text-mist/50">
            <ImageOff className="size-7" strokeWidth={1.5} />
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col px-3.5 pb-3.5 pt-3">
        <h3 className="line-clamp-2 text-[14.5px] font-medium leading-snug text-fg">
          <Link href={href} className="rounded-sm outline-offset-4">
            {product.name}
          </Link>
        </h3>
        <p className="mt-0.5 font-mono text-[11px] tracking-tight text-mist">{product.reference}</p>
        {product.availability === "low" && <p className="mt-1 text-[11.5px] font-medium text-[var(--tienda-oro)]">Últimas unidades</p>}
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          {product.price === null ? (
            <span className="text-[13px] text-mist">Precio a consultar</span>
          ) : (
            <span className="text-base font-semibold tabular-nums text-fg">{formatCop(product.price)}</span>
          )}
          <AgregarAlCarrito product={product} />
        </div>
      </div>
    </article>
  );
}
