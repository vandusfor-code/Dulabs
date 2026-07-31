"use client";

import { RotateCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { AIInsights } from "@/lib/surveys";

// Positivo → verde de marca; Neutral → azul de la plataforma; Negativo → rojo.
const SENTIMENT_COLORS = {
  positive: "var(--color-lime)",
  neutral: "var(--color-chart-4)",
  negative: "#e85d68",
} as const;

export function AIInsightsPanel({
  insights,
  onViewReport,
}: {
  insights: AIInsights | null;
  onViewReport?: () => void;
}) {
  const { t } = useI18n();

  if (!insights) {
    return (
      <div className="flex flex-col rounded-xl border border-edge bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">{t("Insights de IA", "AI insights")}</h2>
          <span className="rounded-full bg-lime/12 px-2 py-0.5 text-[11px] font-semibold text-lime-text">Beta</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-mist">
          {t(
            "Aún no hay suficientes respuestas de texto libre para un análisis de sentimiento. Aparece automáticamente cuando tus encuestas empiecen a recibir respuestas.",
            "There aren't enough open-text responses yet for a sentiment analysis. This appears automatically once your surveys start getting responses."
          )}
        </p>
      </div>
    );
  }

  const { sentiment, topics, completedResponses } = insights;

  const nf = (n: number) => n.toLocaleString("es-CO");
  const sentimentRows = [
    { key: "positive" as const, label: t("Positivo", "Positive"), ...sentiment.positive },
    { key: "neutral" as const, label: t("Neutral", "Neutral"), ...sentiment.neutral },
    { key: "negative" as const, label: t("Negativo", "Negative"), ...sentiment.negative },
  ];

  return (
    <div className="flex flex-col rounded-xl border border-edge bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">{t("Insights de IA", "AI insights")}</h2>
        <span className="rounded-full bg-lime/12 px-2 py-0.5 text-[11px] font-semibold text-lime-text">Beta</span>
      </div>
      <p className="mt-0.5 text-sm text-mist">
        {t(`Basado en ${nf(completedResponses)} respuestas completadas`, `Based on ${nf(completedResponses)} completed responses`)}
      </p>

      {/* Sentiment */}
      <p className="mt-5 text-sm font-medium text-fg">{t("Sentimiento general", "Overall sentiment")}</p>
      <div className="mt-2 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {sentimentRows.map((row) => (
          <div
            key={row.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${row.percentage}%`, background: SENTIMENT_COLORS[row.key] }}
            aria-hidden
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        {sentimentRows.map((row) => (
          <span key={row.key} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: SENTIMENT_COLORS[row.key] }} />
            <span className="text-fg">{row.label}</span>
            <span className="tabular-nums text-mist">
              {row.percentage}% ({nf(row.count)})
            </span>
          </span>
        ))}
      </div>

      {/* Top topics */}
      <p className="mt-5 text-sm font-medium text-fg">{t("Temas principales", "Top topics")}</p>
      <div className="mt-2 space-y-1.5">
        {topics.map((topic) => (
          <div
            key={topic.label}
            className="flex items-center justify-between rounded-lg bg-ink px-3 py-2 text-sm"
          >
            <span className="truncate text-fg">{topic.label}</span>
            <span className="ml-3 shrink-0 rounded-md bg-card px-2 py-0.5 text-xs font-medium tabular-nums text-mist">
              {topic.percentage}%
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onViewReport}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-lime/40 px-4 py-2.5 text-sm font-medium text-lime-text transition-colors hover:bg-lime/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
      >
        {t("Actualizar análisis", "Refresh analysis")}
        <RotateCw className="size-4" />
      </button>
    </div>
  );
}
