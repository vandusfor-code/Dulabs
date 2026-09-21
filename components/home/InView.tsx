"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Única isla cliente de las secciones: avisa cuándo la sección entra en pantalla para que sus secuencias (.home-seq) arranquen
// entonces y no al cargar la página (mismo patrón de IntersectionObserver que components/site/Reveal, pero sin envolver cada bloque
// ni cargar estilos propios). El contenido ya está en el HTML del servidor: esto solo dispara animaciones.
export function InView({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visto, setVisto] = useState(false);

  useEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    const observador = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) {
          setVisto(true);
          observador.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  return (
    <div ref={ref} data-inview={visto} className={`home-view ${className}`}>
      {children}
    </div>
  );
}
