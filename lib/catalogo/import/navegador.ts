/**
 * Carga masiva — archivos EN EL NAVEGADOR: reúne la planilla y las fotos que
 * la persona eligió, arrastró (también carpetas completas) o empaquetó en un
 * ZIP. Las fotos nunca se suben a una función de Vercel: se quedan aquí hasta
 * que el producto exista y luego van optimizadas directo a Storage.
 */
import { IMPORT_LIMITS, formatBytes } from "@/lib/catalogo/import/limites";
import { baseName, extensionOf, fileKey, imageProblem, isImageFileName, sniffImage } from "@/lib/catalogo/import/fotos";
import { spreadsheetKind } from "@/lib/catalogo/import/planilla-tipo";
import type { ImageInfo } from "@/lib/catalogo/import/types";
import { isSystemEntry, readZipIndex, ZipError } from "@/lib/catalogo/import/zip";

export interface ImportFiles {
  spreadsheet: File | null;
  /** Foto por nombre de archivo (clave = fileKey). */
  images: Map<string, File>;
  infos: ImageInfo[];
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

async function inspect(file: File): Promise<ImageInfo> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return { name: file.name, size: file.size, problem: imageProblem(sniffImage(head), file.size) };
}

/**
 * Agrega archivos a la selección actual (no la reemplaza: se puede soltar el
 * Excel y luego la carpeta de fotos). Devuelve avisos amables y, si algo
 * impide continuar, un error.
 */
export async function collectFiles(incoming: readonly File[], current: ImportFiles): Promise<CollectResult> {
  const files: ImportFiles = { spreadsheet: current.spreadsheet, images: new Map(current.images), infos: [...current.infos] };
  const notices: string[] = [];
  let ignored = 0;
  let repeated = 0;
  const newImages: File[] = [];

  const addImage = (file: File) => {
    const key = fileKey(file.name);
    if (files.images.has(key) || newImages.some((f) => fileKey(f.name) === key)) {
      repeated++;
      return;
    }
    newImages.push(file);
  };
  const setSpreadsheet = (file: File) => {
    if (files.spreadsheet && files.spreadsheet !== current.spreadsheet) notices.push(`Había más de una planilla: usamos «${file.name}».`);
    files.spreadsheet = file;
  };

  for (const file of incoming) {
    const name = baseName(file.name);
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
              addImage(new File([new Uint8Array(0)], entryName));
              continue;
            }
            addImage(new File([(await entry.read(IMPORT_LIMITS.imageBytes)) as BlobPart], entryName, { type: MIME_BY_EXT[extensionOf(entryName)] ?? "" }));
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
    else if (isImageFileName(name) || file.type.startsWith("image/")) addImage(file.name === name ? file : new File([file], name, { type: file.type }));
    else ignored++;
  }

  if (files.images.size + newImages.length > IMPORT_LIMITS.images) {
    return { files: current, notices, error: `Son más de ${IMPORT_LIMITS.images} fotos. Importa el catálogo por partes.` };
  }
  const total = [...files.images.values(), ...newImages].reduce((n, f) => n + f.size, 0);
  if (total > IMPORT_LIMITS.imagesTotalBytes) {
    return { files: current, notices, error: `Las fotos suman más de ${formatBytes(IMPORT_LIMITS.imagesTotalBytes)}. Importa el catálogo por partes.` };
  }

  for (const f of newImages) {
    files.images.set(fileKey(f.name), f);
    files.infos.push(await inspect(f));
  }
  if (ignored > 0) notices.push(ignored === 1 ? "Ignoramos 1 archivo que no es foto ni planilla." : `Ignoramos ${ignored} archivos que no son fotos ni planillas.`);
  if (repeated > 0) notices.push(repeated === 1 ? "Una foto estaba repetida (mismo nombre): usamos la primera." : `${repeated} fotos estaban repetidas (mismo nombre): usamos la primera de cada una.`);
  return { files, notices, error: null };
}

/** Foto por el nombre que devolvió el análisis. */
export function imageFile(files: ImportFiles, name: string): File | null {
  return files.images.get(fileKey(name)) ?? null;
}

// ---------------------------------------------------------------------------
// Arrastrar y soltar carpetas
// ---------------------------------------------------------------------------

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: FsEntry[]) => void, fail: (e: unknown) => void) => void };
}

async function walk(entry: FsEntry, out: File[], depth: number): Promise<void> {
  if (out.length > IMPORT_LIMITS.images + 50 || depth > 8) return;
  if (entry.isFile && entry.file) {
    if (isSystemEntry(entry.name) || entry.name.startsWith(".")) return;
    out.push(await new Promise<File>((ok, fail) => entry.file!(ok, fail)));
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
export function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries: FsEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return Promise.resolve(Array.from(dt.files ?? []));
  return (async () => {
    const out: File[] = [];
    for (const e of entries) await walk(e, out, 0);
    return out;
  })();
}
