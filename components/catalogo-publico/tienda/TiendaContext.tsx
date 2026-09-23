"use client";

/**
 * Contexto de la tienda pública: el ÚNICO motor de carrito del catálogo (uno
 * por catálogo y contexto de precio) y el estado de la hoja "Tu selección".
 * Vive en el layout de la tienda: inicio, listado, búsqueda y ficha de
 * producto comparten el mismo carrito sin duplicar lógica.
 */
import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PriceContext } from "@/lib/catalogo/domain";
import { totalItems, type CartAction, type CartProduct, type CartState } from "@/lib/catalogo/carrito";
import { getCartStore, type CartStore } from "@/lib/catalogo/carrito-store";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";

interface TiendaValue {
  store: CartStore;
  basePath: string;
  whatsapp: string | null;
  carritoAbierto: boolean;
  abrirCarrito: () => void;
  cerrarCarrito: () => void;
}

const TiendaContext = createContext<TiendaValue | null>(null);

export function TiendaProvider({
  slug,
  context,
  basePath,
  whatsapp,
  children,
}: {
  slug: string;
  context: PriceContext;
  basePath: string;
  whatsapp: string | null;
  children: ReactNode;
}) {
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  const value = useMemo<TiendaValue>(
    () => ({
      store: getCartStore(slug, context),
      basePath,
      whatsapp,
      carritoAbierto,
      abrirCarrito: () => setCarritoAbierto(true),
      cerrarCarrito: () => setCarritoAbierto(false),
    }),
    [slug, context, basePath, whatsapp, carritoAbierto],
  );
  return <TiendaContext.Provider value={value}>{children}</TiendaContext.Provider>;
}

export function useTienda(): TiendaValue {
  const value = useContext(TiendaContext);
  if (!value) throw new Error("useTienda debe usarse dentro de <TiendaProvider>");
  return value;
}

export function useCarrito(): { state: CartState; items: number; dispatch: (action: CartAction) => void } {
  const { store } = useTienda();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return { state, items: totalItems(state), dispatch: store.dispatch };
}

/** Único mapeo producto público -> carrito (nunca datos escritos a mano). */
export function productoCarrito(product: PublicCatalogProduct): CartProduct {
  return {
    reference: product.reference,
    name: product.name,
    price: product.price,
    imageUrl: product.thumbUrl ?? product.imageUrl,
    available: product.available,
    maxQuantity: product.maxQuantity,
  };
}
