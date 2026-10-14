"use client";

/**
 * Categorías del inicio como en la referencia: una tira de tarjetas verticales de borde a borde, pegadas entre sí, con «Categoría» y el nombre abajo (centrados) y un botón redondo a cada
 * lado que desplaza un tramo cuando hay más de las que caben. Son los MISMOS enlaces de siempre (`?categoria=`): en el celular se desliza con el dedo (scroll-snap nativo) y las flechas son
 * comodidad para el mouse (con «movimiento reducido», sin animación). Quien navega con teclado usa los enlaces: el riel completo es enfocable y se desplaza con las flechas del teclado.
 * Ninguna categoría se oculta, pero las que tienen foto van primero (en la primera pantalla se ven las que tienen algo que mostrar; las demás quedan a un deslizamiento).
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EnlaceIntencion } from "@/components/catalogo-publico/tienda/EnlaceIntencion";
import { indice } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import type { PublicHome } from "@/lib/catalogo/service";

const FLECHA = "joy-flecha absolute top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-card text-fg shadow-lg active:scale-95 md:flex";

export function CarruselCategorias({ categorias: todas, basePath }: { categorias: PublicHome["categories"]; basePath: string }) {
  const riel = useRef<HTMLDivElement>(null);
  const [extremos, setExtremos] = useState({ inicio: true, fin: true });
  // Orden estable: las que tienen foto primero, cada grupo en su orden de siempre.
  const categorias = [...todas].sort((a, b) => Number(Boolean(b.coverUrl)) - Number(Boolean(a.coverUrl)));
  // Con cuatro o menos, en pantallas anchas caben todas: ocupan toda la fila (o quedan centradas); con más, se asoma la siguiente para invitar a deslizar.
  const caben = categorias.length <= 4;

  // Las flechas solo existen si hay hacia dónde desplazarse (se mide en un fotograma al cargar, al cambiar el tamaño y al desplazar).
  useEffect(() => {
    const el = riel.current;
    if (!el) return;
    const medir = () => setExtremos({ inicio: el.scrollLeft <= 4, fin: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    const observador = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    observador?.observe(el);
    el.addEventListener("scroll", medir, { passive: true });
    const cuadro = window.requestAnimationFrame(medir);
    return () => {
      observador?.disconnect();
      el.removeEventListener("scroll", medir);
      window.cancelAnimationFrame(cuadro);
    };
  }, [categorias.length]);

  const mover = (sentido: 1 | -1) => {
    const el = riel.current;
    if (!el) return;
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: sentido * el.clientWidth * 0.85, behavior: reducido ? "auto" : "smooth" });
  };

  return (
    <div className="relative">
      <div
        ref={riel}
        role="region"
        aria-roledescription="carrusel"
        aria-label="Categorías, desplázate horizontalmente"
        tabIndex={0}
        className="tienda-scroll snap-x snap-mandatory overflow-x-auto"
      >
        <ul className={`flex ${caben ? "lg:justify-center" : ""}`}>
          {categorias.map((c, i) => (
            <li key={c.id} className={`joy-item w-[64%] shrink-0 snap-start sm:w-[40%] md:w-[31%] ${caben ? "lg:w-1/4" : "lg:w-[23%]"}`} style={indice(i)}>
              <EnlaceIntencion href={`${basePath}?categoria=${encodeURIComponent(c.id)}`} className="joy-cat group relative block aspect-[4/5] overflow-hidden bg-ink-2">
                {c.coverUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- miniatura pública ya optimizada (WebP) del catálogo */}
                    <img src={c.coverUrl} alt="" loading="lazy" decoding="async" width={400} height={400} className="joy-cat-foto size-full object-cover" />
                    <span className="joy-cat-velo pointer-events-none absolute inset-0" aria-hidden />
                    <span className="joy-cat-rotulo absolute inset-x-0 bottom-0 flex flex-col items-center gap-0.5 px-4 pb-6 text-center text-white">
                      <span className="text-xs tracking-[0.04em] text-white">Categoría</span>
                      <span className="line-clamp-2 text-[19px] font-medium uppercase leading-tight tracking-[0.04em]">{c.name}</span>
                    </span>
                  </>
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-3 bg-[var(--tienda-oro-suave)] p-4 text-center">
                    <span className="font-serif-tienda text-6xl font-medium text-[var(--tienda-oro)]" aria-hidden>
                      {c.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="flex flex-col items-center gap-0.5">
                      <span className="text-xs tracking-[0.04em] text-mist">Categoría</span>
                      <span className="line-clamp-2 text-[19px] font-medium uppercase leading-tight tracking-[0.04em] text-fg">{c.name}</span>
                    </span>
                  </span>
                )}
              </EnlaceIntencion>
            </li>
          ))}
        </ul>
      </div>
      {!extremos.inicio && (
        <button type="button" tabIndex={-1} aria-hidden onClick={() => mover(-1)} className={`${FLECHA} left-3 lg:left-6`}>
          <ChevronLeft className="size-5" strokeWidth={1.6} />
        </button>
      )}
      {!extremos.fin && (
        <button type="button" tabIndex={-1} aria-hidden onClick={() => mover(1)} className={`${FLECHA} right-3 lg:right-6`}>
          <ChevronRight className="size-5" strokeWidth={1.6} />
        </button>
      )}
    </div>
  );
}
