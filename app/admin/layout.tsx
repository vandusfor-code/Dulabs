import type { ReactNode } from "react";
import { DashboardSessionProvider } from "@/lib/dashboard-session";
import AdminShell from "@/components/admin/AdminShell";

// FASE F15 (Operations Center, autorizado) -- /admin es un árbol de rutas
// propio (no vive bajo /dashboard), con su propio shell operador. La
// autorización real de cada acción/lectura vive en el backend
// (verificarAccesoAdminDulabs, lib/admin-tenant.ts) -- este layout es solo
// la capa de conveniencia de UI, igual que ya documentaba
// app/dashboard/admin/layout.tsx.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardSessionProvider>
      <AdminShell>{children}</AdminShell>
    </DashboardSessionProvider>
  );
}
