/**
 * CMS comercial — PROCESAMIENTO de imágenes en el SERVIDOR (sharp).
 *
 * Lo que sube el navegador NUNCA se publica tal cual: el servidor lo lee, comprueba que de verdad sea una imagen (firma real del archivo, no el tipo que declaró
 * quien lo subió), limita sus dimensiones y la RE-CODIFICA a WebP en un tamaño acotado, sin metadatos (se pierde la ubicación GPS, el modelo de cámara, etc.).
 * Así lo que queda en Storage es siempre un WebP limpio y de tamaño razonable, aunque alguien suba un archivo manipulado o enorme.
 */
import sharp, { type Metadata } from "sharp";

/** Lo máximo que se acepta SUBIR (el navegador normalmente lo envía ya comprimido, muy por debajo de esto). */
export const MAX_BYTES_SUBIDA = 6 * 1024 * 1024;
/** Lado más largo de la imagen publicada: más no aporta en pantalla y pesa. */
export const LADO_MAXIMO = 2400;
export const LADO_MINIMO = 16;
/** Protege contra «bombas de descompresión»: una imagen pequeña en disco que se expande a miles de millones de píxeles. */
export const MAX_PIXELES = 40_000_000;

export type FormatoEntrada = "jpeg" | "png" | "webp";

export class ImagenInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ImagenInvalida";
  }
}

export interface ImagenProcesada {
  bytes: Uint8Array;
  mimeType: "image/webp";
  ancho: number;
  alto: number;
  formatoOriginal: FormatoEntrada;
}

/** Formato real según los primeros bytes (firma del archivo). */
export function formatoPorFirma(cabeza: Uint8Array): FormatoEntrada | null {
  if (cabeza.length >= 3 && cabeza[0] === 0xff && cabeza[1] === 0xd8 && cabeza[2] === 0xff) return "jpeg";
  if (cabeza.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => cabeza[i] === b)) return "png";
  if (cabeza.length >= 12 && cabeza[0] === 0x52 && cabeza[1] === 0x49 && cabeza[2] === 0x46 && cabeza[3] === 0x46 && cabeza[8] === 0x57 && cabeza[9] === 0x45 && cabeza[10] === 0x42 && cabeza[11] === 0x50) return "webp";
  return null;
}

const NO_ES_IMAGEN = "El archivo no es una imagen válida. Usa una foto JPG, PNG o WebP.";
const DEMASIADO_GRANDE = "La imagen es demasiado grande (más de 40 megapíxeles). Redúcela y vuelve a intentar.";

export async function procesarImagen(entrada: Uint8Array): Promise<ImagenProcesada> {
  if (entrada.byteLength === 0) throw new ImagenInvalida("El archivo está vacío.");
  if (entrada.byteLength > MAX_BYTES_SUBIDA) throw new ImagenInvalida("La imagen supera el tamaño máximo permitido (6 MB).");
  const formato = formatoPorFirma(entrada.subarray(0, 16));
  if (!formato) throw new ImagenInvalida(NO_ES_IMAGEN);

  const opciones = { limitInputPixels: MAX_PIXELES, failOn: "error" as const };
  let meta: Metadata;
  try {
    // `limitInputPixels` también se aplica al leer la cabecera: una imagen que se expandiría a más de 40 megapíxeles ni siquiera se decodifica.
    meta = await sharp(entrada, opciones).metadata();
  } catch (err) {
    if (err instanceof Error && /pixel limit/i.test(err.message)) throw new ImagenInvalida(DEMASIADO_GRANDE);
    throw new ImagenInvalida(NO_ES_IMAGEN);
  }
  const { width, height } = meta;
  if (!width || !height) throw new ImagenInvalida(NO_ES_IMAGEN);
  if ((meta.pages ?? 1) > 1) throw new ImagenInvalida("No se admiten imágenes animadas. Sube una imagen fija.");
  if (width < LADO_MINIMO || height < LADO_MINIMO) throw new ImagenInvalida(`La imagen es demasiado pequeña (mínimo ${LADO_MINIMO} px por lado).`);

  try {
    const { data, info } = await sharp(entrada, opciones)
      .rotate() // aplica la orientación EXIF antes de descartar los metadatos
      .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), mimeType: "image/webp", ancho: info.width, alto: info.height, formatoOriginal: formato };
  } catch {
    throw new ImagenInvalida("No pudimos procesar la imagen. Prueba con otra o guárdala de nuevo desde tu galería.");
  }
}
