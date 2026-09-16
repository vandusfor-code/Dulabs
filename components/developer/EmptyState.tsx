import type { ReactNode } from "react";

// DuLabs Developer V1 -- Fase 9. Estado vacío con mensaje útil y CTA opcional.

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-edge bg-card/40 px-6 py-14 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-mist">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
