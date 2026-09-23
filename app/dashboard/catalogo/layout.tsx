import type { ReactNode } from "react";
import { CatalogGate, CatalogToastProvider } from "@/components/dashboard/catalogo/ui";

// Catálogo (autorizado): el módulo se muestra solo si el tenant lo tiene
// habilitado (dulabs_tenant_modulos). Es presentación -- cada endpoint de
// /api/dashboard/catalogo/* vuelve a autorizar por su cuenta.
export default function CatalogoLayout({ children }: { children: ReactNode }) {
  return (
    <CatalogToastProvider>
      <CatalogGate>{children}</CatalogGate>
    </CatalogToastProvider>
  );
}
