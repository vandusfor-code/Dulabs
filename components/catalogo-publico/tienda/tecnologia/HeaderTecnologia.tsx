"use client";

/**
 * Header del tema "tecnologia" (solo en el INICIO de la tienda; el resto de pantallas conserva por ahora el header de siempre): barra navy compacta con el
 * menú, el nombre de la marca en dos líneas, la búsqueda y el carrito con su contador REAL, más el buscador (una búsqueda real del catálogo: "?q=") y el
 * relleno navy sobre el que se apoya el hero. La barra se queda fija al desplazarse; el buscador se va con el contenido.
 */
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { LayoutGrid, Menu, MessageCircle, Search, ShoppingCart, X } from "lucide-react";
import type { CatalogCategory } from "@/lib/catalogo/domain";
import { Dialogo } from "@/components/catalogo-publico/tienda/Dialogo";
import { useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";
import { partirMarca } from "@/lib/catalogo/vitrina";

const iconBtn = "relative flex size-11 items-center justify-center rounded-full text-white transition-[background-color,transform] duration-150 hover:bg-white/10 active:scale-90";

/** El inicio de la tienda: la ruta raíz sin búsqueda, categoría, página ni "ver todo". */
export function useEnInicio(basePath: string): boolean {
  const pathname = usePathname();
  const params = useSearchParams();
  return pathname === basePath && !params.get("q") && !params.get("categoria") && !params.get("pagina") && !params.get("todo");
}

/** Lo que se ve mientras el marco carga: el mismo bloque navy (sin salto de color). */
export function HeaderTecnologiaEsqueleto() {
  return <div className="h-[241px] bg-[var(--tech-navy)]" aria-hidden />;
}

export function HeaderTecnologia({
  marca,
  basePath,
  listPath,
  categoriasHref,
  categorias,
  placeholder,
}: {
  marca: { name: string };
  basePath: string;
  listPath: string;
  categoriasHref: string;
  categorias: CatalogCategory[];
  placeholder: string;
}) {
  const enInicio = useEnInicio(basePath);
  const { whatsapp, abrirCarrito } = useTienda();
  const { items } = useCarrito();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const buscador = useRef<HTMLInputElement>(null);
  if (!enInicio) return null;
  const [linea1, linea2] = partirMarca(marca.name);
  const digits = (whatsapp ?? "").replace(/\D/g, "");
  const cerrarMenu = () => setMenuAbierto(false);

  return (
    <>
      <header className="tech-oscuro sticky top-0 z-30 bg-[var(--tech-navy)] pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto grid h-[64px] max-w-6xl grid-cols-[96px_minmax(0,1fr)_96px] items-center px-1.5 sm:px-4">
          <div className="flex items-center">
            <button type="button" onClick={() => setMenuAbierto(true)} className={iconBtn} aria-label="Abrir menú" aria-haspopup="dialog">
              <Menu className="size-[26px]" strokeWidth={1.8} aria-hidden />
            </button>
          </div>
          <Link href={basePath} className="flex min-w-0 flex-col items-center justify-center rounded-lg py-1 text-center leading-[1.02]" aria-label={`${marca.name}, inicio`}>
            <span className="max-w-full truncate text-[17px] font-extrabold tracking-[-0.01em] text-white min-[360px]:text-[19px]">{linea1}</span>
            {linea2 && <span className="max-w-full truncate text-[17px] font-extrabold tracking-[-0.01em] text-[var(--tech-blue-bright)] min-[360px]:text-[19px]">{linea2}</span>}
          </Link>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
                buscador.current?.focus({ preventScroll: true });
              }}
              className={iconBtn}
              aria-label="Buscar productos"
            >
              <Search className="size-[23px]" strokeWidth={1.8} aria-hidden />
            </button>
            <button type="button" onClick={abrirCarrito} className={iconBtn} aria-label={items > 0 ? `Ver tu selección (${items} productos)` : "Ver tu selección"}>
              <ShoppingCart className="size-[24px]" strokeWidth={1.8} aria-hidden />
              {items > 0 && (
                <span
                  key={items}
                  aria-hidden
                  className="tienda-bump absolute right-0.5 top-0.5 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[var(--tech-blue)] px-1 text-[11px] font-bold tabular-nums text-white ring-2 ring-[var(--tech-navy)]"
                >
                  {items > 99 ? "99+" : items}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="tech-oscuro bg-[var(--tech-navy)] px-4 pb-4 pt-1 text-white">
        <form action={basePath} method="get" role="search" className="relative mx-auto max-w-6xl">
          <label className="relative block">
            <span className="sr-only">Buscar productos por nombre o referencia</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 size-[19px] -translate-y-1/2 text-white/65" strokeWidth={1.8} aria-hidden />
            <input
              ref={buscador}
              type="search"
              name="q"
              enterKeyHint="search"
              autoComplete="off"
              placeholder={placeholder}
              className="h-[52px] w-full rounded-[26px] border border-white/15 bg-white/[0.07] pl-12 pr-14 text-base text-white outline-none transition-colors placeholder:text-white/60 focus:border-[var(--tech-blue-bright)] focus:bg-white/10 sm:text-[15px]"
            />
          </label>
          <Link href={categoriasHref} aria-label="Ver categorías" className="absolute right-1.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white">
            <LayoutGrid className="size-[22px]" strokeWidth={1.7} aria-hidden />
          </Link>
        </form>
      </div>
      {/* Relleno navy bajo el buscador: el hero (que sube sobre él) deja ver el navy en su mitad superior, como en el diseño. */}
      <div className="h-[108px] bg-[var(--tech-navy)]" aria-hidden />

      <Dialogo
        open={menuAbierto}
        onClose={cerrarMenu}
        label="Menú"
        className="tienda-velo fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-none w-[82%] max-w-sm bg-ink p-0 text-fg shadow-2xl backdrop:bg-fg/35 backdrop:backdrop-blur-[2px]"
      >
        <nav aria-label="Menú de la tienda" className="flex h-full flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
          <div className="tech-oscuro flex h-16 items-center justify-between bg-[var(--tech-navy)] px-3 text-white">
            <span className="pl-2 text-[17px] font-extrabold leading-[1.02] tracking-[-0.01em]">
              {linea1}
              <br />
              <span className="text-[var(--tech-blue-bright)]">{linea2}</span>
            </span>
            <button type="button" onClick={cerrarMenu} className={iconBtn} aria-label="Cerrar menú">
              <X className="size-5" strokeWidth={1.8} aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <Link href={basePath} onClick={cerrarMenu} className="flex h-12 items-center rounded-xl px-3 text-[15px] font-semibold text-fg hover:bg-fg/5">
              Inicio
            </Link>
            <Link href={listPath} onClick={cerrarMenu} className="flex h-12 items-center rounded-xl px-3 text-[15px] font-semibold text-fg hover:bg-fg/5">
              Todo el catálogo
            </Link>
            {categorias.length > 0 && (
              <>
                <p className="mt-5 px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-mist">Categorías</p>
                {categorias.map((c) => (
                  <Link key={c.id} href={`${basePath}?categoria=${encodeURIComponent(c.id)}`} onClick={cerrarMenu} className="flex h-12 items-center rounded-xl px-3 text-[15px] text-fg hover:bg-fg/5">
                    {c.name}
                  </Link>
                ))}
              </>
            )}
          </div>
          {digits.length >= 8 && (
            <a
              href={`https://wa.me/${digits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="m-3 flex h-12 items-center justify-center gap-2 rounded-[14px] border border-edge text-sm font-semibold text-fg hover:bg-fg/5"
            >
              <MessageCircle className="size-4" strokeWidth={1.9} aria-hidden />
              Escríbenos por WhatsApp
            </a>
          )}
        </nav>
      </Dialogo>
    </>
  );
}
