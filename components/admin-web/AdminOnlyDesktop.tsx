"use client";

import type { ReactNode } from "react";
import { useAdminWeb } from "./AdminWebContext";

// Panel web AMORE (autorizado) — guarda de UX para páginas admin-only
// (Clientes/Servicios/Equipo/Contabilidad/WhatsApp/Cumpleaños/
// Fidelización/Recordatorios/Configuración): si una colaboradora navega
// directo a la URL, no ve el módulo -- ve un aviso neutro. La protección
// REAL ya vive server-side en cada API (requiereAdministrador), esto es
// solo para no dejar una pantalla rota/vacía.
export function AdminOnlyDesktop({ children }: { children: ReactNode }) {
  const { datos } = useAdminWeb();
  if (datos.sesion?.rol === "colaboradora") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-mist">Esta sección no está disponible para tu cuenta.</p>
      </div>
    );
  }
  return <>{children}</>;
}
