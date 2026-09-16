import type { ReactNode } from "react";

// DuLabs Developer V1 -- Fase 9. Card de métrica pequeña y útil. Presentacional.

export function StatCard({ label, value, hint, children }: { label: string; value: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-edge bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-mist">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-fg">{value}</p>
      {hint ? <p className="mt-1 text-xs text-mist">{hint}</p> : null}
      {children}
    </div>
  );
}
