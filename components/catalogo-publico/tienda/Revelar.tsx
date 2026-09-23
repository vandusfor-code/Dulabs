"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Aparición progresiva al hacer scroll. Seguro por diseño: el HTML llega
 * visible; solo lo que está DEBAJO del pliegue al cargar se oculta y se
 * revela al entrar en pantalla. Sin JavaScript, con movimiento reducido o en
 * una página que no alcanza a desplazarse, todo queda visible.
 */
export function Revelar({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // ya está a la vista
    el.classList.add("tienda-oculto");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.classList.remove("tienda-oculto");
        el.classList.add("tienda-aparece");
        io.disconnect();
      },
      { rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
