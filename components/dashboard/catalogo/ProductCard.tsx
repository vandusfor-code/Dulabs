"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import type { CatalogProduct } from "@/lib/catalogo/domain";
import { ProductImage, ReferenceTag, StatusBadge, cn, formatPrice } from "@/components/dashboard/catalogo/ui";

export function ProductCard({ product }: { product: CatalogProduct }) {
  const { t } = useI18n();
  const inactive = product.status === "INACTIVE";
  return (
    <Link
      href={`/dashboard/catalogo/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-edge bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-lime/40 hover:shadow-lg hover:shadow-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime/50"
    >
      <div className="relative">
        <ProductImage
          src={product.primaryImage?.thumbUrl}
          alt={product.name}
          className={cn("aspect-square w-full transition-[filter,opacity] duration-200", inactive && "opacity-60 grayscale")}
        />
        {inactive && (
          <div className="absolute left-2 top-2">
            <StatusBadge status={product.status} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <ReferenceTag reference={product.reference} />
        <p className="line-clamp-2 text-sm font-medium leading-snug text-fg">{product.name}</p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-mist">{t("Detal", "Retail")}</p>
            <p className="text-sm font-semibold tabular-nums text-fg">{formatPrice(product.pricing.retail)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-mist">{t("Mayor", "Wholesale")}</p>
            <p className="text-sm tabular-nums text-mist">{formatPrice(product.pricing.wholesale)}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}
