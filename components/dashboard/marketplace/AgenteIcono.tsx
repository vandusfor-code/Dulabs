"use client";

import { Scissors, UtensilsCrossed, Cross, ShoppingBag, Dumbbell, House, Scale, Bot, type LucideIcon } from "lucide-react";

// Mapea la clave de ícono del catálogo (lib/marketplace.ts) a un componente
// Lucide. Todos los íconos del Marketplace usan el mismo estilo monocromático
// que el resto del dashboard: contenedor cuadrado, borde, sin color de acento.
const ICONOS: Record<string, LucideIcon> = {
  Scissors,
  UtensilsCrossed,
  Cross,
  ShoppingBag,
  Dumbbell,
  House,
  Scale,
};

export function AgenteIcono({ icono, className = "size-14" }: { icono: string; className?: string }) {
  const Icono = ICONOS[icono] ?? Bot;
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-xl border border-edge bg-ink ${className}`}>
      <Icono className="size-7 text-fg/80" strokeWidth={1.8} />
    </div>
  );
}
