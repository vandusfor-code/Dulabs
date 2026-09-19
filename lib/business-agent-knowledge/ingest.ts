/**
 * R4 — ingesta de documentos de conocimiento: validación -> extracción ->
 * limpieza -> chunking -> huella. Sin I/O de base de datos (la persistencia la
 * hace el store). La extracción REUTILIZA lib/archivo-texto.ts (pdf-parse +
 * exceljs, ya probada en producción, con firma %PDF-, timeout y mensajes
 * claros); aquí solo se agregan las defensas propias de R4 (magic bytes,
 * zip-bomb en xlsx, nombre de archivo, tope de texto/chunks).
 *
 * No se conserva el archivo original: solo el texto extraído. Por eso no hay
 * Storage, URLs firmadas ni rutas de archivo que atacar.
 */
import { createHash } from "node:crypto";
import { extraerTexto } from "@/lib/archivo-texto";
import { chunkText, cleanExtractedText } from "@/lib/business-agent-knowledge/chunker";
import { KNOWLEDGE_DOC_EXTENSIONS, KNOWLEDGE_LIMITS, type KnowledgeDocExtension } from "@/lib/business-agent-knowledge/limits";

export type IngestErrorCode = "INVALID_FILE" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "EMPTY" | "NO_TEXT" | "EXTRACTION_FAILED" | "SUSPICIOUS_ARCHIVE";

export type IngestResult =
  | {
      ok: true;
      filename: string;
      extension: KnowledgeDocExtension;
      chunks: string[];
      /** Caracteres de texto indexados (tras el tope). */
      charCount: number;
      /** true si el texto o los chunks superaron el tope y se descartó el resto. */
      truncated: boolean;
      sha256: string;
    }
  | { ok: false; code: IngestErrorCode; error: string };

const CONTROL_Y_RESERVADOS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}<>:"|?*\\\\/]`,
  "g",
);

/** Extensión en minúsculas (sin punto) o "". */
export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * Nombre visible y SEGURO: solo el basename (sin rutas), sin caracteres de
 * control/reservados, con tope de longitud. El nombre es solo una etiqueta: no
 * se usa nunca para construir una ruta ni para acceder al sistema de archivos.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const limpio = base.replace(CONTROL_Y_RESERVADOS, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (limpio.length <= KNOWLEDGE_LIMITS.filenameMax) return limpio;
  const ext = fileExtension(limpio);
  const cola = ext ? `.${ext}` : "";
  return `${limpio.slice(0, KNOWLEDGE_LIMITS.filenameMax - cola.length).trimEnd()}${cola}`;
}

// --- Zip (xlsx) anti-bomba ---------------------------------------------------
const MAX_ZIP_ENTRIES = 2000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/**
 * Lee el directorio central de un .xlsx (zip) SIN descomprimir y rechaza
 * archivos cuyo tamaño descomprimido declarado es desproporcionado (zip
 * bomb) o que usan zip64 / demasiadas entradas. exceljs descomprime en
 * memoria: sin esto, 4 MB de zip podrían expandirse a GB.
 */
export function inspectZipBomb(buffer: Buffer): { ok: true } | { ok: false; reason: string } {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const desde = Math.max(0, buffer.length - 22 - 65535);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= desde; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, reason: "no es un archivo comprimido válido" };
  const entradas = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entradas === 0xffff || cdOffset === 0xffffffff) return { ok: false, reason: "usa un formato comprimido no soportado (zip64)" };
  if (entradas > MAX_ZIP_ENTRIES) return { ok: false, reason: "contiene demasiados archivos internos" };

  let pos = cdOffset;
  let total = 0;
  for (let n = 0; n < entradas; n++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== CD_SIG) return { ok: false, reason: "estructura interna corrupta" };
    const sinComprimir = buffer.readUInt32LE(pos + 24);
    if (sinComprimir === 0xffffffff) return { ok: false, reason: "usa un formato comprimido no soportado (zip64)" };
    total += sinComprimir;
    if (total > MAX_ZIP_UNCOMPRESSED_BYTES) return { ok: false, reason: "su contenido descomprimido es demasiado grande" };
    const nombreLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const comentarioLen = buffer.readUInt16LE(pos + 32);
    pos += 46 + nombreLen + extraLen + comentarioLen;
  }
  return { ok: true };
}

export interface PrepareDocumentInput {
  filename: string;
  size: number;
  buffer: Buffer;
  /** Solo tests: reemplaza la extracción real (pdf-parse/exceljs). */
  extract?: (name: string, buffer: Buffer) => Promise<string>;
}

async function defaultExtract(name: string, buffer: Buffer): Promise<string> {
  const ext = fileExtension(name);
  if (ext === "txt") return buffer.toString("utf8");
  // extraerTexto solo usa `archivo.name` (extensión/etiqueta) y el buffer.
  return extraerTexto({ name } as File, buffer);
}

/** Valida el archivo y lo convierte en chunks listos para indexar. Nunca lanza. */
export async function prepareDocument(input: PrepareDocumentInput): Promise<IngestResult> {
  const filename = sanitizeFilename(input.filename);
  if (!filename) return { ok: false, code: "INVALID_FILE", error: "El archivo no tiene un nombre válido." };

  const ext = fileExtension(filename);
  if (!(KNOWLEDGE_DOC_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, code: "UNSUPPORTED_TYPE", error: `Formato no soportado. Sube un archivo ${KNOWLEDGE_DOC_EXTENSIONS.map((e) => `.${e}`).join(", ")}.` };
  }
  const tipo = ext as KnowledgeDocExtension;

  const size = input.buffer.length; // el tamaño real del buffer manda, no el que declara el cliente
  if (size === 0) return { ok: false, code: "EMPTY", error: "El archivo está vacío." };
  if (size > KNOWLEDGE_LIMITS.docMaxBytes) {
    return { ok: false, code: "TOO_LARGE", error: `El archivo supera el límite de ${Math.round(KNOWLEDGE_LIMITS.docMaxBytes / (1024 * 1024))} MB.` };
  }

  // Firma real del contenido (la extensión o el MIME del cliente no son confiables).
  const cabeza = input.buffer.subarray(0, 5).toString("latin1");
  if (tipo === "pdf" && cabeza !== "%PDF-") {
    return { ok: false, code: "INVALID_FILE", error: "El archivo no es un PDF válido (firma incorrecta). Vuelve a exportarlo o súbelo de nuevo." };
  }
  if (tipo === "xlsx") {
    if (input.buffer.length < 4 || input.buffer.readUInt32LE(0) !== 0x04034b50) {
      return { ok: false, code: "INVALID_FILE", error: "El archivo no es un Excel (.xlsx) válido." };
    }
    const zip = inspectZipBomb(input.buffer);
    if (!zip.ok) return { ok: false, code: "SUSPICIOUS_ARCHIVE", error: `Este archivo Excel no se puede procesar: ${zip.reason}.` };
  }
  if ((tipo === "csv" || tipo === "txt") && input.buffer.subarray(0, 4096).includes(0)) {
    return { ok: false, code: "INVALID_FILE", error: "El archivo no parece texto plano (contiene datos binarios)." };
  }

  let texto: string;
  try {
    texto = await (input.extract ?? defaultExtract)(filename, input.buffer);
  } catch (err) {
    return { ok: false, code: "EXTRACTION_FAILED", error: err instanceof Error ? err.message : "No se pudo leer el archivo." };
  }

  let limpio = cleanExtractedText(texto);
  if (!limpio) return { ok: false, code: "NO_TEXT", error: "El documento no contiene texto extraíble." };

  let truncated = false;
  if (limpio.length > KNOWLEDGE_LIMITS.docMaxChars) {
    limpio = limpio.slice(0, KNOWLEDGE_LIMITS.docMaxChars);
    truncated = true;
  }
  let chunks = chunkText(limpio);
  if (chunks.length === 0) return { ok: false, code: "NO_TEXT", error: "El documento no contiene texto extraíble." };
  if (chunks.length > KNOWLEDGE_LIMITS.docMaxChunks) {
    chunks = chunks.slice(0, KNOWLEDGE_LIMITS.docMaxChunks);
    truncated = true;
  }

  return {
    ok: true,
    filename,
    extension: tipo,
    chunks,
    charCount: chunks.reduce((n, c) => n + c.length, 0),
    truncated,
    sha256: createHash("sha256").update(limpio).digest("hex"),
  };
}
