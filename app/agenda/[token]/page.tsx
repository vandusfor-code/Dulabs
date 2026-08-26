"use client";

import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { StatsCards } from "@/components/spa-panel/StatsCards";
import { DailyAgenda } from "@/components/spa-panel/DailyAgenda";
import { UpcomingAppointments } from "@/components/spa-panel/UpcomingAppointments";

export default function AgendaDashboardPage() {
  const { datos } = useAgenda();

  return (
    <div className="flex flex-col gap-6">
      <StatsCards citas={datos.citas} />
      <DailyAgenda citas={datos.citas} />
      <UpcomingAppointments citas={datos.citas} />
    </div>
  );
}
