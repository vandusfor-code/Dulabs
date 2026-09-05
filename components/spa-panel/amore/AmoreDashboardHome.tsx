"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { formatearFechaLarga } from "@/components/spa-panel/format";
import { AmoreMetricCards } from "./AmoreMetricCards";
import { AmoreUpcomingAppointments } from "./AmoreUpcomingAppointments";
import { useAmoreUi } from "./AmoreUiContext";
import { dashboardDataMock } from "./amore-dashboard-mock";

// AMORE (Fase 5, panel administrativo móvil, autorizado) — contenido de la
// pantalla Inicio/Dashboard. Datos 100% mock (ver amore-dashboard-mock.ts):
// ningún módulo real de Citas/Clientes/Servicios/Contabilidad existe todavía,
// así que nada de esto se guarda ni se lee de Supabase.
//
// Fase 5 (diseño visual completo, autorizado) — el saludo/fecha/selector
// "Hoy" vivía antes en AmoreHeader (chrome global); se movió acá tal cual
// (mismas clases, mismo margen) porque es contenido de ESTA pantalla, no del
// header que ahora comparten todas -- cero cambio visual en Inicio.
export function AmoreDashboardHome() {
  const { datos } = useAgenda();
  const { avisarProximamente } = useAmoreUi();
  const fecha = formatearFechaLarga(new Date());

  return (
    <>
      <div className="mt-6 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold text-fg">¡Hola, {datos.especialista.nombre}! 💕</p>
          <p className="mt-1 text-sm text-mist">{fecha}</p>
        </div>
        <button
          type="button"
          onClick={avisarProximamente}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-edge bg-card px-3.5 py-2 text-sm font-medium text-fg"
        >
          <CalendarDays className="size-4 text-lime-text" />
          Hoy
          <ChevronDown className="size-3.5 text-mist" />
        </button>
      </div>

      <AmoreMetricCards datos={dashboardDataMock} />
      <AmoreUpcomingAppointments
        citas={dashboardDataMock.proximasCitas}
        onVerTodas={avisarProximamente}
        onVerCalendario={avisarProximamente}
      />
    </>
  );
}
