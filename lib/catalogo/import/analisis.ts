/**
 * Análisis de una carga masiva — PURO y DETERMINISTA (sin red ni BD).
 *
 * Lo ejecuta el SERVIDOR (con las categorías y productos reales del tenant de
 * la sesión) para el preview y, otra vez, para cada lote al confirmar: el
 * navegador nunca decide qué es válido.
 *
 * Una sola regla para crear productos: los valores se validan con
 * `productCreateSchema`, el mismo esquema del formulario y de la API.
 */
import { productCreateSchema, CATALOG_LIMITS, type CatalogCategory } from "@/lib/catalogo/domain";
import { columnDef, type ColumnKey } from "@/lib/catalogo/import/columnas";
import { buildImageIndex, imageProblemText, splitImageCell } from "@/lib/catalogo/import/fotos";
import { IMPORT_LIMITS } from "@/lib/catalogo/import/limites";
import type {
  AnalyzedRow,
  CategoryDecision,
  CategoryPlan,
  ExistingProductKey,
  ImageInfo,
  ImageMatch,
  ImportAnalysis,
  ImportIssue,
  ImportProductDraft,
  IssueCode,
  RawRow,
  RowStatus,
} from "@/lib/catalogo/import/types";

export interface AnalyzeInput {
  rows: readonly RawRow[];
  images: readonly ImageInfo[];
  /** Categorías reales del tenant. */
  categories: readonly CatalogCategory[];
  /** Productos reales del tenant (para detectar repetidos). */
  existing: readonly ExistingProductKey[];
  /** Decisiones sobre categorías nuevas, por clave. */
  decisions?: Readonly<Record<string, CategoryDecision>>;
  /** Filas que la persona decidió importar aunque parezcan repetidas. */
  force?: readonly number[];
}

/** Texto comparable: sin tildes, minúsculas, espacios colapsados. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Variantes singular/plural de una clave ("aretes" -> aretes, arete, aret). */
function variants(key: string): string[] {
  const out = [key];
  if (key.length > 3 && key.endsWith("s")) out.push(key.slice(0, -1));
  if (key.length > 4 && key.endsWith("es")) out.push(key.slice(0, -2));
  return out;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type Parsed = { value: number | null; issue: { code: IssueCode; text: string } | null };

/** Pesos colombianos: "129900", "129.900", "$ 129,900", "129900.00". Nunca decimales reales. */
export function parseMoney(raw: string | undefined, label: string): Parsed {
  const s = (raw ?? "").replace(/cop/gi, "").replace(/[$\s ]/g, "");
  if (!s) return { value: null, issue: null };
  if (/^-/.test(s)) return { value: null, issue: { code: "invalid_price", text: `${label} no puede ser negativo` } };
  let digits: string | null = null;
  if (/^\d+$/.test(s)) digits = s;
  else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) digits = s.replace(/[.,]/g, "");
  else if (/^\d+[.,]0{1,2}$/.test(s)) digits = s.split(/[.,]/)[0];
  else if (/^\d{1,3}([.,]\d{3})+[.,]0{1,2}$/.test(s)) digits = s.slice(0, -3).replace(/[.,]/g, "");
  else if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(s) && Number.isInteger(Number(s))) digits = String(Number(s));
  else if (/^\d+[.,]\d+$/.test(s)) return { value: null, issue: { code: "invalid_price", text: `${label} no puede tener decimales (usa pesos enteros, ej. 129900)` } };
  if (digits === null || digits.length > 13) return { value: null, issue: { code: "invalid_price", text: `${label} «${raw}» no es un número válido` } };
  return { value: Number(digits), issue: null };
}

/** Unidades: entero >= 0 ("5", "5.0", "1.000"). */
export function parseStock(raw: string | undefined): Parsed {
  const s = (raw ?? "").replace(/[\s ]/g, "");
  if (!s) return { value: null, issue: null };
  if (/^-\d/.test(s)) return { value: null, issue: { code: "invalid_stock", text: "el stock no puede ser negativo" } };
  if (/^\d+$/.test(s)) return { value: Number(s), issue: null };
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return { value: Number(s.replace(/[.,]/g, "")), issue: null };
  if (/^\d+[.,]0+$/.test(s)) return { value: Number(s.split(/[.,]/)[0]), issue: null };
  if (/^\d+[.,]\d+$/.test(s)) return { value: null, issue: { code: "invalid_stock", text: "el stock debe ser un número entero" } };
  return { value: null, issue: { code: "invalid_stock", text: `el stock «${raw}» no es un número válido` } };
}

const SCHEMA_FIELDS: Record<string, ColumnKey> = {
  name: "name",
  description: "description",
  material: "material",
  color: "color",
  retailPrice: "retailPrice",
  wholesalePrice: "wholesalePrice",
  stock: "stock",
};

function schemaMessage(field: ColumnKey, message: string): string {
  if (field === "retailPrice") return message.replace(/^El precio/, "El precio detal");
  if (field === "wholesalePrice") return message.replace(/^El precio/, "El precio mayor");
  return message;
}

interface FirstPass {
  raw: RawRow;
  issues: ImportIssue[];
  fields: Omit<ImportProductDraft, "category"> | null;
  categoryLabel: string | null;
  requested: string[];
}

export function analyzeImport(input: AnalyzeInput): ImportAnalysis {
  const force = new Set(input.force ?? []);
  const issue = (row: number, code: IssueCode, severity: ImportIssue["severity"], field: ColumnKey | null, text: string): ImportIssue => ({
    code,
    severity,
    field,
    message: `Fila ${row}: ${lowerFirst(text)}${/[.!?]$/.test(text) ? "" : "."}`,
  });

  // ---- 1. Valores de cada fila (con las MISMAS reglas del formulario) ----
  const first: FirstPass[] = input.rows.map((raw) => {
    const v = raw.values;
    const issues: ImportIssue[] = [];
    const name = (v.name ?? "").trim();
    if (!name) issues.push(issue(raw.row, "missing_name", "error", "name", "El nombre es obligatorio"));

    const retail = parseMoney(v.retailPrice, "el precio detal");
    if (retail.issue) issues.push(issue(raw.row, retail.issue.code, "error", "retailPrice", retail.issue.text));
    else if (retail.value === null) issues.push(issue(raw.row, "missing_retail_price", "error", "retailPrice", "El precio detal es obligatorio"));

    const wholesale = parseMoney(v.wholesalePrice, "el precio mayor");
    if (wholesale.issue) issues.push(issue(raw.row, wholesale.issue.code, "error", "wholesalePrice", wholesale.issue.text));

    const stock = parseStock(v.stock);
    if (stock.issue) issues.push(issue(raw.row, stock.issue.code, "error", "stock", stock.issue.text));
    else if (stock.value === null) issues.push(issue(raw.row, "missing_stock", "error", "stock", "El stock es obligatorio (usa 0 si está agotado)"));

    const categoryLabel = (v.category ?? "").replace(/\s+/g, " ").trim() || null;
    if (categoryLabel && categoryLabel.length > CATALOG_LIMITS.categoryName) {
      issues.push(issue(raw.row, "invalid_category", "error", "category", `El nombre de la categoría admite máximo ${CATALOG_LIMITS.categoryName} caracteres`));
    }

    let fields: FirstPass["fields"] = null;
    if (!issues.some((i) => i.severity === "error")) {
      const parsed = productCreateSchema.safeParse({
        name,
        categoryId: null,
        description: v.description ?? null,
        material: v.material ?? null,
        color: v.color ?? null,
        retailPrice: retail.value,
        wholesalePrice: wholesale.value,
        stock: stock.value,
      });
      if (parsed.success) {
        const d = parsed.data;
        fields = {
          name: d.name,
          description: d.description ?? null,
          material: d.material ?? null,
          color: d.color ?? null,
          retailPrice: d.retailPrice,
          wholesalePrice: d.wholesalePrice ?? null,
          stock: d.stock,
        };
      } else {
        for (const zi of parsed.error.issues) {
          const field = SCHEMA_FIELDS[String(zi.path[0])] ?? null;
          const code: IssueCode = field === "stock" ? "invalid_stock" : field === "retailPrice" || field === "wholesalePrice" ? "invalid_price" : field === "name" ? "invalid_name" : "invalid_text";
          issues.push(issue(raw.row, code, "error", field, field ? schemaMessage(field, zi.message) : zi.message));
        }
      }
    }
    return { raw, issues, fields, categoryLabel, requested: splitImageCell(v.images) };
  });

  // ---- 2. Categorías: existentes (sin tildes ni mayúsculas) y plan para las nuevas ----
  const existingByKey = new Map<string, CatalogCategory>();
  for (const c of input.categories) existingByKey.set(normalizeText(c.name), c);
  const existingById = new Map(input.categories.map((c) => [c.id, c]));
  const existingByVariant = new Map<string, CatalogCategory>();
  for (const [k, c] of existingByKey) for (const vk of variants(k)) if (!existingByVariant.has(vk)) existingByVariant.set(vk, c);

  const planByKey = new Map<string, CategoryPlan>();
  for (const f of first) {
    if (!f.categoryLabel || f.categoryLabel.length > CATALOG_LIMITS.categoryName) continue;
    const key = normalizeText(f.categoryLabel);
    if (existingByKey.has(key)) continue;
    const plan = planByKey.get(key);
    if (plan) {
      plan.rows++;
      if (!plan.spellings.includes(f.categoryLabel)) plan.spellings.push(f.categoryLabel);
      continue;
    }
    const near = variants(key)
      .map((vk) => existingByVariant.get(vk))
      .find((c): c is CatalogCategory => Boolean(c));
    const suggestion = near ? { id: near.id, name: near.name } : null;
    planByKey.set(key, { key, label: f.categoryLabel, spellings: [f.categoryLabel], rows: 1, suggestion, decision: { action: "create" } });
  }
  for (const plan of planByKey.values()) {
    const chosen = input.decisions?.[plan.key];
    const valid = chosen && (chosen.action !== "use" || existingById.has(chosen.categoryId));
    plan.decision = valid ? chosen : plan.suggestion ? { action: "use", categoryId: plan.suggestion.id } : { action: "create" };
  }

  const resolveCategory = (label: string | null): ImportProductDraft["category"] => {
    if (!label) return { kind: "none" };
    const key = normalizeText(label);
    const existing = existingByKey.get(key);
    if (existing) return { kind: "existing", id: existing.id, name: existing.name };
    const plan = planByKey.get(key)!;
    if (plan.decision.action === "use") {
      const c = existingById.get(plan.decision.categoryId)!;
      return { kind: "existing", id: c.id, name: c.name };
    }
    if (plan.decision.action === "none") return { kind: "none" };
    return { kind: "new", key: plan.key, label: plan.label };
  };

  // ---- 3. Fotos, repetidos y estado ----
  const index = buildImageIndex(input.images);
  const used = new Set<string>();
  const anyPhotos = input.images.length > 0 || first.some((f) => f.requested.length > 0);

  const catalogByKey = new Map<string, ExistingProductKey>();
  const dupKey = (name: string, categoryIdentity: string, color: string | null, material: string | null) =>
    [normalizeText(name), categoryIdentity, normalizeText(color), normalizeText(material)].join("|");
  for (const p of input.existing) {
    const k = dupKey(p.name, p.categoryId ?? "", p.color, p.material);
    const prev = catalogByKey.get(k);
    // Si varios coinciden, se informa el que vino de una carga masiva (señal más fuerte de "ya importado").
    if (!prev || (prev.importId === null && p.importId !== null)) catalogByKey.set(k, p);
  }
  const fileByKey = new Map<string, number>();

  const rows: AnalyzedRow[] = first.map((f) => {
    const row = f.raw.row;
    const issues = [...f.issues];

    const images: ImageMatch[] = [];
    f.requested.forEach((requested, i) => {
      if (i >= IMPORT_LIMITS.imagesPerProduct) return;
      const found = index.find(requested);
      if (found) used.add(found.name);
      if (!found) {
        issues.push(issue(row, "image_not_found", "warning", "images", `No encontramos la imagen «${requested}». Agrégala antes de importar o súbela después desde el producto`));
      } else if (found.problem) {
        issues.push(issue(row, "image_invalid", "warning", "images", `La imagen «${found.name}» ${imageProblemText(found.problem)}`));
      } else {
        images.push({ requested, file: found.name });
      }
    });
    if (f.requested.length > IMPORT_LIMITS.imagesPerProduct) {
      issues.push(issue(row, "too_many_images", "warning", "images", `Tiene ${f.requested.length} fotos; se usarán las primeras ${IMPORT_LIMITS.imagesPerProduct}`));
    }
    if (f.requested.length === 0 && anyPhotos) {
      issues.push(issue(row, "no_image", "warning", "images", "No tiene foto; podrás agregarla después desde el producto"));
    }

    let product: ImportProductDraft | null = null;
    let duplicateOf: AnalyzedRow["duplicateOf"] = null;
    const forced = force.has(row);
    if (f.fields && !issues.some((i) => i.severity === "error")) {
      const category = resolveCategory(f.categoryLabel);
      product = { ...f.fields, category };
      const identity = category.kind === "existing" ? category.id : category.kind === "new" ? `new:${category.key}` : "";
      const k = dupKey(product.name, identity, product.color, product.material);
      const earlier = fileByKey.get(k);
      const inCatalog = catalogByKey.get(k);
      if (earlier !== undefined) {
        duplicateOf = { kind: "file", row: earlier };
        issues.push(issue(row, "duplicate_in_file", "error", "name", `Repite el producto de la fila ${earlier} (mismo nombre, categoría, color y material)`));
        product = null;
      } else {
        fileByKey.set(k, row);
        if (inCatalog) {
          const imported = inCatalog.importId !== null;
          duplicateOf = { kind: "catalog", reference: inCatalog.reference, name: inCatalog.name, imported };
          const text = forced
            ? `Ya existe «${inCatalog.name}» (${inCatalog.reference}); se importará de todas formas, como producto nuevo`
            : imported
              ? `«${inCatalog.name}» ya se cargó en una importación anterior (${inCatalog.reference}). Se omitirá para no duplicarlo`
              : `Ya existe «${inCatalog.name}» en tu catálogo (${inCatalog.reference}). Se omitirá, salvo que elijas importarlo de todas formas`;
          issues.push(issue(row, imported ? "already_imported" : "duplicate_in_catalog", "warning", "name", text));
        }
      }
    }

    const hasError = issues.some((i) => i.severity === "error");
    // Una fila que no se importará no necesita además el aviso de "sin foto".
    if (hasError) {
      const idx = issues.findIndex((i) => i.code === "no_image");
      if (idx >= 0) issues.splice(idx, 1);
    }
    const status: RowStatus = hasError ? "error" : duplicateOf?.kind === "catalog" && !forced ? "duplicate" : issues.length > 0 ? "warning" : "ready";
    return { row, values: f.raw.values, status, issues, product: hasError ? null : product, images: hasError ? [] : images, duplicateOf, forced: forced && duplicateOf?.kind === "catalog" };
  });

  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  const importableRows = rows.filter((r) => r.status === "ready" || r.status === "warning");
  const notices: string[] = [];
  if (!anyPhotos && rows.length > 0) notices.push("Ningún producto tiene fotos asignadas: se crearán sin foto y podrás agregarlas después.");

  return {
    rows,
    categories: [...planByKey.values()],
    summary: {
      total: rows.length,
      ready: count("ready"),
      warnings: count("warning"),
      errors: count("error"),
      duplicates: count("duplicate"),
      importable: importableRows.length,
      photos: {
        matched: importableRows.reduce((n, r) => n + r.images.length, 0),
        missing: rows.reduce((n, r) => n + r.issues.filter((i) => i.code === "image_not_found").length, 0),
        unused: input.images.filter((img) => !used.has(img.name)).map((img) => img.name),
      },
    },
    notices,
  };
}

/** Nombre de columna para un campo (mensajes de la interfaz). */
export function fieldHeader(field: ColumnKey): string {
  return columnDef(field).header;
}
