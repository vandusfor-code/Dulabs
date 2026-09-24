/**
 * Catálogo DuLabs — REPOSITORIO.
 *
 * ÚNICO punto del dominio Catálogo que accede a tablas y a Storage. Traduce
 * la estructura física (dulabs_inventario_productos, que comparten AMORE, el
 * Business Agent y la cotización; dulabs_catalogo_*; bucket
 * inventario-productos) al modelo del dominio (lib/catalogo/domain.ts). Si
 * mañana la tabla se renombra o el storage cambia, solo cambia este archivo.
 *
 * TODA consulta filtra por id_tenant: el tenantId llega del contexto
 * autenticado (lib/catalogo/auth.ts), nunca del frontend.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CatalogCategory,
  CatalogProduct,
  ImageMimeType,
  ProductStatus,
  StatusFilter,
} from "@/lib/catalogo/domain";
import { CatalogError } from "@/lib/catalogo/errors";
import type { CatalogPublication } from "@/lib/catalogo/publicacion";
import type { ExistingProductKey, ImportRecord } from "@/lib/catalogo/import/types";
import { moduloHabilitado } from "@/lib/tenant-modulos";

// ---------------------------------------------------------------------------
// Puerto (lo implementa Supabase aquí; los tests usan una implementación en memoria)
// ---------------------------------------------------------------------------

export interface ProductWriteData {
  name: string;
  description: string | null;
  categoryId: string | null;
  /** Nombre de la categoría para la columna legada `categoria` (texto que leen AMORE/Business Agent). */
  categoryName: string | null;
  material: string | null;
  color: string | null;
  retailPrice: number;
  wholesalePrice: number | null;
  /** Unidades disponibles (>= 0). Escribirlo activa el control de inventario del producto. */
  stock: number;
}

export type ProductPatchData = Partial<ProductWriteData> & { status?: ProductStatus };

/** De qué carga masiva y fila salió un producto (idempotencia: UNIQUE por tenant + importación + fila). */
export interface ProductOrigin {
  importId: string;
  row: number;
}

export interface ImportCounts {
  skipped: number;
  errors: number;
  photosUploaded: number;
  photosFailed: number;
}

export interface ProductListFilter {
  search?: string;
  categoryId?: string;
  /** Solo productos con foto principal (vitrina pública: destacados, portadas de categoría). */
  withImage?: boolean;
  status: StatusFilter;
  offset: number;
  limit: number;
}

export interface StoredMedia {
  id: string;
  productId: string;
  storagePath: string;
  thumbPath: string | null;
  isPrimary: boolean;
  order: number;
  mimeType: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
}

export interface StoredObjectInfo {
  size: number | null;
  contentType: string | null;
}

/** Imagen lista para servir por la ruta pública (cuerpo en streaming, sin cargarla en memoria). */
export interface PublicImageObject {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  size: number | null;
}

/** Únicos tipos que la ruta pública sirve (lo que el Catálogo y AMORE suben). */
export const PUBLIC_IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;

export interface SignedUpload {
  path: string;
  token: string;
  signedUrl: string;
}

export interface AttachMediaData {
  productId: string;
  storagePath: string;
  thumbPath: string | null;
  mimeType: ImageMimeType;
  bytes: number | null;
  width: number | null;
  height: number | null;
  makePrimary: boolean;
}

export interface CatalogRepository {
  listProducts(tenantId: string, filter: ProductListFilter): Promise<{ items: CatalogProduct[]; total: number }>;
  getProduct(tenantId: string, productId: string): Promise<CatalogProduct | null>;
  getProductByReference(tenantId: string, reference: string): Promise<CatalogProduct | null>;
  /** Resolución por lote de referencias EXACTAS del tenant (la referencia es la identidad del producto). */
  getProductsByReferences(tenantId: string, references: string[]): Promise<CatalogProduct[]>;
  /** `origin` solo en la carga masiva; un reintento de la misma fila lanza CONFLICT. */
  insertProduct(tenantId: string, actorId: string, data: ProductWriteData, origin?: ProductOrigin): Promise<CatalogProduct>;
  updateProduct(tenantId: string, actorId: string, productId: string, patch: ProductPatchData): Promise<CatalogProduct | null>;

  listCategories(tenantId: string): Promise<CatalogCategory[]>;
  getCategory(tenantId: string, categoryId: string): Promise<CatalogCategory | null>;
  insertCategory(tenantId: string, actorId: string, name: string): Promise<CatalogCategory>;

  listMedia(tenantId: string, productId: string): Promise<StoredMedia[]>;
  listPrimaryMedia(tenantId: string, productIds: string[]): Promise<StoredMedia[]>;
  countMedia(tenantId: string, productId: string): Promise<number>;
  attachMedia(tenantId: string, actorId: string, data: AttachMediaData): Promise<StoredMedia>;
  deleteMedia(tenantId: string, actorId: string, mediaId: string): Promise<StoredMedia | null>;

  // Publicación pública del catálogo (links detal / mayor).
  getPublication(tenantId: string): Promise<CatalogPublication | null>;
  getPublicationBySlug(slug: string): Promise<(CatalogPublication & { tenantId: string }) | null>;
  /** Lanza CatalogError CONFLICT si el slug ya lo usa otro negocio (o el tenant ya tiene publicación). */
  insertPublication(tenantId: string, slug: string, publicName: string): Promise<CatalogPublication>;
  updatePublicationToken(tenantId: string, token: string): Promise<CatalogPublication | null>;
  /** Nombre y WhatsApp del negocio (número conectado más reciente del tenant). */
  getBusinessProfile(tenantId: string): Promise<{ name: string | null; whatsapp: string | null }>;
  /** Módulo "catalogo" habilitado (estricto: un error de BD se propaga). */
  isModuleEnabled(tenantId: string): Promise<boolean>;

  /**
   * Búsqueda de texto completo del agente (dulabs_catalogo_buscar): SOLO referencias,
   * en orden de relevancia, con el total. null = la migración de búsqueda aún no está
   * aplicada (el caller usa la búsqueda anterior).
   */
  searchCatalog(tenantId: string, query: CatalogSearchQuery): Promise<CatalogSearchPage | null>;

  // Carga masiva (historial + origen de cada producto importado).
  /** Nombre/categoría/color/material de TODOS los productos del tenant (detección de repetidos). */
  listProductKeys(tenantId: string): Promise<ExistingProductKey[]>;
  /** false si la migración de carga masiva (20261107000000) aún no está aplicada en esta BD. */
  importsAvailable(): Promise<boolean>;
  /** Productos ya creados por esta importación para esas filas (reintentos idempotentes). */
  getProductsByImportRows(tenantId: string, importId: string, rows: number[]): Promise<Array<{ row: number; product: CatalogProduct }>>;
  /** De estos productos, cuáles vinieron de una carga masiva (cualquiera del tenant). */
  bulkImportedProductIds(tenantId: string, productIds: string[]): Promise<string[]>;
  insertImport(tenantId: string, actorId: string, data: { fileName: string; totalRows: number }): Promise<ImportRecord>;
  getImport(tenantId: string, importId: string): Promise<ImportRecord | null>;
  /** Cierra la importación; `created` lo cuenta la BD (productos con esta importación), nunca el navegador. */
  finishImport(tenantId: string, importId: string, counts: ImportCounts): Promise<ImportRecord | null>;
  listImports(tenantId: string, limit: number): Promise<ImportRecord[]>;

  bucket: string;
  createSignedUpload(path: string): Promise<SignedUpload>;
  objectInfo(path: string): Promise<StoredObjectInfo | null>;
  /** Primeros bytes del objeto (para verificar la firma real de la imagen). */
  readObjectHead(path: string, bytes: number): Promise<Uint8Array | null>;
  removeObjects(paths: string[]): Promise<void>;
  publicUrl(path: string): string;
  /** Ruta dentro del bucket si `url` es una URL pública de ESTE bucket (foto legada en foto_url); null en otro caso. */
  storagePathFromUrl(url: string): string | null;
  /** Abre una imagen del bucket para servirla por la ruta pública; null si no existe o no es una imagen permitida. */
  openImage(path: string): Promise<PublicImageObject | null>;
}

export interface CatalogSearchQuery {
  text: string;
  /** all = todas las palabras; any = alguna (para relajar cuando no hay coincidencias). */
  mode: "all" | "any";
  /** El filtro de precio usa el precio de ESTE canal. */
  channel: "retail" | "wholesale";
  limit: number;
  offset: number;
  category?: string | null;
  color?: string | null;
  material?: string | null;
  categoryId?: string | null;
  maxPrice?: number | null;
  exclude?: readonly string[];
}

export interface CatalogSearchPage {
  references: string[];
  total: number;
}

// ---------------------------------------------------------------------------
// Implementación Supabase
// ---------------------------------------------------------------------------

/** Bucket EXISTENTE de fotos de producto (AMORE lo usa con la misma convención de rutas). Público: la URL es estable para <img>, catálogo público y envío por WhatsApp. */
export const CATALOG_BUCKET = "inventario-productos";

const T_PRODUCTOS = "dulabs_inventario_productos";
const T_CATEGORIAS = "dulabs_catalogo_categorias";
const T_MEDIA = "dulabs_catalogo_media";
const T_PUBLICACION = "dulabs_catalogo_publicacion";
const T_IMPORTACIONES = "dulabs_catalogo_importaciones";
const IMPORT_COLUMNS = "id, archivo, total_filas, creados, omitidos, errores, fotos_subidas, fotos_fallidas, estado, created_at, finalizada_at, creado_por";

interface ImportRow {
  id: string;
  archivo: string;
  total_filas: number;
  creados: number;
  omitidos: number;
  errores: number;
  fotos_subidas: number;
  fotos_fallidas: number;
  estado: ImportRecord["status"];
  created_at: string;
  finalizada_at: string | null;
  creado_por: string | null;
}

function mapImport(r: ImportRow): ImportRecord {
  return {
    id: r.id,
    fileName: r.archivo,
    totalRows: r.total_filas,
    created: r.creados,
    skipped: r.omitidos,
    errors: r.errores,
    photosUploaded: r.fotos_subidas,
    photosFailed: r.fotos_fallidas,
    status: r.estado,
    createdAt: r.created_at,
    finishedAt: r.finalizada_at,
    createdBy: r.creado_por,
  };
}

/**
 * Errores de la carga masiva: si la migración 20261107000000 aún no se aplicó
 * (tabla o columnas inexistentes) se responde con un mensaje claro en vez de
 * un error técnico. El resto del catálogo no se ve afectado.
 */
/** Tabla o columna inexistente (migración de carga masiva sin aplicar). Códigos de Postgres y de PostgREST. */
function isMissingSchema(error: PgError): boolean {
  return error.code === "42P01" || error.code === "42703" || error.code === "PGRST204" || error.code === "PGRST205";
}

function failImport(context: string, error: PgError): never {
  if (isMissingSchema(error)) {
    console.error(`[catalogo/repository] ${context}: falta la migración de carga masiva`, error.code);
    throw new CatalogError("FEATURE_UNAVAILABLE", "La carga masiva todavía no está activada. Intenta de nuevo más tarde o avísale al equipo de DuLabs.");
  }
  fail(context, error);
}
const PUBLICATION_COLUMNS = "id_tenant, slug, nombre_publico, publicado, token_mayor";

interface PublicationRow {
  id_tenant: string;
  slug: string;
  nombre_publico: string;
  publicado: boolean;
  token_mayor: string;
}

function mapPublication(row: PublicationRow): CatalogPublication {
  return { slug: row.slug, publicName: row.nombre_publico, published: row.publicado, wholesaleToken: row.token_mayor };
}

const PRODUCT_COLUMNS =
  "id, referencia, nombre, descripcion, precio, precio_mayor, material, color, categoria, categoria_id, activo, controla_stock, stock, foto_url, created_at, updated_at";
const MEDIA_COLUMNS = "id, producto_id, storage_path, thumb_path, es_principal, orden, mime_type, bytes, ancho, alto";

interface ProductRow {
  id: string;
  referencia: string;
  nombre: string;
  descripcion: string | null;
  precio: number;
  precio_mayor: number | null;
  material: string | null;
  color: string | null;
  categoria: string | null;
  categoria_id: string | null;
  activo: boolean;
  controla_stock: boolean;
  stock: number | null;
  foto_url: string | null;
  created_at: string;
  updated_at: string;
}

interface MediaRow {
  id: string;
  producto_id: string;
  storage_path: string;
  thumb_path: string | null;
  es_principal: boolean;
  orden: number;
  mime_type: string;
  bytes: number | null;
  ancho: number | null;
  alto: number | null;
}

interface PgError {
  code?: string;
  message?: string;
}

function mapProduct(row: ProductRow): CatalogProduct {
  return {
    id: row.id,
    reference: row.referencia,
    name: row.nombre,
    description: row.descripcion,
    categoryId: row.categoria_id,
    categoryName: row.categoria,
    material: row.material,
    color: row.color,
    pricing: { retail: row.precio, wholesale: row.precio_mayor },
    status: row.activo ? "ACTIVE" : "INACTIVE",
    tracksStock: row.controla_stock,
    stock: Math.max(0, row.stock ?? 0),
    // Foto legada (AMORE / principal sincronizada por la BD). El service la
    // reemplaza por la miniatura de la media principal cuando existe.
    primaryImage: row.foto_url ? { url: row.foto_url, thumbUrl: row.foto_url } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMedia(row: MediaRow): StoredMedia {
  return {
    id: row.id,
    productId: row.producto_id,
    storagePath: row.storage_path,
    thumbPath: row.thumb_path,
    isPrimary: row.es_principal,
    order: row.orden,
    mimeType: row.mime_type,
    bytes: row.bytes,
    width: row.ancho,
    height: row.alto,
  };
}

/** Traduce errores de Postgres/PostgREST a CatalogError sin filtrar detalles internos. */
function fail(context: string, error: PgError): never {
  if (error.code === "23505") throw new CatalogError("CONFLICT", "Ya existe un registro con esos datos.");
  if (error.code === "23503") throw new CatalogError("VALIDATION_ERROR", "La categoría no existe.");
  if (error.code === "23514") throw new CatalogError("VALIDATION_ERROR", "Algún dato no cumple las reglas del catálogo.");
  if (error.code === "CT001") throw new CatalogError("VALIDATION_ERROR", "La referencia es inmutable.");
  if (error.code === "CT003" || error.code === "CT004") throw new CatalogError("NOT_FOUND", "No se encontró el recurso.");
  console.error(`[catalogo/repository] ${context}:`, error.code ?? "", error.message ?? "");
  throw new CatalogError("INTERNAL_ERROR", "No se pudo completar la operación del catálogo.");
}

export function createSupabaseCatalogRepository(supabase: SupabaseClient): CatalogRepository {
  const storage = () => supabase.storage.from(CATALOG_BUCKET);
  const publicUrl = (path: string) => storage().getPublicUrl(path).data.publicUrl;
  /** URL pública base del bucket (termina en "/"): la BD construye foto_url = base || storage_path, idéntico a getPublicUrl. */
  const publicUrlBase = () => {
    const sample = "x";
    const url = publicUrl(sample);
    return url.slice(0, url.length - sample.length);
  };

  return {
    bucket: CATALOG_BUCKET,

    async listProducts(tenantId, filter) {
      let query = supabase.from(T_PRODUCTOS).select(PRODUCT_COLUMNS, { count: "exact" }).eq("id_tenant", tenantId);
      if (filter.status === "ACTIVE") query = query.eq("activo", true);
      if (filter.status === "INACTIVE") query = query.eq("activo", false);
      if (filter.categoryId) query = query.eq("categoria_id", filter.categoryId);
      if (filter.withImage) query = query.not("foto_url", "is", null);
      // `search` ya viene normalizado por el dominio (sin , ( ) * % _ \ : " ').
      // El valor va ENTRE COMILLAS (forma documentada de PostgREST para
      // valores con caracteres reservados como "."), con % como comodín.
      if (filter.search) query = query.or(`nombre.ilike."%${filter.search}%",referencia.ilike."%${filter.search}%"`);
      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(filter.offset, filter.offset + filter.limit - 1);
      if (error) fail("listProducts", error);
      return { items: ((data ?? []) as ProductRow[]).map(mapProduct), total: count ?? 0 };
    },

    async searchCatalog(tenantId, q) {
      const { data, error } = await supabase.rpc("dulabs_catalogo_buscar", {
        p_tenant: tenantId,
        p_texto: q.text,
        p_modo: q.mode,
        p_canal: q.channel,
        p_limite: q.limit,
        p_offset: q.offset,
        p_categoria: q.category ?? null,
        p_color: q.color ?? null,
        p_material: q.material ?? null,
        p_categoria_id: q.categoryId ?? null,
        p_precio_max: q.maxPrice ?? null,
        p_excluir: q.exclude && q.exclude.length > 0 ? [...q.exclude] : null,
      });
      if (error) {
        // Sin la migración de búsqueda (función inexistente): el caller usa la búsqueda anterior.
        if (["PGRST202", "42883", "PGRST205"].includes(error.code ?? "")) return null;
        fail("searchCatalog", error);
      }
      const rows = (data ?? []) as Array<{ referencia: string; total: number | string }>;
      return { references: rows.map((r) => r.referencia), total: rows.length > 0 ? Number(rows[0].total) : 0 };
    },

    async getProduct(tenantId, productId) {
      const { data, error } = await supabase.from(T_PRODUCTOS).select(PRODUCT_COLUMNS).eq("id_tenant", tenantId).eq("id", productId).maybeSingle();
      if (error) fail("getProduct", error);
      return data ? mapProduct(data as ProductRow) : null;
    },

    async getProductByReference(tenantId, reference) {
      const { data, error } = await supabase.from(T_PRODUCTOS).select(PRODUCT_COLUMNS).eq("id_tenant", tenantId).eq("referencia", reference).maybeSingle();
      if (error) fail("getProductByReference", error);
      return data ? mapProduct(data as ProductRow) : null;
    },

    async getProductsByReferences(tenantId, references) {
      if (references.length === 0) return [];
      const { data, error } = await supabase.from(T_PRODUCTOS).select(PRODUCT_COLUMNS).eq("id_tenant", tenantId).in("referencia", references);
      if (error) fail("getProductsByReferences", error);
      return ((data ?? []) as ProductRow[]).map(mapProduct);
    },

    async insertProduct(tenantId, actorId, d, origin) {
      const { data, error } = await supabase
        .from(T_PRODUCTOS)
        .insert({
          // Solo la carga masiva envía estas columnas (así la creación manual no depende de su migración).
          ...(origin ? { importacion_id: origin.importId, importacion_fila: origin.row } : {}),
          id_tenant: tenantId,
          nombre: d.name,
          descripcion: d.description,
          categoria_id: d.categoryId,
          categoria: d.categoryName,
          material: d.material,
          color: d.color,
          precio: d.retailPrice,
          precio_mayor: d.wholesalePrice,
          activo: true,
          // Inventario CONTROLADO desde el Catálogo: el stock del formulario es
          // la verdad (0 = agotado; la BD rechaza negativos con su CHECK).
          controla_stock: true,
          stock: d.stock,
          created_by: actorId,
          updated_by: actorId,
          escritura_id: randomUUID(),
          // `referencia` NO se envía: la asigna el trigger de la BD.
        })
        .select(PRODUCT_COLUMNS)
        .single();
      if (error || !data) (origin ? failImport : fail)("insertProduct", error ?? { message: "sin fila" });
      return mapProduct(data as ProductRow);
    },

    async updateProduct(tenantId, actorId, productId, patch) {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        updated_by: actorId,
        // Token nuevo: la auditoría atribuye ESTA escritura a actorId.
        escritura_id: randomUUID(),
      };
      if (patch.name !== undefined) payload.nombre = patch.name;
      if (patch.description !== undefined) payload.descripcion = patch.description;
      if (patch.categoryId !== undefined) {
        payload.categoria_id = patch.categoryId;
        payload.categoria = patch.categoryName ?? null;
      }
      if (patch.material !== undefined) payload.material = patch.material;
      if (patch.color !== undefined) payload.color = patch.color;
      if (patch.retailPrice !== undefined) payload.precio = patch.retailPrice;
      if (patch.wholesalePrice !== undefined) payload.precio_mayor = patch.wholesalePrice;
      if (patch.stock !== undefined) {
        payload.stock = patch.stock;
        payload.controla_stock = true;
      }
      if (patch.status !== undefined) payload.activo = patch.status === "ACTIVE";

      const { data, error } = await supabase
        .from(T_PRODUCTOS)
        .update(payload)
        .eq("id_tenant", tenantId)
        .eq("id", productId)
        .select(PRODUCT_COLUMNS)
        .maybeSingle();
      if (error) fail("updateProduct", error);
      return data ? mapProduct(data as ProductRow) : null;
    },

    async listProductKeys(tenantId) {
      // PostgREST devuelve máximo 1000 filas por consulta: se pagina. `importacion_id`
      // solo existe con la migración de carga masiva: sin ella se lee lo demás
      // (el preview funciona igual; solo no se distingue "ya importado").
      const read = async (withImport: boolean) => {
        const out: ExistingProductKey[] = [];
        const columns: string = withImport ? "id, referencia, nombre, categoria_id, color, material, foto_url, importacion_id" : "id, referencia, nombre, categoria_id, color, material, foto_url";
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .from(T_PRODUCTOS)
            .select(columns)
            .eq("id_tenant", tenantId)
            .order("id", { ascending: true })
            .range(from, from + 999);
          if (error) return { out, error };
          const rows = (data ?? []) as unknown as Array<{
            id: string;
            referencia: string;
            nombre: string;
            categoria_id: string | null;
            color: string | null;
            material: string | null;
            foto_url: string | null;
            importacion_id?: string | null;
          }>;
          for (const r of rows) {
            out.push({ id: r.id, reference: r.referencia, name: r.nombre, categoryId: r.categoria_id, color: r.color, material: r.material, importId: r.importacion_id ?? null, hasImages: r.foto_url !== null });
          }
          if (rows.length < 1000 || out.length >= 50_000) break;
        }
        return { out, error: null };
      };
      const full = await read(true);
      if (!full.error) return full.out;
      if (!isMissingSchema(full.error)) fail("listProductKeys", full.error);
      const basic = await read(false);
      if (basic.error) fail("listProductKeys", basic.error);
      return basic.out;
    },

    async importsAvailable() {
      // Sonda barata (0 filas): ¿existen la tabla y las columnas de la migración?
      // GET con limit(0), NO `head: true`: una respuesta HEAD no trae cuerpo, así
      // que el código del error (PGRST205 / 42703) se perdería y no se podría
      // distinguir "falta la migración" de una caída real.
      const [tabla, columnas] = await Promise.all([
        supabase.from(T_IMPORTACIONES).select("id").limit(0),
        supabase.from(T_PRODUCTOS).select("importacion_id, importacion_fila").limit(0),
      ]);
      for (const r of [tabla, columnas]) {
        if (r.error) {
          if (isMissingSchema(r.error)) return false;
          fail("importsAvailable", r.error);
        }
      }
      return true;
    },

    async getProductsByImportRows(tenantId, importId, rows) {
      if (rows.length === 0) return [];
      const { data, error } = await supabase
        .from(T_PRODUCTOS)
        .select(`${PRODUCT_COLUMNS}, importacion_fila`)
        .eq("id_tenant", tenantId)
        .eq("importacion_id", importId)
        .in("importacion_fila", rows);
      if (error) failImport("getProductsByImportRows", error);
      return ((data ?? []) as Array<ProductRow & { importacion_fila: number }>).map((r) => ({ row: r.importacion_fila, product: mapProduct(r) }));
    },

    async bulkImportedProductIds(tenantId, productIds) {
      if (productIds.length === 0) return [];
      const { data, error } = await supabase.from(T_PRODUCTOS).select("id").eq("id_tenant", tenantId).not("importacion_id", "is", null).in("id", productIds);
      if (error) failImport("bulkImportedProductIds", error);
      return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    },

    async insertImport(tenantId, actorId, d) {
      const { data, error } = await supabase
        .from(T_IMPORTACIONES)
        .insert({ id_tenant: tenantId, creado_por: actorId, archivo: d.fileName, total_filas: d.totalRows })
        .select(IMPORT_COLUMNS)
        .single();
      if (error || !data) failImport("insertImport", error ?? { message: "sin fila" });
      return mapImport(data as ImportRow);
    },

    async getImport(tenantId, importId) {
      const { data, error } = await supabase.from(T_IMPORTACIONES).select(IMPORT_COLUMNS).eq("id_tenant", tenantId).eq("id", importId).maybeSingle();
      if (error) failImport("getImport", error);
      return data ? mapImport(data as ImportRow) : null;
    },

    async finishImport(tenantId, importId, c) {
      const { count, error: countError } = await supabase
        .from(T_PRODUCTOS)
        .select("id", { count: "exact", head: true })
        .eq("id_tenant", tenantId)
        .eq("importacion_id", importId);
      if (countError) failImport("finishImport.count", countError);
      const { data, error } = await supabase
        .from(T_IMPORTACIONES)
        .update({
          creados: count ?? 0,
          omitidos: c.skipped,
          errores: c.errors,
          fotos_subidas: c.photosUploaded,
          fotos_fallidas: c.photosFailed,
          estado: "completada",
          finalizada_at: new Date().toISOString(),
        })
        .eq("id_tenant", tenantId)
        .eq("id", importId)
        .select(IMPORT_COLUMNS)
        .maybeSingle();
      if (error) failImport("finishImport", error);
      return data ? mapImport(data as ImportRow) : null;
    },

    async listImports(tenantId, limit) {
      const { data, error } = await supabase
        .from(T_IMPORTACIONES)
        .select(IMPORT_COLUMNS)
        .eq("id_tenant", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) failImport("listImports", error);
      return ((data ?? []) as ImportRow[]).map(mapImport);
    },

    async listCategories(tenantId) {
      const { data, error } = await supabase.from(T_CATEGORIAS).select("id, nombre").eq("id_tenant", tenantId).order("nombre", { ascending: true });
      if (error) fail("listCategories", error);
      return ((data ?? []) as Array<{ id: string; nombre: string }>).map((c) => ({ id: c.id, name: c.nombre }));
    },

    async getCategory(tenantId, categoryId) {
      const { data, error } = await supabase.from(T_CATEGORIAS).select("id, nombre").eq("id_tenant", tenantId).eq("id", categoryId).maybeSingle();
      if (error) fail("getCategory", error);
      return data ? { id: (data as { id: string }).id, name: (data as { nombre: string }).nombre } : null;
    },

    async insertCategory(tenantId, actorId, name) {
      const { data, error } = await supabase
        .from(T_CATEGORIAS)
        .insert({ id_tenant: tenantId, nombre: name, created_by: actorId })
        .select("id, nombre")
        .single();
      if (error || !data) fail("insertCategory", error ?? { message: "sin fila" });
      return { id: (data as { id: string }).id, name: (data as { nombre: string }).nombre };
    },

    async listMedia(tenantId, productId) {
      const { data, error } = await supabase
        .from(T_MEDIA)
        .select(MEDIA_COLUMNS)
        .eq("id_tenant", tenantId)
        .eq("producto_id", productId)
        .order("es_principal", { ascending: false })
        .order("orden", { ascending: true });
      if (error) fail("listMedia", error);
      return ((data ?? []) as MediaRow[]).map(mapMedia);
    },

    async listPrimaryMedia(tenantId, productIds) {
      if (productIds.length === 0) return [];
      const { data, error } = await supabase
        .from(T_MEDIA)
        .select(MEDIA_COLUMNS)
        .eq("id_tenant", tenantId)
        .eq("es_principal", true)
        .in("producto_id", productIds);
      if (error) fail("listPrimaryMedia", error);
      return ((data ?? []) as MediaRow[]).map(mapMedia);
    },

    async countMedia(tenantId, productId) {
      const { count, error } = await supabase.from(T_MEDIA).select("id", { count: "exact", head: true }).eq("id_tenant", tenantId).eq("producto_id", productId);
      if (error) fail("countMedia", error);
      return count ?? 0;
    },

    async attachMedia(tenantId, actorId, d) {
      // RPC atómica: lock del producto + principal única + foto_url sincronizada.
      const { data, error } = await supabase.rpc("dulabs_catalogo_adjuntar_media", {
        p_tenant: tenantId,
        p_producto: d.productId,
        p_storage_path: d.storagePath,
        p_thumb_path: d.thumbPath,
        p_mime_type: d.mimeType,
        p_bytes: d.bytes,
        p_ancho: d.width,
        p_alto: d.height,
        p_principal: d.makePrimary,
        p_actor: actorId,
        p_url_base: publicUrlBase(),
      });
      if (error || !data) fail("attachMedia", error ?? { message: "sin fila" });
      return mapMedia(data as MediaRow);
    },

    async deleteMedia(tenantId, actorId, mediaId) {
      const { data, error } = await supabase.rpc("dulabs_catalogo_eliminar_media", {
        p_tenant: tenantId,
        p_media: mediaId,
        p_actor: actorId,
        p_url_base: publicUrlBase(),
      });
      if (error) {
        if (error.code === "CT004") return null;
        fail("deleteMedia", error);
      }
      return data ? mapMedia(data as MediaRow) : null;
    },

    async getPublication(tenantId) {
      const { data, error } = await supabase.from(T_PUBLICACION).select(PUBLICATION_COLUMNS).eq("id_tenant", tenantId).maybeSingle();
      if (error) fail("getPublication", error);
      return data ? mapPublication(data as PublicationRow) : null;
    },

    async getPublicationBySlug(slug) {
      const { data, error } = await supabase.from(T_PUBLICACION).select(PUBLICATION_COLUMNS).eq("slug", slug).maybeSingle();
      if (error) fail("getPublicationBySlug", error);
      if (!data) return null;
      const row = data as PublicationRow;
      return { ...mapPublication(row), tenantId: row.id_tenant };
    },

    async insertPublication(tenantId, slug, publicName) {
      // token_mayor lo genera la BD (default aleatorio de 64 hex).
      const { data, error } = await supabase
        .from(T_PUBLICACION)
        .insert({ id_tenant: tenantId, slug, nombre_publico: publicName })
        .select(PUBLICATION_COLUMNS)
        .single();
      if (error || !data) fail("insertPublication", error ?? { message: "sin fila" });
      return mapPublication(data as PublicationRow);
    },

    async updatePublicationToken(tenantId, token) {
      const { data, error } = await supabase
        .from(T_PUBLICACION)
        .update({ token_mayor: token, updated_at: new Date().toISOString() })
        .eq("id_tenant", tenantId)
        .select(PUBLICATION_COLUMNS)
        .maybeSingle();
      if (error) fail("updatePublicationToken", error);
      return data ? mapPublication(data as PublicationRow) : null;
    },

    async getBusinessProfile(tenantId) {
      const { data, error } = await supabase
        .from("dulabs_clientes_config")
        .select("nombre_negocio, telefono_negocio")
        .eq("id_tenant", tenantId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("getBusinessProfile", error);
      const row = data as { nombre_negocio: string | null; telefono_negocio: string | null } | null;
      return { name: row?.nombre_negocio ?? null, whatsapp: row?.telefono_negocio ?? null };
    },

    isModuleEnabled: (tenantId) => moduloHabilitado(supabase, tenantId, "catalogo"),

    async createSignedUpload(path) {
      // upsert false: una ruta emitida no puede sobrescribir un objeto existente.
      const { data, error } = await storage().createSignedUploadUrl(path);
      if (error || !data) fail("createSignedUpload", { message: error?.message });
      return { path: data.path, token: data.token, signedUrl: data.signedUrl };
    },

    async objectInfo(path) {
      const { data, error } = await storage().info(path);
      if (error || !data) return null;
      return { size: typeof data.size === "number" ? data.size : null, contentType: data.contentType ?? null };
    },

    async readObjectHead(path, bytes) {
      // El bucket es público: un Range request trae solo los primeros bytes
      // (firma del formato) sin descargar la imagen completa.
      try {
        const res = await fetch(publicUrl(path), { headers: { Range: `bytes=0-${bytes - 1}` }, cache: "no-store" });
        if (!res.ok) return null;
        const buffer = new Uint8Array(await res.arrayBuffer());
        return buffer.slice(0, bytes);
      } catch {
        return null;
      }
    },

    async removeObjects(paths) {
      if (paths.length === 0) return;
      const { error } = await storage().remove(paths);
      if (error) console.error("[catalogo/repository] no se pudieron borrar objetos de Storage (no fatal):", error.message);
    },

    publicUrl,

    storagePathFromUrl(url) {
      const base = publicUrlBase();
      if (!url.startsWith(base)) return null;
      const path = url.slice(base.length).split(/[?#]/)[0];
      try {
        return decodeURIComponent(path) || null;
      } catch {
        return null;
      }
    },

    async openImage(path) {
      // El bucket es público: se lee por su URL pública (CDN de Supabase) y el
      // cuerpo se reenvía en streaming. Sin caché de datos de Next: la caché
      // la hacen el CDN y el navegador con los headers de la ruta pública.
      try {
        const res = await fetch(publicUrl(path), { cache: "no-store" });
        const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!res.ok || !res.body || !(PUBLIC_IMAGE_TYPES as readonly string[]).includes(contentType)) {
          // Sin await: con el fetch de Next, esperar el cancel de un 404 puede no resolver nunca
          // y dejaba colgada la ruta pública (p. ej. foto sin variante de detalle => fallback a la principal).
          void res.body?.cancel().catch(() => {});
          return null;
        }
        const length = Number(res.headers.get("content-length"));
        return { body: res.body, contentType, size: Number.isFinite(length) && length > 0 ? length : null };
      } catch (error) {
        console.error("[catalogo/repository] openImage:", error instanceof Error ? error.message : error);
        return null;
      }
    },
  };
}
