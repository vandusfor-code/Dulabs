/**
 * Persistencia de productos del Business Agent (R6) sobre `dulabs_inventario_productos`.
 *
 * El `tenantId` viene SIEMPRE de la sesión autenticada (lo pasa el route); TODA query
 * filtra por `id_tenant` (y por `id` en editar/borrar), de modo que un admin nunca puede
 * leer ni tocar el producto de otro tenant. Una sola puerta de acceso = un solo lugar
 * donde auditar el aislamiento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToProduct, type BusinessAgentProduct, type NormalizedProductInput, type ProductoRow } from "@/lib/business-agent-products";

const TABLE = "dulabs_inventario_productos";
const COLUMNS = "id, nombre, categoria, descripcion, precio, stock, activo";
/** Tope defensivo por tenant: el catálogo de un negocio real está muy por debajo. */
export const MAX_PRODUCTS_PER_TENANT = 500;

export async function listProducts(supabase: SupabaseClient, tenantId: string): Promise<BusinessAgentProduct[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq("id_tenant", tenantId)
    .order("categoria", { ascending: true, nullsFirst: true })
    .order("nombre", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as ProductoRow[]).map(rowToProduct);
}

export type CreateProductResult = { ok: true; product: BusinessAgentProduct } | { ok: false; code: "LIMIT_REACHED" };

export async function createProduct(supabase: SupabaseClient, tenantId: string, v: NormalizedProductInput): Promise<CreateProductResult> {
  const { count, error: countError } = await supabase.from(TABLE).select("id", { count: "exact", head: true }).eq("id_tenant", tenantId);
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_PRODUCTS_PER_TENANT) return { ok: false, code: "LIMIT_REACHED" };

  const { data, error } = await supabase
    .from(TABLE)
    .insert({ id_tenant: tenantId, nombre: v.nombre, categoria: v.categoria, descripcion: v.descripcion, precio: v.precio, stock: v.stock, activo: v.activo })
    .select(COLUMNS)
    .single();
  if (error || !data) throw error ?? new Error("insert vacío");
  return { ok: true, product: rowToProduct(data as ProductoRow) };
}

/** null = no existe PARA ESTE TENANT (404), aunque exista en otro. */
export async function updateProduct(supabase: SupabaseClient, tenantId: string, id: string, v: NormalizedProductInput): Promise<BusinessAgentProduct | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ nombre: v.nombre, categoria: v.categoria, descripcion: v.descripcion, precio: v.precio, stock: v.stock, activo: v.activo, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("id_tenant", tenantId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToProduct(data as ProductoRow) : null;
}

export async function deleteProduct(supabase: SupabaseClient, tenantId: string, id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id).eq("id_tenant", tenantId);
  if (error) throw error;
}

/** ¿Tiene el tenant al menos un producto ACTIVO? (gate de publicación en el servidor). */
export async function countActiveProducts(supabase: SupabaseClient, tenantId: string): Promise<number> {
  const { count, error } = await supabase.from(TABLE).select("id", { count: "exact", head: true }).eq("id_tenant", tenantId).eq("activo", true);
  if (error) throw error;
  return count ?? 0;
}
