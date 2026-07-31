"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Send, PlayCircle, CircleCheck, Gauge, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { SurveyKpiCard } from "@/components/dashboard/surveys/SurveyKpiCard";
import { SurveyPerformanceChart } from "@/components/dashboard/surveys/SurveyPerformanceChart";
import { CompletionFunnel } from "@/components/dashboard/surveys/CompletionFunnel";
import { SurveysTable } from "@/components/dashboard/surveys/SurveysTable";
import { AIInsightsPanel } from "@/components/dashboard/surveys/AIInsightsPanel";
import type { SurveyDashboard } from "@/lib/surveys";
import { useDashboard } from "@/lib/dashboard-session";
import { useI18n } from "@/lib/i18n";

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      <span className="text-xs text-mist">{label}</span>
    </div>
  );
}

export default function SurveysPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { session } = useDashboard();
  const [data, setData] = useState<SurveyDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!session) return;
    fetch("/api/dashboard/surveys", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? t("Error cargando encuestas", "Error loading surveys"));
        setData(json as SurveyDashboard);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [session, t]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const header = (
    <PageHeader
      eyebrow={t("Encuestas", "Surveys")}
      title={t("Encuestas", "Surveys")}
      description={t(
        "Crea encuestas conversacionales por WhatsApp y analiza las respuestas en tiempo real.",
        "Create conversational WhatsApp surveys and analyze responses in real time."
      )}
    >
      <Link
        href="/dashboard/surveys/new"
        className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-2 text-sm font-medium text-lime-fg transition-opacity hover:opacity-90"
      >
        <Plus className="size-4" /> {t("Nueva encuesta", "New survey")}
      </Link>
    </PageHeader>
  );

  if (error) {
    return (
      <div className="pb-12">
        {header}
        <div className="px-4 pt-6 md:px-8">
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="pb-12">
        {header}
        <div className="px-4 pt-6 md:px-8">
          <p className="text-sm text-mist">{t("Cargando…", "Loading…")}</p>
        </div>
      </div>
    );
  }

  if (data.surveys.length === 0) {
    return (
      <div className="pb-12">
        {header}
        <div className="px-4 pt-6 md:px-8">
          <div className="rounded-xl border border-edge bg-card p-10 text-center">
            <ClipboardList className="mx-auto size-10 text-mist/40" strokeWidth={1.2} />
            <p className="mt-3 text-sm font-semibold text-fg">
              {t("Todavía no tienes ninguna encuesta", "You don't have any survey yet")}
            </p>
            <p className="mt-1 text-sm text-mist">
              {t(
                "Crea tu primera encuesta conversacional para WhatsApp — puedes escribir las preguntas o importarlas desde un Excel.",
                "Create your first conversational WhatsApp survey — write the questions or import them from an Excel file."
              )}
            </p>
            <Link
              href="/dashboard/surveys/new"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-lime-fg hover:bg-lime-hover"
            >
              <Plus className="size-3.5" /> {t("Crear encuesta →", "Create survey →")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { kpis } = data;

  return (
    <div className="pb-12">
      {header}

      <div className="px-4 pt-6 md:px-8">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SurveyKpiCard
            label={t("Encuestas enviadas", "Surveys sent")}
            value={kpis.sent.toLocaleString("es-CO")}
            delta={`${kpis.deltas.sent >= 0 ? "+" : ""}${kpis.deltas.sent}%`}
            comparison={t("vs. últimos 30 días", "vs last 30 days")}
            icon={Send}
          />
          <SurveyKpiCard
            label={t("Iniciadas", "Started")}
            value={kpis.started.toLocaleString("es-CO")}
            delta={`${kpis.deltas.started >= 0 ? "+" : ""}${kpis.deltas.started}%`}
            comparison={t("vs. últimos 30 días", "vs last 30 days")}
            icon={PlayCircle}
          />
          <SurveyKpiCard
            label={t("Completadas", "Completed")}
            value={kpis.completed.toLocaleString("es-CO")}
            delta={`${kpis.deltas.completed >= 0 ? "+" : ""}${kpis.deltas.completed}%`}
            comparison={t("vs. últimos 30 días", "vs last 30 days")}
            icon={CircleCheck}
          />
          <SurveyKpiCard
            label={t("Tasa de finalización", "Completion rate")}
            value={`${kpis.completionRate.toLocaleString(t("es-CO", "en-US"), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
            delta={`${kpis.deltas.completionRate >= 0 ? "+" : ""}${kpis.deltas.completionRate}%`}
            comparison={t("vs. últimos 30 días", "vs last 30 days")}
            icon={Gauge}
          />
        </div>

        {/* Performance + Funnel */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-edge bg-card p-5 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg">{t("Rendimiento de encuestas", "Survey performance")}</h2>
                <p className="text-sm text-mist">{t("Iniciadas vs. completadas, últimas 6 semanas", "Started vs. completed, last 6 weeks")}</p>
              </div>
              <div className="flex items-center gap-4">
                <Legend color="var(--color-chart-4)" label={t("Iniciadas", "Started")} />
                <Legend color="var(--color-lime)" label={t("Completadas", "Completed")} />
              </div>
            </div>
            <div className="mt-4">
              <SurveyPerformanceChart data={data.performance} />
            </div>
          </div>

          <CompletionFunnel steps={data.funnel} />
        </div>

        {/* Table + AI insights */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SurveysTable surveys={data.surveys} onRowClick={(s) => router.push(`/dashboard/surveys/${s.id}`)} />
          </div>
          <AIInsightsPanel insights={data.insights} onViewReport={cargar} />
        </div>
      </div>
    </div>
  );
}
