"use client";

/** Progreso real de la importación y resultado final (con resumen de errores). */
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, ImageOff, Loader2, Plus, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ImportProgress, ImportReport } from "@/lib/catalogo/import/proceso";
import { ReferenceTag, actionBtn, cn, primaryBtn } from "@/components/dashboard/catalogo/ui";

export function Proceso({ progress }: { progress: ImportProgress }) {
  const { t } = useI18n();
  const total = progress.rowsTotal + progress.photosTotal;
  const done = progress.rowsDone + progress.photosDone;
  const pct = total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100));
  const etapa =
    progress.phase === "starting"
      ? t("Preparando la importación…", "Preparing the import…")
      : progress.phase === "finishing"
        ? t("Terminando…", "Finishing…")
        : progress.phase === "photos"
          ? t(`Subiendo fotos · ${progress.photosDone} de ${progress.photosTotal}`, `Uploading photos · ${progress.photosDone} of ${progress.photosTotal}`)
          : t(`Creando productos · ${progress.rowsDone} de ${progress.rowsTotal}`, `Creating products · ${progress.rowsDone} of ${progress.rowsTotal}`);

  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-edge bg-card p-6 text-center md:p-8" aria-busy>
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-lime/10 text-lime-text">
        <Loader2 className="size-7 animate-spin" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-fg">{t("Importando tus productos", "Importing your products")}</h2>
      <p className="mt-1 text-sm text-mist" aria-live="polite">
        {etapa}
      </p>
      <div className="mt-6 h-2 overflow-hidden rounded-full bg-ink-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-lime transition-[width] duration-500 ease-out" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <p className="mt-3 text-xs tabular-nums text-mist">
        {t(`${progress.created} productos creados`, `${progress.created} products created`)} · {pct}%
      </p>
      <p className="mt-5 rounded-lg bg-ink-2/60 px-3 py-2 text-xs text-mist">
        {t("No cierres esta pestaña hasta que termine. Si se corta la conexión, lo ya creado no se pierde.", "Keep this tab open until it finishes. If the connection drops, what was created is kept.")}
      </p>
    </section>
  );
}

export function Resultado({ report, onNew, onDownloadReport }: { report: ImportReport; onNew: () => void; onDownloadReport: () => void }) {
  const { t } = useI18n();
  const created = report.rows.filter((r) => r.status === "created");
  const skipped = report.rows.filter((r) => r.status === "skipped");
  const errors = report.rows.filter((r) => r.status === "error");
  const problems = [...errors, ...skipped];
  const allOk = errors.length === 0 && report.photoFailures.length === 0;

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <div className="rounded-2xl border border-edge bg-card p-6 text-center md:p-8">
        <div
          className={cn(
            "mx-auto flex size-14 items-center justify-center rounded-full motion-safe:animate-[catalogo-pop_420ms_cubic-bezier(0.16,1,0.3,1)]",
            created.length > 0 ? "bg-lime text-lime-fg" : "bg-ink-2 text-mist",
          )}
        >
          {created.length > 0 ? <CheckCircle2 className="size-7" /> : <XCircle className="size-7" />}
        </div>
        <h2 className="mt-5 text-xl font-semibold tracking-tight text-fg">
          {created.length > 0 ? t("Importación completada", "Import completed") : t("No se creó ningún producto", "No product was created")}
        </h2>
        <p className="mt-1 text-sm text-mist">
          {report.rows.length === 1 ? t("1 producto procesado", "1 product processed") : t(`${report.rows.length} productos procesados`, `${report.rows.length} products processed`)}
        </p>
        <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-2">
          <Count tone="ok" value={created.length} label={t("creados", "created")} />
          <Count tone="warn" value={skipped.length} label={t("omitidos", "skipped")} />
          <Count tone="error" value={errors.length} label={t("con error", "with errors")} />
        </div>
        {report.photosUploaded + report.photoFailures.length > 0 && (
          <p className="mt-4 text-sm text-mist">
            {t(`${report.photosUploaded} fotos subidas`, `${report.photosUploaded} photos uploaded`)}
            {report.photoFailures.length > 0 && <span className="text-amber-400"> · {t(`${report.photoFailures.length} no se pudieron subir`, `${report.photoFailures.length} failed`)}</span>}
          </p>
        )}
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href="/dashboard/catalogo" className={cn(primaryBtn, "justify-center py-2.5")}>
            {t("Ver productos", "View products")}
          </Link>
          <button type="button" onClick={onNew} className={cn(actionBtn, "justify-center py-2.5")}>
            <Plus className="size-4" />
            {t("Nueva importación", "New import")}
          </button>
          {!allOk && (
            <button type="button" onClick={onDownloadReport} className={cn(actionBtn, "justify-center py-2.5")}>
              <Download className="size-4" />
              {t("Descargar reporte", "Download report")}
            </button>
          )}
        </div>
      </div>

      {problems.length > 0 && (
        <div className="rounded-2xl border border-edge bg-card">
          <h3 className="border-b border-edge px-5 py-3 text-sm font-semibold text-fg">{t("Productos que no se crearon", "Products not created")}</h3>
          <ul className="divide-y divide-edge">
            {problems.map((r) => (
              <li key={r.row} className="flex gap-3 px-5 py-3">
                {r.status === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{r.name ?? t(`Fila ${r.row}`, `Row ${r.row}`)}</p>
                  <p className="text-xs text-mist">{r.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.photoFailures.length > 0 && (
        <div className="rounded-2xl border border-edge bg-card">
          <h3 className="border-b border-edge px-5 py-3 text-sm font-semibold text-fg">{t("Fotos que no se subieron", "Photos not uploaded")}</h3>
          <p className="px-5 pt-3 text-xs text-mist">{t("Los productos sí se crearon: puedes agregar estas fotos desde cada producto.", "The products were created: you can add these photos from each product.")}</p>
          <ul className="divide-y divide-edge">
            {report.photoFailures.map((f, i) => (
              <li key={`${f.row}-${f.file}-${i}`} className="flex items-start gap-3 px-5 py-3">
                <ImageOff className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-fg">
                    <span className="truncate">{f.file}</span>
                    {f.reference && <ReferenceTag reference={f.reference} />}
                  </p>
                  <p className="text-xs text-mist">{f.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Count({ tone, value, label }: { tone: "ok" | "warn" | "error"; value: number; label: string }) {
  const color = value === 0 ? "text-mist" : tone === "ok" ? "text-lime-text" : tone === "warn" ? "text-amber-400" : "text-red-400";
  return (
    <div className="rounded-xl border border-edge bg-ink-2/40 px-3 py-3">
      <p className={cn("text-2xl font-semibold tabular-nums", color)}>{value}</p>
      <p className="text-xs text-mist">{label}</p>
    </div>
  );
}
