import type { ReactNode } from "react";
import { CatalogGate, CatalogToastProvider } from "@/components/dashboard/catalogo/ui";

// Bloque 27 — módulo "Pedidos": se muestra solo si el negocio tiene el módulo "pedidos" habilitado
// (dulabs_tenant_modulos). Es presentación -- /api/dashboard/pedidos/* vuelve a autorizar.
export default function PedidosLayout({ children }: { children: ReactNode }) {
  return (
    <CatalogToastProvider>
      <CatalogGate modulo="pedidos">{children}</CatalogGate>
    </CatalogToastProvider>
  );
}
