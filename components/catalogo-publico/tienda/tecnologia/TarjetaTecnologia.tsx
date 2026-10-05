/**
 * Tarjeta de producto del tema "tecnologia": foto grande sobre fondo limpio (cuadrada, `contain`, con aire alrededor), nombre, referencia, precio y el
 * botón circular del carrito (el MISMO motor único del carrito). Todo sale del catálogo real: nada de calificaciones, "Nuevo" ni "Oferta" inventados;
 * la etiqueta solo aparece cuando el backend la respalda ("Últimas unidades" / "Agotado"). El corazón es UI lista para conectar (no guarda).
 * Server Component (solo el carrito, el corazón y la precarga por intención son de cliente).
 */
import { ImageOff } from "lucide-react";
import { AgregarAlCarrito } from "@/components/catalogo-publico/tienda/AgregarAlCarrito";
import { EnlaceIntencion } from "@/components/catalogo-publico/tienda/EnlaceIntencion";
import { MarcaReferencia } from "@/components/catalogo-publico/tienda/MarcaReferencia";
import { BotonFavorito } from "@/components/catalogo-publico/tienda/tecnologia/BotonFavorito";
import { formatCop } from "@/lib/business-agent-quote";
import { cargaDeFoto, productPathIn, type PublicCatalogProduct } from "@/lib/catalogo/publicacion";

/** La etiqueta de la tarjeta, solo con datos reales de disponibilidad. */
export function etiquetaDeProducto(product: Pick<PublicCatalogProduct, "available" | "availability">): { texto: string; tono: "aviso" | "agotado" } | null {
  if (!product.available || product.availability === "sold_out") return { texto: "Agotado", tono: "agotado" };
  if (product.availability === "low") return { texto: "Últimas unidades", tono: "aviso" };
  return null;
}

export function TarjetaTecnologia({ product, basePath, posicion }: { product: PublicCatalogProduct; basePath: string; posicion?: number }) {
  const carga = cargaDeFoto(posicion);
  const href = productPathIn(basePath, product.reference);
  const etiqueta = etiquetaDeProducto(product);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[20px] border border-edge bg-card shadow-[0_1px_2px_rgba(7,20,38,0.04),0_10px_24px_-14px_rgba(7,20,38,0.14)] transition-transform duration-150 active:scale-[0.985]">
      <EnlaceIntencion href={href} className="relative block aspect-square bg-white p-3" tabIndex={-1} aria-hidden>
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
            className={"size-full object-contain transition-transform duration-300 group-hover:scale-[1.03]" + (product.available ? "" : " opacity-55 grayscale")}
          />
        ) : (
          <span className="flex size-full items-center justify-center rounded-xl bg-[var(--tech-surface)] text-[#94a3b8]">
            <ImageOff className="size-8" strokeWidth={1.5} />
          </span>
        )}
        {product.thumbUrl && <MarcaReferencia reference={product.reference} />}
      </EnlaceIntencion>
      {etiqueta && (
        <span
          className={
            "pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-full px-2.5 py-1 text-[10.5px] font-bold leading-none " +
            (etiqueta.tono === "agotado" ? "bg-[#e2e8f0] text-[#475569]" : "bg-[#fff1e6] text-[#b45309]")
          }
        >
          {etiqueta.texto}
        </span>
      )}
      <BotonFavorito nombre={product.name} />
      <div className="flex flex-1 flex-col px-3.5 pb-3.5 pt-1">
        <h3 className="line-clamp-2 min-h-[2.5rem] text-[14px] font-semibold leading-snug text-fg">
          <EnlaceIntencion href={href} className="rounded-sm outline-offset-4">
            {product.name}
          </EnlaceIntencion>
        </h3>
        <p className="mt-1 font-mono text-[11px] tracking-tight text-mist">{product.reference}</p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          {product.price === null ? (
            <span className="text-[13px] text-mist">Precio a consultar</span>
          ) : (
            <span className="text-[20px] font-extrabold leading-none tracking-tight tabular-nums text-fg">{formatCop(product.price)}</span>
          )}
          <AgregarAlCarrito product={product} variante="circular" />
        </div>
      </div>
    </article>
  );
}
