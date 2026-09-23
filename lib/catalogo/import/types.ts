/**
 * Catálogo DuLabs — carga masiva: tipos compartidos por servidor y navegador.
 *
 * Pipeline (nunca "subir archivo => crear 2.000 productos"):
 *
 *   Planilla (CSV/XLSX) --> servidor: leer (exceljs / CSV) --> RawRow[]
 *   Fotos (selección, carpeta o ZIP) --> quedan en el navegador: solo viajan
 *     su nombre, tamaño y validez (ImageInfo)
 *   RawRow[] + ImageInfo[] + decisiones --> analyzeImport (puro) --> preview
 *   Confirmar --> lotes de filas --> CatalogService.createProduct (MISMA regla
 *     que el formulario; referencia asignada por la BD)
 *             --> lotes de fotos --> requestImageUpload / confirmImage (MISMA
 *     galería del catálogo: la primera foto es la principal)
 *
 * Ver ./README.md para las decisiones.
 */
import type { ColumnKey } from "@/lib/catalogo/import/columnas";
import type { ImportOutcome, PersistedImportStatus } from "@/lib/catalogo/import/estados";

export type { ColumnKey };

/** Fila tal como viene del archivo: solo texto. `row` = número de fila en Excel/CSV (el encabezado es la 1). */
export interface RawRow {
  row: number;
  values: Partial<Record<ColumnKey, string>>;
}

/** Foto disponible en el navegador. El servidor nunca recibe la foto para analizar: solo esto. */
export interface ImageInfo {
  /** Nombre de archivo (sin carpeta). */
  name: string;
  size: number;
  /** null = válida; si no, por qué no se puede usar. */
  problem: ImageProblem | null;
}

export type ImageProblem = "format" | "heic" | "size" | "empty";

export type IssueSeverity = "error" | "warning";

export type IssueCode =
  | "missing_name"
  | "invalid_name"
  | "missing_retail_price"
  | "invalid_price"
  | "missing_stock"
  | "invalid_stock"
  | "invalid_text"
  | "invalid_category"
  | "category_missing"
  | "no_image"
  | "image_not_found"
  | "image_invalid"
  | "too_many_images"
  | "duplicate_in_file"
  | "already_imported"
  | "duplicate_in_catalog";

export interface ImportIssue {
  code: IssueCode;
  severity: IssueSeverity;
  field: ColumnKey | null;
  /** Texto listo para mostrar: "Fila 24: el precio detal es obligatorio." */
  message: string;
}

/** Qué hacer con una categoría del archivo que no existe en el catálogo. */
export type CategoryDecision = { action: "create" } | { action: "use"; categoryId: string } | { action: "none" };

/** Categoría del archivo que no coincide con ninguna existente. */
export interface CategoryPlan {
  /** Clave normalizada (sin tildes ni mayúsculas): "Anillos", "anillos" y "ANILLOS" son la misma. */
  key: string;
  /** Cómo se llamará si se crea (primera escritura encontrada en el archivo). */
  label: string;
  /** Variantes tal como aparecen en el archivo. */
  spellings: string[];
  rows: number;
  /** Categoría existente parecida (singular/plural): "Anillo" -> "Anillos". */
  suggestion: { id: string; name: string } | null;
  /** Decisión vigente (la del usuario o la propuesta por defecto). */
  decision: CategoryDecision;
}

export interface ImageMatch {
  /** Lo que escribió la persona en la celda. */
  requested: string;
  /** Archivo encontrado (nombre exacto) o null. */
  file: string | null;
}

export type RowStatus = "ready" | "warning" | "error" | "duplicate";

/** Producto listo para crear (valores ya validados con las reglas del dominio). */
export interface ImportProductDraft {
  name: string;
  description: string | null;
  material: string | null;
  color: string | null;
  retailPrice: number;
  wholesalePrice: number | null;
  stock: number;
  /** Categoría resuelta: existente, a crear (por clave) o ninguna. */
  category: { kind: "existing"; id: string; name: string } | { kind: "new"; key: string; label: string } | { kind: "none" };
}

export interface AnalyzedRow {
  row: number;
  values: RawRow["values"];
  status: RowStatus;
  issues: ImportIssue[];
  /** null si la fila tiene errores. */
  product: ImportProductDraft | null;
  /** Fotos que se subirán, en orden (la primera es la principal). */
  images: ImageMatch[];
  /**
   * - file: repite otra fila del mismo archivo (error).
   * - catalog: coincide con un producto existente. `imported` = ese producto vino
   *   de una carga masiva anterior (casi seguro es el mismo archivo subido otra vez).
   */
  duplicateOf: { kind: "catalog"; reference: string; name: string; imported: boolean } | { kind: "file"; row: number } | null;
  /** true si la persona eligió importarla aunque parezca repetida. */
  forced: boolean;
}

export interface ImportSummary {
  total: number;
  ready: number;
  warnings: number;
  errors: number;
  duplicates: number;
  /** Filas que se crearán al confirmar (listas + con advertencias + repetidas forzadas). */
  importable: number;
  photos: { matched: number; missing: number; unused: string[] };
}

export interface ImportAnalysis {
  rows: AnalyzedRow[];
  categories: CategoryPlan[];
  summary: ImportSummary;
  /** Avisos generales (no de una fila): columnas ignoradas, ninguna foto, etc. */
  notices: string[];
}

/** Producto existente, reducido a lo necesario para detectar duplicados. */
export interface ExistingProductKey {
  reference: string;
  name: string;
  categoryId: string | null;
  color: string | null;
  material: string | null;
  /** Carga masiva que lo creó (null: creado a mano, por AMORE, o la migración aún no está aplicada). */
  importId: string | null;
}

/** Resultado de crear una fila al confirmar. */
export interface ImportRowResult {
  row: number;
  status: "created" | "skipped" | "error";
  reference: string | null;
  productId: string | null;
  name: string | null;
  message: string | null;
  /** Fotos que el navegador debe subir para este producto (solo "created"). */
  images: string[];
}

export type ImportStatus = PersistedImportStatus;

/** Registro del historial. */
export interface ImportRecord {
  id: string;
  fileName: string;
  totalRows: number;
  created: number;
  skipped: number;
  errors: number;
  photosUploaded: number;
  photosFailed: number;
  status: ImportStatus;
  createdAt: string;
  finishedAt: string | null;
  createdBy: string | null;
}

/** Registro del historial tal como lo consume la interfaz (con el resultado ya derivado). */
export interface ImportHistoryItem extends ImportRecord {
  outcome: ImportOutcome;
}

/**
 * ¿Está activa la carga masiva en esta base de datos? false = falta aplicar la
 * migración 20261107000000 (REQUISITO PARA ACTIVACIÓN EN PRODUCCIÓN). El
 * análisis y el preview funcionan igual; crear productos no.
 */
export interface ImportAvailability {
  available: boolean;
}
