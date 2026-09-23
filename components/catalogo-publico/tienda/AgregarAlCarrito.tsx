"use client";

import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";
import { productoCarrito, useCarrito } from "@/components/catalogo-publico/tienda/TiendaContext";

/** "+" de las tarjetas (inicio, listado, búsqueda): agrega una unidad con el motor único del carrito. */
export function AgregarAlCarrito({ product }: { product: PublicCatalogProduct }) {
  const { dispatch } = useCarrito();
  const [agregado, setAgregado] = useState(0);

  useEffect(() => {
    if (!agregado) return;
    const t = window.setTimeout(() => setAgregado(0), 1100);
    return () => window.clearTimeout(t);
  }, [agregado]);

  if (!product.available) {
    return <span className="shrink-0 rounded-full bg-ink-2 px-2.5 py-1 text-[11px] font-medium text-mist">Agotado</span>;
  }

  return (
    <button
      type="button"
      onClick={() => {
        dispatch({ type: "add", product: productoCarrito(product) });
        setAgregado((n) => n + 1);
      }}
      aria-label={`Agregar ${product.name} a tu selección`}
      className={
        "relative flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm transition-[background-color,transform] duration-200 active:scale-90 " +
        (agregado ? "bg-[var(--tienda-oro-hover)]" : "bg-[var(--tienda-oro)] hover:bg-[var(--tienda-oro-hover)]")
      }
    >
      {agregado ? <Check key={agregado} className="tienda-bump size-5" strokeWidth={2.2} /> : <Plus className="size-5" strokeWidth={2} />}
      <span className="sr-only" aria-live="polite">
        {agregado ? `${product.name} agregado a tu selección` : ""}
      </span>
    </button>
  );
}
