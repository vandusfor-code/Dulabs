/**
 * Validación (zod, estricta) de lo que el navegador envía a las rutas de la
 * carga masiva. Nada de tenant, negocio ni publicación: esos salen SIEMPRE de
 * la sesión. Todo lo que llega es texto de la planilla o metadatos de fotos, y
 * se vuelve a validar con las reglas del dominio en el servidor.
 */
import { z } from "zod";
import { imageConfirmSchema, imageUploadRequestSchema } from "@/lib/catalogo/domain";
import { COLUMN_KEYS } from "@/lib/catalogo/import/columnas";
import { IMPORT_LIMITS } from "@/lib/catalogo/import/limites";

const cell = z.string().max(IMPORT_LIMITS.cellChars);

export const rawRowSchema = z
  .object({
    row: z.number().int().min(1).max(1_000_000),
    values: z.object(Object.fromEntries(COLUMN_KEYS.map((k) => [k, cell.optional()])) as Record<(typeof COLUMN_KEYS)[number], z.ZodOptional<typeof cell>>).strict(),
  })
  .strict();

export const imageInfoSchema = z
  .object({
    name: z.string().min(1).max(255),
    size: z.number().int().min(0),
    problem: z.enum(["format", "heic", "size", "empty"]).nullable(),
  })
  .strict();

export const categoryDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create") }).strict(),
  z.object({ action: z.literal("use"), categoryId: z.uuid() }).strict(),
  z.object({ action: z.literal("none") }).strict(),
]);

const decisions = z.record(z.string().max(80), categoryDecisionSchema).default({});
const force = z.array(z.number().int().min(1)).max(IMPORT_LIMITS.rows).default([]);
const images = z.array(imageInfoSchema).max(IMPORT_LIMITS.images).default([]);

/** Re-análisis (fotos agregadas, decisiones o filas corregidas en el preview). */
export const analyzeRowsSchema = z
  .object({
    rows: z.array(rawRowSchema).min(1).max(IMPORT_LIMITS.rows),
    images,
    decisions,
    force,
  })
  .strict();

/** Partes JSON del análisis inicial (el archivo llega como multipart). */
export const analyzeFileExtrasSchema = z.object({ images, decisions }).strict();

export const startImportSchema = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    totalRows: z.number().int().min(1).max(IMPORT_LIMITS.rows),
  })
  .strict();

/** Un lote de filas a crear. */
export const importRowsSchema = z
  .object({
    rows: z.array(rawRowSchema).min(1).max(IMPORT_LIMITS.rowsPerBatch),
    images,
    decisions,
    force,
  })
  .strict();

export const photoUrlsSchema = z
  .object({
    items: z.array(imageUploadRequestSchema.safeExtend({ productId: z.uuid() })).min(1).max(IMPORT_LIMITS.photosPerBatch),
  })
  .strict();

export const photoConfirmSchema = z
  .object({
    items: z.array(imageConfirmSchema.safeExtend({ productId: z.uuid() })).min(1).max(IMPORT_LIMITS.photosPerBatch),
  })
  .strict();

export const finishImportSchema = z
  .object({
    skipped: z.number().int().min(0).max(IMPORT_LIMITS.rows),
    errors: z.number().int().min(0).max(IMPORT_LIMITS.rows),
    photosUploaded: z.number().int().min(0).max(IMPORT_LIMITS.images * 2),
    photosFailed: z.number().int().min(0).max(IMPORT_LIMITS.images * 2),
  })
  .strict();
