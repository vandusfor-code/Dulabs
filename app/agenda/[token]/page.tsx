"use client";

import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { StatsCards } from "@/components/spa-panel/StatsCards";
import { DailyAgenda } from "@/components/spa-panel/DailyAgenda";
import { UpcomingAppointments } from "@/components/spa-panel/UpcomingAppointments";
import { AmoreDashboardHome } from "@/components/spa-panel/amore/AmoreDashboardHome";

export default function AgendaDashboardPage() {
  const { datos } = useAgenda();

  // AMORE (Fase 5, panel administrativo móvil, autorizado) — únicamente la
  // pantalla Inicio/Dashboard de esta fase; el resto de rutas bajo
  // /agenda/[token] siguen sin tocarse para este tenant.
  if (datos.negocio === "AMORE") {
    return <AmoreDashboardHome />;
  }

  return (
    <div className="flex flex-col gap-6">
      <StatsCards citas={datos.citas} resumen={datos.resumen} />
      <DailyAgenda citas={datos.citas} />
      <UpcomingAppointments citas={datos.citas} />
    </div>
  );
}
