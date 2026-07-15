"use client";

import { useEffect, useState } from "react";
import { MessagesSquare, TrendingUp, Phone, Bot } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";
import { PageHeader, StatTile } from "@/components/dashboard/shell/ui";
import { AreaTrend, Donut } from "@/components/dashboard/shell/charts";

const COLORES_DONUT = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

export default function AnalyticsPage() {
  const { session, negocios } = useDashboard();
  const [dias, setDias] = useState<{ fecha: string; cantidad: number }[] | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/actividad", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setDias(data.dias ?? []))
      .catch(() => setDias([]));
  }, [session]);

  const mensajesUsados = negocios?.reduce((acc, n) => acc + n.mensajes_usados, 0) ?? 0;
  const totalSemana = (dias ?? []).reduce((acc, d) => acc + d.cantidad, 0);
  const promedioDiario = dias && dias.length > 0 ? Math.round(totalSemana / dias.length) : 0;
  const numerosActivos = negocios?.filter((n) => n.conectado).length ?? 0;

  const chartData = (dias ?? []).map((d) => ({
    label: new Date(d.fecha + "T00:00:00").toLocaleDateString("es-CO", { weekday: "short" }),
    mensajes: d.cantidad,
  }));

  const porNegocio = (negocios ?? [])
    .filter((n) => n.mensajes_usados > 0)
    .map((n, i) => ({ name: n.nombre_negocio, value: n.mensajes_usados, color: COLORES_DONUT[i % COLORES_DONUT.length] }));

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Infraestructura"
        title="Analytics"
        description="El estado real de tu operación en WhatsApp: mensajes procesados, ritmo diario y distribución por número."
      />

      <div className="px-4 pt-6 md:px-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Mensajes este mes" value={mensajesUsados.toLocaleString("es-CO")} icon={MessagesSquare} />
          <StatTile label="Últimos 7 días" value={totalSemana.toLocaleString("es-CO")} icon={TrendingUp} />
          <StatTile label="Promedio diario" value={promedioDiario.toLocaleString("es-CO")} icon={Bot} />
          <StatTile label="Números activos" value={String(numerosActivos)} icon={Phone} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-edge bg-card p-5 lg:col-span-2">
            <h2 className="text-base font-semibold text-fg">Mensajes procesados</h2>
            <p className="text-sm text-mist">Últimos 7 días, todos los números</p>
            <div className="mt-4">
              {dias === null ? (
                <div className="flex h-[220px] items-center justify-center text-sm text-mist">Cargando…</div>
              ) : (
                <AreaTrend data={chartData} keys={[{ key: "mensajes", name: "Mensajes", color: "var(--color-lime)" }]} />
              )}
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-card p-5">
            <h2 className="text-base font-semibold text-fg">Por número</h2>
            <p className="text-sm text-mist">Mensajes de este mes</p>
            {porNegocio.length === 0 ? (
              <p className="mt-8 text-center text-sm text-mist">Todavía sin mensajes este mes.</p>
            ) : (
              <>
                <Donut data={porNegocio} />
                <div className="mt-2 space-y-2">
                  {porNegocio.map((d) => (
                    <div key={d.name} className="flex items-center gap-2.5 text-sm">
                      <span className="size-2.5 rounded-full" style={{ background: d.color }} />
                      <span className="truncate text-mist">{d.name}</span>
                      <span className="ml-auto font-medium tabular-nums text-fg">{d.value.toLocaleString("es-CO")}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-edge bg-card p-5">
          <h2 className="text-base font-semibold text-fg">Tus números</h2>
          <div className="mt-4 divide-y divide-edge">
            {negocios?.map((n) => (
              <div key={n.phone_number_id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-fg">{n.nombre_negocio}</p>
                  <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">
                    {formatearTelefono(n.telefono_negocio)}
                  </p>
                </div>
                <span className="text-sm tabular-nums text-mist">
                  {n.mensajes_usados.toLocaleString("es-CO")}
                  {n.mensajes_limite !== null && ` / ${n.mensajes_limite.toLocaleString("es-CO")}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
