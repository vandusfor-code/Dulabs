"use client";

import Link from "next/link";
import { Home, LayoutGrid, ShoppingBag } from "lucide-react";
import { useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";

function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

const item = "flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-[color,transform] duration-150 active:scale-95";

/** Navegación inferior móvil: solo destinos reales (Inicio, Categorías, Carrito). Oculta en escritorio. */
export function NavInferior({ vista, basePath, categoriasHref }: { vista: "inicio" | "listado"; basePath: string; categoriasHref: string }) {
  const { abrirCarrito } = useTienda();
  const { items } = useCarrito();
  return (
    <nav
      aria-label="Navegación de la tienda"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-edge/80 bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <div className="mx-auto flex max-w-md px-2">
        <Link href={basePath} className={cn(item, vista === "inicio" ? "text-[var(--tienda-oro)]" : "text-mist")} aria-current={vista === "inicio" ? "page" : undefined}>
          <Home className="size-[22px]" strokeWidth={vista === "inicio" ? 2 : 1.6} />
          Inicio
        </Link>
        <Link href={categoriasHref} className={cn(item, vista === "listado" ? "text-[var(--tienda-oro)]" : "text-mist")} aria-current={vista === "listado" ? "page" : undefined}>
          <LayoutGrid className="size-[22px]" strokeWidth={vista === "listado" ? 2 : 1.6} />
          Categorías
        </Link>
        <button type="button" onClick={abrirCarrito} className={cn(item, "relative text-mist")} aria-label={items > 0 ? `Carrito (${items} productos)` : "Carrito"}>
          <span className="relative">
            <ShoppingBag className="size-[22px]" strokeWidth={1.6} />
            {items > 0 && (
              <span
                key={items}
                className="tienda-bump absolute -right-2.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--tienda-oro)] px-1 text-[10px] font-semibold tabular-nums text-white"
              >
                {items > 99 ? "99+" : items}
              </span>
            )}
          </span>
          Carrito
        </button>
      </div>
    </nav>
  );
}
