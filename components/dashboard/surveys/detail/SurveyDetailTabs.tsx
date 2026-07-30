"use client";

import { LayoutDashboard, ListChecks, MessageSquare, Users, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export type DetailTab = "resumen" | "preguntas" | "respuestas" | "participantes";

const TABS: { key: DetailTab; icon: LucideIcon; es: string; en: string }[] = [
  { key: "resumen", icon: LayoutDashboard, es: "Resumen", en: "Summary" },
  { key: "preguntas", icon: ListChecks, es: "Preguntas", en: "Questions" },
  { key: "respuestas", icon: MessageSquare, es: "Respuestas", en: "Responses" },
  { key: "participantes", icon: Users, es: "Participantes", en: "Participants" },
];

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

export function SurveyDetailTabs({ active, onChange }: { active: DetailTab; onChange: (t: DetailTab) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
              isActive ? "border-lime text-lime-text" : "border-transparent text-mist hover:text-fg"
            )}
          >
            <tab.icon className="size-4" strokeWidth={1.8} />
            {t(tab.es, tab.en)}
          </button>
        );
      })}
    </div>
  );
}
