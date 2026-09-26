"use client";

/**
 * Contexto de la tienda pública: el ÚNICO motor de carrito del catálogo (uno
 * por catálogo y contexto de precio) y el estado de la hoja "Tu selección".
 * Vive en el layout de la tienda: inicio, listado, búsqueda y ficha de
 * producto comparten el mismo carrito sin duplicar lógica.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { PriceContext } from "@/lib/catalogo/domain";
import { totalItems, type CartAction, type CartProduct, type CartState } from "@/lib/catalogo/carrito";
import { getCartStore, type CartStore } from "@/lib/catalogo/carrito-store";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";

interface TiendaValue {
  store: CartStore;
  basePath: string;
  whatsapp: string | null;
  /** Bloque 29: la referencia se muestra sobre las fotos (módulo "marca_referencia"). */
  marcaReferencia: boolean;
  carritoAbierto: boolean;
  abrirCarrito: () => void;
  cerrarCarrito: () => void;
  /** Microconfirmación "Agregado" (una sola, compartida por tarjetas y ficha). */
  avisarAgregado: (nombre: string) => void;
}

export const TiendaContext = createContext<TiendaValue | null>(null);

export function TiendaProvider({
  slug,
  context,
  basePath,
  whatsapp,
  marcaReferencia = false,
  children,
}: {
  slug: string;
  context: PriceContext;
  basePath: string;
  whatsapp: string | null;
  marcaReferencia?: boolean;
  children: ReactNode;
}) {
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  const [agregado, setAgregado] = useState<{ nombre: string; n: number } | null>(null);
  const avisarAgregado = useCallback((nombre: string) => setAgregado((a) => ({ nombre, n: (a?.n ?? 0) + 1 })), []);
  const value = useMemo<TiendaValue>(
    () => ({
      store: getCartStore(slug, context),
      basePath,
      whatsapp,
      marcaReferencia,
      carritoAbierto,
      abrirCarrito: () => {
        setAgregado(null);
        setCarritoAbierto(true);
      },
      cerrarCarrito: () => setCarritoAbierto(false),
      avisarAgregado,
    }),
    [slug, context, basePath, whatsapp, marcaReferencia, carritoAbierto, avisarAgregado],
  );
  return (
    <TiendaContext.Provider value={value}>
      {children}
      {agregado && !carritoAbierto && <AvisoAgregado key={agregado.n} nombre={agregado.nombre} onFin={() => setAgregado(null)} />}
    </TiendaContext.Provider>
  );
}

/**
 * "Agregado · Ver selección (3)": confirmación breve y accionable al agregar.
 * Sobre la navegación inferior en móvil; esquina inferior en escritorio.
 */
function AvisoAgregado({ nombre, onFin }: { nombre: string; onFin: () => void }) {
  const { abrirCarrito } = useTienda();
  const { items } = useCarrito();
  useEffect(() => {
    const t = window.setTimeout(onFin, 2600);
    return () => window.clearTimeout(t);
  }, [onFin]);
  return (
    <div
      role="status"
      aria-live="polite"
      className="tienda-aviso fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-sm items-center gap-3 rounded-full bg-fg py-2 pl-2 pr-2 text-ink shadow-xl md:inset-x-auto md:bottom-6 md:right-6"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--tienda-oro)] text-white">
        <Check className="size-4" strokeWidth={2.4} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13.5px]">
        <span className="font-semibold">Agregado</span> · {nombre}
      </span>
      <button type="button" onClick={abrirCarrito} className="shrink-0 rounded-full bg-ink/10 px-3.5 py-2 text-[13px] font-semibold transition-colors hover:bg-ink/20">
        Ver ({items})
      </button>
    </div>
  );
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
