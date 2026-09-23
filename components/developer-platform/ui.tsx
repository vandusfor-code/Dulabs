"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// DuLabs Developer -- primitivas de la landing. Pocas y precisas: el encabezado editorial de bloque (índice + etiqueta + título), los dos
// botones, la etiqueta mono y la marca de estado. Todo lo demás se compone con estas piezas.

/** Encabezado de bloque: índice y etiqueta en una columna estrecha (rail editorial), título y apoyo a la derecha. */
export function Encabezado({ indice, etiqueta, titulo, apoyo, accion }: { indice: string; etiqueta: string; titulo: ReactNode; apoyo?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
      <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-dp-muted lg:col-span-3 lg:self-start lg:pt-3">
        <span className="text-dp-text">{indice}</span>
        <span aria-hidden className="h-px w-6 bg-dp-border-strong" />
        {etiqueta}
      </p>
      <div className="lg:col-span-9">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-[24ch] text-[30px] font-medium leading-[1.06] tracking-[-0.03em] text-dp-text md:text-[40px] lg:text-[44px]">{titulo}</h2>
          {accion ? <div className="flex-none">{accion}</div> : null}
        </div>
        {apoyo ? <p className="mt-4 max-w-[62ch] text-[15.5px] leading-[1.65] text-dp-text-2 md:text-[16px]">{apoyo}</p> : null}
      </div>
    </div>
  );
}

export function BotonPrimario({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={`dp-btn inline-flex h-11 items-center justify-center gap-2 rounded-dp bg-dev-accent px-5 text-[14px] font-medium text-dev-accent-fg hover:bg-dev-accent-hover ${className}`}
    >
      {children}
      <span aria-hidden className="dp-flecha">→</span>
    </Link>
  );
}

export function BotonSecundario({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={`dp-btn inline-flex h-11 items-center justify-center gap-2 rounded-dp border border-dp-border-strong px-5 text-[14px] font-medium text-dp-text hover:border-white/35 hover:bg-white/[0.03] ${className}`}
    >
      {children}
      <span aria-hidden className="dp-flecha text-dp-muted">→</span>
    </Link>
  );
}

/** Enlace de texto con flecha (a docs, referencia, etc.). */
export function EnlaceFlecha({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="dp-btn dp-link group inline-flex items-center gap-1.5 text-[13.5px] font-medium text-dp-text-2 hover:text-dp-text">
      {children}
      <span aria-hidden className="dp-flecha">→</span>
    </Link>
  );
}

export type Estado = "created" | "queued" | "processing" | "sent" | "delivered" | "read" | "received" | "failed" | "retrying" | "dlq" | "200";

/** Marca de estado: neutro por defecto; azul solo para lo que está ocurriendo; rojo apagado solo para fallos. */
export function MarcaEstado({ estado }: { estado: Estado }) {
  const cls =
    estado === "failed" || estado === "dlq"
      ? "bg-dp-danger"
      : estado === "processing" || estado === "retrying"
        ? "bg-dp-signal"
        : estado === "queued" || estado === "created"
          ? "bg-dp-muted"
          : "bg-dp-text";
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 flex-none rounded-full ${cls}`} />;
}

/** Nota de honestidad para vistas ilustrativas (datos de ejemplo, no métricas reales). */
export function NotaEjemplo({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dp-muted">{children}</p>;
}
