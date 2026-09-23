/**
 * Carga masiva — ORQUESTACIÓN en el navegador (sin bloquear la interfaz):
 *
 *   iniciar importación
 *   por cada lote de filas (IMPORT_LIMITS.rowsPerBatch):
 *     crear productos en el servidor (validación + referencia en backend)
 *     por cada lote de sus fotos (IMPORT_LIMITS.photosPerBatch):
 *       optimizar en el navegador -> URLs firmadas -> subir a Storage -> confirmar
 *   finalizar (el servidor cuenta los creados)
 *
 * Peticiones cortas y reintentables en vez de una gigante: no hay timeouts de
 * Vercel, el progreso es real y un corte de red no pierde lo ya creado (el
 * servidor es idempotente por importación + fila). Sin colas externas: no
 * hacen falta, porque las fotos SOLO se pueden optimizar en el navegador.
 *
 * Dependencias inyectadas: se prueba sin navegador ni red.
 */
import { baseName, pathKey } from "@/lib/catalogo/import/fotos";
import { IMPORT_LIMITS } from "@/lib/catalogo/import/limites";
import type { CategoryDecision, ImageInfo, ImportRecord, ImportRowResult, RawRow } from "@/lib/catalogo/import/types";

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; status: number } };

export interface PreparedPhoto {
  image: Blob;
  thumb: Blob;
  detail: Blob;
  mimeType: "image/webp" | "image/jpeg";
  width: number;
  height: number;
}

export interface UploadTicketLike {
  uploadId: string;
}

export interface ImportRunDeps<Ticket extends UploadTicketLike = UploadTicketLike> {
  startImport(fileName: string, totalRows: number): Promise<Result<{ import: ImportRecord }>>;
  importRows(
    importId: string,
    body: { rows: RawRow[]; images: ImageInfo[]; decisions: Record<string, CategoryDecision>; force: number[]; attach: number[] },
  ): Promise<Result<{ results: ImportRowResult[] }>>;
  photoUrls(
    importId: string,
    items: Array<{ productId: string; mimeType: PreparedPhoto["mimeType"]; bytes: number; thumbBytes: number; detailBytes?: number }>,
  ): Promise<Result<{ results: Array<{ productId: string; ok: true; upload: Ticket } | { productId: string; ok: false; message: string }> }>>;
  confirmPhotos(
    importId: string,
    items: Array<{ productId: string; uploadId: string; mimeType: PreparedPhoto["mimeType"]; width: number; height: number; makePrimary: boolean }>,
  ): Promise<Result<{ results: Array<{ productId: string; uploadId: string; ok: boolean; message?: string }> }>>;
  finishImport(importId: string, counts: { skipped: number; errors: number; photosUploaded: number; photosFailed: number }): Promise<Result<{ import: ImportRecord }>>;
  /** Optimiza la foto (lanza con un mensaje legible si no se puede). */
  prepare(file: File): Promise<PreparedPhoto>;
  upload(ticket: Ticket, photo: PreparedPhoto): Promise<Result<null>>;
  imageFile(name: string): File | null;
  sleep(ms: number): Promise<void>;
}

export interface ImportProgress {
  phase: "starting" | "creating" | "photos" | "finishing";
  rowsDone: number;
  rowsTotal: number;
  photosDone: number;
  photosTotal: number;
  created: number;
  /** Foto que se está procesando ahora (nombre de archivo), para mostrarla. */
  current: string | null;
}

export interface PhotoFailure {
  row: number;
  reference: string | null;
  /** Nombre del producto (para el resultado). */
  product: string | null;
  /** Id de la foto (ruta relativa). */
  file: string;
  message: string;
  /** prepare = no se pudo leer/optimizar (imagen inválida); upload = no se pudo subir o registrar. */
  stage: "prepare" | "upload";
}

export interface ImportReport {
  importId: string;
  record: ImportRecord | null;
  rows: ImportRowResult[];
  photosUploaded: number;
  photoFailures: PhotoFailure[];
}

export interface ImportRunInput {
  fileName: string;
  rows: RawRow[];
  images: ImageInfo[];
  decisions: Record<string, CategoryDecision>;
  force: number[];
  /** Filas ya importadas sin fotos a las que se agregan sus fotos. */
  attach?: number[];
}

// ~90 s en total: más que la ventana de 60 s del rate limit, así una importación
// grande que lo alcance espera y sigue en vez de marcar el lote como fallido.
const RETRY_DELAYS = [2000, 4000, 8000, 16000, 30000, 30000];

function retryable(err: { code: string; status: number }): boolean {
  return err.code === "RATE_LIMITED" || err.code === "NETWORK_ERROR" || err.status === 429 || (err.status >= 500 && err.code !== "FEATURE_UNAVAILABLE");
}

async function withRetry<T>(deps: Pick<ImportRunDeps, "sleep">, fn: () => Promise<Result<T>>): Promise<Result<T>> {
  let last = await fn();
  for (const delay of RETRY_DELAYS) {
    if (last.ok || !retryable(last.error)) return last;
    await deps.sleep(delay);
    last = await fn();
  }
  return last;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export class ImportStartError extends Error {}

export async function runImport<Ticket extends UploadTicketLike>(input: ImportRunInput, deps: ImportRunDeps<Ticket>, onProgress: (p: ImportProgress) => void): Promise<ImportReport> {
  // Con las fotos congeladas del preview el total se conoce desde el inicio; se
  // descuenta lo de las filas que no se crearon.
  const planned = new Map(input.rows.map((r) => [r.row, r.photos?.length ?? 0]));
  const progress: ImportProgress = {
    phase: "starting",
    rowsDone: 0,
    rowsTotal: input.rows.length,
    photosDone: 0,
    photosTotal: [...planned.values()].reduce((a, b) => a + b, 0),
    created: 0,
    current: null,
  };
  const emit = () => onProgress({ ...progress });
  emit();

  const started = await withRetry(deps, () => deps.startImport(input.fileName, input.rows.length));
  if (!started.ok) throw new ImportStartError(started.error.message);
  const importId = started.data.import.id;

  const report: ImportReport = { importId, record: null, rows: [], photosUploaded: 0, photoFailures: [] };

  // Filas con fotos ya decididas (congeladas del preview): cada lote lleva solo
  // los metadatos de SUS fotos, no los de miles.
  const infoById = new Map(input.images.map((i) => [pathKey(i.id), i]));
  const imagesFor = (batch: RawRow[]): ImageInfo[] => {
    if (batch.some((r) => r.photos === undefined)) return input.images;
    const out = new Map<string, ImageInfo>();
    for (const id of batch.flatMap((r) => r.photos ?? [])) {
      const info = infoById.get(pathKey(id));
      if (info) out.set(pathKey(id), info);
    }
    return [...out.values()];
  };

  for (const batch of chunk(input.rows, IMPORT_LIMITS.rowsPerBatch)) {
    progress.phase = "creating";
    emit();
    const res = await withRetry(deps, () =>
      deps.importRows(importId, {
        rows: batch,
        images: imagesFor(batch),
        decisions: input.decisions,
        force: input.force.filter((r) => batch.some((b) => b.row === r)),
        attach: (input.attach ?? []).filter((r) => batch.some((b) => b.row === r)),
      }),
    );
    const results: ImportRowResult[] = res.ok
      ? res.data.results
      : batch.map((b) => ({ row: b.row, status: "error" as const, reference: null, productId: null, name: b.values.name ?? null, message: `Fila ${b.row}: ${res.error.message}`, images: [] }));
    report.rows.push(...results);
    progress.rowsDone += batch.length;
    progress.created += results.filter((r) => r.status === "created").length;

    // Fotos de ESTE lote (la primera de cada producto es la principal).
    const tasks = results.flatMap((r) =>
      (r.status === "created" || r.status === "attached") && r.productId
        ? r.images.map((file, i) => ({ row: r.row, reference: r.reference, productId: r.productId as string, name: r.name, file, primary: i === 0 }))
        : [],
    );
    for (const r of results) {
      const expected = planned.get(r.row) ?? 0;
      const real = (r.status === "created" || r.status === "attached") && r.productId ? r.images.length : 0;
      progress.photosTotal += real - expected;
      planned.set(r.row, real);
    }
    emit();
    if (tasks.length > 0) progress.phase = "photos";

    for (const photoBatch of chunk(tasks, IMPORT_LIMITS.photosPerBatch)) {
      const fail = (t: (typeof tasks)[number], message: string, stage: PhotoFailure["stage"] = "upload") => {
        report.photoFailures.push({ row: t.row, reference: t.reference, product: t.name, file: t.file, message, stage });
        progress.photosDone++;
      };

      // 1. Optimizar en el navegador (de a una: fotos de 10 MB en memoria).
      const ready: Array<{ task: (typeof tasks)[number]; photo: PreparedPhoto }> = [];
      for (const task of photoBatch) {
        progress.current = baseName(task.file);
        emit();
        const file = deps.imageFile(task.file);
        if (!file) {
          fail(task, "No encontramos la foto seleccionada.");
          continue;
        }
        try {
          ready.push({ task, photo: await deps.prepare(file) });
        } catch (err) {
          fail(task, err instanceof Error && err.message ? err.message : "No pudimos procesar esta foto.", "prepare");
        }
      }
      emit();
      if (ready.length === 0) continue;

      // 2. URLs firmadas (el servidor decide la ruta y verifica que el producto sea de esta importación).
      const urls = await withRetry(deps, () =>
        deps.photoUrls(
          importId,
          ready.map((r) => ({ productId: r.task.productId, mimeType: r.photo.mimeType, bytes: r.photo.image.size, thumbBytes: r.photo.thumb.size, detailBytes: r.photo.detail.size })),
        ),
      );
      if (!urls.ok) {
        ready.forEach((r) => fail(r.task, urls.error.message));
        emit();
        continue;
      }

      // 3. Subida directa a Storage (en paralelo, acotada).
      const uploaded = await mapLimit(ready, 3, async (r, i) => {
        const ticket = urls.data.results[i];
        if (!ticket || !ticket.ok) {
          fail(r.task, ticket && !ticket.ok ? ticket.message : "No se pudo preparar la subida de la foto.");
          return null;
        }
        const up = await deps.upload(ticket.upload, r.photo);
        if (!up.ok) {
          fail(r.task, up.error.message);
          return null;
        }
        return { ...r, uploadId: ticket.upload.uploadId };
      });
      const toConfirm = uploaded.filter((u): u is NonNullable<typeof u> => u !== null);
      if (toConfirm.length === 0) {
        emit();
        continue;
      }

      // 4. Confirmar EN ORDEN (principal primero); el servidor verifica cada foto.
      const conf = await withRetry(deps, () =>
        deps.confirmPhotos(
          importId,
          toConfirm.map((u) => ({ productId: u.task.productId, uploadId: u.uploadId, mimeType: u.photo.mimeType, width: u.photo.width, height: u.photo.height, makePrimary: u.task.primary })),
        ),
      );
      toConfirm.forEach((u, i) => {
        const r = conf.ok ? conf.data.results[i] : null;
        if (r?.ok) {
          report.photosUploaded++;
          progress.photosDone++;
        } else {
          fail(u.task, conf.ok ? r?.message ?? "No se pudo registrar la foto." : conf.error.message);
        }
      });
      emit();
    }
  }

  progress.phase = "finishing";
  progress.current = null;
  emit();
  const finished = await withRetry(deps, () =>
    deps.finishImport(importId, {
      skipped: report.rows.filter((r) => r.status === "skipped").length,
      errors: report.rows.filter((r) => r.status === "error").length,
      photosUploaded: report.photosUploaded,
      photosFailed: report.photoFailures.length,
    }),
  );
  report.record = finished.ok ? finished.data.import : null;
  return report;
}

/** Una foto (optimizar + subir + confirmar) cuesta bastante más que crear una fila. */
const PHOTO_WEIGHT = 4;

/**
 * Tiempo restante estimado (ms) con el ritmo real hasta ahora, o null si aún
 * es muy pronto para estimar algo honesto.
 */
export function estimateRemainingMs(p: Pick<ImportProgress, "rowsDone" | "rowsTotal" | "photosDone" | "photosTotal">, elapsedMs: number): number | null {
  const total = p.rowsTotal + PHOTO_WEIGHT * p.photosTotal;
  const done = p.rowsDone + PHOTO_WEIGHT * p.photosDone;
  if (total <= 0 || done <= 0 || elapsedMs < 4000 || done / total < 0.03) return null;
  if (done >= total) return 0;
  return Math.round((elapsedMs / done) * (total - done));
}

/** "Menos de un minuto" / "Unos 3 minutos" / "Aprox. 1 h 10 min". */
export function formatRemaining(ms: number): { es: string; en: string } {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (ms < 60_000) return { es: "Falta menos de un minuto", en: "Less than a minute left" };
  if (min === 1) return { es: "Falta aproximadamente 1 minuto", en: "About 1 minute left" };
  if (min < 60) return { es: `Faltan aproximadamente ${min} minutos`, en: `About ${min} minutes left` };
  const h = Math.floor(min / 60);
  const m = min % 60;
  return { es: `Faltan aproximadamente ${h} h${m > 0 ? ` ${m} min` : ""}`, en: `About ${h} h${m > 0 ? ` ${m} min` : ""} left` };
}
