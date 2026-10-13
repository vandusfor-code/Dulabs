"use client";

/**
 * Categorías del inicio como carrusel de tarjetas verticales. Son los MISMOS enlaces de siempre (`?categoria=`): en el celular se desliza con el dedo (scroll-snap nativo) y en
 * pantallas medianas hay flechas que desplazan un tramo (con «movimiento reducido», sin animación). Las flechas son comodidad para el mouse: quien navega con teclado usa los
 * enlaces (el riel completo es enfocable y se desplaza con las flechas del teclado).
 */
import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EnlaceIntencion } from "@/components/catalogo-publico/tienda/EnlaceIntencion";
import { indice } from "@/components/catalogo-publico/tienda/joyeria/piezas";
import type { PublicHome } from "@/lib/catalogo/service";

const FLECHA =
  "joy-flecha absolute top-[38%] hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-card text-fg shadow-lg active:scale-95 md:flex";

export function CarruselCategorias({ categorias, basePath }: { categorias: PublicHome["categories"]; basePath: string }) {
  const riel = useRef<HTMLDivElement>(null);

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
        className="tienda-scroll -mx-4 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:scroll-px-0 sm:px-0"
      >
        <ul className="flex gap-3 sm:gap-4">
          {categorias.map((c, i) => (
            <li key={c.id} className="joy-item w-[56%] shrink-0 snap-start sm:w-[31%] lg:w-[23.5%]" style={indice(i)}>
              <EnlaceIntencion href={`${basePath}?categoria=${encodeURIComponent(c.id)}`} className="joy-cat group relative block aspect-[4/5] overflow-hidden rounded-xl bg-ink-2">
                {c.coverUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- miniatura pública ya optimizada (WebP) del catálogo */}
                    <img src={c.coverUrl} alt="" loading="lazy" decoding="async" width={400} height={400} className="joy-cat-foto size-full object-cover" />
                    <span className="joy-cat-velo pointer-events-none absolute inset-0" aria-hidden />
                    <span className="font-serif-tienda absolute inset-x-0 bottom-0 line-clamp-2 p-4 text-[21px] font-medium leading-tight text-white drop-shadow-sm">{c.name}</span>
                  </>
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-3 bg-[var(--tienda-oro-suave)] p-4 text-center">
                    <span className="font-serif-tienda text-6xl font-medium text-[var(--joy-oro)]" aria-hidden>
                      {c.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="font-serif-tienda line-clamp-2 text-[21px] font-medium leading-tight text-fg">{c.name}</span>
                  </span>
                )}
              </EnlaceIntencion>
            </li>
          ))}
        </ul>
      </div>
      {categorias.length > 4 && (
        <>
          <button type="button" tabIndex={-1} aria-hidden onClick={() => mover(-1)} className={`${FLECHA} -left-2 lg:-left-5`}>
            <ChevronLeft className="size-5" strokeWidth={1.6} />
          </button>
          <button type="button" tabIndex={-1} aria-hidden onClick={() => mover(1)} className={`${FLECHA} -right-2 lg:-right-5`}>
            <ChevronRight className="size-5" strokeWidth={1.6} />
          </button>
        </>
      )}
    </div>
  );
}
