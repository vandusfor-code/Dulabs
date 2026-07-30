"use client";

export function QuestionKpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-edge bg-card p-4">
      <p className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-fg">{value}</p>
      <p className="mt-1.5 text-xs text-mist">{hint}</p>
    </div>
  );
}
