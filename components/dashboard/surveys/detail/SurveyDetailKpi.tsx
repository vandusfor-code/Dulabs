"use client";

import type { LucideIcon } from "lucide-react";

/**
 * KPI de la pantalla de detalle: contenedor de icono con acento semántico
 * (restringido), label, valor prominente y una línea de contexto.
 */
export function SurveyDetailKpi({
  icon: Icon,
  accent,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  accent: string;
  label: string;
  value: string;
  hint: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="flex items-center gap-3">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `color-mix(in oklab, ${accent} 15%, transparent)`, color: accent }}
        >
          <Icon className="size-4" strokeWidth={1.8} />
        </div>
        <p className="text-sm text-mist">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums text-fg">{value}</p>
      <p className="mt-1.5 text-xs text-mist">{hint}</p>
    </div>
  );
}
