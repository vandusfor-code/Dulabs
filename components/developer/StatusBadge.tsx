import type { ReactNode } from "react";
import type { Tono } from "@/lib/dev-dashboard/dev-format";

// DuLabs Developer V1 -- Fase 9. Badge de estado técnico, sobrio. Presentacional.

const TONO_CLASES: Record<Tono, string> = {
  success: "bg-success text-success-text",
  warning: "bg-warning text-warning-text",
  danger: "bg-danger text-danger-text",
  info: "bg-dev-accent-soft text-dev-accent",
  neutral: "bg-ink-2 text-mist",
};

export function StatusBadge({ tono, children }: { tono: Tono; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONO_CLASES[tono]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />
      {children}
    </span>
  );
}
