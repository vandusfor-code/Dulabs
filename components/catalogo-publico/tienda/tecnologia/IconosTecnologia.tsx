/**
 * Traducción de los identificadores cerrados de lib/catalogo/vitrina.ts a iconos (lucide). Un solo lugar: la vista nunca recibe nombres de icono
 * libres, y una categoría o un beneficio desconocido cae en un icono neutro (jamás rompe).
 */
import {
  BadgePercent,
  Banknote,
  CookingPot,
  Gamepad2,
  Headphones,
  Headset,
  LayoutGrid,
  Laptop,
  Package,
  ShieldCheck,
  Smartphone,
  Tablet,
  Truck,
  Watch,
  type LucideIcon,
} from "lucide-react";
import type { IconoBeneficio, IconoCategoria } from "@/lib/catalogo/vitrina";

const CATEGORIAS: Record<IconoCategoria, LucideIcon> = {
  celular: Smartphone,
  tablet: Tablet,
  computador: Laptop,
  audio: Headphones,
  smartwatch: Watch,
  gaming: Gamepad2,
  cocina: CookingPot,
  general: Package,
};

const BENEFICIOS: Record<IconoBeneficio, LucideIcon> = {
  envio: Truck,
  seguridad: ShieldCheck,
  soporte: Headset,
  ofertas: BadgePercent,
  pago: Banknote,
  garantia: ShieldCheck,
};

export function IconoDeCategoria({ icono, className, strokeWidth = 1.6 }: { icono: IconoCategoria; className?: string; strokeWidth?: number }) {
  const Icono = CATEGORIAS[icono] ?? Package;
  return <Icono className={className} strokeWidth={strokeWidth} aria-hidden />;
}

export function IconoDeBeneficio({ icono, className, strokeWidth = 1.6 }: { icono: IconoBeneficio; className?: string; strokeWidth?: number }) {
  const Icono = BENEFICIOS[icono] ?? ShieldCheck;
  return <Icono className={className} strokeWidth={strokeWidth} aria-hidden />;
}

/** El acceso "Ver más" de la franja de categorías. */
export const IconoVerMas = LayoutGrid;
