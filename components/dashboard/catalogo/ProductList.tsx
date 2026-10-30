"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { CatalogProduct } from "@/lib/catalogo/domain";
import { etiquetasDeLineas, lineasDeMaterial, type LineaConfig } from "@/lib/catalogo/lineas";
import { ProductImage, StatusBadge, cn, formatPrice } from "@/components/dashboard/catalogo/ui";

// Columnas compartidas por cabecera y filas (escritorio). En móvil cada fila se apila.
const COLS = "md:grid md:grid-cols-[44px_104px_minmax(0,1fr)_104px_104px_72px_96px_20px] md:items-center md:gap-4";

/**
 * Clasificación por líneas de la tienda (Plata, Rodio…) desde la propia lista: cada fila dice a qué línea pertenece su pieza y, para quien puede modificar el catálogo, la cambia ahí mismo sin abrir el
 * producto. Solo existe en negocios con líneas; sin esto la lista es exactamente la de siempre.
 */
export interface ClasificacionDeLista {
  lineas: readonly LineaConfig[];
  /** Quien puede modificar el catálogo asigna la línea desde la lista; los demás solo la ven. */
  puedeAsignar: boolean;
  /** Los productos que se están guardando, con la línea que se les eligió (su selector queda en pausa). */
  asignando: ReadonlyMap<string, string>;
  onAsignar: (producto: CatalogProduct, clave: string) => void;
}

/** Lista de ADMINISTRACIÓN (no vitrina): encontrar, revisar y abrir para editar. */
export function ProductList({ products, dimmed, clasificacion }: { products: CatalogProduct[]; dimmed?: boolean; clasificacion?: ClasificacionDeLista }) {
  const { t } = useI18n();
  const clasifica = clasificacion && clasificacion.lineas.length > 0 ? clasificacion : null;
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
        {products.map((p) =>
          clasifica ? (
            <FilaClasificable key={p.id} p={p} clasificacion={clasifica} />
          ) : (
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
          ),
        )}
      </ul>
    </div>
  );
}

/**
 * La misma fila, con la línea de la pieza. Como ahora lleva un selector, la fila ya no puede ser UN enlace (un control dentro de un enlace no es HTML válido ni accesible): el enlace cubre toda
 * la fila por detrás y el selector queda por encima.
 */
function FilaClasificable({ p, clasificacion }: { p: CatalogProduct; clasificacion: ClasificacionDeLista }) {
  const { t } = useI18n();
  return (
    <li className="group relative transition-colors hover:bg-ink-2">
      <div className={cn("flex items-center gap-3 px-4 py-3", COLS)}>
        <ProductImage src={p.primaryImage?.thumbUrl} alt="" className={cn("size-11 shrink-0 rounded-md", p.status === "INACTIVE" && "opacity-50 grayscale")} />
        <span className="hidden font-mono text-xs text-mist md:block">{p.reference}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{p.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mist">
            <span className="min-w-0 truncate">
              <span className="font-mono md:hidden">{p.reference} · </span>
              {p.categoryName ?? t("Sin categoría", "No category")}
            </span>
            <LineaDeLaFila p={p} clasificacion={clasificacion} />
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
      </div>
      <Link
        href={`/dashboard/catalogo/${p.id}`}
        aria-label={t(`Abrir ${p.name}`, `Open ${p.name}`)}
        className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime/50"
      />
    </li>
  );
}

/** La línea de la pieza: un selector para cambiarla ahí mismo, o solo su nombre (sin permiso de edición, o si está en varias líneas: eso se ajusta en el producto). */
function LineaDeLaFila({ p, clasificacion }: { p: CatalogProduct; clasificacion: ClasificacionDeLista }) {
  const { t } = useI18n();
  const { lineas, puedeAsignar, asignando, onAsignar } = clasificacion;
  const claves = lineasDeMaterial(p.material, lineas);
  const nombres = etiquetasDeLineas(p.material, lineas);
  const sinLinea = claves.length === 0;
  if (!puedeAsignar || claves.length > 1) {
    return (
      <span data-linea-pieza className={cn("rounded-full px-2 py-0.5 text-[11px]", sinLinea ? "bg-amber-400/10 text-amber-400" : "bg-ink-2 text-fg")}>
        {sinLinea ? t("Sin línea", "No line") : nombres.join(" · ")}
      </span>
    );
  }
  const guardando = asignando.get(p.id);
  const valor = guardando ?? claves[0] ?? "";
  return (
    <select
      aria-label={t(`Línea de ${p.name}`, `Line of ${p.name}`)}
      aria-busy={guardando !== undefined || undefined}
      value={valor}
      disabled={guardando !== undefined}
      onChange={(e) => {
        if (e.target.value) onAsignar(p, e.target.value);
      }}
      className={cn(
        "relative z-10 max-w-full rounded-md border bg-ink px-1.5 py-0.5 text-xs outline-none transition-colors focus-visible:border-lime/60 disabled:cursor-wait disabled:opacity-60",
        valor === "" ? "border-amber-400/50 text-amber-400" : "border-edge text-fg",
      )}
    >
      {valor === "" && <option value="">{t("Sin línea · elegir…", "No line · choose…")}</option>}
      {lineas.map((l) => (
        <option key={l.clave} value={l.clave}>
          {l.etiqueta}
        </option>
      ))}
    </select>
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
