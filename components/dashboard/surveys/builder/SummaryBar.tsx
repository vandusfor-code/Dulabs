"use client";

import { Clock, MessageSquare, Share2, Users, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";

function Item({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex flex-1 items-center gap-3 px-5 py-4">
      <Icon className="size-5 shrink-0 text-lime-text" strokeWidth={1.8} />
      <div className="min-w-0">
        <p className="text-xs text-mist">{label}</p>
        <p className="mt-0.5 truncate text-sm font-semibold text-fg">{value}</p>
      </div>
    </div>
  );
}

export function SummaryBar({
  estMinutes,
  totalQuestions,
  conditionalPaths,
  estadoLabel,
}: {
  estMinutes: number;
  totalQuestions: number;
  conditionalPaths: number;
  estadoLabel: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col divide-y divide-edge rounded-xl border border-edge bg-card sm:flex-row sm:divide-x sm:divide-y-0">
      <Item icon={Clock} label={t("Tiempo estimado", "Est. time to complete")} value={`~ ${estMinutes} min`} />
      <Item icon={MessageSquare} label={t("Total de preguntas", "Total questions")} value={String(totalQuestions)} />
      <Item icon={Share2} label={t("Rutas condicionales", "Conditional paths")} value={String(conditionalPaths)} />
      <Item icon={Users} label={t("Estado", "Status")} value={estadoLabel} />
    </div>
  );
}
