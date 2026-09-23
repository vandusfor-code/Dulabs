"use client";

/** Historial de cargas masivas del negocio (las 20 más recientes). */
import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { CatalogClient } from "@/lib/catalogo-client";
import type { ImportRecord } from "@/lib/catalogo/import/types";
import { cn } from "@/components/dashboard/catalogo/ui";

/** Una importación "procesando" hace más de una hora no terminó (pestaña cerrada o sin conexión). */
const INTERRUMPIDA_MS = 60 * 60 * 1000;

export function Historial({ client, refreshKey }: { client: CatalogClient | null; refreshKey: number }) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<ImportRecord[] | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.listImports().then((r) => {
      // Sin historial disponible (p. ej. migración pendiente): simplemente no se muestra.
      if (vivo) setItems(r.ok ? r.data.imports : []);
    });
    return () => {
      vivo = false;
    };
  }, [client, refreshKey]);

  if (!items || items.length === 0) return null;
  const fecha = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-CO", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <section className="rounded-2xl border border-edge bg-card">
      <h2 className="flex items-center gap-2 border-b border-edge px-5 py-3 text-sm font-semibold text-fg">
        <History className="size-4 text-mist" />
        {t("Importaciones anteriores", "Previous imports")}
      </h2>
      <ul className="divide-y divide-edge">
        {items.map((i) => {
          const estado =
            i.status === "completada"
              ? { text: t("Completada", "Completed"), cls: "text-lime-text" }
              : now - new Date(i.createdAt).getTime() > INTERRUMPIDA_MS
                ? { text: t("Interrumpida", "Interrupted"), cls: "text-amber-400" }
                : { text: t("En curso", "In progress"), cls: "text-mist" };
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
                {i.errors > 0 && <span className="text-red-400">{t(`${i.errors} errores`, `${i.errors} errors`)}</span>}
                <span className={cn("font-medium", estado.cls)}>{estado.text}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
