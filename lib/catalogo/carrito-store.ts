/**
 * Store del carrito en el navegador: un store por catálogo + contexto de
 * precio, persistido en localStorage y compartido entre pestañas (evento
 * `storage`). Se consume con useSyncExternalStore: en el servidor (y durante
 * la hidratación) el carrito es vacío, así el HTML nunca difiere.
 * Toda la lógica vive en el reducer puro de ./carrito.
 */
import type { PriceContext } from "@/lib/catalogo/domain";
import { cartReducer, cartStorageKey, emptyCart, parseStoredCart, type CartAction, type CartState } from "@/lib/catalogo/carrito";

export interface CartStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): CartState;
  getServerSnapshot(): CartState;
  dispatch(action: CartAction): void;
}

const stores = new Map<string, CartStore>();

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // modo privado / almacenamiento bloqueado: carrito en memoria
  }
}

function writeStorage(key: string, state: CartState) {
  try {
    if (state.lines.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Sin almacenamiento el carrito sigue funcionando en memoria.
  }
}

export function getCartStore(slug: string, context: PriceContext): CartStore {
  const key = cartStorageKey(slug, context);
  const existing = stores.get(key);
  if (existing) return existing;

  const serverSnapshot = emptyCart(slug, context);
  let state: CartState | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const current = (): CartState => {
    if (state === null) state = typeof window === "undefined" ? serverSnapshot : parseStoredCart(readStorage(key), slug, context);
    return state;
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== key) return;
    state = parseStoredCart(event.newValue, slug, context);
    notify();
  };

  const store: CartStore = {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot: current,
    getServerSnapshot: () => serverSnapshot,
    dispatch(action) {
      const next = cartReducer(current(), action);
      if (next === state) return;
      state = next;
      writeStorage(key, next);
      notify();
    },
  };
  stores.set(key, store);
  return store;
}
