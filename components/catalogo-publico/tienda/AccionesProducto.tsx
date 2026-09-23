"use client";

/**
 * Compra en la ficha: cantidad + "Agregar a tu selección" con el motor único
 * del carrito. En móvil queda fija abajo (con safe-area); en escritorio,
 * dentro de la ficha. Si el backend dice que no está disponible, no se agrega.
 */
import { useEffect, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { formatCop } from "@/lib/business-agent-quote";
import { MAX_QUANTITY } from "@/lib/catalogo/carrito";
import type { PublicProductDetail } from "@/lib/catalogo/publicacion";
import { productoCarrito, useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";

const stepBtn =
  "flex size-12 items-center justify-center rounded-full text-fg transition-[background-color,transform] duration-150 hover:bg-fg/5 active:scale-90 disabled:opacity-30";

export function AccionesProducto({ product }: { product: PublicProductDetail }) {
  const { dispatch } = useCarrito();
  const { abrirCarrito } = useTienda();
  const [cantidad, setCantidad] = useState(1);
  const [agregado, setAgregado] = useState(0);

  useEffect(() => {
    if (!agregado) return;
    const t = window.setTimeout(() => setAgregado(0), 2200);
    return () => window.clearTimeout(t);
  }, [agregado]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-edge/80 bg-ink/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-md md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
      {product.available ? (
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="flex shrink-0 items-center rounded-full border border-edge bg-card" role="group" aria-label="Cantidad">
            <button type="button" className={stepBtn} disabled={cantidad <= 1} onClick={() => setCantidad((c) => Math.max(1, c - 1))} aria-label="Una unidad menos">
              <Minus className="size-4" strokeWidth={1.8} aria-hidden />
            </button>
            <output className="w-7 text-center text-[15px] font-semibold tabular-nums text-fg" aria-live="polite">
              {cantidad}
            </output>
            <button type="button" className={stepBtn} disabled={cantidad >= MAX_QUANTITY} onClick={() => setCantidad((c) => Math.min(MAX_QUANTITY, c + 1))} aria-label="Una unidad más">
              <Plus className="size-4" strokeWidth={1.8} aria-hidden />
            </button>
          </div>
          {agregado ? (
            <button
              type="button"
              onClick={abrirCarrito}
              className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full border border-[var(--tienda-oro)] px-4 text-[15px] font-semibold text-[var(--tienda-oro)] transition-transform active:scale-[0.98]"
            >
              <Check key={agregado} className="tienda-bump size-5 shrink-0" strokeWidth={2.2} aria-hidden />
              <span className="truncate">Agregado · Ver selección</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "add", product: productoCarrito(product), quantity: cantidad });
                setAgregado((n) => n + 1);
                setCantidad(1);
              }}
              className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--tienda-oro)] px-4 text-[15px] font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-[var(--tienda-oro-hover)] active:scale-[0.98]"
            >
              <span className="truncate">Agregar{product.price !== null ? ` · ${formatCop(product.price * cantidad)}` : ""}</span>
            </button>
          )}
          <span className="sr-only" aria-live="polite">
            {agregado ? `${product.name} agregado a tu selección` : ""}
          </span>
        </div>
      ) : (
        <p className="mx-auto max-w-6xl rounded-full bg-ink-2 py-3.5 text-center text-sm font-medium text-mist">Agotado por ahora</p>
      )}
    </div>
  );
}
