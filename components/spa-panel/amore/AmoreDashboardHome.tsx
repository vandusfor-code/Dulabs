"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { useAgenda } from "@/components/spa-panel/AgendaContext";
import { formatearFechaLarga, formatearHora, mismoDia } from "@/components/spa-panel/format";
import { AmoreMetricCards } from "./AmoreMetricCards";
import { AmoreUpcomingAppointments } from "./AmoreUpcomingAppointments";
import type { DashboardDataMock, CitaMock } from "./amore-dashboard-mock";

type ReporteMes = { ingresos: { actual: number; variacionPorcentual: number | null } };

// AMORE (Fase "sistema completo", autorizado) — métricas REALES: citas y
// resumen ya vienen cargados en useAgenda() (mismo fetch que usa toda la
// agenda); clientes e ingresos reutilizan las APIs ya existentes de
// Clientes y Contabilidad (ningún endpoint nuevo). AmoreMetricCards/
// AmoreUpcomingAppointments no cambiaron -- siguen recibiendo exactamente
// la misma forma de datos, solo que ahora es real en vez de mock.
export function AmoreDashboardHome() {
  const { token, datos } = useAgenda();
  const router = useRouter();
  const fecha = formatearFechaLarga(new Date());
  const [clientesNuevosEsteMes, setClientesNuevosEsteMes] = useState(0);
  const [ingresosMes, setIngresosMes] = useState<{ total: number; variacionPct: number }>({ total: 0, variacionPct: 0 });

  useEffect(() => {
    const ahora = new Date();
    fetch(`/api/agenda/${token}/clientes`)
      .then((r) => r.json())
      .then((body) => {
        const clientes = (body.clientes ?? []) as { created_at: string }[];
        const nuevos = clientes.filter((c) => {
          const d = new Date(c.created_at);
          return d.getUTCFullYear() === ahora.getUTCFullYear() && d.getUTCMonth() === ahora.getUTCMonth();
        }).length;
        setClientesNuevosEsteMes(nuevos);
      })
      .catch(() => {});

    fetch(`/api/agenda/${token}/contabilidad?periodo=mes`)
      .then((r) => r.json())
      .then((body: ReporteMes) => {
        setIngresosMes({ total: body.ingresos?.actual ?? 0, variacionPct: body.ingresos?.variacionPorcentual ?? 0 });
      })
      .catch(() => {});
  }, [token]);

  const citasHoy = useMemo(() => datos.citas.filter((c) => mismoDia(c.inicio, new Date()) && c.estado !== "rechazada"), [datos.citas]);

  const dashboardData: DashboardDataMock = useMemo(() => {
    const pendientes = citasHoy.filter((c) => c.estado === "pendiente" || c.estado === "propuesta").length;
    const serviciosDistintos = new Set(citasHoy.map((c) => c.servicio)).size;
    const proximasCitas: CitaMock[] = citasHoy
      .filter((c) => c.estado === "confirmada" || c.estado === "pendiente")
      .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime())
      .slice(0, 5)
      .map((c) => ({
        id: String(c.id),
        hora: formatearHora(c.inicio),
        nombreCliente: c.nombre_cliente,
        servicio: c.servicio,
        estado: c.estado as "confirmada" | "pendiente",
      }));

    return {
      citasHoy: { total: citasHoy.length, pendientes },
      clientesActivos: { total: datos.resumen.clientesRegistrados, nuevosEsteMes: clientesNuevosEsteMes },
      serviciosHoy: { total: citasHoy.length, diferentes: serviciosDistintos },
      ingresosMes,
      proximasCitas,
    };
  }, [citasHoy, datos.resumen.clientesRegistrados, clientesNuevosEsteMes, ingresosMes]);

  return (
    <>
      <div className="mt-6 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold text-fg">¡Hola, {datos.especialista.nombre}! 💕</p>
          <p className="mt-1 text-sm text-mist">{fecha}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-edge bg-card px-3.5 py-2 text-sm font-medium text-fg">
          <CalendarDays className="size-4 text-lime-text" />
          Hoy
        </div>
      </div>

      <AmoreMetricCards datos={dashboardData} />
      <AmoreUpcomingAppointments
        citas={dashboardData.proximasCitas}
        onVerTodas={() => router.push(`/agenda/${token}/completa`)}
        onVerCalendario={() => router.push(`/agenda/${token}/completa`)}
      />
    </>
  );
}
