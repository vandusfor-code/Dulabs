"use client";

import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";
import { useCarrito } from "@/components/catalogo-publico/tienda/TiendaContext";

/** "+" de la tarjeta: agrega la pieza con los datos reales del catálogo y confirma con un check breve. */
export function AgregarAlCarrito({ product }: { product: PublicCatalogProduct }) {
  const { dispatch } = useCarrito();
  const [agregado, setAgregado] = useState(0);

  useEffect(() => {
    if (!agregado) return;
    const t = window.setTimeout(() => setAgregado(0), 1100);
    return () => window.clearTimeout(t);
  }, [agregado]);

  return (
    <button
      type="button"
      onClick={() => {
        dispatch({ type: "add", product: { reference: product.reference, name: product.name, price: product.price, imageUrl: product.thumbUrl ?? product.imageUrl } });
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
        {agregado ? `${product.name} agregado` : ""}
      </span>
    </button>
  );
}
