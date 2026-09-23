"use client";

/**
 * Galería de la ficha: swipe NATIVO (scroll-snap, sin librerías). Solo la
 * primera foto carga de inmediato; el resto, perezosas. Con varias fotos:
 * contador accesible y miniaturas táctiles.
 */
import { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import type { PublicProductImages } from "@/lib/catalogo/publicacion";

export function GaleriaProducto({ images, name }: { images: PublicProductImages[]; name: string }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [activa, setActiva] = useState(0);

  // Foto visible = la que ocupa la mayor parte del riel (se actualiza al deslizar).
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || images.length < 2) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActiva(Number((e.target as HTMLElement).dataset.index));
      },
      { root: rail, threshold: 0.6 },
    );
    rail.querySelectorAll("[data-index]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [images.length]);

  const irA = (i: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ left: rail.clientWidth * i, behavior: reduce ? "auto" : "smooth" });
  };

  if (images.length === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-[26px] bg-ink-2 text-mist/50">
        <ImageOff className="size-10" strokeWidth={1.3} aria-hidden />
        <span className="sr-only">Producto sin fotografía</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" aria-roledescription="galería" aria-label={`Fotos de ${name}`}>
      <div className="relative overflow-hidden rounded-[26px] bg-ink-2">
        <div ref={railRef} className="tienda-scroll flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain">
          {images.map((img, i) => (
            <div key={img.imageUrl} data-index={i} className="aspect-square w-full shrink-0 snap-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- foto pública ya optimizada (WebP) en la carga */}
              <img
                src={img.imageUrl}
                alt={images.length > 1 ? `${name}, foto ${i + 1} de ${images.length}` : name}
                loading={i === 0 ? "eager" : "lazy"}
                fetchPriority={i === 0 ? "high" : "auto"}
                decoding="async"
                className="size-full object-cover"
              />
            </div>
          ))}
        </div>
        {images.length > 1 && (
          <p className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-fg/55 px-2.5 py-1 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm" aria-live="polite">
            {activa + 1} / {images.length}
          </p>
        )}
      </div>
      {images.length > 1 && (
        <ul className="tienda-scroll -mx-4 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:px-1">
          {images.map((img, i) => (
            <li key={img.thumbUrl} className="shrink-0">
              <button
                type="button"
                onClick={() => irA(i)}
                aria-label={`Ver foto ${i + 1}`}
                aria-current={activa === i ? "true" : undefined}
                className={
                  "block size-16 overflow-hidden rounded-2xl ring-2 ring-offset-2 ring-offset-ink transition-[box-shadow,opacity] " +
                  (activa === i ? "ring-[var(--tienda-oro)]" : "opacity-70 ring-transparent hover:opacity-100")
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- miniatura pública ya optimizada (WebP) */}
                <img src={img.thumbUrl} alt="" loading="lazy" decoding="async" width={64} height={64} className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
