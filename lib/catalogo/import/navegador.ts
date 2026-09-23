/**
 * Carga masiva — archivos EN EL NAVEGADOR: reúne la planilla y las fotos que
 * la persona eligió, arrastró (también carpetas completas) o empaquetó en un
 * ZIP. Las fotos nunca se suben a una función de Vercel: se quedan aquí hasta
 * que el producto exista y luego van optimizadas directo a Storage.
 */
import { IMPORT_LIMITS, formatBytes } from "@/lib/catalogo/import/limites";
import { baseName, extensionOf, imageProblem, isImageFileName, normalizePath, pathKey, readImageSize, sniffImage, type HeaderRead } from "@/lib/catalogo/import/fotos";
import { spreadsheetKind } from "@/lib/catalogo/import/planilla-tipo";
import type { ImageInfo } from "@/lib/catalogo/import/types";
import { isSystemEntry, readZipIndex, ZipError } from "@/lib/catalogo/import/zip";

export interface ImportFiles {
  spreadsheet: File | null;
  /** Foto por su identidad (clave = pathKey(ImageInfo.id)): dos "1.jpg" en carpetas distintas son dos fotos. */
  images: Map<string, File>;
  infos: ImageInfo[];
}

/** Archivo con la ruta relativa desde lo que la persona eligió ("Fotos/Anillos/a.jpg"). */
export interface IncomingFile {
  file: File;
  path: string;
}

export interface CollectResult {
  files: ImportFiles;
  notices: string[];
  error: string | null;
}

export function emptyImportFiles(): ImportFiles {
  return { spreadsheet: null, images: new Map(), infos: [] };
}

const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", gif: "image/gif", avif: "image/avif" };

/** Bytes que se leen, por intento, para encontrar las dimensiones (casi siempre basta el primero). */
const HEADER_READS = [64 * 1024, 1024 * 1024, 4 * 1024 * 1024];

/**
 * Metadatos de una foto SIN decodificarla: firma real, dimensiones del
 * encabezado y si está dañada. Lee como mucho unos KB por foto, así 2.000
 * fotos se revisan en segundos y sin cargarlas en memoria.
 */
export async function inspectImage(file: Blob, id: string): Promise<ImageInfo> {
  const info = { id, name: baseName(id), size: file.size, width: null as number | null, height: null as number | null };
  let head = new Uint8Array(await file.slice(0, HEADER_READS[0]).arrayBuffer());
  const kind = sniffImage(head);
  let dims: HeaderRead | null = null;
  if (kind === "jpeg" || kind === "png" || kind === "webp") {
    for (let i = 0; ; i++) {
      dims = readImageSize(head, kind);
      if (dims !== "truncated") break;
      if (head.length >= file.size) {
        dims = "invalid"; // leído completo y aún incompleto: el archivo está cortado
        break;
      }
      if (i + 1 >= HEADER_READS.length) {
        dims = null; // encabezado inusualmente largo: no se sabe (se verificará al procesarla)
        break;
      }
      head = new Uint8Array(await file.slice(0, HEADER_READS[i + 1]).arrayBuffer());
    }
  }
  if (typeof dims === "object" && dims !== null) {
    info.width = dims.width;
    info.height = dims.height;
  }
  return { ...info, problem: imageProblem(kind, file.size, dims) };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Ruta con la que llega un archivo: la de la carpeta elegida, o solo su nombre. */
export function incomingOf(file: File | IncomingFile): IncomingFile {
  if ("file" in file) return file;
  return { file, path: file.webkitRelativePath || file.name };
}

/**
 * Agrega archivos a la selección actual (no la reemplaza: se puede soltar el
 * Excel y luego la carpeta de fotos). Devuelve avisos amables y, si algo
 * impide continuar, un error.
 */
export async function collectFiles(incoming: ReadonlyArray<File | IncomingFile>, current: ImportFiles): Promise<CollectResult> {
  const files: ImportFiles = { spreadsheet: current.spreadsheet, images: new Map(current.images), infos: [...current.infos] };
  const notices: string[] = [];
  let ignored = 0;
  let repeated = 0;
  const newImages: Array<{ file: File; id: string; tooBig: boolean }> = [];
  const pending = new Set<string>();

  const addImage = (file: File, path: string, tooBig = false) => {
    const id = normalizePath(path) || file.name;
    const key = pathKey(id);
    if (files.images.has(key) || pending.has(key)) {
      repeated++;
      return;
    }
    pending.add(key);
    newImages.push({ file, id, tooBig });
  };
  const setSpreadsheet = (file: File) => {
    if (files.spreadsheet && files.spreadsheet !== current.spreadsheet) notices.push(`Había más de una planilla: usamos «${file.name}».`);
    files.spreadsheet = file;
  };

  for (const item of incoming.map(incomingOf)) {
    const { file, path } = item;
    const name = baseName(path);
    if (isSystemEntry(normalizePath(path)) || name.startsWith(".")) continue;
    if (extensionOf(name) === "zip") {
      if (file.size > IMPORT_LIMITS.zipBytes) return { files: current, notices, error: `El ZIP pesa más de ${formatBytes(IMPORT_LIMITS.zipBytes)}. Divide las fotos en varios ZIP o selecciona la carpeta directamente.` };
      try {
        const entries = readZipIndex(new Uint8Array(await file.arrayBuffer()), IMPORT_LIMITS.zipEntries).filter((e) => !isSystemEntry(e.path));
        for (const entry of entries) {
          const entryName = baseName(entry.path);
          if (spreadsheetKind(entryName)) {
            setSpreadsheet(new File([(await entry.read(IMPORT_LIMITS.spreadsheetBytes)) as BlobPart], entryName));
          } else if (isImageFileName(entryName)) {
            if (entry.size > IMPORT_LIMITS.imageBytes) {
              addImage(new File([new Uint8Array(0)], entryName), entry.path, true);
              continue;
            }
            addImage(new File([(await entry.read(IMPORT_LIMITS.imageBytes)) as BlobPart], entryName, { type: MIME_BY_EXT[extensionOf(entryName)] ?? "" }), entry.path);
          } else {
            ignored++;
          }
        }
      } catch (err) {
        return { files: current, notices, error: err instanceof ZipError ? err.message : "No pudimos abrir el ZIP. Créalo de nuevo o selecciona la carpeta de fotos directamente." };
      }
      continue;
    }
    if (spreadsheetKind(name)) setSpreadsheet(file.name === name ? file : new File([file], name, { type: file.type }));
    else if (isImageFileName(name) || file.type.startsWith("image/")) addImage(file, path);
    else ignored++;
  }

  if (files.images.size + newImages.length > IMPORT_LIMITS.images) {
    return { files: current, notices, error: `Son más de ${IMPORT_LIMITS.images} fotos. Importa el catálogo por partes.` };
  }
  const total = [...files.images.values(), ...newImages.map((n) => n.file)].reduce((n, f) => n + f.size, 0);
  if (total > IMPORT_LIMITS.imagesTotalBytes) {
    return { files: current, notices, error: `Las fotos suman más de ${formatBytes(IMPORT_LIMITS.imagesTotalBytes)}. Importa el catálogo por partes.` };
  }

  const infos = await mapLimit(newImages, 8, (n) =>
    n.tooBig ? Promise.resolve<ImageInfo>({ id: n.id, name: baseName(n.id), size: IMPORT_LIMITS.imageBytes + 1, width: null, height: null, problem: "size" }) : inspectImage(n.file, n.id),
  );
  newImages.forEach((n, i) => {
    files.images.set(pathKey(n.id), n.file);
    files.infos.push(infos[i]);
  });
  if (ignored > 0) notices.push(ignored === 1 ? "Ignoramos 1 archivo que no es foto ni planilla." : `Ignoramos ${ignored} archivos que no son fotos ni planillas.`);
  if (repeated > 0) notices.push(repeated === 1 ? "Una foto ya estaba seleccionada: la dejamos una sola vez." : `${repeated} fotos ya estaban seleccionadas: las dejamos una sola vez.`);
  return { files, notices, error: null };
}

/** Foto por su id (el que devolvió el análisis). */
export function imageFile(files: ImportFiles, id: string): File | null {
  return files.images.get(pathKey(id)) ?? null;
}

// ---------------------------------------------------------------------------
// Arrastrar y soltar carpetas
// ---------------------------------------------------------------------------

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
  file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: FsEntry[]) => void, fail: (e: unknown) => void) => void };
}

async function walk(entry: FsEntry, out: IncomingFile[], depth: number): Promise<void> {
  if (out.length > IMPORT_LIMITS.images + 50 || depth > 8) return;
  if (entry.isFile && entry.file) {
    if (isSystemEntry(entry.name) || entry.name.startsWith(".")) return;
    const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail));
    // fullPath = "/Fotos/Anillos/a.jpg": se conserva la carpeta (identidad y detección por carpeta).
    out.push({ file, path: normalizePath(entry.fullPath ?? entry.name) });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries entrega por tandas: se llama hasta que devuelva vacío.
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, out, depth + 1);
    }
  }
}

/**
 * Archivos de un "drop", entrando en las carpetas. Las entradas se toman de
 * forma SÍNCRONA (el DataTransfer deja de ser válido al terminar el evento).
 */
export function filesFromDrop(dt: DataTransfer): Promise<Array<File | IncomingFile>> {
  const entries: FsEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return Promise.resolve(Array.from(dt.files ?? []));
  return (async () => {
    const out: IncomingFile[] = [];
    for (const e of entries) await walk(e, out, 0);
    return out;
  })();
}
