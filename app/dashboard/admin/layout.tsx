"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/lib/dashboard-session";

// Capa de conveniencia en la UI (evita el parpadeo de contenido admin antes
// de redirigir). La autorización REAL vive en cada endpoint
// /api/dashboard/admin/* vía verificarAccesoAdminDulabs (lib/admin-tenant.ts)
// -- este layout nunca debe ser el único freno.
export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { rol, esAdminDulabs } = useDashboard();

  useEffect(() => {
    // rol === null todavía puede significar "cargando" -- solo redirige
    // cuando ya sabemos con certeza que no es admin de DuLabs.
    if (rol !== null && !esAdminDulabs) {
      router.replace("/dashboard");
    }
  }, [rol, esAdminDulabs, router]);

  if (!esAdminDulabs) return null;
  return <>{children}</>;
}
