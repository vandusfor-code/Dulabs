"use client";

/**
 * Compra en la ficha: cantidad + "Agregar" con el motor único del carrito.
 * La cantidad nunca supera lo pedible (máximo del backend menos lo que ya está
 * en la selección). En móvil queda fija abajo (con safe-area); en escritorio,
 * dentro de la ficha. Agotado => no se agrega.
 */
import { useEffect, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { formatCop } from "@/lib/business-agent-quote";
import { quantityLimit } from "@/lib/catalogo/carrito";
import type { PublicProductDetail } from "@/lib/catalogo/publicacion";
import { productoCarrito, useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";

const stepBtn =
  "flex size-12 items-center justify-center rounded-full text-fg transition-[background-color,transform] duration-150 hover:bg-fg/5 active:scale-90 disabled:opacity-30";

export function AccionesProducto({ product }: { product: PublicProductDetail }) {
  const { state, dispatch } = useCarrito();
  const { abrirCarrito, avisarAgregado } = useTienda();
  const [cantidad, setCantidad] = useState(1);
  const [agregado, setAgregado] = useState(0);
  const [topeAvisado, setTopeAvisado] = useState(false);

  const item = productoCarrito(product);
  const enSeleccion = state.lines.find((l) => l.reference === product.reference)?.quantity ?? 0;
  const restantes = Math.max(0, quantityLimit(item) - enSeleccion);
  const cantidadValida = Math.min(cantidad, Math.max(1, restantes));

  useEffect(() => {
    if (!agregado) return;
    const t = window.setTimeout(() => setAgregado(0), 2200);
    return () => window.clearTimeout(t);
  }, [agregado]);

  const barra =
    "fixed inset-x-0 bottom-0 z-40 border-t border-edge/80 bg-ink/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-md md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none";

  if (!product.available) {
    return (
      <div className={barra}>
        <p className="mx-auto max-w-6xl rounded-full bg-ink-2 py-3.5 text-center text-sm font-medium text-mist">Agotado por ahora</p>
      </div>
    );
  }

  if (restantes === 0 && !agregado) {
    return (
      <div className={barra}>
        <div className="mx-auto flex max-w-6xl flex-col gap-2 md:items-start">
          <p className="text-center text-[13px] text-mist md:text-left">Ya tienes en tu selección todas las unidades disponibles.</p>
          <button
            type="button"
            onClick={abrirCarrito}
            className="flex h-12 w-full items-center justify-center rounded-full border border-[var(--tienda-oro)] px-6 text-[15px] font-semibold text-[var(--tienda-oro)] transition-transform active:scale-[0.98] md:w-auto"
          >
            Ver tu selección
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={barra}>
      {topeAvisado && product.maxQuantity !== null && (
        <p className="mx-auto mb-2 max-w-6xl text-center text-[13px] font-medium text-[var(--tienda-oro)] md:text-left" role="status">
          {product.maxQuantity === 1 ? "Solo queda 1 unidad disponible." : `Solo quedan ${product.maxQuantity} unidades disponibles.`}
        </p>
      )}
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <div className="flex shrink-0 items-center rounded-full border border-edge bg-card" role="group" aria-label="Cantidad">
          <button
            type="button"
            className={stepBtn}
            disabled={cantidadValida <= 1}
            onClick={() => {
              setTopeAvisado(false);
              setCantidad(Math.max(1, cantidadValida - 1));
            }}
            aria-label="Una unidad menos"
          >
            <Minus className="size-4" strokeWidth={1.8} aria-hidden />
          </button>
          <output className="w-7 text-center text-[15px] font-semibold tabular-nums text-fg" aria-live="polite">
            {cantidadValida}
          </output>
          <button
            type="button"
            className={stepBtn}
            aria-disabled={cantidadValida >= restantes}
            onClick={() => {
              if (cantidadValida >= restantes) setTopeAvisado(true);
              else setCantidad(cantidadValida + 1);
            }}
            aria-label="Una unidad más"
          >
            <Plus className={"size-4" + (cantidadValida >= restantes ? " opacity-30" : "")} strokeWidth={1.8} aria-hidden />
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
              dispatch({ type: "add", product: item, quantity: cantidadValida });
              setAgregado((n) => n + 1);
              avisarAgregado(product.name);
              setCantidad(1);
              setTopeAvisado(false);
            }}
            className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--tienda-oro)] px-4 text-[15px] font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-[var(--tienda-oro-hover)] active:scale-[0.98]"
          >
            <span className="truncate">Agregar{product.price !== null ? ` · ${formatCop(product.price * cantidadValida)}` : ""}</span>
          </button>
        )}
        <span className="sr-only" aria-live="polite">
          {agregado ? `${product.name} agregado a tu selección` : ""}
        </span>
      </div>
    </div>
  );
}
