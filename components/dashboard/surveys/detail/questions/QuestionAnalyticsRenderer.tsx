"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { pct, type OptionAggregate, type QuestionAnalytics, type SurveyQuestionDef } from "@/lib/survey-questions";

const nf = (n: number) => n.toLocaleString("es-CO");
const pf = (n: number) => n.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * Dispatcher central: elige la visualización según `question.type`.
 * (Nunca un componente gigante con condicionales dispersos por la página.)
 */
export function QuestionAnalyticsRenderer({
  question,
  analytics,
}: {
  question: SurveyQuestionDef;
  analytics: QuestionAnalytics | undefined;
}) {
  if (!analytics || analytics.answered === 0) return <QuestionEmptyState />;

  switch (question.type) {
    case "single_choice":
    case "multiple_choice":
    case "yes_no":
      return (
        <ChoiceDistribution
          analytics={analytics}
          note={question.type === "multiple_choice"}
        />
      );
    case "category":
    case "location":
      return <ChoiceDistribution analytics={analytics} sortByCount searchable />;
    case "scale":
    case "rating":
      return <ChoiceDistribution analytics={analytics} />;
    case "nps":
      return <ChoiceDistribution analytics={analytics} />;
    case "free_text":
      return <TextResponseAnalysis analytics={analytics} />;
    default:
      return <ChoiceDistribution analytics={analytics} />;
  }
}

function DistributionRow({ option, answered }: { option: OptionAggregate; answered: number }) {
  const percentage = pct(option.count, answered);
  return (
    <div className="grid grid-cols-[minmax(110px,1.3fr)_2fr_64px_116px] items-center gap-x-4 py-2.5">
      <span className="flex items-center gap-2.5 text-sm text-fg">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color ?? "var(--color-lime)" }} />
        <span className="truncate">{option.label}</span>
      </span>
      <div className="h-2 overflow-hidden rounded-full bg-ink">
        <div className="h-full rounded-full bg-lime" style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-right text-sm tabular-nums text-fg">{nf(option.count)}</span>
      <span className="text-right text-sm tabular-nums text-mist">{pf(percentage)}%</span>
    </div>
  );
}

function ChoiceDistribution({
  analytics,
  note,
  sortByCount,
  searchable,
}: {
  analytics: QuestionAnalytics;
  note?: boolean;
  sortByCount?: boolean;
  searchable?: boolean;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const base = analytics.options ?? [];
  const ordered = sortByCount ? [...base].sort((a, b) => b.count - a.count) : base;
  const filtered = search ? ordered.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase())) : ordered;

  const many = filtered.length > 12;
  const rows = many && !showAll && !search ? filtered.slice(0, 8) : filtered;

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-fg">{t("Distribución de respuestas", "Response distribution")}</h3>
        {searchable && base.length > 12 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-mist" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Buscar opción…", "Search option…")}
              aria-label={t("Buscar opción", "Search option")}
              className="w-40 rounded-lg border border-edge bg-ink py-1.5 pl-8 pr-2 text-xs text-fg outline-none placeholder:text-mist focus:border-lime/50"
            />
          </div>
        )}
      </div>

      {note && (
        <p className="mt-1 text-xs text-mist">
          {t(
            "El % representa participantes que eligieron cada opción y puede superar 100%.",
            "The % represents participants who chose each option and may exceed 100%."
          )}
        </p>
      )}

      <div className="mt-4">
        <div className="grid grid-cols-[minmax(110px,1.3fr)_2fr_64px_116px] items-center gap-x-4 border-b border-edge pb-2">
          <span className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Opción", "Option")}</span>
          <span />
          <span className="text-right font-mono text-[10.5px] uppercase tracking-widest text-mist">{t("Cantidad", "Count")}</span>
          <span className="text-right font-mono text-[10.5px] uppercase tracking-widest text-mist">
            {t("% Participación", "% Share")}
          </span>
        </div>

        <div className="divide-y divide-edge/60">
          {rows.map((o) => (
            <DistributionRow key={o.label} option={o} answered={analytics.answered} />
          ))}
        </div>

        {many && !search && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-2 text-sm font-medium text-lime-text transition-opacity hover:opacity-80"
          >
            {showAll ? t("Ver menos", "Show less") : t(`Ver todas (${filtered.length})`, `View all (${filtered.length})`)}
          </button>
        )}

        {!note && (
          <div className="mt-1 grid grid-cols-[minmax(110px,1.3fr)_2fr_64px_116px] items-center gap-x-4 border-t border-edge pt-3">
            <span className="text-sm font-semibold text-lime-text">{t("TOTAL", "TOTAL")}</span>
            <span />
            <span className="text-right text-sm font-semibold tabular-nums text-lime-text">{nf(analytics.answered)}</span>
            <span className="text-right text-sm font-semibold tabular-nums text-lime-text">100%</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TextResponseAnalysis({ analytics }: { analytics: QuestionAnalytics }) {
  const { t, lang } = useI18n();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(4);
  const all = analytics.textResponses ?? [];
  const filtered = search ? all.filter((r) => r.text.toLowerCase().includes(search.trim().toLowerCase())) : all;
  const shown = filtered.slice(0, limit);

  const fmt = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    const months = lang === "en"
      ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
      : ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
  };

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-fg">{t("Respuestas", "Responses")}</h3>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-mist" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Buscar en respuestas…", "Search responses…")}
            aria-label={t("Buscar en respuestas", "Search responses")}
            className="w-48 rounded-lg border border-edge bg-ink py-1.5 pl-8 pr-2 text-xs text-fg outline-none placeholder:text-mist focus:border-lime/50"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-6 text-sm text-mist">{t("Sin respuestas que coincidan.", "No matching responses.")}</p>
      ) : (
        <div className="mt-4 space-y-2.5">
          {shown.map((r) => (
            <div key={r.id} className="rounded-lg border border-edge bg-ink/40 p-3">
              <p className="text-sm leading-relaxed text-fg">{r.text}</p>
              <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-widest text-mist">{fmt(r.createdAt)}</p>
            </div>
          ))}
        </div>
      )}

      {filtered.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 4)}
          className="mt-3 text-sm font-medium text-lime-text transition-opacity hover:opacity-80"
        >
          {t("Ver más", "Show more")}
        </button>
      )}
    </div>
  );
}

function QuestionEmptyState() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-edge bg-card p-6 text-center text-sm text-mist">
      {t("Aún no hay respuestas para esta pregunta.", "There are no responses for this question yet.")}
    </div>
  );
}
