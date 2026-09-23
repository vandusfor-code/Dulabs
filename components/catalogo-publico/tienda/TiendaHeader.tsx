"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, MessageCircle, Search, ShoppingBag, X } from "lucide-react";
import type { CatalogCategory } from "@/lib/catalogo/domain";
import { Dialogo } from "@/components/catalogo-publico/tienda/Dialogo";
import { useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";

function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

const iconBtn =
  "flex size-11 items-center justify-center rounded-full text-fg transition-[background-color,transform] duration-150 hover:bg-fg/5 active:scale-90";

/** Botón del carrito con contador: solo aparece cuando hay productos; "salta" al cambiar. */
export function BotonCarrito({ className }: { className?: string }) {
  const { abrirCarrito } = useTienda();
  const { items } = useCarrito();
  return (
    <button type="button" onClick={abrirCarrito} className={cn(iconBtn, "relative", className)} aria-label={items > 0 ? `Ver tu selección (${items} productos)` : "Ver tu selección"}>
      <ShoppingBag className="size-[22px]" strokeWidth={1.6} aria-hidden />
      {items > 0 && (
        <span
          key={items}
          aria-hidden
          className="tienda-bump absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--tienda-oro)] px-1 text-[10.5px] font-semibold tabular-nums text-white"
        >
          {items > 99 ? "99+" : items}
        </span>
      )}
    </button>
  );
}

export function TiendaHeader({
  marca,
  basePath,
  listPath,
  categorias,
}: {
  marca: { name: string; descriptor?: string };
  basePath: string;
  listPath: string;
  categorias: CatalogCategory[];
}) {
  const { whatsapp } = useTienda();
  const q = useSearchParams().get("q") ?? undefined;
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [buscando, setBuscando] = useState(Boolean(q));
  const inputRef = useRef<HTMLInputElement>(null);
  const digits = (whatsapp ?? "").replace(/\D/g, "");
  const cerrarMenu = () => setMenuAbierto(false);

  // Enfoca solo cuando el cliente abre la búsqueda (no al cargar un listado
  // con ?q=…, que abriría el teclado del celular sin pedirlo).
  const primerRender = useRef(true);
  useEffect(() => {
    if (!primerRender.current && buscando) inputRef.current?.focus({ preventScroll: true });
    primerRender.current = false;
  }, [buscando]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-edge/70 bg-ink/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto grid h-16 max-w-6xl grid-cols-[88px_minmax(0,1fr)_88px] items-center px-1 sm:px-4">
          <div className="flex items-center">
            <button type="button" onClick={() => setMenuAbierto(true)} className={iconBtn} aria-label="Abrir menú" aria-haspopup="dialog">
              <Menu className="size-[22px]" strokeWidth={1.6} aria-hidden />
            </button>
          </div>
          <Link href={basePath} className="flex min-w-0 flex-col items-center justify-center rounded-lg py-1 text-center leading-none" aria-label={`${marca.name}, inicio`}>
            <span className="font-serif-tienda max-w-full truncate text-[13px] font-semibold uppercase tracking-[0.02em] text-fg min-[360px]:text-[16px] min-[390px]:text-[17px] min-[420px]:text-lg sm:text-2xl sm:tracking-[0.08em]">
              {marca.name}
            </span>
            {marca.descriptor && <span className="mt-1 text-[9.5px] font-medium uppercase tracking-[0.42em] text-mist">{marca.descriptor}</span>}
          </Link>
          <div className="flex items-center justify-end">
            <button type="button" onClick={() => setBuscando((v) => !v)} className={iconBtn} aria-label={buscando ? "Cerrar búsqueda" : "Buscar"} aria-expanded={buscando} aria-controls="tienda-busqueda">
              <Search className="size-[21px]" strokeWidth={1.6} aria-hidden />
            </button>
            <BotonCarrito />
          </div>
        </div>
        {buscando && (
          <form id="tienda-busqueda" action={basePath} method="get" role="search" className="tienda-velo mx-auto max-w-6xl px-4 pb-3">
            <label className="relative block">
              <span className="sr-only">Buscar productos por nombre o referencia</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-mist" aria-hidden />
              <input
                key={q ?? ""}
                ref={inputRef}
                type="search"
                name="q"
                defaultValue={q}
                enterKeyHint="search"
                autoComplete="off"
                placeholder="Busca por nombre o referencia"
                className="h-12 w-full rounded-full border border-edge bg-card pl-11 pr-4 text-base text-fg outline-none transition-colors placeholder:text-mist/80 focus:border-[var(--tienda-oro)] sm:text-[15px]"
              />
            </label>
          </form>
        )}
      </header>

      <Dialogo
        open={menuAbierto}
        onClose={cerrarMenu}
        label="Menú"
        className="tienda-velo fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-none w-[82%] max-w-sm bg-ink p-0 text-fg shadow-2xl backdrop:bg-fg/35 backdrop:backdrop-blur-[2px]"
      >
        <nav aria-label="Menú de la tienda" className="flex h-full flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
          <div className="flex h-16 items-center justify-between border-b border-edge px-3">
            <span className="font-serif-tienda pl-2 text-xl font-medium text-fg">{marca.name}</span>
            <button type="button" onClick={cerrarMenu} className={iconBtn} aria-label="Cerrar menú">
              <X className="size-5" strokeWidth={1.6} aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <Link href={basePath} onClick={cerrarMenu} className="flex h-12 items-center rounded-xl px-3 text-[15px] font-medium text-fg hover:bg-fg/5">
              Inicio
            </Link>
            <Link href={listPath} onClick={cerrarMenu} className="flex h-12 items-center rounded-xl px-3 text-[15px] font-medium text-fg hover:bg-fg/5">
              Todo el catálogo
            </Link>
            {categorias.length > 0 && (
              <>
                <p className="mt-5 px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-mist">Categorías</p>
                {categorias.map((c) => (
                  <Link
                    key={c.id}
                    href={`${basePath}?categoria=${encodeURIComponent(c.id)}`}
                    onClick={cerrarMenu}
                    className="flex h-12 items-center rounded-xl px-3 text-[15px] text-fg hover:bg-fg/5"
                  >
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
              className="m-3 flex h-12 items-center justify-center gap-2 rounded-full border border-edge text-sm font-medium text-fg hover:bg-fg/5"
            >
              <MessageCircle className="size-4" strokeWidth={1.8} aria-hidden />
              Escríbenos por WhatsApp
            </a>
          )}
        </nav>
      </Dialogo>
    </>
  );
}
