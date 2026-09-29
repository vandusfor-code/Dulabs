import type { ReactNode } from "react";
import { CatalogGate, CatalogToastProvider } from "@/components/dashboard/catalogo/ui";

// Bloque 33 — módulo "Clientes": se muestra solo si el negocio tiene el módulo "clientes_joyeria"
// (dulabs_tenant_modulos). Es presentación -- /api/dashboard/clientes/* vuelve a autorizar.
export default function ClientesLayout({ children }: { children: ReactNode }) {
  return (
    <CatalogToastProvider>
      <CatalogGate modulo="clientes_joyeria">{children}</CatalogGate>
    </CatalogToastProvider>
  );
}
