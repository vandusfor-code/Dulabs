/**
 * Catálogo DuLabs — CONTRATOS de importación masiva (Fase 2+). SOLO tipos:
 * ningún parser se implementa en la Fase 1.
 *
 * Pipeline acordado (nunca "subir archivo => crear 2.000 productos"):
 *
 *   Archivo (CSV/XLSX, HTML, +ZIP de imágenes)
 *     -> Parse      (adaptador de infraestructura por formato:
 *                    lib/catalogo/import/csv, lib/catalogo/import/html)
 *     -> Normalize  (a ImportCandidate: el MISMO shape venga del formato que venga)
 *     -> Validate   (reglas del dominio: lib/catalogo/domain.ts -- productCreateSchema)
 *     -> Preview    (ImportPreview: válidos / errores / imágenes faltantes / precios faltantes)
 *     -> Confirm    (la usuaria decide)
 *     -> ImportJob  (procesamiento en segundo plano vía QStash, ya presente en el proyecto)
 *     -> Products   (a través de CatalogService.createProduct: la referencia la
 *                    asigna la BD igual que en la creación manual)
 *
 * Un parser NUNCA toca el dominio ni la BD: solo produce ImportCandidate. Si
 * el diseño del HTML de la cliente cambia, cambia su parser; el dominio no.
 */

export type ImportSourceKind = "csv" | "xlsx" | "html";

/** Fila normalizada, independiente del formato de origen. Los precios ya en COP enteros o null. */
export interface ImportCandidate {
  /** Posición en el archivo de origen (fila, o índice del bloque HTML) para reportar problemas. */
  sourceIndex: number;
  name: string | null;
  categoryName: string | null;
  description: string | null;
  material: string | null;
  color: string | null;
  retailPrice: number | null;
  wholesalePrice: number | null;
  /** Referencia a la imagen en el origen (nombre de archivo del ZIP, o URL/src del HTML). */
  imageRef: string | null;
}

export type ImportIssueCode = "missing_name" | "missing_retail_price" | "missing_wholesale_price" | "missing_image" | "invalid_price" | "duplicate_in_file";

export interface ImportIssue {
  sourceIndex: number;
  code: ImportIssueCode;
  /** "error" bloquea la fila; "warning" permite importarla (ej. sin precio mayor, sin imagen). */
  severity: "error" | "warning";
  message: string;
}

export interface ImportPreview {
  source: ImportSourceKind;
  total: number;
  valid: number;
  withErrors: number;
  missingImages: number;
  missingWholesalePrice: number;
  issues: ImportIssue[];
}

export type ImportJobStatus = "previewed" | "confirmed" | "processing" | "completed" | "failed" | "cancelled";

/** Estado persistido de una importación (tabla a crear en la Fase 2, con la primera implementación real). */
export interface ImportJob {
  id: string;
  tenantId: string;
  source: ImportSourceKind;
  status: ImportJobStatus;
  preview: ImportPreview;
  createdBy: string;
  createdAt: string;
  processed: number;
  failed: number;
}
