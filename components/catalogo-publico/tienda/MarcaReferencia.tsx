"use client";

/**
 * Bloque 29 — la referencia sobre la foto de la tienda (módulo "marca_referencia" del negocio):
 * si el cliente hace captura de la tarjeta o de la ficha, la referencia sale en la imagen y puede
 * escribírsela al agente. Solo presentación: el archivo de la foto no cambia.
 */
import { useContext } from "react";
import { TiendaContext } from "@/components/catalogo-publico/tienda/TiendaContext";

export function MarcaReferencia({ reference, className = "bottom-2 right-2" }: { reference: string; className?: string }) {
  if (!useContext(TiendaContext)?.marcaReferencia) return null;
  return (
    <span
      className={`pointer-events-none absolute ${className} rounded-full bg-black/50 px-2 py-0.5 font-mono text-[10.5px] font-medium tracking-wide text-white`}
      aria-hidden
    >
      {reference}
    </span>
  );
}
