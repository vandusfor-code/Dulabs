"use client";

/**
 * Contexto de la tienda pública: el carrito del catálogo (uno por catálogo y
 * contexto de precio) y el estado de la hoja "Tu selección". El carrito vive
 * en un store externo (lib/catalogo/carrito-store) para que cualquier parte
 * de la página (header, tarjetas, navegación inferior) lo comparta.
 */
import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PriceContext } from "@/lib/catalogo/domain";
import { totalItems, type CartAction, type CartState } from "@/lib/catalogo/carrito";
import { getCartStore, type CartStore } from "@/lib/catalogo/carrito-store";

interface TiendaValue {
  store: CartStore;
  whatsapp: string | null;
  carritoAbierto: boolean;
  abrirCarrito: () => void;
  cerrarCarrito: () => void;
}

const TiendaContext = createContext<TiendaValue | null>(null);

export function TiendaProvider({ slug, context, whatsapp, children }: { slug: string; context: PriceContext; whatsapp: string | null; children: ReactNode }) {
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  const value = useMemo<TiendaValue>(
    () => ({
      store: getCartStore(slug, context),
      whatsapp,
      carritoAbierto,
      abrirCarrito: () => setCarritoAbierto(true),
      cerrarCarrito: () => setCarritoAbierto(false),
    }),
    [slug, context, whatsapp, carritoAbierto],
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
