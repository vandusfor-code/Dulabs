/**
 * AMORE (autorizado, módulo Inventario) — dominio de productos de la tienda
 * pública (/amore/tienda) y del flujo de compra por WhatsApp. Único punto
 * real de acceso a `dulabs_inventario_productos` y al bucket de fotos
 * `inventario-productos` — reutilizado tal cual por las rutas admin
 * (/api/agenda/[token]/inventario/*), el endpoint público de la tienda
 * (/api/amore/tienda) y el parser de Excel (lib/amore-inventario-excel.ts),
 * para que ninguno reimplemente sus propias reglas de validación o su propio
 * mapeo de fila.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export interface ProductoInventario {
  id: string;
  idTenant: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  stock: number;
  categoria: string | null;
  fotoUrl: string | null;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FilaProductoDb {
  id: string;
  id_tenant: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  stock: number;
  categoria: string | null;
  foto_url: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

const TABLA = "dulabs_inventario_productos";
const COLUMNAS = "id, id_tenant, nombre, descripcion, precio, stock, categoria, foto_url, activo, created_at, updated_at";

function mapearProducto(fila: FilaProductoDb): ProductoInventario {
  return {
    id: fila.id,
    idTenant: fila.id_tenant,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    precio: fila.precio,
    stock: fila.stock,
    categoria: fila.categoria,
    fotoUrl: fila.foto_url,
    activo: fila.activo,
    createdAt: fila.created_at,
    updatedAt: fila.updated_at,
  };
}

// --- Validación compartida (admin manual + importación Excel) -----------

/** Nombre recortado, o null si queda vacío (obligatorio en ambos flujos). */
export function validarNombreProducto(valor: unknown): string | null {
  const nombre = typeof valor === "string" ? valor.trim() : "";
  return nombre.length > 0 ? nombre : null;
}

/** Precio entero >= 0 (COP, sin decimales), o null si no es válido. Acepta number o string numérica. */
export function validarPrecioProducto(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero < 0) return null;
  return numero;
}

/** Stock entero >= 0, o null si no es válido. Acepta number o string numérica. */
export function validarStockProducto(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero < 0) return null;
  return numero;
}

// --- Lectura --------------------------------------------------------------

export async function listarProductos(supabase: SupabaseClient, idTenant: string): Promise<ProductoInventario[]> {
  const { data, error } = await supabase
    .from(TABLA)
    .select(COLUMNAS)
    .eq("id_tenant", idTenant)
    .order("nombre", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as FilaProductoDb[]).map(mapearProducto);
}

/** Solo activos -- usados por la tienda pública y por la detección de intención de compra del bot (nunca se "vende" un producto oculto/inactivo). */
export async function listarProductosActivos(supabase: SupabaseClient, idTenant: string): Promise<ProductoInventario[]> {
  const { data, error } = await supabase
    .from(TABLA)
    .select(COLUMNAS)
    .eq("id_tenant", idTenant)
    .eq("activo", true)
    .order("nombre", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as FilaProductoDb[]).map(mapearProducto);
}

export interface ProductoTiendaPublico {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  categoria: string | null;
  fotoUrl: string | null;
  agotado: boolean;
}

/**
 * Forma pública de un producto para /amore/tienda (autorizado) -- NUNCA
 * expone el stock numérico exacto ni el id_tenant (sección SEGURIDAD del
 * pedido), solo un booleano `agotado`. Disponibles primero (sección ORDEN
 * del pedido). Función pura para poder probarla sin tocar Supabase.
 */
export function mapearProductosParaTienda(productos: ProductoInventario[]): ProductoTiendaPublico[] {
  return productos
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precio: p.precio,
      categoria: p.categoria,
      fotoUrl: p.fotoUrl,
      agotado: p.stock === 0,
    }))
    .sort((a, b) => Number(a.agotado) - Number(b.agotado));
}

export async function obtenerProducto(supabase: SupabaseClient, idTenant: string, id: string): Promise<ProductoInventario | null> {
  const { data, error } = await supabase.from(TABLA).select(COLUMNAS).eq("id_tenant", idTenant).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapearProducto(data as FilaProductoDb) : null;
}

/** Busca por nombre exacto (normalizado por Postgres con ilike) -- usado por la importación Excel para decidir "producto existente" (sección DUPLICADOS del pedido). */
export async function buscarProductoPorNombre(supabase: SupabaseClient, idTenant: string, nombre: string): Promise<ProductoInventario | null> {
  const { data, error } = await supabase.from(TABLA).select(COLUMNAS).eq("id_tenant", idTenant).ilike("nombre", nombre).maybeSingle();
  if (error) throw error;
  return data ? mapearProducto(data as FilaProductoDb) : null;
}

// --- Escritura (admin) ------------------------------------------------------

export interface DatosProducto {
  nombre: string;
  descripcion: string | null;
  precio: number;
  stock: number;
  categoria: string | null;
  activo: boolean;
}

export async function crearProducto(supabase: SupabaseClient, idTenant: string, datos: DatosProducto): Promise<ProductoInventario> {
  const { data, error } = await supabase
    .from(TABLA)
    .insert({
      id_tenant: idTenant,
      nombre: datos.nombre,
      descripcion: datos.descripcion,
      precio: datos.precio,
      stock: datos.stock,
      categoria: datos.categoria,
      activo: datos.activo,
    })
    .select(COLUMNAS)
    .single();
  if (error || !data) throw error ?? new Error("No se pudo crear el producto");
  return mapearProducto(data as FilaProductoDb);
}

export async function actualizarProducto(
  supabase: SupabaseClient,
  idTenant: string,
  id: string,
  cambios: Partial<DatosProducto & { fotoUrl: string | null }>,
): Promise<ProductoInventario | null> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (cambios.nombre !== undefined) payload.nombre = cambios.nombre;
  if (cambios.descripcion !== undefined) payload.descripcion = cambios.descripcion;
  if (cambios.precio !== undefined) payload.precio = cambios.precio;
  if (cambios.stock !== undefined) payload.stock = cambios.stock;
  if (cambios.categoria !== undefined) payload.categoria = cambios.categoria;
  if (cambios.activo !== undefined) payload.activo = cambios.activo;
  if (cambios.fotoUrl !== undefined) payload.foto_url = cambios.fotoUrl;

  const { error } = await supabase.from(TABLA).update(payload).eq("id_tenant", idTenant).eq("id", id);
  if (error) throw error;
  return obtenerProducto(supabase, idTenant, id);
}

/** Ajuste manual de stock (+1/+5/+10/-1/-5/...) -- nunca deja el stock en negativo (clamp a 0), nunca lo llama ningún flujo automático de la tienda/bot. */
export async function ajustarStockProducto(supabase: SupabaseClient, idTenant: string, id: string, delta: number): Promise<ProductoInventario | null> {
  const actual = await obtenerProducto(supabase, idTenant, id);
  if (!actual) return null;
  const nuevoStock = Math.max(0, actual.stock + delta);
  return actualizarProducto(supabase, idTenant, id, { stock: nuevoStock });
}

// --- Fotografías (Storage) --------------------------------------------------

export const BUCKET_INVENTARIO = "inventario-productos";
export const TAMANO_MAXIMO_FOTO_BYTES = 4 * 1024 * 1024; // 4 MB
const MIME_A_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function extensionFotoPermitida(mimeType: string): string | null {
  return MIME_A_EXTENSION[mimeType] ?? null;
}

/** Sube la foto de un producto ya existente (mismo patrón de nombre que worker/src/chats/persistir-mensaje.ts: nunca el nombre original, siempre {tenant}/{producto}/{uuid}.{ext} para evitar colisiones y no exponer nombres de archivo del cliente). Devuelve la URL pública. */
export async function subirFotoProducto(
  supabase: SupabaseClient,
  params: { idTenant: string; productoId: string; buffer: Buffer; mimeType: string },
): Promise<{ ok: true; fotoUrl: string } | { ok: false; error: string }> {
  const extension = extensionFotoPermitida(params.mimeType);
  if (!extension) {
    return { ok: false, error: "Formato de imagen no permitido. Usa JPG, PNG o WEBP." };
  }
  if (params.buffer.byteLength > TAMANO_MAXIMO_FOTO_BYTES) {
    return { ok: false, error: "La imagen supera el tamaño máximo permitido (4 MB)." };
  }

  const ruta = `${params.idTenant}/${params.productoId}/${randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET_INVENTARIO).upload(ruta, params.buffer, {
    contentType: params.mimeType,
    upsert: false,
  });
  if (error) {
    console.error("[amore-inventario] error subiendo foto:", error.message);
    return { ok: false, error: "No se pudo subir la imagen" };
  }

  const { data } = supabase.storage.from(BUCKET_INVENTARIO).getPublicUrl(ruta);
  return { ok: true, fotoUrl: data.publicUrl };
}

/** Elimina la foto actual de un producto (reemplazo o borrado explícito). Nunca lanza si el archivo ya no existe -- borrar algo que no está ya está "hecho". */
export async function eliminarFotoProducto(supabase: SupabaseClient, fotoUrl: string): Promise<void> {
  const marcador = `/${BUCKET_INVENTARIO}/`;
  const indice = fotoUrl.indexOf(marcador);
  if (indice === -1) return; // no es una URL de nuestro bucket -- nunca se intenta borrar algo externo
  const ruta = fotoUrl.slice(indice + marcador.length);
  const { error } = await supabase.storage.from(BUCKET_INVENTARIO).remove([ruta]);
  if (error) {
    console.error("[amore-inventario] error eliminando foto anterior (no fatal):", error.message);
  }
}
