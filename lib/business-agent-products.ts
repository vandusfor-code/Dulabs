/**
 * Productos estructurados del Business Agent (autoservicio).
 *
 * REUTILIZA la tabla EXISTENTE `dulabs_inventario_productos` (migración
 * 20260923000000_amore_inventario_productos.sql): ya es por tenant (id_tenant),
 * con precio COP entero, stock y activo. No se crea otra tabla. El precio es un
 * dato ESTRUCTURADO (nunca texto en un prompt); la cotización de R6 lo lee de
 * aquí. Solo se exponen los campos genéricos (nombre, categoría, descripción,
 * precio, stock, activo); la foto la administra el panel de AMORE.
 *
 * Lógica PURA (validación + normalización), sin I/O: los routes
 * (app/api/business-agent/products/*) son adaptadores delgados.
 */

/** Proyección pública de un producto (lo que ve la UI). */
export interface BusinessAgentProduct {
  id: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  /** Pesos colombianos enteros (COP), >= 0. */
  precio: number;
  /** Unidades disponibles (administradas manualmente por el negocio). */
  stock: number;
  activo: boolean;
}

/** Fila cruda de dulabs_inventario_productos (subconjunto genérico). */
export interface ProductoRow {
  id: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  precio: number;
  stock: number;
  activo: boolean;
}

export function rowToProduct(r: ProductoRow): BusinessAgentProduct {
  return { id: r.id, nombre: r.nombre, categoria: r.categoria, descripcion: r.descripcion, precio: r.precio, stock: r.stock, activo: r.activo };
}

export const PRODUCT_LIMITS = {
  nombre: 120,
  categoria: 60,
  descripcion: 1000,
  precioMax: 1_000_000_000,
  stockMax: 1_000_000,
} as const;

export interface NormalizedProductInput {
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  precio: number;
  stock: number;
  activo: boolean;
}

export type ProductValidation = { ok: true; value: NormalizedProductInput } | { ok: false; error: string };

/**
 * Valida y normaliza el body de crear/editar un producto. El precio es
 * OBLIGATORIO (la tabla exige `precio >= 0`, y una cotización sin precio no tiene
 * sentido); el stock es opcional (default 0) y entero >= 0.
 */
export function validateProductInput(raw: unknown): ProductValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Cuerpo de la solicitud inválido." };
  const b = raw as Record<string, unknown>;

  const nombre = typeof b.nombre === "string" ? b.nombre.trim() : "";
  if (!nombre) return { ok: false, error: "El nombre del producto es obligatorio." };
  if (nombre.length > PRODUCT_LIMITS.nombre) return { ok: false, error: "El nombre del producto es demasiado largo." };

  if (b.precio === null || b.precio === undefined || b.precio === "") return { ok: false, error: "El precio del producto es obligatorio." };
  const precioN = Number(b.precio);
  if (!Number.isFinite(precioN) || precioN < 0) return { ok: false, error: "El precio no es válido." };
  if (precioN > PRODUCT_LIMITS.precioMax) return { ok: false, error: "El precio es demasiado alto." };
  const precio = Math.round(precioN);

  let stock = 0;
  if (b.stock !== null && b.stock !== undefined && b.stock !== "") {
    const s = Number(b.stock);
    if (!Number.isInteger(s) || s < 0) return { ok: false, error: "El stock debe ser un número entero mayor o igual a 0." };
    if (s > PRODUCT_LIMITS.stockMax) return { ok: false, error: "El stock es demasiado alto." };
    stock = s;
  }

  const categoria = typeof b.categoria === "string" && b.categoria.trim() ? b.categoria.trim().slice(0, PRODUCT_LIMITS.categoria) : null;
  const descripcion = typeof b.descripcion === "string" && b.descripcion.trim() ? b.descripcion.trim().slice(0, PRODUCT_LIMITS.descripcion) : null;
  const activo = typeof b.activo === "boolean" ? b.activo : true;

  return { ok: true, value: { nombre, categoria, descripcion, precio, stock, activo } };
}
