"use client";

import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(" ");
}

/**
 * KPI compacta del panel de Surveys: icono verde a la izquierda + label
 * uppercase, valor prominente y delta con comparación en texto muted.
 * (StatTile no encaja porque ubica el icono a la derecha y no muestra la
 * frase de comparación; aquí sí, para replicar el mockup.)
 */
export function SurveyKpiCard({
  label,
  value,
  delta,
  comparison,
  positive = true,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta: string;
  comparison: string;
  positive?: boolean;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-edge bg-card p-5 transition-colors hover:border-lime/30">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-lime/12 text-lime-text">
          <Icon className="size-4" strokeWidth={1.8} />
        </div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-mist">{label}</p>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums text-fg">{value}</p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium tabular-nums",
            positive ? "text-lime-text" : "text-red-400"
          )}
        >
          {positive ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
          {delta}
        </span>
        <span className="text-mist">{comparison}</span>
      </div>
    </div>
  );
}
