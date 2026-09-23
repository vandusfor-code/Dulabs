"use client";

/** Historial de cargas masivas del negocio (las 20 más recientes). El estado viene derivado del servidor. */
import { History } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { OUTCOME_LABEL } from "@/lib/catalogo/import/estados";
import type { ImportHistoryItem } from "@/lib/catalogo/import/types";
import { cn } from "@/components/dashboard/catalogo/ui";

const TONE = { ok: "text-lime-text", warn: "text-amber-400", error: "text-red-400", muted: "text-mist" } as const;

export function Historial({ items }: { items: ImportHistoryItem[] }) {
  const { t, lang } = useI18n();
  if (items.length === 0) return null;
  const fecha = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-CO", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <section className="rounded-2xl border border-edge bg-card">
      <h2 className="flex items-center gap-2 border-b border-edge px-5 py-3 text-sm font-semibold text-fg">
        <History className="size-4 text-mist" />
        {t("Importaciones anteriores", "Previous imports")}
      </h2>
      <ul className="divide-y divide-edge">
        {items.map((i) => {
          const estado = OUTCOME_LABEL[i.outcome];
          return (
            <li key={i.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{i.fileName}</p>
                <p className="text-xs text-mist">{fecha.format(new Date(i.createdAt))}</p>
              </div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-mist">
                <span>{t(`${i.totalRows} productos`, `${i.totalRows} products`)}</span>
                <span className="text-fg">{t(`${i.created} creados`, `${i.created} created`)}</span>
                {i.skipped > 0 && <span>{t(`${i.skipped} omitidos`, `${i.skipped} skipped`)}</span>}
                {i.errors > 0 && <span className="text-red-400">{t(`${i.errors} requieren corrección`, `${i.errors} need fixes`)}</span>}
                <span className={cn("font-medium", TONE[estado.tone])}>{t(estado.es, estado.en)}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
