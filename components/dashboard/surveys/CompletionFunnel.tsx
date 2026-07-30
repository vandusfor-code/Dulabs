"use client";

import { Send, MessageSquare, ListOrdered, CircleCheck, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { FunnelStep, FunnelStepKey } from "@/lib/surveys";

const STEP_ICON: Record<FunnelStepKey, LucideIcon> = {
  invited: Send,
  started: MessageSquare,
  q5: ListOrdered,
  q10: ListOrdered,
  completed: CircleCheck,
};

export function CompletionFunnel({ steps }: { steps: FunnelStep[] }) {
  const { t } = useI18n();

  const label = (key: FunnelStepKey): string => {
    switch (key) {
      case "invited":
        return t("Invitados", "Invited");
      case "started":
        return t("Iniciaron", "Started");
      case "completed":
        return t("Completaron", "Completed");
      case "q5":
        return "Q5";
      case "q10":
        return "Q10";
    }
  };

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <h2 className="text-base font-semibold text-fg">{t("Embudo de finalización", "Completion funnel")}</h2>
      <p className="text-sm text-mist">{t("Últimos 30 días", "Last 30 days")}</p>

      <div className="mt-5 space-y-4">
        {steps.map((step) => {
          const Icon = STEP_ICON[step.key];
          return (
            <div key={step.key}>
              <div className="flex items-center gap-2.5 text-sm">
                <Icon className="size-4 shrink-0 text-mist" strokeWidth={1.8} />
                <span className="text-fg">{label(step.key)}</span>
                <span className="ml-auto font-medium tabular-nums text-fg">
                  {step.value.toLocaleString("es-CO")}
                </span>
                <span className="w-14 shrink-0 text-right tabular-nums text-mist">
                  {step.percentage.toLocaleString(t("es-CO", "en-US"), {
                    minimumFractionDigits: step.percentage === 100 ? 0 : 1,
                    maximumFractionDigits: 1,
                  })}
                  %
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink">
                <div className="h-full rounded-full bg-lime" style={{ width: `${step.percentage}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
