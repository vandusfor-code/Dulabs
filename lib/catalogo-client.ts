/**
 * Cliente del navegador para /api/dashboard/catalogo/* (mismo patrón que
 * lib/business-agent-client.ts: resultados tipados, nunca lanza por HTTP).
 *
 * uploadImage() orquesta la subida en 4 etapas sin pasar la foto por Vercel:
 *   preparar (comprimir en el navegador) -> pedir URL firmada -> subir DIRECTO
 *   a Storage (imagen + miniatura) -> confirmar (el servidor verifica todo).
 */
import type { CatalogCategory, CatalogImage, CatalogProduct, CatalogProductDetail, ProductPage, ProductStatus, StatusFilter } from "@/lib/catalogo/domain";
import { prepareProductImage, ImagePreparationError, type PreparedImage } from "@/lib/catalogo/image-processing";
import type { CategoryDecision, ImageInfo, ImportAnalysis, ImportHistoryItem, ImportRecord, ImportRowResult, RawRow } from "@/lib/catalogo/import/types";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { PublicationView } from "@/lib/catalogo/service";
import type { PedidoPanel } from "@/lib/catalogo/pedidos/panel";

// Solo el TIPO (se borra al compilar): rutas relativas; el navegador les antepone su origen.
export type { PublicationView };

export interface CatalogClientError {
  code: string;
  message: string;
  status: number;
}

export type CatalogResult<T> = { ok: true; data: T } | { ok: false; error: CatalogClientError };

/** Lo que envía el formulario (el servidor valida y normaliza). Sin `reference`: la asigna la BD. */
export interface ProductDraft {
  name: string;
  categoryId: string | null;
  description: string | null;
  material: string | null;
  color: string | null;
  retailPrice: number;
  wholesalePrice: number | null;
  /** Unidades disponibles para venta (entero >= 0). */
  stock: number;
}

export type ProductPatch = Partial<ProductDraft> & { status?: ProductStatus };

export interface ProductListParams {
  q?: string;
  categoryId?: string;
  status?: StatusFilter;
  page?: number;
  pageSize?: number;
}

export type UploadStage = "preparing" | "uploading" | "confirming";

export interface UploadTicket {
  uploadId: string;
  bucket: string;
  mimeType: "image/webp" | "image/jpeg";
  image: { path: string; token: string };
  thumb: { path: string; token: string };
  detail?: { path: string; token: string };
}

const BASE = "/api/dashboard/catalogo";

async function call<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<CatalogResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    return { ok: false, error: { code: "NETWORK_ERROR", message: "Sin conexión. Revisa tu internet e intenta de nuevo.", status: 0 } };
  }
  let body: { success?: boolean; data?: T; error?: { code?: string; message?: string } | string } = {};
  try {
    body = await response.json();
  } catch {
    // sin cuerpo JSON -- error genérico abajo
  }
  if (response.ok && body.success && body.data !== undefined) return { ok: true, data: body.data };
  // Envelope del catálogo ({error:{code,message}}) o formato histórico ({error:"..."}) de auth/rate limit.
  const err = body.error;
  return {
    ok: false,
    error: {
      code: typeof err === "object" && err?.code ? err.code : response.status === 429 ? "RATE_LIMITED" : "UNKNOWN",
      message: typeof err === "string" ? err : err?.message ?? "Ocurrió un error inesperado.",
      status: response.status,
    },
  };
}

export function createCatalogClient(accessToken: string) {
  return {
    listProducts(params: ProductListParams): Promise<CatalogResult<ProductPage>> {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.categoryId) qs.set("categoryId", params.categoryId);
      if (params.status) qs.set("status", params.status);
      if (params.page) qs.set("page", String(params.page));
      if (params.pageSize) qs.set("pageSize", String(params.pageSize));
      return call(accessToken, `/productos?${qs.toString()}`);
    },

    getProduct(id: string): Promise<CatalogResult<{ product: CatalogProductDetail }>> {
      return call(accessToken, `/productos/${encodeURIComponent(id)}`);
    },

    createProduct(draft: ProductDraft): Promise<CatalogResult<{ product: CatalogProduct }>> {
      return call(accessToken, "/productos", { method: "POST", body: JSON.stringify(draft) });
    },

    updateProduct(id: string, patch: ProductPatch): Promise<CatalogResult<{ product: CatalogProduct }>> {
      return call(accessToken, `/productos/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    },

    listCategories(): Promise<CatalogResult<{ categories: CatalogCategory[] }>> {
      return call(accessToken, "/categorias");
    },

    /** Pedidos abiertos con su stock apartado (Bloque 19). */
    listOrders(): Promise<CatalogResult<{ pedidos: PedidoPanel[] }>> {
      return call(accessToken, "/pedidos");
    },

    /** Venta cerrada (completar) o cancelar (el stock vuelve). Idempotente. */
    closeOrder(pedido: string, accion: "completar" | "cancelar"): Promise<CatalogResult<{ pedido: PedidoPanel; repetido: boolean }>> {
      return call(accessToken, `/pedidos/${encodeURIComponent(pedido)}`, { method: "POST", body: JSON.stringify({ accion }) });
    },

    createCategory(name: string): Promise<CatalogResult<{ category: CatalogCategory }>> {
      return call(accessToken, "/categorias", { method: "POST", body: JSON.stringify({ name }) });
    },

    /** Links públicos (detal y, para admin, mayor). Para un admin los crea la primera vez. */
    getPublication(): Promise<CatalogResult<{ publication: PublicationView | null }>> {
      return call(accessToken, "/publicacion");
    },

    /** Regenera el link mayorista (el anterior deja de funcionar). Solo admin. */
    rotateWholesaleLink(): Promise<CatalogResult<{ publication: PublicationView }>> {
      return call(accessToken, "/publicacion/rotar-mayor", { method: "POST" });
    },

    deleteImage(mediaId: string): Promise<CatalogResult<{ deleted: true }>> {
      return call(accessToken, `/imagenes/${encodeURIComponent(mediaId)}`, { method: "DELETE" });
    },

    async uploadImage(
      productId: string,
      file: File,
      opts: { makePrimary?: boolean; onStage?: (stage: UploadStage) => void } = {},
    ): Promise<CatalogResult<{ image: CatalogImage }>> {
      opts.onStage?.("preparing");
      let prepared;
      try {
        prepared = await prepareProductImage(file);
      } catch (err) {
        const message = err instanceof ImagePreparationError ? err.message : "No pudimos procesar esta imagen.";
        return { ok: false, error: { code: "IMAGE_INVALID", message, status: 0 } };
      }

      opts.onStage?.("uploading");
      const ticket = await call<{ upload: UploadTicket }>(accessToken, `/productos/${encodeURIComponent(productId)}/imagenes/upload-url`, {
        method: "POST",
        body: JSON.stringify({ mimeType: prepared.mimeType, bytes: prepared.image.size, thumbBytes: prepared.thumb.size, detailBytes: prepared.detail.size }),
      });
      if (!ticket.ok) return ticket;
      const { upload } = ticket.data;

      const subida = await uploadPrepared(upload, prepared);
      if (!subida.ok) return subida;

      opts.onStage?.("confirming");
      return call(accessToken, `/productos/${encodeURIComponent(productId)}/imagenes`, {
        method: "POST",
        body: JSON.stringify({
          uploadId: upload.uploadId,
          mimeType: prepared.mimeType,
          width: prepared.width,
          height: prepared.height,
          makePrimary: opts.makePrimary ?? false,
        }),
      });
    },

    // ------------------------------------------------------------------
    // Carga masiva
    // ------------------------------------------------------------------

    /** Preview a partir de la planilla (el servidor la lee). Las fotos NO viajan: solo `images` (metadatos). */
    async analyzeImportFile(
      file: File,
      extras: { images: ImageInfo[]; decisions: Record<string, CategoryDecision> },
    ): Promise<CatalogResult<{ file: { name: string; sheet: string | null }; rows: RawRow[]; analysis: ImportAnalysis }>> {
      const form = new FormData();
      form.set("archivo", file);
      form.set("extras", JSON.stringify(extras));
      // Sin Content-Type explícito: el navegador pone multipart/form-data con su boundary.
      return call(accessToken, "/importaciones/analizar", { method: "POST", body: form });
    },

    analyzeImportRows(body: { rows: RawRow[]; images: ImageInfo[]; decisions: Record<string, CategoryDecision>; force: number[]; attach?: number[] }): Promise<CatalogResult<{ analysis: ImportAnalysis }>> {
      return call(accessToken, "/importaciones/analizar", { method: "POST", body: JSON.stringify(body) });
    },

    startImport(fileName: string, totalRows: number): Promise<CatalogResult<{ import: ImportRecord }>> {
      return call(accessToken, "/importaciones", { method: "POST", body: JSON.stringify({ fileName, totalRows }) });
    },

    importRows(
      importId: string,
      body: { rows: RawRow[]; images: ImageInfo[]; decisions: Record<string, CategoryDecision>; force: number[]; attach?: number[] },
    ): Promise<CatalogResult<{ results: ImportRowResult[] }>> {
      return call(accessToken, `/importaciones/${encodeURIComponent(importId)}/filas`, { method: "POST", body: JSON.stringify(body) });
    },

    importPhotoUrls(
      importId: string,
      items: Array<{ productId: string; mimeType: PreparedImage["mimeType"]; bytes: number; thumbBytes: number; detailBytes?: number }>,
    ): Promise<CatalogResult<{ results: Array<{ productId: string; ok: true; upload: UploadTicket } | { productId: string; ok: false; message: string }> }>> {
      return call(accessToken, `/importaciones/${encodeURIComponent(importId)}/fotos/urls`, { method: "POST", body: JSON.stringify({ items }) });
    },

    confirmImportPhotos(
      importId: string,
      items: Array<{ productId: string; uploadId: string; mimeType: PreparedImage["mimeType"]; width: number; height: number; makePrimary: boolean }>,
    ): Promise<CatalogResult<{ results: Array<{ productId: string; uploadId: string; ok: boolean; message?: string }> }>> {
      return call(accessToken, `/importaciones/${encodeURIComponent(importId)}/fotos/confirmar`, { method: "POST", body: JSON.stringify({ items }) });
    },

    finishImport(importId: string, counts: { skipped: number; errors: number; photosUploaded: number; photosFailed: number }): Promise<CatalogResult<{ import: ImportRecord }>> {
      return call(accessToken, `/importaciones/${encodeURIComponent(importId)}/finalizar`, { method: "POST", body: JSON.stringify(counts) });
    },

    /** `available: false` = la carga masiva aún no está activada en la BD (el análisis sí funciona). */
    listImports(): Promise<CatalogResult<{ available: boolean; imports: ImportHistoryItem[] }>> {
      return call(accessToken, "/importaciones");
    },

    /** Descarga la plantilla (XLSX con las categorías reales del catálogo, o CSV). */
    async downloadTemplate(format: "xlsx" | "csv"): Promise<CatalogResult<{ blob: Blob; fileName: string }>> {
      try {
        const res = await fetch(`${BASE}/importaciones/plantilla?formato=${format}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) return { ok: false, error: { code: "UNKNOWN", message: "No pudimos descargar la plantilla. Intenta de nuevo.", status: res.status } };
        return { ok: true, data: { blob: await res.blob(), fileName: `plantilla-productos.${format}` } };
      } catch {
        return { ok: false, error: { code: "NETWORK_ERROR", message: "Sin conexión. Revisa tu internet e intenta de nuevo.", status: 0 } };
      }
    },
  };
}

/** Sube imagen + miniatura YA preparadas DIRECTO a Storage con URLs firmadas (nunca pasan por Vercel). */
export async function uploadPrepared(upload: UploadTicket, prepared: PreparedImage): Promise<CatalogResult<null>> {
  const storage = supabaseBrowser().storage.from(upload.bucket);
  const [img, thumb, detail] = await Promise.all([
    storage.uploadToSignedUrl(upload.image.path, upload.image.token, prepared.image, { contentType: prepared.mimeType }),
    storage.uploadToSignedUrl(upload.thumb.path, upload.thumb.token, prepared.thumb, { contentType: prepared.mimeType }),
    upload.detail ? storage.uploadToSignedUrl(upload.detail.path, upload.detail.token, prepared.detail, { contentType: prepared.mimeType }) : Promise.resolve({ error: null }),
  ]);
  // La variante de detalle es opcional: si falla, la tienda usa la principal.
  if (detail.error) console.warn("[catalogo] no se pudo subir la variante de detalle; se usará la principal.");
  if (img.error || thumb.error) {
    return { ok: false, error: { code: "UPLOAD_FAILED", message: "No se pudo subir la foto. Revisa tu conexión e intenta de nuevo.", status: 0 } };
  }
  return { ok: true, data: null };
}

export type CatalogClient = ReturnType<typeof createCatalogClient>;
