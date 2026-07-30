"use client";

import { Info, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { STATUS_META, STATUS_ORDER, pct, type SurveyDetail } from "@/lib/survey-detail";

const nf = (n: number) => n.toLocaleString("es-CO");
const pf = (n: number) => n.toLocaleString("es-CO", { minimumFractionDigits: n % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 });

export function ResultadoBaseTable({ detail }: { detail: SurveyDetail }) {
  const { t } = useI18n();
  const byStatus = new Map(detail.results.map((r) => [r.status, r.count]));
  const rows = STATUS_ORDER.map((status) => ({ status, count: byStatus.get(status) ?? 0 }));

  return (
    <div className="flex flex-col rounded-xl border border-edge bg-card p-5">
      <div className="flex items-center gap-1.5">
        <h2 className="text-base font-semibold text-fg">{t("Resultado de la base", "Base breakdown")}</h2>
        <Info className="size-3.5 text-mist" />
      </div>

      <div className="mt-4 flex-1">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-edge pb-2.5">
          <span className="flex items-center gap-1 text-xs text-mist">
            <ChevronDown className="size-3.5" /> {t("Resultado", "Result")}
          </span>
          <span className="text-right text-xs text-mist">{t("Cantidad", "Count")}</span>
          <span className="w-24 text-right text-xs text-mist">{t("% Participación", "% Share")}</span>
        </div>

        <div className="divide-y divide-edge/60">
          {rows.map(({ status, count }) => {
            const meta = STATUS_META[status];
            return (
              <div key={status} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 py-2.5">
                <span className="flex items-center gap-2.5 text-sm text-fg">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                  <span className="truncate">{t(meta.es, meta.en)}</span>
                </span>
                <span className="text-right text-sm tabular-nums text-fg">{nf(count)}</span>
                <span className="w-24 text-right text-sm tabular-nums text-mist">{pf(pct(count, detail.sent))}%</span>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-t border-edge pt-3">
          <span className="text-sm font-semibold text-lime-text">{t("TOTAL", "TOTAL")}</span>
          <span className="text-right text-sm font-semibold tabular-nums text-lime-text">{nf(detail.sent)}</span>
          <span className="w-24 text-right text-sm font-semibold tabular-nums text-lime-text">100%</span>
        </div>
      </div>
    </div>
  );
}
