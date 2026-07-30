"use client";

import { Info } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { STATUS_META, STATUS_ORDER, nonEffectiveCount, pct, type SurveyDetail } from "@/lib/survey-detail";

const nf = (n: number) => n.toLocaleString("es-CO");
const pf = (n: number) => n.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function NonEffectiveBreakdown({ detail }: { detail: SurveyDetail }) {
  const { t } = useI18n();
  const nonEffective = nonEffectiveCount(detail);
  const byStatus = new Map(detail.results.map((r) => [r.status, r.count]));
  const rows = STATUS_ORDER.filter((s) => s !== "completed").map((status) => ({
    status,
    count: byStatus.get(status) ?? 0,
  }));
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold text-fg">{t("Detalle de no efectivas", "Non-effective breakdown")}</h2>
          <Info className="size-3.5 text-mist" />
        </div>
        <span className="text-xs text-mist">
          {t("Total", "Total")}: {nf(nonEffective)} (100%)
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {rows.map(({ status, count }) => {
          const meta = STATUS_META[status];
          return (
            <div
              key={status}
              className="grid grid-cols-[minmax(120px,1.1fr)_minmax(80px,1.6fr)_auto_auto] items-center gap-x-4"
            >
              <span className="truncate text-sm text-fg">{t(meta.es, meta.en)}</span>
              <div className="h-2 overflow-hidden rounded-full bg-ink">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(count / max) * 100}%`, backgroundColor: meta.color }}
                />
              </div>
              <span className="text-right text-sm tabular-nums text-fg">{nf(count)}</span>
              <span className="w-16 text-right text-sm tabular-nums text-mist">({pf(pct(count, nonEffective))}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
