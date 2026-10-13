/**
 * Tarjeta de producto del tema "joyeria": la MISMA información y el MISMO carrito que la de siempre (foto y nombre abren la ficha, precio con oferta, «Últimas unidades», agotado), con otra
 * composición: foto vertical uniforme (4:5), nombre en serif, referencia, precio y una píldora de vidrio «Agregar al carrito» sobre la foto.
 *
 * Movimiento (CSS, solo con movimiento permitido): al pasar el mouse la foto se acerca 1,05× en 0,5 s y la píldora aparece en 0,2 s. En pantallas sin mouse (táctiles) la píldora está
 * siempre visible: no hay «pasar el mouse» al que esperar. Server Component (solo el botón y la precarga por intención son de cliente).
 */
import { ImageOff } from "lucide-react";
import { AgregarAlCarrito } from "@/components/catalogo-publico/tienda/AgregarAlCarrito";
import { EnlaceIntencion } from "@/components/catalogo-publico/tienda/EnlaceIntencion";
import { MarcaReferencia } from "@/components/catalogo-publico/tienda/MarcaReferencia";
import { formatCop } from "@/lib/business-agent-quote";
import { cargaDeFoto, productPathIn, type PublicCatalogProduct } from "@/lib/catalogo/publicacion";

export function TarjetaJoyeria({ product, basePath, posicion }: { product: PublicCatalogProduct; basePath: string; posicion?: number }) {
  const carga = cargaDeFoto(posicion);
  const href = productPathIn(basePath, product.reference);
  return (
    <article className="joy-tarjeta group relative flex h-full flex-col">
      <div className="relative">
        <EnlaceIntencion href={href} className="joy-foto relative block aspect-[4/5] overflow-hidden rounded-xl bg-ink-2" tabIndex={-1} aria-hidden>
          {product.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- miniatura pública ya optimizada (WebP ≤ 400 px) en la carga
            <img
              src={product.thumbUrl}
              alt=""
              loading={carga.loading}
              fetchPriority={carga.fetchPriority}
              decoding="async"
              width={400}
              height={400}
              className={"size-full object-cover" + (product.available ? "" : " opacity-60 grayscale-[35%]")}
            />
          ) : (
            <span className="flex size-full items-center justify-center text-mist/50">
              <ImageOff className="size-7" strokeWidth={1.4} />
            </span>
          )}
          {product.thumbUrl && <MarcaReferencia reference={product.reference} className="right-2 top-2" />}
        </EnlaceIntencion>
        {/* Etiqueta de la oferta vigente (el detalle en palabras va debajo, para quien no ve la foto). */}
        {product.offer && (
          <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-[var(--tienda-oro)] px-2.5 py-1 text-[11px] font-semibold leading-none text-white shadow-sm">{product.offer.label}</span>
        )}
        <div className="joy-pildora pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3">
          <AgregarAlCarrito product={product} variante="cristal" />
        </div>
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-1 px-1">
        <h3 className="font-serif-tienda line-clamp-2 text-[16px] font-medium leading-snug text-fg sm:text-[17px]">
          <EnlaceIntencion href={href} className="rounded-sm outline-offset-4">
            {product.name}
          </EnlaceIntencion>
        </h3>
        <p className="font-mono text-[11px] tracking-tight text-mist">{product.reference}</p>
        {product.availability === "low" && <p className="text-[11.5px] font-medium text-[var(--tienda-oro)]">Últimas unidades</p>}
        {product.offer && <p className="text-[11.5px] font-medium text-[var(--tienda-oro)]">{product.offer.benefit}</p>}
        <div className="mt-auto pt-1.5">
          {product.price === null ? (
            <span className="text-[13px] text-mist">Precio a consultar</span>
          ) : product.listPrice !== undefined ? (
            <span className="flex flex-wrap items-baseline gap-x-2 leading-tight">
              <span className="text-[15px] font-medium tabular-nums text-fg">{formatCop(product.price)}</span>
              <span className="text-[12px] tabular-nums text-mist">
                <span className="sr-only">Precio normal: </span>
                <s>{formatCop(product.listPrice)}</s>
              </span>
            </span>
          ) : (
            <span className="text-[15px] font-medium tabular-nums text-fg">{formatCop(product.price)}</span>
          )}
        </div>
      </div>
    </article>
  );
}
