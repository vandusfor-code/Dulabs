"use client";

import { useEffect, useState } from "react";
import { MessagesSquare, TrendingUp, Phone, Bot, LayoutTemplate } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";
import { PageHeader, StatTile } from "@/components/dashboard/shell/ui";
import { AreaTrend, Donut } from "@/components/dashboard/shell/charts";

const COLORES_DONUT = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const BLOQUES_HORA = [0, 3, 6, 9, 12, 15, 18, 21];

const CANAL_LABEL: Record<string, string> = { ia: "IA", "campaña": "Campañas", manual: "Manual" };
const CANAL_COLOR: Record<string, string> = {
  ia: "var(--color-chart-1)",
  "campaña": "var(--color-chart-2)",
  manual: "var(--color-chart-3)",
};

type Analytics = {
  funnel: { enviados: number; entregados: number; leidos: number; respondidos: number };
  heatmap: number[][];
  canales: { canal: string; cantidad: number }[];
  topPlantillas: { nombre: string; enviados: number; tasaLectura: number; tasaRespuesta: number }[];
};

export default function AnalyticsPage() {
  const { session, negocios } = useDashboard();
  const [dias, setDias] = useState<{ fecha: string; cantidad: number }[] | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/dashboard/actividad", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setDias(data.dias ?? []))
      .catch(() => setDias([]));
    fetch("/api/dashboard/analytics", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json())
      .then((data) => setAnalytics(data))
      .catch(() => setAnalytics(null));
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

  const funnel = analytics?.funnel;
  const etapasFunnel = funnel
    ? [
        { etiqueta: "Enviados", valor: funnel.enviados },
        { etiqueta: "Entregados", valor: funnel.entregados },
        { etiqueta: "Leídos", valor: funnel.leidos },
        { etiqueta: "Respondidos", valor: funnel.respondidos },
      ]
    : [];
  const baseFunnel = funnel?.enviados || 1;

  const heatmapBloques = (analytics?.heatmap ?? []).map((horas) =>
    BLOQUES_HORA.map((h) => horas.slice(h, h + 3).reduce((a, b) => a + b, 0))
  );
  const maxHeatmap = Math.max(1, ...heatmapBloques.flat());

  const canalesData = (analytics?.canales ?? []).map((c) => ({
    name: CANAL_LABEL[c.canal] ?? c.canal,
    value: c.cantidad,
    color: CANAL_COLOR[c.canal] ?? "var(--color-chart-4)",
  }));

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
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-fg">Embudo de entrega</h2>
              <p className="text-sm text-mist">Últimos 30 días, todos los números</p>
            </div>
            {funnel && funnel.enviados > 0 && (
              <span className="rounded-full bg-lime/10 px-2.5 py-1 text-xs font-semibold text-lime-text">
                {Math.round((funnel.respondidos / baseFunnel) * 100)}% respondido
              </span>
            )}
          </div>
          {!funnel || funnel.enviados === 0 ? (
            <p className="mt-6 text-sm text-mist">Todavía sin mensajes en los últimos 30 días.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {etapasFunnel.map((e) => {
                const pct = Math.round((e.valor / baseFunnel) * 100);
                return (
                  <div key={e.etiqueta}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-fg">{e.etiqueta}</span>
                      <span className="text-mist">
                        {e.valor.toLocaleString("es-CO")} <span className="text-fg">{pct}%</span>
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-ink">
                      <div className="h-full rounded-full bg-lime" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-edge bg-card p-5 lg:col-span-2">
            <h2 className="text-base font-semibold text-fg">Mapa de actividad</h2>
            <p className="text-sm text-mist">Cuándo responden tus clientes — últimos 30 días</p>
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[520px]">
                <div className="grid grid-cols-[40px_repeat(8,1fr)] gap-1 text-[10px] text-mist">
                  <span />
                  {BLOQUES_HORA.map((h) => (
                    <span key={h} className="text-center">
                      {String(h).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                {DIAS_SEMANA.map((dia, i) => (
                  <div key={dia} className="mt-1 grid grid-cols-[40px_repeat(8,1fr)] items-center gap-1">
                    <span className="text-[10px] text-mist">{dia}</span>
                    {(heatmapBloques[i] ?? BLOQUES_HORA.map(() => 0)).map((valor, j) => (
                      <div
                        key={j}
                        title={`${dia} ${String(BLOQUES_HORA[j]).padStart(2, "0")}:00 — ${valor} respuestas`}
                        className="h-7 rounded-md bg-lime"
                        style={{ opacity: valor === 0 ? 0.06 : 0.15 + 0.85 * (valor / maxHeatmap) }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-card p-5">
            <h2 className="text-base font-semibold text-fg">Por canal</h2>
            <p className="text-sm text-mist">Últimos 30 días</p>
            {canalesData.length === 0 ? (
              <p className="mt-8 text-center text-sm text-mist">Todavía sin mensajes salientes.</p>
            ) : (
              <>
                <Donut data={canalesData} />
                <div className="mt-2 space-y-2">
                  {canalesData.map((d) => (
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

        {analytics && analytics.topPlantillas.length > 0 && (
          <div className="mt-6 rounded-xl border border-edge bg-card p-5">
            <h2 className="text-base font-semibold text-fg">Plantillas con mejor desempeño</h2>
            <p className="text-sm text-mist">Últimos 30 días, por envíos</p>
            <div className="mt-4 divide-y divide-edge">
              <div className="grid grid-cols-[1fr_repeat(3,90px)] gap-2 pb-2 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                <span>Plantilla</span>
                <span className="text-right">Enviados</span>
                <span className="text-right">Leídas</span>
                <span className="text-right">Respondidas</span>
              </div>
              {analytics.topPlantillas.map((p) => (
                <div key={p.nombre} className="grid grid-cols-[1fr_repeat(3,90px)] items-center gap-2 py-3 text-sm">
                  <span className="flex items-center gap-2 truncate font-medium text-fg">
                    <LayoutTemplate className="size-3.5 shrink-0 text-mist" /> {p.nombre}
                  </span>
                  <span className="text-right tabular-nums text-mist">{p.enviados.toLocaleString("es-CO")}</span>
                  <span className="text-right tabular-nums text-mist">{Math.round(p.tasaLectura * 100)}%</span>
                  <span className="text-right tabular-nums text-mist">{Math.round(p.tasaRespuesta * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
