"use client";

import { useMemo, useState } from "react";
import {
  Search,
  Filter,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  MoreHorizontal,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SurveyStatus, SurveySummary } from "@/lib/surveys";

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

const GRID = "grid-cols-[minmax(190px,1.6fr)_110px_72px_84px_100px_170px_minmax(96px,1fr)_40px]";

function StatusBadge({ status }: { status: SurveyStatus }) {
  const { t } = useI18n();
  const map: Record<SurveyStatus, { label: string; className: string; dot?: boolean }> = {
    active: { label: t("Activa", "Active"), className: "bg-lime/12 text-lime-text", dot: true },
    completed: { label: t("Completada", "Completed"), className: "bg-lime/8 text-lime-text/85" },
    draft: { label: t("Borrador", "Draft"), className: "bg-ink text-mist" },
    paused: { label: t("Pausada", "Paused"), className: "bg-amber-400/15 text-amber-400", dot: true },
    archived: { label: t("Archivada", "Archived"), className: "bg-ink text-mist" },
  };
  const s = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", s.className)}>
      {s.dot && <span className="size-1.5 rounded-full bg-current" />}
      {s.label}
    </span>
  );
}

function CompletionCell({ rate }: { rate: number }) {
  const { t } = useI18n();
  return (
    <div className="pr-4">
      <span className="text-sm tabular-nums text-fg">
        {rate.toLocaleString(t("es-CO", "en-US"), { minimumFractionDigits: rate % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 })}%
      </span>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink">
        <div className="h-full rounded-full bg-lime" style={{ width: `${rate}%` }} />
      </div>
    </div>
  );
}

export function SurveysTable({
  surveys,
  onRowClick,
}: {
  surveys: SurveySummary[];
  onRowClick?: (survey: SurveySummary) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | SurveyStatus>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return surveys.filter(
      (s) => (status === "all" || s.status === status) && (q === "" || s.name.toLowerCase().includes(q))
    );
  }, [surveys, search, status]);

  const columns = [
    t("Encuesta", "Survey"),
    t("Estado", "Status"),
    t("Enviadas", "Sent"),
    t("Iniciadas", "Started"),
    t("Completadas", "Completed"),
    t("Tasa de finalización", "Completion rate"),
    t("Actualizada", "Updated"),
    "",
  ];

  return (
    <div className="rounded-xl border border-edge bg-card">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-base font-semibold text-fg">{t("Todas las encuestas", "All surveys")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Buscar encuestas…", "Search surveys…")}
              aria-label={t("Buscar encuestas", "Search surveys")}
              className="w-full rounded-lg border border-edge bg-ink py-2 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-mist focus:border-lime/50 sm:w-64"
            />
          </div>
          <div className="relative">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "all" | SurveyStatus)}
              aria-label={t("Filtrar por estado", "Filter by status")}
              className="appearance-none rounded-lg border border-edge bg-ink py-2 pl-3 pr-8 text-sm text-fg outline-none focus:border-lime/50"
            >
              <option value="all">{t("Todos los estados", "All status")}</option>
              <option value="active">{t("Activa", "Active")}</option>
              <option value="completed">{t("Completada", "Completed")}</option>
              <option value="draft">{t("Borrador", "Draft")}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-mist" />
          </div>
          <div className="hidden items-center gap-2 rounded-lg border border-edge bg-ink py-2 pl-3 pr-3 text-sm text-mist sm:flex">
            <Calendar className="size-4" />
            <span>{t("Últimos 30 días", "Last 30 days")}</span>
            <ChevronDown className="size-4" />
          </div>
          <button
            type="button"
            aria-label={t("Más filtros", "More filters")}
            title={t("Más filtros", "More filters")}
            className="flex size-9 items-center justify-center rounded-lg border border-edge bg-ink text-mist transition-colors hover:border-lime/40 hover:text-fg"
          >
            <Filter className="size-4" />
          </button>
        </div>
      </div>

      {/* Tabla (scroll horizontal en pantallas estrechas) */}
      <div className="overflow-x-auto">
        <div className="min-w-[880px]">
          <div className={cn("grid items-center gap-2 border-y border-edge px-5 py-2.5", GRID)}>
            {columns.map((c, i) => (
              <span key={i} className="font-mono text-[10.5px] uppercase tracking-widest text-mist">
                {c}
              </span>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-mist">
              {t("No hay encuestas que coincidan con el filtro.", "No surveys match the current filter.")}
            </p>
          ) : (
            <div className="divide-y divide-edge">
              {filtered.map((s) => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onRowClick?.(s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick?.(s);
                    }
                  }}
                  className={cn(
                    "grid cursor-pointer items-center gap-2 px-5 py-3.5 text-sm transition-colors hover:bg-ink/60 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-lime",
                    GRID
                  )}
                >
                  {/* Survey */}
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-lime/10 text-lime-text">
                      <FileText className="size-4" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{s.name}</p>
                      <p className="mt-0.5 text-xs text-mist">
                        {s.questionCount} {t("preguntas", "questions")}
                      </p>
                    </div>
                  </div>
                  {/* Status */}
                  <div>
                    <StatusBadge status={s.status} />
                  </div>
                  {/* Sent / Started / Completed */}
                  <span className="tabular-nums text-mist">{s.sent.toLocaleString("es-CO")}</span>
                  <span className="tabular-nums text-mist">{s.started.toLocaleString("es-CO")}</span>
                  <span className="tabular-nums text-mist">{s.completed.toLocaleString("es-CO")}</span>
                  {/* Completion rate */}
                  <CompletionCell rate={s.completionRate} />
                  {/* Updated */}
                  <span className="text-mist">{t(s.updatedAt.es, s.updatedAt.en)}</span>
                  {/* Row menu */}
                  <button
                    type="button"
                    aria-label={t(`Acciones para ${s.name}`, `Actions for ${s.name}`)}
                    title={t("Acciones", "Actions")}
                    onClick={(e) => e.stopPropagation()}
                    className="flex size-8 items-center justify-center rounded-lg text-mist transition-colors hover:bg-card hover:text-fg"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer / paginación */}
      <div className="flex items-center justify-between px-5 py-3.5">
        <p className="text-xs text-mist">
          {t(
            `Mostrando ${filtered.length === 0 ? 0 : 1} a ${filtered.length} de ${filtered.length} encuestas`,
            `Showing ${filtered.length === 0 ? 0 : 1} to ${filtered.length} of ${filtered.length} surveys`
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled
            aria-label={t("Página anterior", "Previous page")}
            className="flex size-7 items-center justify-center rounded-md border border-edge text-mist disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="flex size-7 items-center justify-center rounded-md bg-lime text-xs font-semibold text-lime-fg">
            1
          </span>
          <button
            type="button"
            disabled
            aria-label={t("Página siguiente", "Next page")}
            className="flex size-7 items-center justify-center rounded-md border border-edge text-mist disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
