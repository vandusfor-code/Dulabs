"use client";

/**
 * Carga masiva del Catálogo:
 *   preparar archivo -> subir -> analizar (servidor) -> preview -> confirmar
 *   -> procesar por lotes (servidor + fotos directo a Storage) -> resultado.
 * Nada se crea hasta confirmar; lo que es válido lo decide el backend.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, FileSpreadsheet, FolderOpen, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { CatalogCategory } from "@/lib/catalogo/domain";
import { prepareProductImage } from "@/lib/catalogo/image-processing";
import { uploadPrepared } from "@/lib/catalogo-client";
import { COLUMNS } from "@/lib/catalogo/import/columnas";
import { toCsv } from "@/lib/catalogo/import/csv";
import { collectFiles, emptyImportFiles, imageFile, type ImportFiles } from "@/lib/catalogo/import/navegador";
import { ImportStartError, runImport, type ImportProgress, type ImportReport } from "@/lib/catalogo/import/proceso";
import type { CategoryDecision, ImageInfo, ImportAnalysis, RawRow } from "@/lib/catalogo/import/types";
import { Historial } from "@/components/dashboard/catalogo/importar/Historial";
import { Proceso, Resultado } from "@/components/dashboard/catalogo/importar/ProcesoResultado";
import { VistaPrevia } from "@/components/dashboard/catalogo/importar/VistaPrevia";
import { ZonaCarga } from "@/components/dashboard/catalogo/importar/ZonaCarga";
import { actionBtn, cn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";

type Stage = "select" | "preview" | "processing" | "done";

// Miniaturas locales (blob:) por archivo: se crean una vez y se liberan al descartar la selección.
const objectUrls = new WeakMap<File, string>();
function objectUrl(file: File): string {
  let url = objectUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    objectUrls.set(file, url);
  }
  return url;
}
function releaseUrls(files: ImportFiles) {
  for (const f of files.images.values()) {
    const url = objectUrls.get(f);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(f);
  }
}

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV para Excel en español: separador ";" y BOM (tildes correctas). */
function saveCsv(rows: Array<Array<string | number | null | undefined>>, name: string) {
  saveFile(new Blob([`﻿${toCsv(rows, ";")}\r\n`], { type: "text/csv;charset=utf-8" }), name);
}

export default function ImportarPage() {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useCatalogToast();
  const { client, canWrite, ready } = useCatalogAccess();

  const [stage, setStage] = useState<Stage>("select");
  const [files, setFiles] = useState<ImportFiles>(emptyImportFiles);
  const [fileNotices, setFileNotices] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<RawRow[]>([]);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [decisions, setDecisions] = useState<Record<string, CategoryDecision>>({});
  const [force, setForce] = useState<number[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const request = useRef(0);

  // Solo admin importa (el backend lo exige igual).
  useEffect(() => {
    if (ready && !canWrite) router.replace("/dashboard/catalogo");
  }, [ready, canWrite, router]);

  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.listCategories().then((r) => {
      if (vivo && r.ok) setCategories(r.data.categories);
    });
    return () => {
      vivo = false;
    };
  }, [client, historyKey]);

  // Mientras se importa, avisar antes de cerrar la pestaña.
  useEffect(() => {
    if (stage !== "processing") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [stage]);

  const reanalyze = useCallback(
    async (next: { rows?: RawRow[]; decisions?: Record<string, CategoryDecision>; force?: number[]; images?: ImageInfo[] }) => {
      if (!client) return;
      const body = { rows: next.rows ?? rows, decisions: next.decisions ?? decisions, force: next.force ?? force, images: next.images ?? files.infos };
      if (body.rows.length === 0) {
        setAnalysis(null);
        setStage("select");
        return;
      }
      const id = ++request.current;
      setBusy(true);
      const r = await client.analyzeImportRows(body);
      if (id !== request.current) return;
      setBusy(false);
      if (r.ok) setAnalysis(r.data.analysis);
      else toast(r.error.message, "error");
    },
    [client, rows, decisions, force, files.infos, toast],
  );

  const analyzeFile = async (next: ImportFiles) => {
    if (!client || !next.spreadsheet) return;
    const id = ++request.current;
    setAnalyzing(true);
    setFileError(null);
    const r = await client.analyzeImportFile(next.spreadsheet, { images: next.infos, decisions: {} });
    if (id !== request.current) return;
    setAnalyzing(false);
    if (!r.ok) {
      setFileError(r.error.message);
      setFiles((f) => ({ ...f, spreadsheet: null }));
      return;
    }
    setFileName(r.data.file.name);
    setRows(r.data.rows);
    setDecisions({});
    setForce([]);
    setAnalysis(r.data.analysis);
    setStage("preview");
  };

  const addFiles = async (list: File[]) => {
    setFileError(null);
    const res = await collectFiles(list, files);
    setFileNotices(res.notices);
    if (res.error) {
      setFileError(res.error);
      return;
    }
    setFiles(res.files);
    if (res.files.spreadsheet && res.files.spreadsheet !== files.spreadsheet) await analyzeFile(res.files);
    else if (stage === "preview" && res.files.infos.length !== files.infos.length) await reanalyze({ images: res.files.infos });
  };

  const restart = () => {
    request.current++;
    releaseUrls(files);
    setFiles(emptyImportFiles());
    setFileNotices([]);
    setFileError(null);
    setAnalysis(null);
    setRows([]);
    setDecisions({});
    setForce([]);
    setProgress(null);
    setReport(null);
    setBusy(false);
    setAnalyzing(false);
    setStage("select");
  };

  const importar = async () => {
    if (!client || !analysis || busy) return;
    const importable = new Set(analysis.rows.filter((r) => r.status === "ready" || r.status === "warning").map((r) => r.row));
    const toImport = rows.filter((r) => importable.has(r.row));
    if (toImport.length === 0) return;
    setStage("processing");
    try {
      const result = await runImport(
        { fileName, rows: toImport, images: files.infos, decisions, force },
        {
          startImport: client.startImport,
          importRows: client.importRows,
          photoUrls: client.importPhotoUrls,
          confirmPhotos: client.confirmImportPhotos,
          finishImport: client.finishImport,
          prepare: prepareProductImage,
          upload: uploadPrepared,
          imageFile: (name) => imageFile(files, name),
          sleep: (ms) => new Promise((r) => window.setTimeout(r, ms)),
        },
        setProgress,
      );
      setReport(result);
      setStage("done");
      setHistoryKey((k) => k + 1);
    } catch (err) {
      setStage("preview");
      toast(err instanceof ImportStartError ? err.message : t("No se pudo iniciar la importación. Intenta de nuevo.", "The import could not start. Try again."), "error");
    }
  };

  const descargarErrores = () => {
    if (!analysis) return;
    const header = [...COLUMNS.map((c) => c.header), "fila_original", "problema"];
    const data = analysis.rows
      .filter((r) => r.status === "error")
      .map((r) => [...COLUMNS.map((c) => r.values[c.key] ?? ""), r.row, r.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ")]);
    saveCsv([header, ...data], "filas-con-errores.csv");
  };

  const descargarReporte = () => {
    if (!report) return;
    const estado = { created: "creado", skipped: "omitido", error: "error" } as const;
    const data: Array<Array<string | number | null>> = [["fila", "estado", "referencia", "nombre", "detalle"]];
    for (const r of report.rows) data.push([r.row, estado[r.status], r.reference, r.name, r.message]);
    for (const f of report.photoFailures) data.push([f.row, "foto no subida", f.reference, f.file, f.message]);
    saveCsv(data, "resultado-importacion.csv");
  };

  const descargarPlantilla = async (format: "xlsx" | "csv") => {
    if (!client) return;
    const r = await client.downloadTemplate(format);
    if (r.ok) saveFile(r.data.blob, r.data.fileName);
    else toast(r.error.message, "error");
  };

  const photoUrl = (name: string) => {
    const f = imageFile(files, name);
    return f ? objectUrl(f) : null;
  };

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow={t("Catálogo", "Catalog")}
        title={t("Carga masiva", "Bulk upload")}
        description={t("Carga muchos productos a la vez desde Excel o CSV, con sus fotografías. DuLabs asigna la referencia de cada uno.", "Load many products at once from Excel or CSV, with their photos. DuLabs assigns each reference.")}
      >
        {stage !== "processing" && (
          <Link href="/dashboard/catalogo" className={actionBtn}>
            <ArrowLeft className="size-4" />
            {t("Volver", "Back")}
          </Link>
        )}
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        <div className="mx-auto max-w-6xl space-y-5">
          {fileError && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {fileError}
            </p>
          )}
          {fileNotices.length > 0 && stage !== "done" && (
            <ul className="space-y-1">
              {fileNotices.map((n) => (
                <li key={n} className="text-xs text-mist">
                  {n}
                </li>
              ))}
            </ul>
          )}

          {stage === "select" && (
            <>
              <ZonaCarga
                files={files}
                analyzing={analyzing}
                disabled={!client}
                onFiles={(l) => void addFiles(l)}
                onClearSpreadsheet={() => setFiles((f) => ({ ...f, spreadsheet: null }))}
                onClearImages={() => {
                  releaseUrls(files);
                  setFiles((f) => ({ ...f, images: new Map(), infos: [] }));
                }}
              />

              <section className="grid gap-3 md:grid-cols-3">
                <Paso n={1} icon={<Download className="size-4" />} title={t("Descarga la plantilla", "Download the template")}>
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    <button type="button" onClick={() => void descargarPlantilla("xlsx")} className="font-medium text-lime-text underline-offset-2 hover:underline">
                      {t("Excel (.xlsx)", "Excel (.xlsx)")}
                    </button>
                    <button type="button" onClick={() => void descargarPlantilla("csv")} className="text-mist underline-offset-2 hover:text-fg hover:underline">
                      CSV
                    </button>
                  </span>
                </Paso>
                <Paso n={2} icon={<FileSpreadsheet className="size-4" />} title={t("Una fila por producto", "One row per product")}>
                  {t("En «imagenes» escribe el nombre de cada foto. Varias, separadas por coma: la primera es la principal.", "In «imagenes» write each photo's file name. Several, comma-separated: the first one is the main photo.")}
                </Paso>
                <Paso n={3} icon={<FolderOpen className="size-4" />} title={t("Sube el Excel y las fotos", "Upload the Excel and photos")}>
                  {t("Selecciona la planilla y la carpeta de fotos (o un .zip). Revisarás todo antes de importar.", "Select the spreadsheet and the photo folder (or a .zip). You'll review everything before importing.")}
                </Paso>
              </section>

              <Historial client={client} refreshKey={historyKey} />
            </>
          )}

          {stage === "preview" && analysis && (
            <VistaPrevia
              fileName={fileName}
              analysis={analysis}
              existingCategories={categories}
              busy={busy}
              photoUrl={photoUrl}
              addPhotos={<ZonaCarga compact files={files} analyzing={busy} onFiles={(l) => void addFiles(l)} />}
              onDecision={(key, d) => {
                const next = { ...decisions, [key]: d };
                setDecisions(next);
                void reanalyze({ decisions: next });
              }}
              onToggleForce={(row) => {
                const next = force.includes(row) ? force.filter((r) => r !== row) : [...force, row];
                setForce(next);
                void reanalyze({ force: next });
              }}
              onSaveRow={(row, values) => {
                const next = rows.map((r) => (r.row === row ? { row, values } : r));
                setRows(next);
                void reanalyze({ rows: next });
              }}
              onRemoveRow={(row) => {
                const next = rows.filter((r) => r.row !== row);
                setRows(next);
                void reanalyze({ rows: next });
              }}
              onDownloadErrors={descargarErrores}
              onImport={() => void importar()}
              onRestart={restart}
            />
          )}

          {stage === "processing" && progress && <Proceso progress={progress} />}

          {stage === "done" && report && <Resultado report={report} onNew={restart} onDownloadReport={descargarReporte} />}
        </div>
      </div>
    </div>
  );
}

function Paso({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-edge bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-fg">
        <span className={cn("flex size-6 items-center justify-center rounded-full bg-lime/10 text-[11px] font-semibold text-lime-text")}>{n}</span>
        {title}
        <span className="ml-auto text-mist">{icon}</span>
      </p>
      <div className="mt-2 text-xs leading-relaxed text-mist">{children}</div>
    </div>
  );
}
