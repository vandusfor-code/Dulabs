"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, MessageCircle, Search, ShoppingBag, X } from "lucide-react";
import type { CatalogCategory } from "@/lib/catalogo/domain";
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
      <ShoppingBag className="size-[22px]" strokeWidth={1.6} />
      {items > 0 && (
        <span
          key={items}
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
  q,
}: {
  marca: { nombre: string; descriptor?: string };
  basePath: string;
  listPath: string;
  categorias: CatalogCategory[];
  q?: string;
}) {
  const { whatsapp } = useTienda();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [buscando, setBuscando] = useState(Boolean(q));
  const inputRef = useRef<HTMLInputElement>(null);
  const digits = (whatsapp ?? "").replace(/\D/g, "");

  // Enfoca solo cuando el cliente abre la búsqueda (no al cargar un listado
  // con ?q=…, que abriría el teclado del celular sin pedirlo).
  const primerRender = useRef(true);
  useEffect(() => {
    if (!primerRender.current && buscando) inputRef.current?.focus({ preventScroll: true });
    primerRender.current = false;
  }, [buscando]);

  useEffect(() => {
    if (!menuAbierto) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuAbierto(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previo;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuAbierto]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-edge/70 bg-ink/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto grid h-16 max-w-6xl grid-cols-[88px_minmax(0,1fr)_88px] items-center px-1 sm:px-4">
          <div className="flex items-center">
            <button type="button" onClick={() => setMenuAbierto(true)} className={iconBtn} aria-label="Abrir menú" aria-expanded={menuAbierto}>
              <Menu className="size-[22px]" strokeWidth={1.6} />
            </button>
          </div>
          <Link href={basePath} className="flex min-w-0 flex-col items-center justify-center text-center leading-none" aria-label={`${marca.nombre}, inicio`}>
            <span className="font-serif-tienda max-w-full truncate text-[17px] font-semibold uppercase tracking-[0.06em] text-fg min-[400px]:text-lg sm:text-2xl sm:tracking-[0.08em]">{marca.nombre}</span>
            {marca.descriptor && <span className="mt-1 text-[9.5px] font-medium uppercase tracking-[0.42em] text-mist">{marca.descriptor}</span>}
          </Link>
          <div className="flex items-center justify-end">
            <button type="button" onClick={() => setBuscando((v) => !v)} className={iconBtn} aria-label="Buscar" aria-expanded={buscando}>
              <Search className="size-[21px]" strokeWidth={1.6} />
            </button>
            <BotonCarrito />
          </div>
        </div>
        {buscando && (
          <form action={basePath} method="get" role="search" className="tienda-velo mx-auto max-w-6xl px-4 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-mist" />
              <input
                ref={inputRef}
                type="search"
                name="q"
                defaultValue={q}
                enterKeyHint="search"
                placeholder="Busca por nombre o referencia"
                aria-label="Buscar productos"
                className="h-12 w-full rounded-full border border-edge bg-card pl-11 pr-4 text-[15px] text-fg outline-none transition-colors placeholder:text-mist/80 focus:border-[var(--tienda-oro)]"
              />
            </div>
          </form>
        )}
      </header>

      {menuAbierto && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" aria-label="Cerrar menú" onClick={() => setMenuAbierto(false)} className="tienda-velo absolute inset-0 bg-fg/35 backdrop-blur-[2px]" />
          <nav className="tienda-velo absolute inset-y-0 left-0 flex w-[82%] max-w-sm flex-col bg-ink pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-edge px-3">
              <span className="font-serif-tienda pl-2 text-xl font-medium text-fg">{marca.nombre}</span>
              <button type="button" onClick={() => setMenuAbierto(false)} className={iconBtn} aria-label="Cerrar menú">
                <X className="size-5" strokeWidth={1.6} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <Link href={basePath} onClick={() => setMenuAbierto(false)} className="flex h-12 items-center rounded-xl px-3 text-[15px] font-medium text-fg hover:bg-fg/5">
                Inicio
              </Link>
              <Link href={listPath} onClick={() => setMenuAbierto(false)} className="flex h-12 items-center rounded-xl px-3 text-[15px] font-medium text-fg hover:bg-fg/5">
                Todo el catálogo
              </Link>
              {categorias.length > 0 && (
                <>
                  <p className="mt-5 px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-mist">Categorías</p>
                  {categorias.map((c) => (
                    <Link
                      key={c.id}
                      href={`${basePath}?categoria=${encodeURIComponent(c.id)}`}
                      onClick={() => setMenuAbierto(false)}
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
                <MessageCircle className="size-4" strokeWidth={1.8} />
                Escríbenos por WhatsApp
              </a>
            )}
          </nav>
        </div>
      )}
    </>
  );
}
