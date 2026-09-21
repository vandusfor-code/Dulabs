import type { CSSProperties, ReactNode } from "react";

// Burbujas de conversación del mockup del hero. Aparecen UNA vez, escalonadas por `ms` (ver .home-seq); se anulan con
// prefers-reduced-motion. Se ajustan al texto (w-fit) y su tamaño crece un poco en pantallas grandes, donde el mockup ocupa más ancho.

export const retraso = (ms: number): CSSProperties => ({ ["--home-d" as string]: `${ms}ms` });

export function Cliente({ ms = 0, children, className = "" }: { ms?: number; children: ReactNode; className?: string }) {
  return (
    <div
      className={`home-seq w-fit max-w-[84%] rounded-2xl rounded-tl-md bg-white/[0.055] px-3.5 py-2.5 text-[13.5px] leading-snug text-site-fg xl:px-4 xl:py-3 xl:text-[15px] ${className}`}
      style={retraso(ms)}
    >
      {children}
    </div>
  );
}

export function Agente({ ms = 0, children, etiqueta = "Agente", className = "" }: { ms?: number; children: ReactNode; etiqueta?: string; className?: string }) {
  return (
    <div
      className={`home-seq ml-auto w-fit max-w-[90%] rounded-2xl rounded-tr-md border border-site-border bg-site-secondary px-3.5 py-2.5 text-[13.5px] leading-snug text-site-fg xl:px-4 xl:py-3 xl:text-[15px] ${className}`}
      style={retraso(ms)}
    >
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-site-muted-fg">{etiqueta}</p>
      {children}
    </div>
  );
}
