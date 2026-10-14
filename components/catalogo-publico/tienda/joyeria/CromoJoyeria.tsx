"use client";

/**
 * Cromo superior del tema "joyeria": barra de anuncios + cabecera, fijos arriba. Solo presentación: los destinos, el buscador (un formulario GET a «?q=»), el menú, las categorías y el
 * carrito son los de siempre (mismos enlaces, mismo motor de carrito).
 *
 * Estados (data-estado): "hero" = transparente sobre la portada a pantalla completa (texto claro, velo degradado para que se lea); "vidrio" = crema translúcida con desenfoque. Pasa a
 * vidrio cuando el contenido (la «cortina») sube hasta la cabecera; en las demás pantallas siempre es vidrio. Si la página no tiene portada, el CSS lo dibuja como vidrio.
 * Anuncios: rotan cada 5 s con fundido (se pausan al pasar el mouse o enfocar, y con «movimiento reducido» no rotan solos; las flechas siempre funcionan).
 */
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Menu, MessageCircle, Search, ShoppingBag, X } from "lucide-react";
import type { CatalogCategory } from "@/lib/catalogo/domain";
import { Dialogo } from "@/components/catalogo-publico/tienda/Dialogo";
import { useCarrito, useTienda } from "@/components/catalogo-publico/tienda/TiendaContext";
import { useMovimientoReducido } from "@/components/catalogo-publico/tienda/joyeria/medios";
import { esListadoDeUrl } from "@/lib/catalogo/inicio";
import type { AnuncioVisible } from "@/lib/catalogo/joyeria";

/** De un mensaje al siguiente pasan 5 s (medido en la referencia): el fundido de salida (0,28 s) va dentro de ese tiempo. */
const CICLO_MS = 5000;
const FUNDIDO_MS = 280;

function cn(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

function BotonCarritoJoyeria() {
  const { abrirCarrito } = useTienda();
  const { items } = useCarrito();
  return (
    <button type="button" onClick={abrirCarrito} className="joy-icono relative size-11" aria-label={items > 0 ? `Ver tu selección (${items} productos)` : "Ver tu selección"}>
      <ShoppingBag className="size-[22px]" strokeWidth={1.5} aria-hidden />
      {items > 0 && (
        <span
          key={items}
          aria-hidden
          className="tienda-bump absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--tienda-oro)] px-1 text-[10.5px] font-semibold tabular-nums text-white"
        >
          {items > 99 ? "99+" : items}
        </span>
      )}
    </button>
  );
}

/** Barra de anuncios: un mensaje a la vez, con flechas. Nunca aparece sin al menos un mensaje. */
function BarraAnuncios({ anuncios }: { anuncios: AnuncioVisible[] }) {
  const reducido = useMovimientoReducido();
  const [indice, setIndice] = useState(0);
  const [visible, setVisible] = useState(true);
  const [pausa, setPausa] = useState(false);
  const [manual, setManual] = useState(false);
  const temporizador = useRef<number | undefined>(undefined);
  const total = anuncios.length;

  const cambiar = useCallback(
    (delta: number) => {
      if (total < 2) return;
      window.clearTimeout(temporizador.current);
      setVisible(false);
      temporizador.current = window.setTimeout(
        () => {
          setIndice((i) => (i + delta + total) % total);
          setVisible(true);
        },
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : FUNDIDO_MS,
      );
    },
    [total],
  );

  useEffect(() => () => window.clearTimeout(temporizador.current), []);

  useEffect(() => {
    if (total < 2 || pausa || reducido) return;
    const id = window.setInterval(() => cambiar(1), CICLO_MS - FUNDIDO_MS);
    return () => window.clearInterval(id);
  }, [total, pausa, reducido, cambiar, indice]);

  const actual = anuncios[Math.min(indice, total - 1)];
  const flecha = "joy-icono absolute top-1/2 size-7 -translate-y-1/2 sm:size-8";
  return (
    <div
      className="joy-anuncios"
      role="region"
      aria-label="Anuncios de la tienda"
      onMouseEnter={() => setPausa(true)}
      onMouseLeave={() => setPausa(false)}
      onFocus={() => setPausa(true)}
      onBlur={() => setPausa(false)}
    >
      <div className="relative mx-auto flex h-10 max-w-7xl items-center justify-center px-10 sm:h-11 sm:px-14">
        {total > 1 && (
          <button
            type="button"
            aria-label="Anuncio anterior"
            onClick={() => {
              setManual(true);
              cambiar(-1);
            }}
            className={cn(flecha, "left-0 sm:left-3")}
          >
            <ChevronLeft className="size-4" strokeWidth={1.6} aria-hidden />
          </button>
        )}
        <div className="min-w-0 flex-1 text-center" aria-live={manual ? "polite" : "off"} aria-atomic="true">
          <p className={cn("joy-anuncio-texto joy-tinta truncate text-[10px] font-light uppercase leading-relaxed tracking-[0.06em] sm:text-[11px] sm:tracking-[0.12em]", !visible && "joy-anuncio-oculto")}>
            {actual.href ? (
              <a href={actual.href} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                {actual.texto}
              </a>
            ) : (
              actual.texto
            )}
          </p>
        </div>
        {total > 1 && (
          <button
            type="button"
            aria-label="Siguiente anuncio"
            onClick={() => {
              setManual(true);
              cambiar(1);
            }}
            className={cn(flecha, "right-0 sm:right-3")}
          >
            <ChevronRight className="size-4" strokeWidth={1.6} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

export function CromoJoyeria({
  marca,
  basePath,
  listPath,
  categorias,
  categoriasHref,
  anuncios,
  mayorista,
}: {
  marca: { name: string; descriptor?: string };
  basePath: string;
  listPath: string;
  categorias: CatalogCategory[];
  categoriasHref: string;
  anuncios: AnuncioVisible[];
  /** Hay bloque de mayoristas en el inicio (el acceso «Mayorista» lleva a él). */
  mayorista: boolean;
}) {
  const { whatsapp } = useTienda();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? undefined;
  const hayFiltros = esListadoDeUrl(params);
  const enRaiz = pathname === basePath;
  const esInicio = enRaiz && !hayFiltros;
  const esListado = enRaiz && hayFiltros;
  const cromo = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const [pasado, setPasado] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [categoriasAbiertas, setCategoriasAbiertas] = useState(false);
  const digits = (whatsapp ?? "").replace(/\D/g, "");

  // ¿La cortina (el contenido que sube sobre la portada) ya llegó a la cabecera? Se mide en un fotograma, nunca en cada evento de scroll.
  useEffect(() => {
    if (!esInicio) return;
    let cuadro = 0;
    const medir = () => {
      cuadro = 0;
      const cortina = document.querySelector<HTMLElement>("[data-joy-cortina]");
      const alto = cromo.current?.offsetHeight ?? 0;
      setPasado(!cortina || cortina.getBoundingClientRect().top <= alto);
    };
    const alMover = () => {
      if (!cuadro) cuadro = window.requestAnimationFrame(medir);
    };
    alMover();
    window.addEventListener("scroll", alMover, { passive: true });
    window.addEventListener("resize", alMover);
    // También cuando cambia el alto de la página (llegan los estilos, las fuentes o las fotos): la cortina pudo moverse sin que el cliente haya hecho scroll.
    const observador = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(alMover);
    observador?.observe(document.body);
    return () => {
      window.removeEventListener("scroll", alMover);
      window.removeEventListener("resize", alMover);
      observador?.disconnect();
      if (cuadro) window.cancelAnimationFrame(cuadro);
    };
  }, [esInicio, pathname]);

  // El campo recibe el foco cuando el buscador ya está abierto (el diálogo nativo se abre después de montar su contenido).
  useEffect(() => {
    if (!buscando) return;
    const id = window.setTimeout(() => campo.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [buscando]);

  const estado = esInicio && !pasado ? "hero" : "vidrio";
  const cerrarMenu = () => setMenuAbierto(false);
  const actual = (activo: boolean) => (activo ? "page" : undefined);

  return (
    <>
      <div ref={cromo} className="joy-cromo" data-estado={estado}>
        {anuncios.length > 0 && <BarraAnuncios anuncios={anuncios} />}
        <header className="joy-cab" aria-label="Navegación principal">
          <div className="mx-auto grid h-16 max-w-7xl grid-cols-[96px_minmax(0,1fr)_96px] items-center px-2 sm:px-6 md:h-20 lg:grid-cols-[1fr_auto_1fr] lg:px-8">
            <div className="col-start-1 row-start-1 flex items-center lg:hidden">
              <button type="button" onClick={() => setMenuAbierto(true)} className="joy-icono size-11" aria-label="Abrir menú" aria-haspopup="dialog">
                <Menu className="size-[22px]" strokeWidth={1.5} aria-hidden />
              </button>
            </div>

            <Link
              href={basePath}
              className="joy-marca col-start-2 row-start-1 flex min-w-0 flex-col items-center justify-center rounded-sm text-center leading-none lg:col-start-1 lg:items-start lg:text-left"
              aria-label={`${marca.name}, inicio`}
            >
              <span className="font-serif-tienda joy-tinta max-w-full truncate text-[14px] font-semibold uppercase tracking-[0.12em] min-[360px]:text-[16px] min-[420px]:text-lg sm:tracking-[0.16em] md:text-xl lg:text-[26px]">
                {marca.name}
              </span>
              {marca.descriptor && <span className="joy-tinta mt-1 text-[9px] font-medium uppercase tracking-[0.42em] opacity-80 lg:text-[10px]">{marca.descriptor}</span>}
            </Link>

            <nav className="col-start-2 row-start-1 hidden items-center gap-7 lg:flex xl:gap-9" aria-label="Menú principal">
              <Link href={basePath} className="joy-enlace joy-tinta text-[15px]" aria-current={actual(esInicio)}>
                Inicio
              </Link>
              <Link href={listPath} className="joy-enlace joy-tinta text-[15px]" aria-current={actual(esListado)}>
                Catálogo
              </Link>
              {categorias.length > 0 && (
                <Link href={categoriasHref} className="joy-enlace joy-tinta text-[15px]">
                  Categorías
                </Link>
              )}
              {mayorista && (
                <Link href={`${basePath}#mayoristas`} className="joy-pildora-nav joy-tinta rounded-full border px-4 py-1.5 text-sm">
                  Mayorista
                </Link>
              )}
            </nav>

            <div className="col-start-3 row-start-1 flex items-center justify-end lg:gap-1">
              <button type="button" onClick={() => setBuscando(true)} className="joy-icono size-11" aria-label="Buscar" aria-haspopup="dialog">
                <Search className="size-[21px]" strokeWidth={1.5} aria-hidden />
              </button>
              <BotonCarritoJoyeria />
            </div>
          </div>
        </header>
      </div>

      <Dialogo
        open={menuAbierto}
        onClose={cerrarMenu}
        label="Menú"
        persistente
        className="joy-menu fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-none w-80 max-w-[90vw] border-0 bg-ink p-0 text-fg shadow-2xl"
      >
        <nav aria-label="Menú de la tienda" className="flex h-full flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
          <div className="flex items-center justify-between border-b border-edge bg-ink-2 px-6 py-4">
            <span className="flex flex-col leading-none">
              <span className="font-serif-tienda text-base font-semibold uppercase tracking-[0.14em] text-fg">{marca.name}</span>
              {marca.descriptor && <span className="mt-1 text-[8px] font-medium uppercase tracking-[0.4em] text-[var(--tienda-oro)]">{marca.descriptor}</span>}
            </span>
            <button type="button" onClick={cerrarMenu} className="joy-icono size-9" aria-label="Cerrar menú">
              <X className="size-5" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <Link href={basePath} onClick={cerrarMenu} className="joy-fila-menu" aria-current={actual(esInicio)}>
              Inicio
            </Link>
            <Link href={listPath} onClick={cerrarMenu} className="joy-fila-menu" aria-current={actual(esListado)}>
              Todo el catálogo
            </Link>
            {mayorista && (
              <Link href={`${basePath}#mayoristas`} onClick={cerrarMenu} className="joy-fila-menu">
                Mayoristas
              </Link>
            )}
            {categorias.length > 0 && (
              <div className="mt-2 border-t border-edge pt-2">
                <button
                  type="button"
                  className="joy-fila-menu w-full justify-between"
                  aria-expanded={categoriasAbiertas}
                  aria-controls="joy-menu-categorias"
                  onClick={() => setCategoriasAbiertas((v) => !v)}
                >
                  Categorías
                  <ChevronDown className="joy-giro size-4" strokeWidth={1.6} aria-hidden />
                </button>
                <div id="joy-menu-categorias" className="joy-acordeon" data-abierto={categoriasAbiertas} inert={!categoriasAbiertas}>
                  <div className="overflow-hidden">
                    <div className="space-y-0.5 pt-1">
                      {categorias.map((c) => (
                        <Link
                          key={c.id}
                          href={`${basePath}?categoria=${encodeURIComponent(c.id)}`}
                          onClick={cerrarMenu}
                          className="joy-fila-menu joy-fila-sub"
                        >
                          {c.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          {digits.length >= 8 && (
            <a
              href={`https://wa.me/${digits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="m-4 flex h-12 items-center justify-center gap-2 rounded-lg border border-edge text-sm font-medium tracking-[0.06em] text-fg transition-colors hover:border-[var(--joy-oro)] hover:text-[var(--tienda-oro)]"
            >
              <MessageCircle className="size-4" strokeWidth={1.7} aria-hidden />
              Escríbenos por WhatsApp
            </a>
          )}
        </nav>
      </Dialogo>

      <Dialogo
        open={buscando}
        onClose={() => setBuscando(false)}
        label="Buscar"
        persistente
        className="joy-busqueda fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-ink/95 p-0 text-fg backdrop-blur-sm"
      >
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-4 pb-6 pt-[calc(1.5rem+env(safe-area-inset-top))] sm:px-6">
          <div className="flex items-center justify-between">
            <span className="font-serif-tienda text-xl font-medium text-fg">Buscar</span>
            <button type="button" onClick={() => setBuscando(false)} className="joy-icono size-11" aria-label="Cerrar búsqueda">
              <X className="size-5" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
          <form action={basePath} method="get" role="search" className="mt-6">
            <label className="relative block">
              <span className="sr-only">Buscar productos por nombre o referencia</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-mist" strokeWidth={1.5} aria-hidden />
              <input
                ref={campo}
                key={q ?? ""}
                type="search"
                name="q"
                defaultValue={q}
                enterKeyHint="search"
                autoComplete="off"
                placeholder="Busca por nombre o referencia"
                className="h-14 w-full rounded-full border border-edge bg-card pl-12 pr-5 text-base text-fg outline-none transition-colors placeholder:text-mist/80 focus:border-[var(--tienda-oro)]"
              />
            </label>
          </form>
          <p className="mt-8 text-center text-sm text-mist">Escribe el nombre o la referencia de la pieza y presiona Enter.</p>
        </div>
      </Dialogo>
    </>
  );
}
