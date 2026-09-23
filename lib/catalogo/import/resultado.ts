/**
 * Resultado de una carga masiva, para la persona — PURO.
 *
 *   120 productos encontrados · 116 creados · 232 fotografías procesadas
 *   4 requieren atención:
 *     sin imagen · imagen inválida · datos incorrectos · duplicado · foto no subida
 *
 * Junta lo que decidió el preview (filas que nunca se enviaron: errores y
 * repetidos) con lo que respondió el servidor al procesar (ImportReport).
 * Cada fila aparece con TODOS sus motivos; "requieren atención" cuenta filas,
 * no motivos.
 */
import type { ImportReport } from "@/lib/catalogo/import/proceso";
import type { AnalyzedRow, ImportAnalysis } from "@/lib/catalogo/import/types";

export const ATTENTION_REASONS = ["no_image", "invalid_image", "invalid_data", "duplicate", "photo_failed"] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export const ATTENTION_LABEL: Record<AttentionReason, { es: string; en: string; hint: { es: string; en: string } }> = {
  no_image: {
    es: "Sin imagen",
    en: "No image",
    hint: { es: "Se crearon sin foto: agrégala desde el producto o sube otra vez el archivo con sus fotos y elige «Agregar sus fotos».", en: "Created without a photo: add it from the product or in a new upload." },
  },
  invalid_image: {
    es: "Imagen inválida",
    en: "Invalid image",
    hint: { es: "La foto está dañada, es muy pequeña o no es JPG, PNG o WEBP.", en: "The photo is damaged, too small or not JPG, PNG or WEBP." },
  },
  invalid_data: {
    es: "Datos incorrectos",
    en: "Incorrect data",
    hint: { es: "No se crearon: corrige la fila y vuelve a subirla.", en: "Not created: fix the row and upload it again." },
  },
  duplicate: {
    es: "Duplicado",
    en: "Duplicate",
    hint: { es: "Ya existían en tu catálogo o se repetían en el archivo: no se crearon otra vez.", en: "Already in your catalog or repeated in the file: not created again." },
  },
  photo_failed: {
    es: "Foto no subida",
    en: "Photo not uploaded",
    hint: { es: "El producto sí se creó; la foto no alcanzó a subir. Súbela desde el producto o en una nueva carga.", en: "The product was created; the photo didn't upload." },
  },
};

export interface AttentionItem {
  row: number;
  name: string | null;
  reference: string | null;
  reason: AttentionReason;
  /** Detalle legible (sin el prefijo "Fila N:"). */
  detail: string;
}

export interface ImportResultSummary {
  /** Productos en el archivo. */
  found: number;
  created: number;
  /** Productos ya importados a los que se les agregaron fotos. */
  completed: number;
  photosProcessed: number;
  /** Filas distintas que requieren atención. */
  needAttention: number;
  items: AttentionItem[];
  byReason: Record<AttentionReason, AttentionItem[]>;
}

/** "Fila 12: el precio…" -> "El precio…" (en el resultado, la fila ya se muestra aparte). */
const stripRow = (m: string) => {
  const rest = m.replace(/^Fila \d+:\s*/, "");
  return rest === m ? m : rest.replace(/^./, (c) => c.toUpperCase());
};

function photoIssues(r: AnalyzedRow) {
  return r.issues.filter((i) => i.field === "images");
}

export function summarizeImport(analysis: ImportAnalysis, report: ImportReport): ImportResultSummary {
  const byRow = new Map(analysis.rows.map((r) => [r.row, r]));
  const sent = new Map(report.rows.map((r) => [r.row, r]));
  const items: AttentionItem[] = [];
  const add = (row: number, name: string | null, reference: string | null, reason: AttentionReason, detail: string) => items.push({ row, name, reference, reason, detail: stripRow(detail) });

  for (const a of analysis.rows) {
    const res = sent.get(a.row);
    const name = res?.name ?? a.product?.name ?? a.values.name ?? null;
    if (!res) {
      // No se envió: el preview ya decidió que no se crea.
      if (a.status === "error") {
        const errs = a.issues.filter((i) => i.severity === "error");
        const dup = errs.find((i) => i.code === "duplicate_in_file");
        if (dup) add(a.row, name, null, "duplicate", dup.message);
        const rest = errs.filter((i) => i.code !== "duplicate_in_file");
        if (rest.length > 0) add(a.row, name, null, "invalid_data", rest.map((i) => stripRow(i.message)).join(" "));
      } else if (a.status === "duplicate") {
        const dup = a.issues.find((i) => i.code === "already_imported" || i.code === "duplicate_in_catalog");
        add(a.row, name, a.duplicateOf?.kind === "catalog" ? a.duplicateOf.reference : null, "duplicate", dup?.message ?? "Ya existe en tu catálogo.");
      }
      continue;
    }
    if (res.status === "error") {
      add(a.row, name, null, "invalid_data", res.message ?? "No se pudo crear.");
      continue;
    }
    if (res.status === "skipped") {
      add(a.row, name, res.reference, "duplicate", res.message ?? "Ya existe en tu catálogo.");
      continue;
    }
    // Creado o completado: ¿quedó alguna foto por el camino?
    const invalid = photoIssues(a).filter((i) => i.code === "image_invalid");
    if (invalid.length > 0) add(a.row, name, res.reference, "invalid_image", invalid.map((i) => stripRow(i.message)).join(" "));
    if (res.status === "created" && res.images.length === 0 && photoIssues(a).some((i) => i.code === "no_image" || i.code === "image_not_found" || i.code === "image_ambiguous")) {
      add(a.row, name, res.reference, "no_image", "Se creó sin foto.");
    }
  }
  // Filas del reporte que el análisis mostrado no tenía (no debería pasar; nunca se ocultan).
  for (const r of report.rows) {
    if (byRow.has(r.row)) continue;
    if (r.status === "error") add(r.row, r.name, null, "invalid_data", r.message ?? "No se pudo crear.");
    if (r.status === "skipped") add(r.row, r.name, r.reference, "duplicate", r.message ?? "Ya existe en tu catálogo.");
  }
  for (const f of report.photoFailures) {
    add(f.row, f.product, f.reference, f.stage === "prepare" ? "invalid_image" : "photo_failed", `${f.file.split("/").pop()}: ${f.message}`);
  }

  items.sort((a, b) => a.row - b.row || ATTENTION_REASONS.indexOf(a.reason) - ATTENTION_REASONS.indexOf(b.reason));
  const byReason = Object.fromEntries(ATTENTION_REASONS.map((k) => [k, items.filter((i) => i.reason === k)])) as Record<AttentionReason, AttentionItem[]>;
  return {
    found: analysis.summary.total,
    created: report.rows.filter((r) => r.status === "created").length,
    completed: report.rows.filter((r) => r.status === "attached").length,
    photosProcessed: report.photosUploaded,
    needAttention: new Set(items.map((i) => i.row)).size,
    items,
    byReason,
  };
}
