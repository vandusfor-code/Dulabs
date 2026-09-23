/**
 * Fotos de la carga masiva — utilidades PURAS (navegador y servidor):
 * reconocer el formato real por su firma, leer sus dimensiones del
 * encabezado (sin decodificar la foto), detectar archivos dañados y
 * normalizar nombres y rutas. La relación fila <-> fotos está en asociacion.ts.
 */
import { IMPORT_LIMITS } from "@/lib/catalogo/import/limites";
import type { ImageProblem } from "@/lib/catalogo/import/types";

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

/** Ruta relativa normalizada: "/" como separador, sin "/" inicial, "./" ni dobles barras. */
export function normalizePath(path: string): string {
  return path
    .normalize("NFC")
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "" && p !== ".")
    .join("/");
}

/** Carpeta que contiene la foto ("Fotos/Anillo corazón/1.jpg" -> "Fotos/Anillo corazón"), o null. */
export function folderPathOf(id: string): string | null {
  const i = id.lastIndexOf("/");
  return i > 0 ? id.slice(0, i) : null;
}

/** Clave de una ruta completa (identidad): mayúsculas y espacios no cuentan. */
export function pathKey(path: string): string {
  return normalizePath(path).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Clave "slug" para relacionar productos y fotos por su nombre: sin tildes,
 * minúsculas y todo lo que no sea letra o número como un guion.
 *   "Anillo Corazón" = "anillo-corazon" = "ANILLO_CORAZON" = "anillo corazon"
 *   "anillo-corazon (2)" -> "anillo-corazon-2"
 */
export function photoKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stemOf(name: string): string {
  const base = baseName(name);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

/** Clave de comparación de nombres de archivo: sin tildes ni mayúsculas, espacios colapsados. */
export function fileKey(name: string): string {
  return baseName(name).normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Dimensiones desde el encabezado (sin decodificar: 2.000 fotos en segundos)
// ---------------------------------------------------------------------------

export type HeaderRead = { width: number; height: number } | "truncated" | "invalid";

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u32le = (b: Uint8Array, i: number) => ((b[i + 3] << 24) >>> 0) + (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16));

function sized(width: number, height: number): HeaderRead {
  return width > 0 && height > 0 ? { width, height } : "invalid";
}

/** JPEG: recorre los segmentos hasta el SOF (Start Of Frame), que trae alto y ancho. */
function jpegSize(b: Uint8Array): HeaderRead {
  let i = 2;
  for (;;) {
    if (i + 4 > b.length) return "truncated";
    if (b[i] !== 0xff) return "invalid";
    let marker = b[i + 1];
    // Bytes de relleno 0xFF entre segmentos.
    while (marker === 0xff) {
      i++;
      if (i + 4 > b.length) return "truncated";
      marker = b[i + 1];
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return "invalid"; // fin o datos de imagen sin SOF antes
    const length = u16be(b, i + 2);
    if (length < 2) return "invalid";
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 > b.length) return "truncated";
      return sized(u16be(b, i + 7), u16be(b, i + 5));
    }
    i += 2 + length;
  }
}

function pngSize(b: Uint8Array): HeaderRead {
  if (b.length < 24) return "truncated";
  // El primer chunk DEBE ser IHDR.
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return "invalid";
  return sized(u32be(b, 16), u32be(b, 20));
}

function webpSize(b: Uint8Array): HeaderRead {
  if (b.length < 30) return "truncated";
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === "VP8X") return sized(u24le(b, 24) + 1, u24le(b, 27) + 1);
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return "invalid";
    const bits = u32le(b, 21);
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return "invalid";
    return sized(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  return "invalid";
}

/**
 * Dimensiones según el encabezado. "truncated" = hacen falta más bytes (o el
 * archivo está cortado, si ya se leyó completo); "invalid" = dañado.
 * No se exige el marcador final: las "fotos en movimiento" de los celulares
 * agregan un video al final del JPEG y son fotos válidas.
 */
export function readImageSize(head: Uint8Array, kind: SniffedImage): HeaderRead {
  if (kind === "jpeg") return jpegSize(head);
  if (kind === "png") return pngSize(head);
  if (kind === "webp") return webpSize(head);
  return "invalid";
}

/** Tamaños mínimos y máximos razonables para una foto de producto. */
export const IMAGE_DIMENSIONS = {
  /** Por debajo (lado mayor) es un ícono o miniatura: no sirve en la tienda. */
  minSide: 200,
  /** Por debajo (lado mayor) se acepta, con aviso: se verá borrosa en la ficha. */
  lowSide: 600,
  /** Más allá el navegador no puede procesarla de forma confiable (memoria). */
  maxSide: 16384,
  maxPixels: 100_000_000,
} as const;

/** Diagnóstico de una foto a partir de su firma, tamaño y dimensiones (null = válida). */
export function imageProblem(sniffed: SniffedImage, size: number, dims: HeaderRead | null = null): ImageProblem | null {
  if (size <= 0) return "empty";
  if (sniffed === "heic") return "heic";
  if (sniffed !== "jpeg" && sniffed !== "png" && sniffed !== "webp") return "format";
  if (size > IMPORT_LIMITS.imageBytes) return "size";
  if (dims === "invalid") return "corrupt";
  if (dims && dims !== "truncated") {
    const side = Math.max(dims.width, dims.height);
    if (side < IMAGE_DIMENSIONS.minSide || side > IMAGE_DIMENSIONS.maxSide || dims.width * dims.height > IMAGE_DIMENSIONS.maxPixels) return "dimensions";
  }
  return null;
}

/** ¿Se verá borrosa en la ficha? (válida, pero con aviso). */
export function isLowResolution(img: { width: number | null; height: number | null }): boolean {
  return img.width !== null && img.height !== null && Math.max(img.width, img.height) < IMAGE_DIMENSIONS.lowSide;
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

export function imageProblemText(problem: ImageProblem, img?: { width: number | null; height: number | null }): string {
  const dims = img?.width && img?.height ? ` (${img.width}×${img.height} px)` : "";
  switch (problem) {
    case "corrupt":
      return "está dañada o incompleta; cópiala de nuevo desde el original";
    case "dimensions":
      return img?.width && img?.height && Math.max(img.width, img.height) < IMAGE_DIMENSIONS.minSide
        ? `es demasiado pequeña${dims}; usa una foto de al menos ${IMAGE_DIMENSIONS.lowSide} px`
        : `es demasiado grande${dims}; redúcela a menos de ${IMAGE_DIMENSIONS.maxSide} px por lado`;
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
