"use client";

/** Progreso real de la importación y resultado final (con resumen de errores). */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, CheckCircle2, Copy, Download, ImageIcon, ImageOff, Loader2, Plus, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ImportOutcomeFinal } from "@/lib/catalogo/import/estados";
import { estimateRemainingMs, formatRemaining, type ImportProgress } from "@/lib/catalogo/import/proceso";
import { ATTENTION_LABEL, ATTENTION_REASONS, type AttentionReason, type ImportResultSummary } from "@/lib/catalogo/import/resultado";
import { ReferenceTag, actionBtn, cn, primaryBtn } from "@/components/dashboard/catalogo/ui";

export function Proceso({ progress }: { progress: ImportProgress }) {
  const { t } = useI18n();
  // Reloj propio: la estimación se actualiza aunque un lote tarde.
  const [clock, setClock] = useState(() => {
    const start = Date.now();
    return { start, now: start };
  });
  useEffect(() => {
    const id = window.setInterval(() => setClock((c) => ({ ...c, now: Date.now() })), 1000);
    return () => window.clearInterval(id);
  }, []);
  const total = progress.rowsTotal + progress.photosTotal;
  const done = progress.rowsDone + progress.photosDone;
  const pct = total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100));
  const remaining = estimateRemainingMs(progress, clock.now - clock.start);
  const etapa =
    progress.phase === "starting"
      ? t("Preparando la importación…", "Preparing the import…")
      : progress.phase === "finishing"
        ? t("Terminando…", "Finishing…")
        : progress.phase === "photos"
          ? t(`Procesando fotografías · ${progress.photosDone} de ${progress.photosTotal}`, `Processing photos · ${progress.photosDone} of ${progress.photosTotal}`)
          : t(`Creando productos · ${progress.rowsDone} de ${progress.rowsTotal}`, `Creating products · ${progress.rowsDone} of ${progress.rowsTotal}`);

  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-edge bg-card p-6 text-center md:p-8" aria-busy>
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-lime/10 text-lime-text">
        <Loader2 className="size-7 animate-spin" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-fg">{t("Estamos registrando tus productos…", "We're registering your products…")}</h2>
      <p className="mt-1 text-sm text-mist" aria-live="polite">
        {etapa}
      </p>
      <div className="mt-6 h-2 overflow-hidden rounded-full bg-ink-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-lime transition-[width] duration-500 ease-out" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs tabular-nums text-mist">
        <span>
          {t(`${progress.created} productos creados`, `${progress.created} products created`)} · {pct}%
        </span>
        <span>{remaining === null ? t("Calculando tiempo restante…", "Estimating time left…") : t(formatRemaining(remaining).es, formatRemaining(remaining).en)}</span>
      </div>
      <p className="mt-2 h-4 truncate text-xs text-mist/80" title={progress.current ?? undefined}>
        {progress.current && (
          <>
            <ImageIcon className="mr-1 inline size-3 -translate-y-px" />
            {progress.current}
          </>
        )}
      </p>
      <p className="mt-5 rounded-lg bg-ink-2/60 px-3 py-2 text-xs text-mist">
        {t(
          "No cierres esta pestaña hasta que termine. Las fotos se optimizan en tu equipo antes de subir. Si se corta la conexión, lo ya creado no se pierde.",
          "Keep this tab open until it finishes. Photos are optimized on your device before uploading. If the connection drops, what was created is kept.",
        )}
      </p>
    </section>
  );
}

export function Resultado({ summary, outcome, onNew, onDownloadReport }: { summary: ImportResultSummary; outcome: ImportOutcomeFinal; onNew: () => void; onDownloadReport: () => void }) {
  const { t } = useI18n();
  const ok = outcome !== "failed";
  const reasons = ATTENTION_REASONS.filter((k) => summary.byReason[k].length > 0);

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <div className="rounded-2xl border border-edge bg-card p-6 text-center md:p-8">
        <div
          className={cn(
            "mx-auto flex size-14 items-center justify-center rounded-full motion-safe:animate-[catalogo-pop_420ms_cubic-bezier(0.16,1,0.3,1)]",
            ok ? "bg-lime text-lime-fg" : "bg-ink-2 text-mist",
          )}
        >
          {ok ? <CheckCircle2 className="size-7" /> : <XCircle className="size-7" />}
        </div>
        <h2 className="mt-5 text-xl font-semibold tracking-tight text-fg">{ok ? t("Importación completada", "Import completed") : t("No se creó ningún producto", "No product was created")}</h2>
        <p className="mt-1 text-sm text-mist">
          {summary.found === 1 ? t("1 producto encontrado", "1 product found") : t(`${summary.found} productos encontrados`, `${summary.found} products found`)}
        </p>

        <ul className="mx-auto mt-6 grid max-w-lg gap-2 text-left sm:grid-cols-2">
          <Line tone="ok" icon={<Check className="size-4" strokeWidth={3} />}>
            {summary.created === 1 ? t("1 creado", "1 created") : t(`${summary.created} creados`, `${summary.created} created`)}
          </Line>
          <Line tone="ok" icon={<Check className="size-4" strokeWidth={3} />}>
            {summary.photosProcessed === 1 ? t("1 fotografía procesada", "1 photo processed") : t(`${summary.photosProcessed} fotografías procesadas`, `${summary.photosProcessed} photos processed`)}
          </Line>
          {summary.completed > 0 && (
            <Line tone="ok" icon={<Check className="size-4" strokeWidth={3} />}>
              {summary.completed === 1 ? t("1 producto completado con fotos", "1 product completed with photos") : t(`${summary.completed} productos completados con fotos`, `${summary.completed} products completed with photos`)}
            </Line>
          )}
          <Line tone={summary.needAttention > 0 ? "warn" : "muted"} icon={<AlertTriangle className="size-4" />}>
            {summary.needAttention === 1 ? t("1 requiere atención", "1 needs attention") : t(`${summary.needAttention} requieren atención`, `${summary.needAttention} need attention`)}
          </Line>
        </ul>

        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href="/dashboard/catalogo" className={cn(primaryBtn, "justify-center py-2.5")}>
            {t("Ver productos", "View products")}
          </Link>
          <button type="button" onClick={onNew} className={cn(actionBtn, "justify-center py-2.5")}>
            <Plus className="size-4" />
            {t("Nueva importación", "New import")}
          </button>
          {summary.needAttention > 0 && (
            <button type="button" onClick={onDownloadReport} className={cn(actionBtn, "justify-center py-2.5")}>
              <Download className="size-4" />
              {t("Descargar reporte", "Download report")}
            </button>
          )}
        </div>
      </div>

      {reasons.map((k) => {
        const list = summary.byReason[k];
        const label = ATTENTION_LABEL[k];
        return (
          <div key={k} className="rounded-2xl border border-edge bg-card">
            <div className="border-b border-edge px-5 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                {REASON_ICON[k]}
                {t(label.es, label.en)} <span className="font-normal tabular-nums text-mist">· {list.length}</span>
              </h3>
              <p className="mt-0.5 text-xs text-mist">{t(label.hint.es, label.hint.en)}</p>
            </div>
            <ul className="divide-y divide-edge">
              {list.map((i, n) => (
                <li key={`${i.row}-${n}`} className="flex gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                      <span className="truncate">{i.name ?? t(`Fila ${i.row}`, `Row ${i.row}`)}</span>
                      {i.reference && <ReferenceTag reference={i.reference} />}
                      <span className="text-xs font-normal text-mist">{t(`Fila ${i.row}`, `Row ${i.row}`)}</span>
                    </p>
                    <p className="text-xs text-mist">{i.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

const REASON_ICON: Record<AttentionReason, React.ReactNode> = {
  no_image: <ImageOff className="size-4 text-amber-400" />,
  invalid_image: <ImageOff className="size-4 text-red-400" />,
  invalid_data: <XCircle className="size-4 text-red-400" />,
  duplicate: <Copy className="size-4 text-mist" />,
  photo_failed: <AlertTriangle className="size-4 text-amber-400" />,
};

function Line({ tone, icon, children }: { tone: "ok" | "warn" | "muted"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 rounded-xl border border-edge bg-ink-2/40 px-3.5 py-2.5 text-sm font-medium text-fg">
      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", tone === "ok" ? "bg-lime/15 text-lime-text" : tone === "warn" ? "bg-amber-400/15 text-amber-400" : "bg-ink-2 text-mist")}>{icon}</span>
      <span className="tabular-nums">{children}</span>
    </li>
  );
}
