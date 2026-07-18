"use client";

import { useEffect, useState } from "react";
import { MessagesSquare, TrendingUp, Phone, Bot, LayoutTemplate, Timer } from "lucide-react";
import { useDashboard } from "@/lib/dashboard-session";
import { formatearTelefono } from "@/lib/format";
import { PageHeader, StatTile } from "@/components/dashboard/shell/ui";
import { AreaTrend, Donut } from "@/components/dashboard/shell/charts";
import { useI18n } from "@/lib/i18n";

const COLORES_DONUT = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

const BLOQUES_HORA = [0, 3, 6, 9, 12, 15, 18, 21];

type Analytics = {
  funnel: { enviados: number; entregados: number; leidos: number; respondidos: number };
  heatmap: number[][];
  canales: { canal: string; cantidad: number }[];
  topPlantillas: { nombre: string; enviados: number; tasaLectura: number; tasaRespuesta: number }[];
  primeraRespuesta: { promedioSeg: number | null };
};

function formatearDuracion(seg: number, t: (es: string, en: string) => string): string {
  if (seg < 60) return `${Math.round(seg)}${t("s", "s")}`;
  const min = Math.floor(seg / 60);
  const resto = Math.round(seg % 60);
  return `${min}${t("m", "m")} ${resto}${t("s", "s")}`;
}

export default function AnalyticsPage() {
  const { session, negocios } = useDashboard();
  const { t } = useI18n();
  const DIAS_SEMANA = [t("Lun", "Mon"), t("Mar", "Tue"), t("Mié", "Wed"), t("Jue", "Thu"), t("Vie", "Fri"), t("Sáb", "Sat"), t("Dom", "Sun")];
  const CANAL_LABEL: Record<string, string> = { ia: "IA", "campaña": t("Campañas", "Campaigns"), manual: t("Manual", "Manual") };
  const CANAL_COLOR: Record<string, string> = {
    ia: "var(--color-chart-1)",
    "campaña": "var(--color-chart-2)",
    manual: "var(--color-chart-3)",
  };
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
    label: new Date(d.fecha + "T00:00:00").toLocaleDateString(t("es-CO", "en-US"), { weekday: "short" }),
    mensajes: d.cantidad,
  }));

  const porNegocio = (negocios ?? [])
    .filter((n) => n.mensajes_usados > 0)
    .map((n, i) => ({ name: n.nombre_negocio, value: n.mensajes_usados, color: COLORES_DONUT[i % COLORES_DONUT.length] }));

  const funnel = analytics?.funnel;
  const etapasFunnel = funnel
    ? [
        { etiqueta: t("Enviados", "Sent"), valor: funnel.enviados },
        { etiqueta: t("Entregados", "Delivered"), valor: funnel.entregados },
        { etiqueta: t("Leídos", "Read"), valor: funnel.leidos },
        { etiqueta: t("Respondidos", "Replied"), valor: funnel.respondidos },
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
        description={t(
          "El estado real de tu operación en WhatsApp: mensajes procesados, ritmo diario y distribución por número.",
          "The real state of your WhatsApp operation: messages processed, daily pace, and distribution by number."
        )}
      />

      <div className="px-4 pt-6 md:px-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label={t("Mensajes este mes", "Messages this month")} value={mensajesUsados.toLocaleString("es-CO")} icon={MessagesSquare} />
          <StatTile label={t("Últimos 7 días", "Last 7 days")} value={totalSemana.toLocaleString("es-CO")} icon={TrendingUp} />
          <StatTile label={t("Promedio diario", "Daily average")} value={promedioDiario.toLocaleString("es-CO")} icon={Bot} />
          <StatTile label={t("Números activos", "Active numbers")} value={String(numerosActivos)} icon={Phone} />
          <StatTile
            label={t("Tiempo de primera respuesta", "First response time")}
            value={
              analytics?.primeraRespuesta.promedioSeg != null
                ? formatearDuracion(analytics.primeraRespuesta.promedioSeg, t)
                : "—"
            }
            icon={Timer}
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-edge bg-card p-5 lg:col-span-2">
            <h2 className="text-base font-semibold text-fg">{t("Mensajes procesados", "Messages processed")}</h2>
            <p className="text-sm text-mist">{t("Últimos 7 días, todos los números", "Last 7 days, all numbers")}</p>
            <div className="mt-4">
              {dias === null ? (
                <div className="flex h-[220px] items-center justify-center text-sm text-mist">{t("Cargando…", "Loading…")}</div>
              ) : (
                <AreaTrend data={chartData} keys={[{ key: "mensajes", name: t("Mensajes", "Messages"), color: "var(--color-lime)" }]} />
              )}
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-card p-5">
            <h2 className="text-base font-semibold text-fg">{t("Por número", "By number")}</h2>
            <p className="text-sm text-mist">{t("Mensajes de este mes", "Messages this month")}</p>
            {porNegocio.length === 0 ? (
              <p className="mt-8 text-center text-sm text-mist">{t("Todavía sin mensajes este mes.", "No messages yet this month.")}</p>
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
              <h2 className="text-base font-semibold text-fg">{t("Embudo de entrega", "Delivery funnel")}</h2>
              <p className="text-sm text-mist">{t("Últimos 30 días, todos los números", "Last 30 days, all numbers")}</p>
            </div>
            {funnel && funnel.enviados > 0 && (
              <span className="rounded-full bg-lime/10 px-2.5 py-1 text-xs font-semibold text-lime-text">
                {Math.round((funnel.respondidos / baseFunnel) * 100)}% {t("respondido", "replied")}
              </span>
            )}
          </div>
          {!funnel || funnel.enviados === 0 ? (
            <p className="mt-6 text-sm text-mist">{t("Todavía sin mensajes en los últimos 30 días.", "No messages yet in the last 30 days.")}</p>
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
            <h2 className="text-base font-semibold text-fg">{t("Mapa de actividad", "Activity map")}</h2>
            <p className="text-sm text-mist">{t("Cuándo responden tus clientes — últimos 30 días", "When your customers reply — last 30 days")}</p>
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
                        title={`${dia} ${String(BLOQUES_HORA[j]).padStart(2, "0")}:00 — ${valor} ${t("respuestas", "replies")}`}
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
            <h2 className="text-base font-semibold text-fg">{t("Por canal", "By channel")}</h2>
            <p className="text-sm text-mist">{t("Últimos 30 días", "Last 30 days")}</p>
            {canalesData.length === 0 ? (
              <p className="mt-8 text-center text-sm text-mist">{t("Todavía sin mensajes salientes.", "No outbound messages yet.")}</p>
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
            <h2 className="text-base font-semibold text-fg">{t("Plantillas con mejor desempeño", "Top-performing templates")}</h2>
            <p className="text-sm text-mist">{t("Últimos 30 días, por envíos", "Last 30 days, by sends")}</p>
            <div className="mt-4 divide-y divide-edge">
              <div className="grid grid-cols-[1fr_repeat(3,90px)] gap-2 pb-2 font-mono text-[10.5px] uppercase tracking-widest text-mist">
                <span>{t("Plantilla", "Template")}</span>
                <span className="text-right">{t("Enviados", "Sent")}</span>
                <span className="text-right">{t("Leídas", "Read")}</span>
                <span className="text-right">{t("Respondidas", "Replied")}</span>
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
          <h2 className="text-base font-semibold text-fg">{t("Tus números", "Your numbers")}</h2>
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
