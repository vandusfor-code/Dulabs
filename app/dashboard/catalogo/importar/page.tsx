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
import { ArrowLeft, Check, Clock, FolderOpen, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/dashboard/shell/ui";
import { useI18n } from "@/lib/i18n";
import type { CatalogCategory } from "@/lib/catalogo/domain";
import { prepareProductImage } from "@/lib/catalogo/image-processing";
import { uploadPrepared } from "@/lib/catalogo-client";
import { COLUMNS } from "@/lib/catalogo/import/columnas";
import { toCsv } from "@/lib/catalogo/import/csv";
import { collectFiles, emptyImportFiles, imageFile, type ImportFiles, type IncomingFile } from "@/lib/catalogo/import/navegador";
import { IMPORT_STEPS, finalOutcome, isFinalPhase, stepOf, type ImportPhase } from "@/lib/catalogo/import/estados";
import { ImportStartError, runImport, type ImportProgress, type ImportReport } from "@/lib/catalogo/import/proceso";
import { ATTENTION_LABEL, summarizeImport } from "@/lib/catalogo/import/resultado";
import type { CategoryDecision, ImageInfo, ImportAnalysis, ImportHistoryItem, RawRow } from "@/lib/catalogo/import/types";
import { Historial } from "@/components/dashboard/catalogo/importar/Historial";
import { Proceso, Resultado } from "@/components/dashboard/catalogo/importar/ProcesoResultado";
import { VistaPrevia } from "@/components/dashboard/catalogo/importar/VistaPrevia";
import { ZonaCarga } from "@/components/dashboard/catalogo/importar/ZonaCarga";
import { actionBtn, cn, useCatalogAccess, useCatalogToast } from "@/components/dashboard/catalogo/ui";

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

  // Fase de la pantalla: dominio central (lib/catalogo/import/estados.ts).
  const [phase, setPhase] = useState<ImportPhase>("draft");
  const [files, setFiles] = useState<ImportFiles>(emptyImportFiles);
  const [fileNotices, setFileNotices] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Revisando fotos recién elegidas (miles de encabezados: unos segundos). */
  const [collecting, setCollecting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<RawRow[]>([]);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [decisions, setDecisions] = useState<Record<string, CategoryDecision>>({});
  const [force, setForce] = useState<number[]>([]);
  /** Filas ya importadas sin fotos a las que la persona decidió agregarles las fotos. */
  const [attach, setAttach] = useState<number[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  /** null = aún no se sabe (o no se pudo consultar: el servidor decide al importar). */
  const [available, setAvailable] = useState<boolean | null>(null);
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

  // ¿Está activa la carga masiva? + historial (un solo pedido).
  useEffect(() => {
    if (!client) return;
    let vivo = true;
    void client.listImports().then((r) => {
      if (!vivo || !r.ok) return;
      setAvailable(r.data.available);
      setHistory(r.data.imports);
    });
    return () => {
      vivo = false;
    };
  }, [client, historyKey]);

  // Mientras se importa, avisar antes de cerrar la pestaña.
  useEffect(() => {
    if (phase !== "processing") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

  const reanalyze = useCallback(
    async (next: { rows?: RawRow[]; decisions?: Record<string, CategoryDecision>; force?: number[]; attach?: number[]; images?: ImageInfo[] }) => {
      if (!client) return;
      const body = { rows: next.rows ?? rows, decisions: next.decisions ?? decisions, force: next.force ?? force, attach: next.attach ?? attach, images: next.images ?? files.infos };
      if (body.rows.length === 0) {
        setAnalysis(null);
        setPhase("draft");
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
    [client, rows, decisions, force, attach, files.infos, toast],
  );

  const analyzeFile = async (next: ImportFiles) => {
    if (!client || !next.spreadsheet) return;
    const id = ++request.current;
    setPhase("analyzing");
    setFileError(null);
    const r = await client.analyzeImportFile(next.spreadsheet, { images: next.infos, decisions: {} });
    if (id !== request.current) return;
    if (!r.ok) {
      setPhase("draft");
      setFileError(r.error.message);
      setFiles((f) => ({ ...f, spreadsheet: null }));
      return;
    }
    setFileName(r.data.file.name);
    setRows(r.data.rows);
    setDecisions({});
    setForce([]);
    setAttach([]);
    setAnalysis(r.data.analysis);
    setPhase("ready");
  };

  const addFiles = async (list: Array<File | IncomingFile>) => {
    setFileError(null);
    setCollecting(true);
    const res = await collectFiles(list, files).finally(() => setCollecting(false));
    setFileNotices(res.notices);
    if (res.error) {
      setFileError(res.error);
      return;
    }
    setFiles(res.files);
    // En el paso 1 se espera a "Revisar mis productos" (planilla y fotos juntas);
    // en el preview, lo nuevo se revisa enseguida.
    if (phase !== "ready") return;
    if (res.files.spreadsheet && res.files.spreadsheet !== files.spreadsheet) await analyzeFile(res.files);
    else if (res.files.infos.length !== files.infos.length) await reanalyze({ images: res.files.infos });
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
    setAttach([]);
    setProgress(null);
    setReport(null);
    setBusy(false);
    setPhase("draft");
  };

  const importar = async () => {
    if (!client || !analysis || busy || available === false) return;
    // Se CONGELA lo que la persona revisó: cada fila viaja con sus fotos exactas
    // (ids), así cada lote crea lo mismo que mostró el preview aunque el
    // servidor analice las filas por partes.
    const reviewed = new Map(analysis.rows.filter((r) => r.status === "ready" || r.status === "warning" || r.attach).map((r) => [r.row, r]));
    const toImport = rows
      .filter((r) => reviewed.has(r.row))
      .map((r) => ({ ...r, photos: reviewed.get(r.row)!.images.flatMap((m) => (m.file ? [m.file] : [])) }));
    if (toImport.length === 0) return;
    const attachRows = analysis.rows.filter((r) => r.attach).map((r) => r.row);
    setPhase("processing");
    try {
      const result = await runImport(
        { fileName, rows: toImport, images: files.infos, decisions, force, attach: attachRows },
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
      setPhase(
        finalOutcome({
          created: result.rows.filter((r) => r.status === "created").length,
          errors: result.rows.filter((r) => r.status === "error").length,
          photosFailed: result.photoFailures.length,
          photosUploaded: result.photosUploaded,
        }),
      );
      setHistoryKey((k) => k + 1);
    } catch (err) {
      setPhase("ready");
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
    if (!report || !analysis) return;
    const estado = { created: "creado", attached: "fotos agregadas", skipped: "omitido", error: "error" } as const;
    const data: Array<Array<string | number | null>> = [["fila", "estado", "referencia", "nombre", "fotos", "detalle"]];
    for (const r of report.rows) data.push([r.row, estado[r.status], r.reference, r.name, r.images.length, r.message]);
    for (const i of summarizeImport(analysis, report).items) data.push([i.row, `requiere atención: ${ATTENTION_LABEL[i.reason].es.toLowerCase()}`, i.reference, i.name, null, i.detail]);
    saveCsv(data, "resultado-importacion.csv");
  };

  const descargarPlantilla = async (format: "xlsx" | "csv") => {
    if (!client) return;
    const r = await client.downloadTemplate(format);
    if (r.ok) saveFile(r.data.blob, r.data.fileName);
    else toast(r.error.message, "error");
  };

  const photoUrl = (id: string) => {
    const f = imageFile(files, id);
    return f ? objectUrl(f) : null;
  };

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow={t("Catálogo", "Catalog")}
        title={t("Carga masiva", "Bulk upload")}
        description={t("Carga muchos productos a la vez desde Excel o CSV, con sus fotografías. DuLabs asigna la referencia de cada uno.", "Load many products at once from Excel or CSV, with their photos. DuLabs assigns each reference.")}
      >
        {phase !== "processing" && (
          <Link href="/dashboard/catalogo" className={actionBtn}>
            <ArrowLeft className="size-4" />
            {t("Volver", "Back")}
          </Link>
        )}
      </PageHeader>

      <div className="px-4 pt-6 md:px-8">
        <div className="mx-auto max-w-6xl space-y-5">
          <Pasos phase={phase} />

          {available === false && (phase === "draft" || phase === "analyzing" || phase === "ready") && (
            <p role="status" className="flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
              <Clock className="mt-0.5 size-4 shrink-0" />
              <span>
                {t(
                  "La carga masiva estará disponible muy pronto. Ya puedes preparar tu archivo y revisar el resultado; el botón de importar se activará en cuanto terminemos la configuración.",
                  "Bulk upload will be available very soon. You can already prepare your file and review the result; the import button will be enabled as soon as setup finishes.",
                )}
              </span>
            </p>
          )}

          {fileError && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {fileError}
            </p>
          )}
          {fileNotices.length > 0 && !isFinalPhase(phase) && (
            <ul className="space-y-1">
              {fileNotices.map((n) => (
                <li key={n} className="text-xs text-mist">
                  {n}
                </li>
              ))}
            </ul>
          )}

          {(phase === "draft" || phase === "analyzing") && (
            <>
              <ZonaCarga
                files={files}
                analyzing={phase === "analyzing"}
                collecting={collecting}
                disabled={!client}
                onFiles={(l) => void addFiles(l)}
                onClearSpreadsheet={() => setFiles((f) => ({ ...f, spreadsheet: null }))}
                onClearImages={() => {
                  releaseUrls(files);
                  setFiles((f) => ({ ...f, images: new Map(), infos: [] }));
                }}
                onDownloadTemplate={(format) => void descargarPlantilla(format)}
                onContinue={() => void analyzeFile(files)}
              />

              <GuiaFotos />

              <Historial items={history} />
            </>
          )}

          {phase === "ready" && analysis && (
            <VistaPrevia
              importBlockedReason={
                available === false ? t("La importación se activará muy pronto.", "Import will be enabled very soon.") : null
              }
              fileName={fileName}
              analysis={analysis}
              existingCategories={categories}
              busy={busy}
              photoUrl={photoUrl}
              images={files.infos}
              addPhotos={<ZonaCarga compact files={files} analyzing={busy} onFiles={(l) => void addFiles(l)} />}
              onPickPhotos={(row, ids) => {
                const next = rows.map((r) => (r.row === row ? (ids === null ? { row, values: r.values } : { ...r, photos: ids }) : r));
                setRows(next);
                void reanalyze({ rows: next });
              }}
              onDecision={(key, d) => {
                const next = { ...decisions, [key]: d };
                setDecisions(next);
                void reanalyze({ decisions: next });
              }}
              onToggleAttach={(rowsToToggle, on) => {
                const next = on ? [...new Set([...attach, ...rowsToToggle])] : attach.filter((r) => !rowsToToggle.includes(r));
                setAttach(next);
                void reanalyze({ attach: next });
              }}
              onToggleForce={(row) => {
                const next = force.includes(row) ? force.filter((r) => r !== row) : [...force, row];
                setForce(next);
                void reanalyze({ force: next });
              }}
              onSaveRow={(row, values) => {
                // Corregir los datos no descarta las fotos elegidas a mano.
                const next = rows.map((r) => (r.row === row ? { ...r, values } : r));
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

          {phase === "processing" && progress && <Proceso progress={progress} />}

          {isFinalPhase(phase) && report && analysis && (
            <Resultado summary={summarizeImport(analysis, report)} outcome={phase} onNew={restart} onDownloadReport={descargarReporte} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Cómo relacionamos fotos y productos (la regla determinista, en lenguaje de la persona). */
function GuiaFotos() {
  const { t } = useI18n();
  const ejemplos: Array<{ archivo: string; es: string; en: string }> = [
    { archivo: "anillo-corazon.jpg", es: "foto principal de «Anillo corazón»", en: "main photo of «Anillo corazón»" },
    { archivo: "anillo-corazon-2.jpg · -3.jpg", es: "galería, en ese orden", en: "gallery, in that order" },
    { archivo: "Anillo corazón/ 1.jpg 2.jpg", es: "o una carpeta por producto", en: "or one folder per product" },
    { archivo: "AN-014.jpg", es: "o tu código, en la columna «codigo»", en: "or your code, in the «codigo» column" },
  ];
  return (
    <section className="rounded-2xl border border-edge bg-card p-5 md:p-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <FolderOpen className="size-4 text-mist" />
        {t("Cómo encontramos las fotos de cada producto", "How we find each product's photos")}
      </h3>
      <p className="mt-1 text-xs text-mist">
        {t(
          "Por su nombre de archivo: mayúsculas, tildes, espacios y guiones no importan. Nunca adivinamos: si dos fotos podrían ser del mismo producto, te preguntamos.",
          "By file name: case, accents, spaces and dashes don't matter. We never guess: if two photos could belong to the same product, we ask you.",
        )}
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {ejemplos.map((e) => (
          <li key={e.archivo} className="flex flex-col rounded-xl bg-ink-2/50 px-3 py-2.5">
            <code className="truncate font-mono text-xs text-lime-text">{e.archivo}</code>
            <span className="text-xs text-mist">{t(e.es, e.en)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-mist/80">
        {t(
          "¿Tus fotos tienen otro nombre? Escríbelo en la columna «imagenes» o elígelas en la revisión. Formatos: JPG, PNG o WEBP (en iPhone, exporta como JPG).",
          "Photos named differently? Write the name in the «imagenes» column or pick them in the review. Formats: JPG, PNG or WEBP.",
        )}
      </p>
    </section>
  );
}

/** "1. Sube tus productos · 2. Revisa los resultados · 3. Confirma la importación". */
function Pasos({ phase }: { phase: ImportPhase }) {
  const { t } = useI18n();
  const actual = stepOf(phase);
  const terminado = isFinalPhase(phase);
  return (
    <ol className="flex items-center gap-2 overflow-x-auto text-sm" aria-label={t("Pasos de la carga masiva", "Bulk upload steps")}>
      {IMPORT_STEPS.map((p, i) => {
        const hecho = p.n < actual || (terminado && p.n === actual);
        const activo = p.n === actual && !terminado;
        return (
          <li key={p.n} className="flex shrink-0 items-center gap-2">
            {i > 0 && <span className={cn("h-px w-5 sm:w-10", hecho || activo ? "bg-lime/50" : "bg-edge")} aria-hidden />}
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                hecho ? "bg-lime text-lime-fg" : activo ? "bg-lime/15 text-lime-text ring-1 ring-lime/40" : "bg-ink-2 text-mist",
              )}
              aria-current={activo ? "step" : undefined}
            >
              {hecho ? <Check className="size-3.5" strokeWidth={3} /> : p.n}
            </span>
            <span className={cn("whitespace-nowrap", activo ? "font-medium text-fg" : "text-mist", !activo && "hidden sm:inline")}>{t(p.es, p.en)}</span>
          </li>
        );
      })}
    </ol>
  );
}
