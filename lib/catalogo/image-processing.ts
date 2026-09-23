/**
 * Catálogo DuLabs — preparación de imágenes EN EL NAVEGADOR, antes de subir.
 *
 * Las fotos de celular pesan 3-10 MB; nunca viajan a una función de Vercel.
 * Aquí se decodifican (respetando la orientación EXIF), se escalan a un lado
 * máximo de 2048 px (imagen) y 400 px (miniatura del listado) y se codifican
 * en WebP -- o JPEG si el navegador no sabe codificar WebP (Safari) -- con la
 * calidad más alta que quepa en el tope del catálogo. Imagen y miniatura usan
 * SIEMPRE el mismo formato. El servidor vuelve a verificar tamaño y firma
 * real del archivo al confirmar.
 */
import { CATALOG_LIMITS, type ImageMimeType } from "@/lib/catalogo/domain";

export interface PreparedImage {
  image: Blob;
  thumb: Blob;
  mimeType: ImageMimeType;
  width: number;
  height: number;
}

/** Escala (w, h) para que su lado mayor no supere `max`, sin agrandar nunca. Puro. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const QUALITIES = [0.86, 0.78, 0.68, 0.58] as const;

export class ImagePreparationError extends Error {}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

let webpSupport: Promise<boolean> | null = null;
/** ¿El navegador CODIFICA WebP? (Safari decodifica pero devuelve PNG al codificar). Se detecta una vez. */
function canEncodeWebp(): Promise<boolean> {
  if (!webpSupport) {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    webpSupport = toBlob(probe, "image/webp", 0.8).then((b) => b?.type === "image/webp");
  }
  return webpSupport;
}

function draw(source: ImageBitmap, width: number, height: number, opaque: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImagePreparationError("Tu navegador no permite procesar imágenes.");
  if (opaque) {
    // JPEG no tiene transparencia: fondo blanco en vez de negro para PNG con alfa.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function encode(source: ImageBitmap, max: number, maxBytes: number, mimeType: ImageMimeType): Promise<{ blob: Blob; width: number; height: number }> {
  const size = fitWithin(source.width, source.height, max);
  const canvas = draw(source, size.width, size.height, mimeType === "image/jpeg");
  for (const quality of QUALITIES) {
    const blob = await toBlob(canvas, mimeType, quality);
    if (blob && blob.type === mimeType && blob.size <= maxBytes) return { blob, ...size };
  }
  throw new ImagePreparationError("La imagen es demasiado pesada incluso comprimida. Prueba con otra foto.");
}

export async function prepareProductImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new ImagePreparationError("El archivo no es una imagen.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImagePreparationError("No pudimos leer esta imagen. Usa una foto JPG, PNG o WEBP.");
  }
  try {
    const mimeType: ImageMimeType = (await canEncodeWebp()) ? "image/webp" : "image/jpeg";
    const [main, thumb] = await Promise.all([
      encode(bitmap, CATALOG_LIMITS.imageMaxSide, CATALOG_LIMITS.imageBytes, mimeType),
      encode(bitmap, CATALOG_LIMITS.thumbMaxSide, CATALOG_LIMITS.thumbBytes, mimeType),
    ]);
    return { image: main.blob, thumb: thumb.blob, mimeType, width: main.width, height: main.height };
  } catch (err) {
    if (err instanceof ImagePreparationError) throw err;
    throw new ImagePreparationError("No pudimos procesar esta imagen.");
  } finally {
    bitmap.close();
  }
}
