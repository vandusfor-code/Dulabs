"use client";

/**
 * Zona para elegir o arrastrar la planilla y las fotos (sueltas, una carpeta
 * completa o un .zip). Estados: reposo -> arrastrando -> analizando.
 */
import { useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet, FolderOpen, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { filesFromDrop, type ImportFiles } from "@/lib/catalogo/import/navegador";
import { actionBtn, cn, primaryBtn } from "@/components/dashboard/catalogo/ui";

const ACCEPT = ".xlsx,.csv,.zip,.jpg,.jpeg,.png,.webp,.heic,image/*";

export function ZonaCarga({
  files,
  analyzing,
  disabled,
  compact,
  onFiles,
  onClearSpreadsheet,
  onClearImages,
}: {
  files: ImportFiles;
  analyzing: boolean;
  disabled?: boolean;
  /** Versión pequeña (en el preview: "agregar más fotos"). */
  compact?: boolean;
  onFiles: (files: File[]) => void;
  onClearSpreadsheet?: () => void;
  onClearImages?: () => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
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
  return (
    <div
      {...dragProps}
      className={cn(
        "relative overflow-hidden rounded-2xl border-2 border-dashed bg-card px-5 py-10 text-center transition-[border-color,background-color,box-shadow] duration-200 sm:px-10 sm:py-14",
        dragging ? "border-lime bg-lime/5 ring-4 ring-lime/10" : "border-edge",
      )}
    >
      {inputs}
      <div
        className={cn(
          "mx-auto flex size-16 items-center justify-center rounded-2xl bg-lime/10 text-lime-text transition-transform duration-300",
          dragging && "scale-110",
          analyzing && "animate-pulse",
        )}
      >
        {analyzing ? <Loader2 className="size-7 animate-spin" /> : <FileSpreadsheet className="size-7" />}
      </div>
      <h2 className="mt-5 text-lg font-semibold tracking-tight text-fg sm:text-xl">
        {analyzing ? t("Estamos revisando tus productos…", "We're reviewing your products…") : dragging ? t("Suéltalos aquí", "Drop them here") : t("Importa tus productos", "Import your products")}
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-mist">
        {analyzing
          ? t("Leemos tu planilla y revisamos cada fila antes de crear nada.", "We read your spreadsheet and check every row before creating anything.")
          : t("Sube un archivo Excel o CSV y las fotografías de tus productos.", "Upload an Excel or CSV file and your product photos.")}
      </p>

      {!analyzing && (
        <>
          <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <button type="button" className={cn(primaryBtn, "w-full justify-center py-2.5 sm:w-auto")} disabled={disabled} onClick={() => input.current?.click()}>
              <Upload className="size-4" />
              {t("Seleccionar archivo", "Select file")}
            </button>
            <button type="button" className={cn(actionBtn, "w-full justify-center py-2.5 sm:w-auto")} disabled={disabled} onClick={() => folder.current?.click()}>
              <FolderOpen className="size-4" />
              {t("Seleccionar carpeta de fotos", "Select photo folder")}
            </button>
          </div>
          <p className="mt-3 text-xs text-mist/80">
            {t("También puedes arrastrar el Excel, las fotos, la carpeta completa o un .zip.", "You can also drag the Excel, the photos, the whole folder or a .zip.")}
          </p>
        </>
      )}

      {(files.spreadsheet || imageCount > 0) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {files.spreadsheet && (
            <Chip icon={<FileSpreadsheet className="size-3.5" />} label={files.spreadsheet.name} onRemove={analyzing ? undefined : onClearSpreadsheet} removeLabel={t("Quitar planilla", "Remove spreadsheet")} />
          )}
          {imageCount > 0 && (
            <Chip
              icon={<ImageIcon className="size-3.5" />}
              label={imageCount === 1 ? t("1 foto", "1 photo") : t(`${imageCount} fotos`, `${imageCount} photos`)}
              onRemove={analyzing ? undefined : onClearImages}
              removeLabel={t("Quitar fotos", "Remove photos")}
            />
          )}
        </div>
      )}
      {!files.spreadsheet && imageCount > 0 && !analyzing && (
        <p className="mt-3 text-sm font-medium text-fg">{t("Ahora selecciona la planilla (Excel o CSV).", "Now select the spreadsheet (Excel or CSV).")}</p>
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
