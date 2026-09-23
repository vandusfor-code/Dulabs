"use client";

import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { canAddMore } from "@/lib/catalogo/carrito";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";
import { productoCarrito, useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";

/**
 * "+" de las tarjetas (inicio, listado, búsqueda): agrega una unidad con el
 * motor único del carrito. Agotado => no se puede agregar. Con el stock
 * completo ya en la selección => lo dice, en vez de sumar una unidad imposible.
 */
export function AgregarAlCarrito({ product }: { product: PublicCatalogProduct }) {
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
        "relative flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm transition-[background-color,transform,opacity] duration-200 active:scale-90 disabled:cursor-not-allowed disabled:bg-[var(--tienda-oro)] disabled:opacity-40 disabled:active:scale-100 " +
        (agregado ? "bg-[var(--tienda-oro-hover)]" : "bg-[var(--tienda-oro)] hover:bg-[var(--tienda-oro-hover)]")
      }
    >
      {agregado || !puede ? <Check key={agregado} className={agregado ? "tienda-bump size-5" : "size-5"} strokeWidth={2.2} /> : <Plus className="size-5" strokeWidth={2} />}
      <span className="sr-only" aria-live="polite">
        {agregado ? `${product.name} agregado a tu selección` : ""}
      </span>
    </button>
  );
}
