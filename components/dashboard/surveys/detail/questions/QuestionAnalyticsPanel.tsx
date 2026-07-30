"use client";

import { Eye, MoreVertical, ListChecks, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  TYPE_LABEL,
  computeInsight,
  pct,
  type QuestionAnalytics,
  type SurveyQuestionDef,
} from "@/lib/survey-questions";
import { QuestionKpiCard } from "./QuestionKpiCard";
import { QuestionAnalyticsRenderer } from "./QuestionAnalyticsRenderer";

const round = (n: number) => Math.round(n);

function buildKpis(
  q: SurveyQuestionDef,
  a: QuestionAnalytics | undefined,
  completed: number,
  t: (es: string, en: string) => string
): { label: string; value: string; hint: string }[] {
  if (!a) return [];
  const completedHint = (n: number) => `${round(pct(n, completed))}% ${t("del total de completadas", "of total completed")}`;
  const answered = { label: t("Respondidas", "Answered"), value: String(a.answered), hint: completedHint(a.answered) };
  const skipped = { label: t("Sin respuesta", "Skipped"), value: String(a.skipped), hint: completedHint(a.skipped) };
  const time = a.averageSeconds != null
    ? { label: t("Tiempo promedio", "Avg. time"), value: `${a.averageSeconds}s`, hint: t("Tiempo para responder", "Time to answer") }
    : null;

  switch (q.type) {
    case "nps":
      return [
        { label: "NPS", value: String(a.nps?.score ?? 0), hint: t("Puntaje NPS", "NPS score") },
        { label: t("Promotores", "Promoters"), value: String(a.nps?.promoters ?? 0), hint: "9–10" },
        { label: t("Pasivos", "Passives"), value: String(a.nps?.passives ?? 0), hint: "7–8" },
        { label: t("Detractores", "Detractors"), value: String(a.nps?.detractors ?? 0), hint: "0–6" },
      ];
    case "scale":
    case "rating": {
      const max = q.config?.scaleMax ?? 10;
      return [
        answered,
        { label: t("Promedio", "Average"), value: String(a.numeric?.average ?? 0), hint: t(`sobre ${max}`, `out of ${max}`) },
        { label: t("Mediana", "Median"), value: String(a.numeric?.median ?? 0), hint: t(`sobre ${max}`, `out of ${max}`) },
        ...(time ? [time] : []),
      ];
    }
    case "multiple_choice":
      return [
        answered,
        skipped,
        {
          label: t("Selecciones", "Selections"),
          value: a.totalSelections != null && a.answered > 0 ? (a.totalSelections / a.answered).toFixed(1) : "—",
          hint: t("Promedio por participante", "Average per participant"),
        },
        ...(time ? [time] : []),
      ];
    case "free_text":
      return [
        answered,
        skipped,
        { label: t("Participantes únicos", "Unique respondents"), value: String(a.uniqueRespondents), hint: t("Respondieron", "Responded") },
      ];
    default: {
      const selected = (a.options ?? []).filter((o) => o.count > 0).length;
      return [
        answered,
        skipped,
        { label: t("Respuestas únicas", "Unique answers"), value: String(selected), hint: t("Opciones seleccionadas", "Options selected") },
        ...(time ? [time] : []),
      ];
    }
  }
}

export function QuestionAnalyticsPanel({
  question,
  analytics,
  index,
  total,
  completed,
  onToast,
}: {
  question: SurveyQuestionDef;
  analytics: QuestionAnalytics | undefined;
  index: number;
  total: number;
  completed: number;
  onToast: (msg: string) => void;
}) {
  const { t } = useI18n();
  const kpis = buildKpis(question, analytics, completed, t);
  const insight = computeInsight(question, analytics ?? { questionId: question.id, answered: 0, skipped: 0, uniqueRespondents: 0 }, t);

  return (
    <div className="min-w-0 space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-edge bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="rounded-full bg-lime/12 px-2.5 py-0.5 text-xs font-medium text-lime-text">
            {t("Pregunta", "Question")} {index + 1} {t("de", "of")} {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onToast(t("Las respuestas individuales llegarán con el backend", "Individual responses will arrive with the backend"))}
              className="flex items-center gap-2 rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:border-lime/40"
            >
              <Eye className="size-4" /> {t("Ver respuesta individual", "View individual response")}
            </button>
            <button
              type="button"
              aria-label={t("Más acciones", "More actions")}
              onClick={() => onToast(t("Más acciones próximamente", "More actions coming soon"))}
              className="flex size-8 items-center justify-center rounded-lg text-mist transition-colors hover:bg-ink hover:text-fg"
            >
              <MoreVertical className="size-4" />
            </button>
          </div>
        </div>
        <h2 className="mt-3 text-lg font-semibold leading-snug text-fg">{question.text}</h2>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-mist">
          <ListChecks className="size-3.5" /> {t("Tipo", "Type")}: {t(TYPE_LABEL[question.type].es, TYPE_LABEL[question.type].en)}
        </p>
      </div>

      {/* Contextual KPIs */}
      {kpis.length > 0 && analytics && analytics.answered > 0 && (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {kpis.map((k) => (
            <QuestionKpiCard key={k.label} label={k.label} value={k.value} hint={k.hint} />
          ))}
        </div>
      )}

      {/* Visualization by type */}
      <QuestionAnalyticsRenderer question={question} analytics={analytics} />

      {/* Insight */}
      {insight && (
        <div className="rounded-xl border border-lime/20 bg-lime/[0.04] p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-lime-text" />
            <span className="text-sm font-semibold text-fg">Insight</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-mist">{insight}</p>
        </div>
      )}
    </div>
  );
}
