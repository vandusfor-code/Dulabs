import type { ReactNode } from "react";
import { AdminWebProvider } from "@/components/admin-web/AdminWebContext";
import { DesktopShell } from "@/components/admin-web/DesktopShell";
import { MobileRedirectGuard } from "@/components/admin-web/MobileRedirectGuard";

// Panel web AMORE (autorizado) — /admin/amore/*, experiencia desktop
// completamente separada de /agenda/[token] (móvil, sin tocar). Misma
// sesión/backend/APIs -- ver components/admin-web/AdminWebContext.tsx.
export default function AdminAmoreLayout({ children }: { children: ReactNode }) {
  return (
    <AdminWebProvider>
      <MobileRedirectGuard />
      <DesktopShell>{children}</DesktopShell>
    </AdminWebProvider>
  );
}
