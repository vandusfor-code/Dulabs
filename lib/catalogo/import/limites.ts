/**
 * Límites de la carga masiva — ÚNICA fuente (servidor, navegador y tests).
 * Cambiar un límite = cambiar este archivo.
 */
import { CATALOG_LIMITS } from "@/lib/catalogo/domain";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-validacion";

export const IMPORT_LIMITS = {
  /**
   * La planilla (CSV/XLSX) viaja a una función de Vercel, que rechaza cuerpos
   * de más de ~4.5 MB a nivel de plataforma. 4 MB son decenas de miles de
   * filas de texto: sobra para un catálogo.
   */
  spreadsheetBytes: MAX_UPLOAD_BYTES,
  /** Filas de producto por importación (la BD admite hasta 100.000: el tope es de experiencia, no técnico). */
  rows: 2000,
  /**
   * Fotos seleccionadas por importación (nunca pasan por Vercel: van directo a
   * Storage ya optimizadas). 3 por producto en promedio. Al analizar solo viaja
   * su metadato (~150 bytes cada una).
   */
  images: 6000,
  /** Foto original individual (antes de optimizarla en el navegador). */
  imageBytes: 30 * 1024 * 1024,
  /**
   * Suma de las fotos originales seleccionadas. Elegidas desde una carpeta NO
   * se cargan en memoria (el navegador solo guarda la referencia al archivo);
   * se leen de a una al procesarlas.
   */
  imagesTotalBytes: 20 * 1024 * 1024 * 1024,
  /** Un ZIP se lee completo en memoria del navegador: tope prudente. */
  zipBytes: 600 * 1024 * 1024,
  /** Entradas de un ZIP (protección ante archivos manipulados). */
  zipEntries: 5000,
  /** Fotos por producto: el mismo tope de la galería del catálogo. */
  imagesPerProduct: CATALOG_LIMITS.imagesPerProduct,
  /** Filas por lote de creación (cada lote es una petición corta al servidor). */
  rowsPerBatch: 20,
  /** Fotos por lote de subida/confirmación. */
  photosPerBatch: 10,
  /** Tamaño del texto de una celda (defensa: nada legítimo ocupa más). */
  cellChars: 2000,
  /** Ruta relativa de una foto ("Fotos/Anillos/anillo-corazon-2.jpg"). */
  photoIdChars: 300,
} as const;

/** "4 MB", "30 MB", "3 GB" para los mensajes. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${Math.round(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
