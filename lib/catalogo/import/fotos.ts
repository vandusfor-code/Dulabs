/**
 * Fotos de la carga masiva — utilidades PURAS (navegador y servidor):
 * reconocer el formato real por su firma, y relacionar lo que la persona
 * escribió en la celda "imagenes" con los archivos que seleccionó.
 */
import { IMPORT_LIMITS } from "@/lib/catalogo/import/limites";
import type { ImageInfo, ImageProblem } from "@/lib/catalogo/import/types";

export type SniffedImage = "jpeg" | "png" | "webp" | "heic" | "gif" | "unknown";

/** Formato REAL por los primeros bytes (nunca por la extensión). Bastan 16 bytes. */
export function sniffImage(head: Uint8Array): SniffedImage {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|avif)$/.test(brand)) return "heic";
  }
  return "unknown";
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "avif"]);

export function isImageFileName(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name));
}

export function extensionOf(name: string): string {
  const base = baseName(name);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

/** Nombre sin carpeta ("fotos/anillos/a.jpg" -> "a.jpg"; también rutas de Windows). */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function stemOf(name: string): string {
  const base = baseName(name);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

/** Clave de comparación de nombres de archivo: sin tildes ni mayúsculas, espacios colapsados. */
export function fileKey(name: string): string {
  return baseName(name).normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Diagnóstico de una foto a partir de su firma y tamaño (null = válida). */
export function imageProblem(sniffed: SniffedImage, size: number): ImageProblem | null {
  if (size <= 0) return "empty";
  if (sniffed === "heic") return "heic";
  if (sniffed !== "jpeg" && sniffed !== "png" && sniffed !== "webp") return "format";
  if (size > IMPORT_LIMITS.imageBytes) return "size";
  return null;
}

/** Celda "imagenes" -> nombres pedidos, en orden. Separadores: coma, punto y coma, barra vertical o salto de línea. */
export function splitImageCell(cell: string | undefined): string[] {
  if (!cell) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of cell.split(/[,;|\n\r]+/)) {
    const t = raw.trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
    if (!t) continue;
    const k = fileKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export interface ImageIndex {
  /** Nombre pedido -> foto (o null). Determinista. */
  find(requested: string): ImageInfo | null;
  all: ImageInfo[];
}

/**
 * Índice de las fotos seleccionadas. Coincidencia, en este orden:
 *   1. nombre exacto (sin distinguir mayúsculas): "Anillo-Corazon.JPG" = "anillo-corazon.jpg";
 *   2. sin extensión o con otra extensión, SOLO si hay una única foto con ese
 *      nombre base: "anillo-corazon" o "anillo-corazon.jpg" -> "anillo-corazon.jpeg".
 * Nunca por parecido del nombre del producto (sería frágil).
 */
export function buildImageIndex(images: readonly ImageInfo[]): ImageIndex {
  const byName = new Map<string, ImageInfo>();
  const byStem = new Map<string, ImageInfo[]>();
  for (const img of images) {
    const k = fileKey(img.name);
    if (!byName.has(k)) byName.set(k, img);
    const s = fileKey(stemOf(img.name));
    byStem.set(s, [...(byStem.get(s) ?? []), img]);
  }
  return {
    all: [...images],
    find(requested) {
      const exact = byName.get(fileKey(requested));
      if (exact) return exact;
      const candidates = byStem.get(fileKey(stemOf(requested))) ?? [];
      return candidates.length === 1 ? candidates[0] : null;
    },
  };
}

export function imageProblemText(problem: ImageProblem): string {
  switch (problem) {
    case "heic":
      return "está en formato HEIC (iPhone); expórtala como JPG";
    case "size":
      return `pesa más de ${Math.round(IMPORT_LIMITS.imageBytes / 1024 / 1024)} MB`;
    case "empty":
      return "está vacía";
    default:
      return "no es una foto JPG, PNG o WEBP";
  }
}
