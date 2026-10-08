import type { ReactNode } from "react";
import { CatalogToastProvider } from "@/components/dashboard/catalogo/ui";
import { TiendaGate } from "@/components/dashboard/tienda/acceso";

// Administración de tienda (Bloque 29): el módulo se muestra solo si el negocio lo tiene habilitado (dulabs_tenant_modulos: cms_comercial).
// Es presentación -- cada endpoint de /api/dashboard/tienda/* vuelve a autorizar por su cuenta (membresía, rol y módulo).
export default function TiendaLayout({ children }: { children: ReactNode }) {
  return (
    <CatalogToastProvider>
      <TiendaGate>{children}</TiendaGate>
    </CatalogToastProvider>
  );
}
