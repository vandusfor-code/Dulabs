import type { ReactNode } from "react";
import { CatalogGate } from "@/components/dashboard/catalogo/ui";

// Fase 3B.7 — "Por aceptar" vive dentro de Pedidos (el layout de arriba ya exige el módulo "pedidos" y da el toast)
// y además exige su módulo propio "pedidos_por_aceptar". Es presentación: /api/dashboard/pedidos/por-aceptar y
// /aceptacion vuelven a autorizar sesión, rol, módulos y negocio en cada llamada.
export default function PorAceptarLayout({ children }: { children: ReactNode }) {
  return <CatalogGate modulo="pedidos_por_aceptar">{children}</CatalogGate>;
}
