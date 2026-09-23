"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Home, LayoutGrid, ShoppingBag } from "lucide-react";
import { useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";

function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

const item = "flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-[color,transform] duration-150 active:scale-95";

/**
 * Navegación inferior móvil: solo destinos reales (Inicio, Categorías,
 * Carrito). Oculta en escritorio y en la ficha de producto (que tiene su
 * propia barra de compra).
 */
export function NavInferior({ basePath, categoriasHref }: { basePath: string; categoriasHref: string }) {
  const { abrirCarrito } = useTienda();
  const { items } = useCarrito();
  const pathname = usePathname();
  const params = useSearchParams();
  if (pathname.startsWith(`${basePath}/productos/`)) return null;

  const enInicio = pathname === basePath && !params.get("q") && !params.get("categoria") && !params.get("pagina") && !params.get("todo");
  return (
    <nav
      aria-label="Navegación de la tienda"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-edge/80 bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <div className="mx-auto flex max-w-md px-2">
        <Link href={basePath} className={cn(item, enInicio ? "text-[var(--tienda-oro)]" : "text-mist")} aria-current={enInicio ? "page" : undefined}>
          <Home className="size-[22px]" strokeWidth={enInicio ? 2 : 1.6} aria-hidden />
          Inicio
        </Link>
        <Link href={categoriasHref} className={cn(item, !enInicio ? "text-[var(--tienda-oro)]" : "text-mist")} aria-current={!enInicio ? "page" : undefined}>
          <LayoutGrid className="size-[22px]" strokeWidth={!enInicio ? 2 : 1.6} aria-hidden />
          Categorías
        </Link>
        <button type="button" onClick={abrirCarrito} className={cn(item, "relative text-mist")} aria-label={items > 0 ? `Carrito (${items} productos)` : "Carrito"}>
          <span className="relative">
            <ShoppingBag className="size-[22px]" strokeWidth={1.6} aria-hidden />
            {items > 0 && (
              <span
                key={items}
                aria-hidden
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
