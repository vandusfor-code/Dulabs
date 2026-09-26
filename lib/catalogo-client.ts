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
import type { PedidoHistorial, PedidoPanel } from "@/lib/catalogo/pedidos/panel";
import type { AccionPedido, EstadoVisible, HistorialEntrada, PedidoGestion } from "@/lib/catalogo/pedidos/gestion";

/** Bloque 27 — filtros del listado del módulo "Pedidos" (todos opcionales). */
export interface PedidosFiltros {
  estado?: EstadoVisible | "todos";
  pago?: "pendiente" | "recibido";
  modalidad?: "detal" | "mayorista";
  metodo?: "pago_en_tienda" | "transferencia";
  entrega?: "tienda" | "domicilio";
  desde?: string;
  hasta?: string;
  q?: string;
}

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
/** Bloque 27: módulo "Pedidos" (su propia API; exige el módulo "pedidos"). */
const PEDIDOS_BASE = "/api/dashboard/pedidos";

async function call<T>(accessToken: string, path: string, init: RequestInit = {}, base: string = BASE): Promise<CatalogResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
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

    /** Historial de pedidos cerrados, por cursor (Bloque 21). `cursor` = `siguiente` de la página anterior. */
    listOrderHistory(params: { estado?: "completed" | "cancelled" | "expired" | "rejected"; cursor?: string | null; limite?: number } = {}): Promise<CatalogResult<{ pedidos: PedidoHistorial[]; siguiente: string | null }>> {
      const qs = new URLSearchParams();
      if (params.estado) qs.set("estado", params.estado);
      if (params.cursor) qs.set("cursor", params.cursor);
      if (params.limite) qs.set("limite", String(params.limite));
      const q = qs.toString();
      return call(accessToken, `/pedidos/historial${q ? `?${q}` : ""}`);
    },

    /** Venta cerrada (completar) o cancelar (el stock vuelve). Idempotente. */
    closeOrder(pedido: string, accion: "completar" | "cancelar"): Promise<CatalogResult<{ pedido: PedidoPanel; repetido: boolean }>> {
      return call(accessToken, `/pedidos/${encodeURIComponent(pedido)}`, { method: "POST", body: JSON.stringify({ accion }) });
    },

    /**
     * Bloque 25 — la asesora cambia la modalidad (detal / por mayor) de un cliente. `canalActual` es la
     * que ve en pantalla: si cambió mientras tanto, el backend responde CONFLICT y no toca nada.
     */
    changeCustomerChannel(input: { numero: string; telefono: string; canal: "retail" | "wholesale"; canalActual: "retail" | "wholesale" | null; motivo: string }): Promise<CatalogResult<{ resultado: "cambiado" | "sin_cambio"; canal: "retail" | "wholesale" }>> {
      return call(accessToken, "/clientes/canal", {
        method: "POST",
        body: JSON.stringify({ numero: input.numero, telefono: input.telefono, canal: input.canal, canal_actual: input.canalActual, motivo: input.motivo }),
      });
    },

    /** Bloque 25 — "Tomar conversación": la MISMA acción del Inbox (pausa la IA en ese chat y se la asigna a quien la toma). */
    async takeConversation(numero: string, telefono: string): Promise<CatalogResult<{ tomada: true }>> {
      try {
        const r = await fetch("/api/dashboard/conversaciones/handoff", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ phone_number_id: numero, telefono_cliente: telefono, accion: "tomar" }),
        });
        const body = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
        return r.ok && body.success ? { ok: true, data: { tomada: true } } : { ok: false, error: { code: "UNKNOWN", message: body.error ?? "No se pudo tomar la conversación.", status: r.status } };
      } catch {
        return { ok: false, error: { code: "NETWORK_ERROR", message: "Sin conexión. Revisa tu internet e intenta de nuevo.", status: 0 } };
      }
    },

    /** Bloque 27 — módulo "Pedidos": pedidos confirmados con filtros y cursor. */
    listManagedOrders(filtros: PedidosFiltros, cursor: string | null = null): Promise<CatalogResult<{ pedidos: PedidoGestion[]; siguiente: string | null }>> {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filtros)) if (typeof v === "string" && v.trim()) qs.set(k, v.trim());
      if (cursor) qs.set("cursor", cursor);
      const q = qs.toString();
      return call(accessToken, q ? `?${q}` : "", {}, PEDIDOS_BASE);
    },

    /** Bloque 27 — detalle de un pedido con su historial. */
    getManagedOrder(pedido: string): Promise<CatalogResult<{ pedido: PedidoGestion; historial: HistorialEntrada[] }>> {
      return call(accessToken, `/${encodeURIComponent(pedido)}`, {}, PEDIDOS_BASE);
    },

    /** Bloque 27 — acción de la operación sobre lo que la persona VIO (`esperado`); motivo para cancelar/rechazar. */
    actOnOrder(pedido: string, input: { accion: AccionPedido; esperado: PedidoGestion["version"]; motivo?: string }): Promise<CatalogResult<{ pedido: PedidoGestion; repetido: boolean }>> {
      return call(accessToken, `/${encodeURIComponent(pedido)}`, { method: "POST", body: JSON.stringify(input) }, PEDIDOS_BASE);
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

    /** Bloque 29: la foto en JPEG con la referencia estampada (módulo "marca_referencia"), para descargarla. */
    async downloadMarkedImage(productId: string, mediaId: string): Promise<CatalogResult<Blob>> {
      try {
        const r = await fetch(`${BASE}/productos/${encodeURIComponent(productId)}/imagenes/${encodeURIComponent(mediaId)}/marcada`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (r.ok) return { ok: true, data: await r.blob() };
        const body = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
        return { ok: false, error: { code: body.error?.code ?? "INTERNAL_ERROR", message: body.error?.message ?? "No se pudo descargar la foto.", status: r.status } };
      } catch {
        return { ok: false, error: { code: "NETWORK_ERROR", message: "Sin conexión. Revisa tu internet e intenta de nuevo.", status: 0 } };
      }
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
