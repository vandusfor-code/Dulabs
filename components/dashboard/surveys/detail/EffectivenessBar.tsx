"use client";

import { Info } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { completedCount, nonEffectiveCount, pct, type SurveyDetail } from "@/lib/survey-detail";

const nf = (n: number) => n.toLocaleString("es-CO");
const pf = (n: number) => n.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const NON_EFFECTIVE_COLOR = "#f59e0b";

export function EffectivenessBar({ detail }: { detail: SurveyDetail }) {
  const { t } = useI18n();
  const completed = completedCount(detail);
  const nonEffective = nonEffectiveCount(detail);
  const effPct = pct(completed, detail.sent);
  const ineffPct = Math.max(0, 100 - effPct);

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="flex items-center gap-1.5">
        <h2 className="text-base font-semibold text-fg">{t("Efectividad de la encuesta", "Survey effectiveness")}</h2>
        <Info className="size-3.5 text-mist" />
      </div>

      <div className="mt-4 flex items-start justify-between gap-4 text-sm">
        <div>
          <p className="text-mist">{t("Respondió encuesta", "Completed")}</p>
          <p className="mt-0.5 font-semibold tabular-nums text-lime-text">
            {nf(completed)} ({pf(effPct)}%)
          </p>
        </div>
        <div className="text-right">
          <p className="text-mist">{t("No efectiva", "Non-effective")}</p>
          <p className="mt-0.5 font-semibold tabular-nums" style={{ color: NON_EFFECTIVE_COLOR }}>
            {nf(nonEffective)} ({pf(ineffPct)}%)
          </p>
        </div>
      </div>

      <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-ink" aria-hidden>
        <div className="h-full bg-lime" style={{ width: `${effPct}%` }} />
        <div className="h-full" style={{ width: `${ineffPct}%`, backgroundColor: NON_EFFECTIVE_COLOR }} />
      </div>
    </div>
  );
}
