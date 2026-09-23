/**
 * Cliente del navegador para /api/dashboard/catalogo/* (mismo patrón que
 * lib/business-agent-client.ts: resultados tipados, nunca lanza por HTTP).
 *
 * uploadImage() orquesta la subida en 4 etapas sin pasar la foto por Vercel:
 *   preparar (comprimir en el navegador) -> pedir URL firmada -> subir DIRECTO
 *   a Storage (imagen + miniatura) -> confirmar (el servidor verifica todo).
 */
import type { CatalogCategory, CatalogImage, CatalogProduct, CatalogProductDetail, ProductPage, ProductStatus, StatusFilter } from "@/lib/catalogo/domain";
import { prepareProductImage, ImagePreparationError } from "@/lib/catalogo/image-processing";
import { supabaseBrowser } from "@/lib/supabase-browser";

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

interface UploadTicket {
  uploadId: string;
  bucket: string;
  mimeType: "image/webp" | "image/jpeg";
  image: { path: string; token: string };
  thumb: { path: string; token: string };
}

const BASE = "/api/dashboard/catalogo";

async function call<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<CatalogResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
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

    createCategory(name: string): Promise<CatalogResult<{ category: CatalogCategory }>> {
      return call(accessToken, "/categorias", { method: "POST", body: JSON.stringify({ name }) });
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
        body: JSON.stringify({ mimeType: prepared.mimeType, bytes: prepared.image.size, thumbBytes: prepared.thumb.size }),
      });
      if (!ticket.ok) return ticket;
      const { upload } = ticket.data;

      const storage = supabaseBrowser().storage.from(upload.bucket);
      const [img, thumb] = await Promise.all([
        storage.uploadToSignedUrl(upload.image.path, upload.image.token, prepared.image, { contentType: prepared.mimeType }),
        storage.uploadToSignedUrl(upload.thumb.path, upload.thumb.token, prepared.thumb, { contentType: prepared.mimeType }),
      ]);
      if (img.error || thumb.error) {
        return { ok: false, error: { code: "UPLOAD_FAILED", message: "No se pudo subir la foto. Revisa tu conexión e intenta de nuevo.", status: 0 } };
      }

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
  };
}

export type CatalogClient = ReturnType<typeof createCatalogClient>;
