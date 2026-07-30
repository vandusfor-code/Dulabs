"use client";

import { ListChecks, Workflow, Sparkles, LifeBuoy, Settings, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export type BuilderTab = "questions" | "flow" | "engagement" | "recovery" | "settings";

const TABS: { key: BuilderTab; icon: LucideIcon; es: string; en: string }[] = [
  { key: "questions", icon: ListChecks, es: "Preguntas", en: "Questions" },
  { key: "flow", icon: Workflow, es: "Flujo", en: "Flow" },
  { key: "engagement", icon: Sparkles, es: "Interacción", en: "Engagement" },
  { key: "recovery", icon: LifeBuoy, es: "Recuperación", en: "Recovery" },
  { key: "settings", icon: Settings, es: "Ajustes", en: "Settings" },
];

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

export function BuilderTabs({ active, onChange }: { active: BuilderTab; onChange: (t: BuilderTab) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-edge px-4 md:px-6">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3.5 text-sm font-medium transition-colors",
              isActive
                ? "border-lime text-lime-text"
                : "border-transparent text-mist hover:text-fg"
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
