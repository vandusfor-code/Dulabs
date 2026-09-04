"use client";

import { AmoreMetricCards } from "./AmoreMetricCards";
import { AmoreUpcomingAppointments } from "./AmoreUpcomingAppointments";
import { useAmoreUi } from "./AmoreUiContext";
import { dashboardDataMock } from "./amore-dashboard-mock";

// AMORE (Fase 5, panel administrativo móvil, autorizado) — contenido de la
// pantalla Inicio/Dashboard. Datos 100% mock (ver amore-dashboard-mock.ts):
// ningún módulo real de Citas/Clientes/Servicios/Contabilidad existe todavía,
// así que nada de esto se guarda ni se lee de Supabase.
export function AmoreDashboardHome() {
  const { avisarProximamente } = useAmoreUi();

  return (
    <>
      <AmoreMetricCards datos={dashboardDataMock} />
      <AmoreUpcomingAppointments
        citas={dashboardDataMock.proximasCitas}
        onVerTodas={avisarProximamente}
        onVerCalendario={avisarProximamente}
      />
    </>
  );
}
