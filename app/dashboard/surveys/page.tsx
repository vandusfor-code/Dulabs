"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Send, PlayCircle, CircleCheck, Gauge, X } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { SurveyKpiCard } from "@/components/dashboard/surveys/SurveyKpiCard";
import { SurveyPerformanceChart } from "@/components/dashboard/surveys/SurveyPerformanceChart";
import { CompletionFunnel } from "@/components/dashboard/surveys/CompletionFunnel";
import { SurveysTable } from "@/components/dashboard/surveys/SurveysTable";
import { AIInsightsPanel } from "@/components/dashboard/surveys/AIInsightsPanel";
import { surveyDashboardDemo } from "@/lib/surveys";
import { useI18n } from "@/lib/i18n";

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      <span className="text-xs text-mist">{label}</span>
    </div>
  );
}

/** Modal placeholder mientras no exista el builder / detalle / reporte real. */
function PlaceholderDialog({
  title,
  body,
  onClose,
}: {
  title: string;
  body: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-xl border border-edge bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-fg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Cerrar", "Close")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-mist transition-colors hover:bg-ink hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-mist">{body}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-lg bg-lime px-4 py-2.5 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90"
        >
          {t("Entendido", "Got it")}
        </button>
      </div>
    </div>
  );
}

export default function SurveysPage() {
  const { t } = useI18n();
  const router = useRouter();
  const data = surveyDashboardDemo;
  const [dialog, setDialog] = useState<{ title: string; body: string } | null>(null);

  const openReport = () =>
    setDialog({
      title: t("Reporte completo", "Full report"),
      body: t(
        "El reporte detallado de IA (sentimiento por tema, citas y tendencias) estará disponible cuando conectemos el motor de análisis.",
        "The detailed AI report (sentiment by topic, quotes, and trends) will be available once the analysis engine is connected."
      ),
    });

  const { kpis } = data;

  return (
    <div className="pb-12">
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

      <div className="px-4 pt-6 md:px-8">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SurveyKpiCard
            label={t("Encuestas enviadas", "Surveys sent")}
            value={kpis.sent.toLocaleString("es-CO")}
            delta={`+${kpis.deltas.sent}%`}
            comparison={t("vs. últimos 30 días", "vs last 30 days")}
            icon={Send}
          />
          <SurveyKpiCard
            label={t("Iniciadas", "Started")}
            value={kpis.started.toLocaleString("es-CO")}
            delta={`+${kpis.deltas.started}%`}
            comparison={t("vs. últimos 30 días", "vs last 30 days")}
            icon={PlayCircle}
          />
          <SurveyKpiCard
            label={t("Completadas", "Completed")}
            value={kpis.completed.toLocaleString("es-CO")}
            delta={`+${kpis.deltas.completed}%`}
            comparison={t("vs. últimos 30 días", "vs last 30 days")}
            icon={CircleCheck}
          />
          <SurveyKpiCard
            label={t("Tasa de finalización", "Completion rate")}
            value={`${kpis.completionRate.toLocaleString(t("es-CO", "en-US"), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
            delta={`+${kpis.deltas.completionRate}%`}
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
          <AIInsightsPanel insights={data.insights} onViewReport={openReport} />
        </div>
      </div>

      {dialog && <PlaceholderDialog title={dialog.title} body={dialog.body} onClose={() => setDialog(null)} />}
    </div>
  );
}
