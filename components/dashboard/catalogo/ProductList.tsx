"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { CatalogProduct } from "@/lib/catalogo/domain";
import { ProductImage, StatusBadge, cn, formatPrice } from "@/components/dashboard/catalogo/ui";

// Columnas compartidas por cabecera y filas (escritorio). En móvil cada fila se apila.
const COLS = "md:grid md:grid-cols-[44px_104px_minmax(0,1fr)_104px_104px_72px_96px_20px] md:items-center md:gap-4";

/** Lista de ADMINISTRACIÓN (no vitrina): encontrar, revisar y abrir para editar. */
export function ProductList({ products, dimmed }: { products: CatalogProduct[]; dimmed?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={cn("overflow-hidden rounded-xl border border-edge bg-card transition-opacity", dimmed && "opacity-60")}>
      <div className={cn("hidden border-b border-edge px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-mist", COLS)}>
        <span />
        <span>{t("Referencia", "Reference")}</span>
        <span>{t("Producto", "Product")}</span>
        <span className="text-right">{t("Detal", "Retail")}</span>
        <span className="text-right">{t("Mayor", "Wholesale")}</span>
        <span className="text-right">{t("Stock", "Stock")}</span>
        <span>{t("Estado", "Status")}</span>
        <span />
      </div>
      <ul className="divide-y divide-edge">
        {products.map((p) => (
          <li key={p.id}>
            <Link
              href={`/dashboard/catalogo/${p.id}`}
              className={cn("group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-2 focus-visible:bg-ink-2 focus-visible:outline-none", COLS)}
            >
              <ProductImage src={p.primaryImage?.thumbUrl} alt="" className={cn("size-11 shrink-0 rounded-md", p.status === "INACTIVE" && "opacity-50 grayscale")} />
              <span className="hidden font-mono text-xs text-mist md:block">{p.reference}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{p.name}</span>
                <span className="mt-0.5 block truncate text-xs text-mist">
                  <span className="font-mono md:hidden">{p.reference} · </span>
                  {p.categoryName ?? t("Sin categoría", "No category")}
                </span>
                {/* Móvil: precios y estado debajo del nombre */}
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs md:hidden">
                  <span className="whitespace-nowrap font-medium tabular-nums text-fg">{formatPrice(p.pricing.retail)}</span>
                  <span className="whitespace-nowrap tabular-nums text-mist">{t("Mayor", "Wholesale")} {formatPrice(p.pricing.wholesale)}</span>
                  <StockCell product={p} />
                  {p.status === "INACTIVE" && <StatusBadge status={p.status} />}
                </span>
              </span>
              <span className="hidden text-right text-sm font-medium tabular-nums text-fg md:block">{formatPrice(p.pricing.retail)}</span>
              <span className="hidden text-right text-sm tabular-nums text-mist md:block">{formatPrice(p.pricing.wholesale)}</span>
              <span className="hidden text-right text-sm md:block">
                <StockCell product={p} />
              </span>
              <span className="hidden md:block">
                <StatusBadge status={p.status} />
              </span>
              <ChevronRight className="size-4 shrink-0 text-mist transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stock compacto: unidades, "Agotado" en 0, o "—" si el producto (legado) aún no controla inventario. */
function StockCell({ product }: { product: CatalogProduct }) {
  const { t } = useI18n();
  if (!product.tracksStock) return <span className="text-mist" title={t("Sin control de inventario", "Inventory not tracked")}>—</span>;
  if (product.stock <= 0) return <span className="font-medium text-amber-400">{t("Agotado", "Sold out")}</span>;
  return (
    <span className="whitespace-nowrap tabular-nums text-fg">
      {product.stock}
      <span className="text-mist"> {t("u.", "u.")}</span>
    </span>
  );
}

export function ProductListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-card" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-edge px-4 py-3 last:border-0">
          <div className="size-11 shrink-0 animate-pulse rounded-md bg-ink-2" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-ink-2" />
            <div className="h-2.5 w-1/5 animate-pulse rounded bg-ink-2" />
          </div>
          <div className="hidden h-3 w-20 animate-pulse rounded bg-ink-2 md:block" />
        </div>
      ))}
    </div>
  );
}
