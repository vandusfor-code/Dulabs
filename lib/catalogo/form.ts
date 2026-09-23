/**
 * Estado del formulario de producto (crear/editar) — lógica PURA, probada sin
 * navegador. La validación aquí es solo para feedback inmediato: el servidor
 * (lib/catalogo/domain.ts) es quien decide.
 */
import { CATALOG_LIMITS, type CatalogProduct } from "@/lib/catalogo/domain";
import type { ProductDraft, ProductPatch } from "@/lib/catalogo-client";

export interface ProductFormState {
  name: string;
  categoryId: string | null;
  retailPrice: number | null;
  wholesalePrice: number | null;
  /** Unidades disponibles para venta. null = aún sin definir (productos legados sin control de inventario). */
  stock: number | null;
  material: string;
  color: string;
  description: string;
}

export type ProductFormErrors = Partial<Record<"name" | "retailPrice" | "wholesalePrice" | "stock", string>>;

export function emptyProductForm(): ProductFormState {
  return { name: "", categoryId: null, retailPrice: null, wholesalePrice: null, stock: null, material: "", color: "", description: "" };
}

export function productFormFrom(p: CatalogProduct): ProductFormState {
  return {
    name: p.name,
    categoryId: p.categoryId,
    retailPrice: p.pricing.retail,
    wholesalePrice: p.pricing.wholesale,
    // Un producto legado sin control de inventario aún no tiene stock definido: el campo queda vacío.
    stock: p.tracksStock ? p.stock : null,
    material: p.material ?? "",
    color: p.color ?? "",
    description: p.description ?? "",
  };
}

const textOrNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

/**
 * `requireStock`: al crear siempre (todo producto nuevo controla inventario);
 * al editar, si el producto ya lo controla (no se puede "borrar" el stock).
 */
export function validateProductForm(f: ProductFormState, opts: { requireStock?: boolean } = { requireStock: true }): ProductFormErrors {
  const errors: ProductFormErrors = {};
  if (f.name.trim() === "") errors.name = "Escribe el nombre del producto.";
  else if (f.name.trim().length > CATALOG_LIMITS.name) errors.name = `Máximo ${CATALOG_LIMITS.name} caracteres.`;
  if (f.retailPrice === null) errors.retailPrice = "El precio detal es obligatorio.";
  else if (f.retailPrice > CATALOG_LIMITS.price) errors.retailPrice = "El precio es demasiado alto.";
  if (f.wholesalePrice !== null && f.wholesalePrice > CATALOG_LIMITS.price) errors.wholesalePrice = "El precio es demasiado alto.";
  if (f.stock === null) {
    if (opts.requireStock !== false) errors.stock = "Indica cuántas unidades hay disponibles (0 si está agotado).";
  } else if (!Number.isInteger(f.stock) || f.stock < 0) errors.stock = "El stock debe ser un número entero, 0 o mayor.";
  else if (f.stock > CATALOG_LIMITS.stock) errors.stock = "El stock es demasiado alto.";
  return errors;
}

/** Borrador para crear. Llamar solo si validateProductForm no devolvió errores. */
export function toProductDraft(f: ProductFormState): ProductDraft {
  return {
    name: f.name.trim(),
    categoryId: f.categoryId,
    description: textOrNull(f.description),
    material: textOrNull(f.material),
    color: textOrNull(f.color),
    retailPrice: f.retailPrice ?? 0,
    wholesalePrice: f.wholesalePrice,
    stock: f.stock ?? 0,
  };
}

/** Solo los campos que cambiaron respecto al producto guardado (PATCH mínimo). */
export function diffProductForm(original: ProductFormState, current: ProductFormState): ProductPatch {
  const a = toProductDraft(original);
  const b = toProductDraft(current);
  const patch: ProductPatch = {};
  if (a.name !== b.name) patch.name = b.name;
  if (a.categoryId !== b.categoryId) patch.categoryId = b.categoryId;
  if (a.description !== b.description) patch.description = b.description;
  if (a.material !== b.material) patch.material = b.material;
  if (a.color !== b.color) patch.color = b.color;
  if (a.retailPrice !== b.retailPrice) patch.retailPrice = b.retailPrice;
  if (a.wholesalePrice !== b.wholesalePrice) patch.wholesalePrice = b.wholesalePrice;
  // El stock solo viaja si se definió y cambió (vacío en un producto legado = no tocarlo).
  if (current.stock !== null && current.stock !== original.stock) patch.stock = current.stock;
  return patch;
}
