import type { ReactNode } from "react";
import { DashboardSessionProvider } from "@/lib/dashboard-session";

// F15.1 (Admin Flow Studio, autorizado) -- layout propio para /flow-studio,
// FUERA de /dashboard: reutiliza DashboardSessionProvider tal cual (mismo
// contrato de sesión/rol que el resto del dashboard, useDashboard() sigue
// funcionando sin cambios) pero deliberadamente SIN <Shell> (sin
// sidebar/topbar del dashboard -- Flow Studio tiene su propio header, ver
// FlowTopbar). `.flow-studio-scope` reemplaza a `.dash-scope`: el dashboard
// general sigue oscuro, Flow Studio es un scope CSS claro aparte (ver
// app/globals.css).
export default function FlowStudioLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flow-studio-scope">
      <DashboardSessionProvider>{children}</DashboardSessionProvider>
    </div>
  );
}
