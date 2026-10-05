"use client";

import { useEffect, useState } from "react";
import { Check, Plus, ShoppingCart } from "lucide-react";
import { canAddMore } from "@/lib/catalogo/carrito";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";
import { productoCarrito, useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";

/**
 * "+" de las tarjetas (inicio, listado, búsqueda): agrega una unidad con el
 * motor único del carrito. Agotado => no se puede agregar. Con el stock
 * completo ya en la selección => lo dice, en vez de sumar una unidad imposible.
 * `variante`: "clasico" (el "+" cuadrado de siempre) o "circular" (carrito azul del tema "tecnologia"). El motor del carrito es el mismo.
 */
export function AgregarAlCarrito({ product, variante = "clasico" }: { product: PublicCatalogProduct; variante?: "clasico" | "circular" }) {
  const circular = variante === "circular";
  const { state, dispatch } = useCarrito();
  const { avisarAgregado } = useTienda();
  const [agregado, setAgregado] = useState(0);
  const item = productoCarrito(product);
  const puede = canAddMore(state, item);

  useEffect(() => {
    if (!agregado) return;
    const t = window.setTimeout(() => setAgregado(0), 1100);
    return () => window.clearTimeout(t);
  }, [agregado]);

  if (!product.available) {
    return <span className="shrink-0 rounded-full bg-ink-2 px-2.5 py-1.5 text-[11px] font-medium text-mist">Agotado</span>;
  }

  return (
    <button
      type="button"
      disabled={!puede && !agregado}
      onClick={() => {
        if (!puede) return;
        dispatch({ type: "add", product: item });
        setAgregado((n) => n + 1);
        avisarAgregado(product.name);
      }}
      aria-label={puede ? `Agregar ${product.name} a tu selección` : `Ya tienes todas las unidades disponibles de ${product.name}`}
      title={puede ? undefined : "Ya tienes todas las unidades disponibles"}
      className={
        "relative flex size-11 shrink-0 items-center justify-center text-white shadow-sm transition-[background-color,transform,opacity] duration-200 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 " +
        (circular
          ? "rounded-full disabled:bg-[var(--tech-blue)] " + (agregado ? "bg-[var(--tienda-oro-hover)]" : "bg-[var(--tech-blue)] hover:bg-[var(--tech-blue-bright)]")
          : "rounded-xl disabled:bg-[var(--tienda-oro)] " + (agregado ? "bg-[var(--tienda-oro-hover)]" : "bg-[var(--tienda-oro)] hover:bg-[var(--tienda-oro-hover)]"))
      }
    >
      {agregado || !puede ? (
        <Check key={agregado} className={agregado ? "tienda-bump size-5" : "size-5"} strokeWidth={2.2} />
      ) : circular ? (
        <ShoppingCart className="size-5" strokeWidth={1.9} />
      ) : (
        <Plus className="size-5" strokeWidth={2} />
      )}
      <span className="sr-only" aria-live="polite">
        {agregado ? `${product.name} agregado a tu selección` : ""}
      </span>
    </button>
  );
}
