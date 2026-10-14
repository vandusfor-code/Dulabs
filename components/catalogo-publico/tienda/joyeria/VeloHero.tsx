"use client";

/**
 * Velo que oscurece la portada mientras el contenido sube sobre ella («cortina»): opacidad = 0,32 × (desplazamiento ÷ alto de la pantalla), de 0 a 0,32 (medido en la referencia).
 * Se escribe directo en el estilo del elemento (sin estado de React, un solo fotograma por cuadro) y con «movimiento reducido» no se mueve.
 */
import { useEffect, useRef } from "react";

export function VeloHero() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cuadro = 0;
    const poner = () => {
      cuadro = 0;
      const progreso = Math.min(1, Math.max(0, window.scrollY / Math.max(1, window.innerHeight)));
      el.style.opacity = (0.32 * progreso).toFixed(3);
    };
    const alMover = () => {
      if (!cuadro) cuadro = window.requestAnimationFrame(poner);
    };
    alMover();
    window.addEventListener("scroll", alMover, { passive: true });
    window.addEventListener("resize", alMover);
    return () => {
      window.removeEventListener("scroll", alMover);
      window.removeEventListener("resize", alMover);
      if (cuadro) window.cancelAnimationFrame(cuadro);
    };
  }, []);

  return <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-30 bg-black opacity-0" />;
}
