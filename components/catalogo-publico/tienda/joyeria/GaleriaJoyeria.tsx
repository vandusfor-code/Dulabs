"use client";

/**
 * Galería de la ficha del tema "joyeria": el mismo swipe NATIVO de siempre (scroll-snap, sin librerías), con foto vertical 4:5, contador, miniaturas y, al tocar la foto, una vista
 * ampliada (diálogo nativo a pantalla completa: contador «1 / N», cerrar, anterior/siguiente, flechas del teclado y deslizar con el dedo). Solo la primera foto carga de inmediato.
 * No cambia ningún dato: las fotos son las de la proyección pública del producto.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import { Dialogo } from "@/components/catalogo-publico/tienda/Dialogo";
import { MarcaReferencia } from "@/components/catalogo-publico/tienda/MarcaReferencia";
import type { PublicProductImages } from "@/lib/catalogo/publicacion";

/** Distancia mínima (px) de un deslizamiento para cambiar de foto en la vista ampliada. */
const UMBRAL_DESLIZAR = 50;

function Ampliada({ images, name, inicial, onClose }: { images: PublicProductImages[]; name: string; inicial: number; onClose: () => void }) {
  const [i, setI] = useState(inicial);
  const inicioX = useRef<number | null>(null);
  const total = images.length;
  const ir = (delta: number) => setI((v) => Math.min(total - 1, Math.max(0, v + delta)));
  const boton = "joy-icono size-11 text-white/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") ir(1);
        else if (e.key === "ArrowLeft") ir(-1);
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="text-sm tabular-nums text-white/70" aria-live="polite">
          {i + 1} / {total}
        </span>
        <button type="button" onClick={onClose} className={boton} aria-label="Cerrar imagen ampliada">
          <X className="size-5" strokeWidth={1.6} aria-hidden />
        </button>
      </div>
      <div
        className="relative min-h-0 flex-1 touch-pan-y select-none"
        onPointerDown={(e) => {
          inicioX.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if (inicioX.current === null) return;
          const dx = e.clientX - inicioX.current;
          inicioX.current = null;
          if (Math.abs(dx) >= UMBRAL_DESLIZAR) ir(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          inicioX.current = null;
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- foto pública ya optimizada (WebP) en la carga */}
        <img key={i} src={images[i].detailUrl} alt={total > 1 ? `${name}, foto ${i + 1} de ${total}` : name} draggable={false} className="absolute inset-0 size-full object-contain" />
      </div>
      <div className="flex items-center justify-center gap-6 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => ir(-1)} disabled={i === 0} className={boton} aria-label="Imagen anterior">
          <ChevronLeft className="size-6" strokeWidth={1.6} aria-hidden />
        </button>
        <button type="button" onClick={() => ir(1)} disabled={i === total - 1} className={boton} aria-label="Imagen siguiente">
          <ChevronRight className="size-6" strokeWidth={1.6} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function GaleriaJoyeria({ images, name, reference }: { images: PublicProductImages[]; name: string; reference?: string }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [activa, setActiva] = useState(0);
  const [ampliada, setAmpliada] = useState<number | null>(null);

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
      <div className="flex aspect-[4/5] w-full items-center justify-center rounded-2xl bg-ink-2 text-mist/50">
        <ImageOff className="size-10" strokeWidth={1.3} aria-hidden />
        <span className="sr-only">Producto sin fotografía</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" role="group" aria-roledescription="galería" aria-label={`Fotos de ${name}`}>
      <div className="relative overflow-hidden rounded-2xl bg-ink-2">
        <div ref={railRef} className="tienda-scroll flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain">
          {images.map((img, i) => (
            <div key={img.imageUrl} data-index={i} className="relative aspect-[4/5] w-full shrink-0 snap-center">
              <button type="button" onClick={() => setAmpliada(i)} aria-haspopup="dialog" aria-label={`Ampliar foto ${i + 1} de ${images.length}: ${name}`} className="absolute inset-0 cursor-zoom-in">
                {/* eslint-disable-next-line @next/next/no-img-element -- foto pública ya optimizada (WebP) en la carga */}
                <img
                  src={img.detailUrl}
                  alt=""
                  loading={i === 0 ? "eager" : "lazy"}
                  fetchPriority={i === 0 ? "high" : "auto"}
                  decoding="async"
                  className="size-full object-cover"
                />
              </button>
              {reference && <MarcaReferencia reference={reference} className="bottom-3 left-3" />}
            </div>
          ))}
        </div>
        {images.length > 1 && (
          <p className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm" aria-live="polite">
            {activa + 1} / {images.length}
          </p>
        )}
      </div>
      {images.length > 1 && (
        <ul className="tienda-scroll -mx-4 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:px-1" role="list">
          {images.map((img, i) => (
            <li key={img.thumbUrl} className="shrink-0">
              <button
                type="button"
                onClick={() => irA(i)}
                aria-label={`Ver foto ${i + 1}`}
                aria-current={activa === i ? "true" : undefined}
                className={"joy-miniatura block size-16 overflow-hidden rounded-lg border-2 " + (activa === i ? "border-[var(--joy-oro)] shadow-md" : "border-transparent opacity-60 hover:border-edge hover:opacity-100")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- miniatura pública ya optimizada (WebP) */}
                <img src={img.thumbUrl} alt="" loading="lazy" decoding="async" width={64} height={64} className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialogo
        open={ampliada !== null}
        onClose={() => setAmpliada(null)}
        label={`${name}, imagen ampliada`}
        className="joy-lightbox fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 p-0 text-white"
      >
        {ampliada !== null && <Ampliada images={images} name={name} inicial={ampliada} onClose={() => setAmpliada(null)} />}
      </Dialogo>
    </div>
  );
}
