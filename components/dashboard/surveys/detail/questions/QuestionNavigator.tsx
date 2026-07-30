"use client";

import { useMemo, useState } from "react";
import { Search, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { QuestionAnalytics, SurveyQuestionDef } from "@/lib/survey-questions";

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

const COLLAPSED_COUNT = 8;

export function QuestionNavigator({
  questions,
  analytics,
  selectedId,
  onSelect,
}: {
  questions: SurveyQuestionDef[];
  analytics: Record<string, QuestionAnalytics>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q === "" ? questions : questions.filter((x) => x.text.toLowerCase().includes(q));
  }, [questions, search]);

  const visible = expanded || search ? filtered : filtered.slice(0, COLLAPSED_COUNT);

  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-edge bg-card">
      <div className="flex items-center justify-between p-5 pb-3">
        <h2 className="text-base font-semibold text-fg">{t("Preguntas", "Questions")}</h2>
        <span className="text-sm text-mist">
          {questions.length} {t("en total", "total")}
        </span>
      </div>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Buscar pregunta…", "Search question…")}
            aria-label={t("Buscar pregunta", "Search question")}
            className="w-full rounded-lg border border-edge bg-ink py-2 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-mist focus:border-lime/50"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {visible.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-mist">{t("Sin coincidencias.", "No matches.")}</p>
        ) : (
          visible.map((q) => {
            const a = analytics[q.id];
            const answered = a?.answered ?? 0;
            const selected = q.id === selectedId;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => onSelect(q.id)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  selected ? "border-lime/60 bg-lime/[0.04]" : "border-transparent hover:border-edge hover:bg-ink/60"
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-ink font-mono text-[11px] font-medium text-mist">
                  P{q.order}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{q.text}</span>
                  <span className="mt-0.5 block text-xs text-mist">
                    {answered} {answered === 1 ? t("respuesta", "response") : t("respuestas", "responses")}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      {!search && questions.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center justify-between border-t border-edge px-5 py-3 text-sm text-mist transition-colors hover:text-fg"
        >
          {expanded
            ? t("Ver menos", "Show less")
            : t(`Ver todas las preguntas (${questions.length})`, `View all questions (${questions.length})`)}
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}
