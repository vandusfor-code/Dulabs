"use client";

/**
 * Paso "Sube tus productos": la planilla y las fotografías, en dos tarjetas
 * claras, con una sola forma recomendada para las fotos (la CARPETA: en
 * Windows es lo natural y no carga nada en memoria) y alternativas para quien
 * las tenga sueltas o en un .zip. Todo el bloque acepta arrastrar y soltar.
 * La versión `compact` es la de "¿Te faltan fotos?" dentro del preview.
 */
import { useRef, useState, type DragEvent } from "react";
import { ArrowRight, CheckCircle2, Download, FileSpreadsheet, FolderOpen, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { filesFromDrop, type ImportFiles, type IncomingFile } from "@/lib/catalogo/import/navegador";
import { actionBtn, cn, primaryBtn } from "@/components/dashboard/catalogo/ui";

const ACCEPT = ".xlsx,.csv,.zip,.jpg,.jpeg,.png,.webp,.heic,image/*";

export function ZonaCarga({
  files,
  analyzing,
  collecting = false,
  disabled,
  compact,
  onFiles,
  onClearSpreadsheet,
  onClearImages,
  onDownloadTemplate,
  onContinue,
}: {
  files: ImportFiles;
  analyzing: boolean;
  /** Revisando las fotos recién elegidas (encabezados, dimensiones). */
  collecting?: boolean;
  disabled?: boolean;
  /** Versión pequeña (en el preview: "agregar más fotos"). */
  compact?: boolean;
  onFiles: (files: Array<File | IncomingFile>) => void;
  onClearSpreadsheet?: () => void;
  onClearImages?: () => void;
  onDownloadTemplate?: (format: "xlsx" | "csv") => void;
  /** Analizar (planilla + fotos elegidas). */
  onContinue?: () => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [depth, setDepth] = useState(0);
  const dragging = depth > 0 && !disabled;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDepth(0);
    if (disabled) return;
    void filesFromDrop(e.dataTransfer).then((list) => list.length > 0 && onFiles(list));
  };
  const dragProps = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      setDepth((d) => d + 1);
    },
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDragLeave: () => setDepth((d) => Math.max(0, d - 1)),
    onDrop,
  };

  const inputs = (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (list.length > 0) onFiles(list);
        }}
      />
      <input
        ref={sheet}
        type="file"
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (list.length > 0) onFiles(list);
        }}
      />
      <input
        ref={folder}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        {...{ webkitdirectory: "", directory: "" }}
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (list.length > 0) onFiles(list);
        }}
      />
    </>
  );

  if (compact) {
    return (
      <div
        {...dragProps}
        className={cn(
          "flex flex-col gap-3 rounded-xl border border-dashed px-4 py-3 transition-colors sm:flex-row sm:items-center",
          dragging ? "border-lime bg-lime/5" : "border-edge bg-ink-2/40",
        )}
      >
        {inputs}
        <p className="flex-1 text-sm text-mist">
          <ImageIcon className="mr-1.5 inline size-4 -translate-y-px" />
          {dragging ? t("Suelta aquí las fotos", "Drop the photos here") : t("¿Te faltan fotos? Arrástralas aquí o agrégalas.", "Missing photos? Drag them here or add them.")}
        </p>
        <div className="flex gap-2">
          <button type="button" className={cn(actionBtn, "flex-1 justify-center sm:flex-none")} disabled={disabled || analyzing} onClick={() => input.current?.click()}>
            <Upload className="size-4" />
            {t("Fotos", "Photos")}
          </button>
          <button type="button" className={cn(actionBtn, "flex-1 justify-center sm:flex-none")} disabled={disabled || analyzing} onClick={() => folder.current?.click()}>
            <FolderOpen className="size-4" />
            {t("Carpeta", "Folder")}
          </button>
        </div>
      </div>
    );
  }

  const imageCount = files.infos.length;
  const withProblems = files.infos.filter((i) => i.problem !== null).length;
  const folders = new Set(files.infos.map((i) => (i.id.includes("/") ? i.id.slice(0, i.id.lastIndexOf("/")) : ""))).size;
  const busy = analyzing || collecting;

  return (
    <div
      {...dragProps}
      className={cn("relative rounded-2xl border-2 border-dashed p-3 transition-[border-color,background-color,box-shadow] duration-200 sm:p-4", dragging ? "border-lime bg-lime/5 ring-4 ring-lime/10" : "border-transparent")}
    >
      {inputs}
      <div className="grid gap-3 md:grid-cols-2">
        {/* 1 · Planilla */}
        <section className="flex flex-col rounded-2xl border border-edge bg-card p-5 sm:p-6">
          <header className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-lime/10 text-lime-text">
              <FileSpreadsheet className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">{t("Paso 1", "Step 1")}</p>
              <h2 className="text-base font-semibold text-fg">{t("Tu planilla", "Your spreadsheet")}</h2>
            </div>
            {files.spreadsheet && <CheckCircle2 className="ml-auto size-5 shrink-0 text-lime-text" aria-label={t("Lista", "Ready")} />}
          </header>
          <p className="mt-3 text-sm text-mist">{t("Excel (.xlsx) o CSV, un producto por fila: nombre, precio detal y stock.", "Excel (.xlsx) or CSV, one product per row: name, retail price and stock.")}</p>
          <div className="mt-auto pt-5">
            {files.spreadsheet ? (
              <Chip icon={<FileSpreadsheet className="size-3.5" />} label={files.spreadsheet.name} onRemove={busy ? undefined : onClearSpreadsheet} removeLabel={t("Quitar planilla", "Remove spreadsheet")} />
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" className={cn(primaryBtn, "justify-center py-2.5")} disabled={disabled || busy} onClick={() => sheet.current?.click()}>
                  <Upload className="size-4" />
                  {t("Seleccionar archivo", "Select file")}
                </button>
                <button type="button" className={cn(actionBtn, "justify-center py-2.5")} disabled={disabled} onClick={() => onDownloadTemplate?.("xlsx")}>
                  <Download className="size-4" />
                  {t("Descargar plantilla", "Download template")}
                </button>
              </div>
            )}
            {!files.spreadsheet && (
              <p className="mt-2 text-xs text-mist/80">
                {t("¿Prefieres CSV? ", "Prefer CSV? ")}
                <button type="button" onClick={() => onDownloadTemplate?.("csv")} className="text-mist underline underline-offset-2 hover:text-fg">
                  {t("Descargar plantilla CSV", "Download CSV template")}
                </button>
              </p>
            )}
          </div>
        </section>

        {/* 2 · Fotografías */}
        <section className="flex flex-col rounded-2xl border border-edge bg-card p-5 sm:p-6">
          <header className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-lime/10 text-lime-text">
              {collecting ? <Loader2 className="size-5 animate-spin" /> : <ImageIcon className="size-5" />}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">{t("Paso 2 · recomendado", "Step 2 · recommended")}</p>
              <h2 className="text-base font-semibold text-fg">{t("Tus fotografías", "Your photos")}</h2>
            </div>
            {imageCount > 0 && !collecting && <CheckCircle2 className="ml-auto size-5 shrink-0 text-lime-text" aria-label={t("Listas", "Ready")} />}
          </header>
          <p className="mt-3 text-sm text-mist">
            {collecting
              ? t("Revisando tus fotos (formato, tamaño y si están completas)…", "Checking your photos (format, size and integrity)…")
              : t("Elige la carpeta donde las tienes. Las relacionamos solas con cada producto por su nombre.", "Choose the folder where they are. We match them to each product by name.")}
          </p>
          <div className="mt-auto pt-5">
            {imageCount > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Chip
                  icon={<ImageIcon className="size-3.5" />}
                  label={
                    (imageCount === 1 ? t("1 foto", "1 photo") : t(`${imageCount} fotos`, `${imageCount} photos`)) +
                    (folders > 1 ? t(` en ${folders} carpetas`, ` in ${folders} folders`) : "")
                  }
                  onRemove={busy ? undefined : onClearImages}
                  removeLabel={t("Quitar fotos", "Remove photos")}
                />
                {withProblems > 0 && (
                  <span className="text-xs text-amber-400">{withProblems === 1 ? t("1 no se podrá usar", "1 can't be used") : t(`${withProblems} no se podrán usar`, `${withProblems} can't be used`)}</span>
                )}
                <button type="button" onClick={() => folder.current?.click()} disabled={busy} className="text-xs text-mist underline underline-offset-2 hover:text-fg">
                  {t("Agregar otra carpeta", "Add another folder")}
                </button>
              </div>
            ) : (
              <>
                <button type="button" className={cn(primaryBtn, "w-full justify-center py-2.5 sm:w-auto")} disabled={disabled || busy} onClick={() => folder.current?.click()}>
                  <FolderOpen className="size-4" />
                  {t("Seleccionar carpeta de fotos", "Select photo folder")}
                </button>
                <p className="mt-2 text-xs text-mist/80">
                  {t("También puedes ", "You can also ")}
                  <button type="button" onClick={() => input.current?.click()} disabled={busy} className="text-mist underline underline-offset-2 hover:text-fg">
                    {t("elegir fotos sueltas o un .zip", "pick single photos or a .zip")}
                  </button>
                  .
                </p>
              </>
            )}
          </div>
        </section>
      </div>

      <div className="mt-3 flex flex-col items-stretch gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-mist">
          {dragging
            ? t("Suelta aquí la planilla, la carpeta o el .zip", "Drop the spreadsheet, folder or .zip here")
            : t("También puedes arrastrar aquí la planilla, la carpeta de fotos o un .zip.", "You can also drag the spreadsheet, photo folder or a .zip here.")}
        </p>
        <button type="button" onClick={onContinue} disabled={!files.spreadsheet || busy || disabled} className={cn(primaryBtn, "justify-center py-2.5")}>
          {analyzing ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
          {analyzing ? t("Estamos revisando tus productos…", "We're reviewing your products…") : t("Revisar mis productos", "Review my products")}
        </button>
      </div>
      {files.spreadsheet && imageCount === 0 && !busy && (
        <p className="mt-2 px-1 text-right text-xs text-mist/80">{t("Sin fotos también puedes continuar: los productos se crearán sin foto.", "You can continue without photos: products will be created without one.")}</p>
      )}
    </div>
  );
}

function Chip({ icon, label, onRemove, removeLabel }: { icon: React.ReactNode; label: string; onRemove?: () => void; removeLabel: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-edge bg-ink-2 py-1 pl-3 pr-1 text-xs font-medium text-fg">
      {icon}
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} className="flex size-6 items-center justify-center rounded-full text-mist transition-colors hover:bg-card hover:text-fg" aria-label={removeLabel}>
          <X className="size-3.5" />
        </button>
      ) : (
        <span className="w-2" />
      )}
    </span>
  );
}
