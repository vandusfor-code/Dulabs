"use client";

import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Panel coherente para los tabs aún sin lógica (Flow, Engagement, Recovery,
 * Settings). Muestra el propósito del tab y qué traerá, sin simular backend.
 */
export function TabPlaceholder({
  icon: Icon,
  title,
  description,
  bullets,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  bullets: string[];
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-edge bg-card px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-lime/10 text-lime-text">
        <Icon className="size-6" strokeWidth={1.6} />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-fg">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-mist">{description}</p>
      <ul className="mt-5 space-y-1.5 text-left text-sm text-mist">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-lime/60" />
            {b}
          </li>
        ))}
      </ul>
      <span className="mt-6 rounded-full border border-edge px-3 py-1 text-xs font-medium text-mist">
        {t("Próximamente", "Coming soon")}
      </span>
    </div>
  );
}
