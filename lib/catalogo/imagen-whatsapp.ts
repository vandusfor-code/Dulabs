/**
 * Foto del catálogo en JPEG para WhatsApp.
 *
 * WhatsApp Cloud API solo acepta imágenes JPEG o PNG (WebP es exclusivo de
 * stickers), y el catálogo guarda sus fotos en WebP. Esta conversión se hace
 * en el servidor, a partir de la variante de detalle (≤ 1200 px), y el CDN la
 * cachea por versión (?v=): se convierte una vez por foto, no por envío.
 *
 * Sin alfa (fondo blanco, como el JPEG del navegador) y con la orientación
 * ya aplicada. Nunca agranda la imagen.
 */
import sharp from "sharp";

export const WHATSAPP_IMAGE_MAX_PX = 1200;
/** Tope de lectura de la foto de origen (el catálogo sube ≤ 2048 px optimizados, muy por debajo). */
export const WHATSAPP_SOURCE_MAX_BYTES = 15 * 1024 * 1024;

export class WhatsappImageError extends Error {}

async function readAll(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new WhatsappImageError("La foto de origen es demasiado grande.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Convierte la foto (WebP, JPEG o PNG) a un JPEG apto para WhatsApp. */
export async function toWhatsappJpeg(source: ReadableStream<Uint8Array> | Uint8Array): Promise<Buffer> {
  const input = source instanceof Uint8Array ? Buffer.from(source) : await readAll(source, WHATSAPP_SOURCE_MAX_BYTES);
  if (input.byteLength === 0 || input.byteLength > WHATSAPP_SOURCE_MAX_BYTES) throw new WhatsappImageError("Foto de origen vacía o demasiado grande.");
  try {
    return await sharp(input, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize(WHATSAPP_IMAGE_MAX_PX, WHATSAPP_IMAGE_MAX_PX, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new WhatsappImageError("No se pudo convertir la foto.");
  }
}
