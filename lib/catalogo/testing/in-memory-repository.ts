/**
 * CatalogRepository EN MEMORIA para tests (mismo patrón que
 * lib/agent-compiler/registry/testing/in-memory-registry-store.ts). Emula las
 * reglas que en producción garantiza la BD: aislamiento por tenant,
 * referencia secuencial por tenant asignada al insertar (nunca por el
 * caller), una sola imagen principal con promoción al borrar, y objetos de
 * Storage con tamaño/content-type/primeros bytes. Nunca toca la red.
 */
import { randomUUID } from "node:crypto";
import { formatReference, type CatalogCategory, type CatalogProduct } from "@/lib/catalogo/domain";
import { CatalogError } from "@/lib/catalogo/errors";
import type { AttachMediaData, CatalogRepository, ProductListFilter, ProductPatchData, ProductWriteData, StoredMedia } from "@/lib/catalogo/repository";

interface StoredProduct extends CatalogProduct {
  tenantId: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface StoredObject {
  size: number;
  contentType: string;
  head: Uint8Array;
}

export const WEBP_HEAD = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
export const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);

export function createInMemoryCatalogRepository() {
  const products = new Map<string, StoredProduct>();
  const categories = new Map<string, CatalogCategory & { tenantId: string }>();
  const media = new Map<string, StoredMedia & { tenantId: string }>();
  const sequences = new Map<string, number>();
  const objects = new Map<string, StoredObject>();
  const removed: string[] = [];
  const signedPaths: string[] = [];
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 8, 22, 12, 0, clock++)).toISOString();

  const publicUrl = (path: string) => `https://storage.test/inventario-productos/${path}`;

  const repo: CatalogRepository = {
    bucket: "inventario-productos",

    async listProducts(tenantId: string, f: ProductListFilter) {
      let items = [...products.values()].filter((p) => p.tenantId === tenantId);
      if (f.status !== "ALL") items = items.filter((p) => p.status === f.status);
      if (f.categoryId) items = items.filter((p) => p.categoryId === f.categoryId);
      if (f.search) {
        const q = f.search.toLowerCase();
        items = items.filter((p) => p.name.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q));
      }
      items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return { items: items.slice(f.offset, f.offset + f.limit).map(strip), total: items.length };
    },

    async getProduct(tenantId, id) {
      const p = products.get(id);
      return p && p.tenantId === tenantId ? strip(p) : null;
    },

    async insertProduct(tenantId, actorId, d: ProductWriteData) {
      // Igual que el trigger de la BD: la referencia se asigna aquí, siempre.
      const n = (sequences.get(tenantId) ?? 0) + 1;
      sequences.set(tenantId, n);
      const ts = now();
      const p: StoredProduct = {
        id: randomUUID(),
        tenantId,
        reference: formatReference("DL", n),
        name: d.name,
        description: d.description,
        categoryId: d.categoryId,
        categoryName: d.categoryName,
        material: d.material,
        color: d.color,
        pricing: { retail: d.retailPrice, wholesale: d.wholesalePrice },
        status: "ACTIVE",
        tracksStock: false,
        primaryImage: null,
        createdAt: ts,
        updatedAt: ts,
        createdBy: actorId,
        updatedBy: actorId,
      };
      products.set(p.id, p);
      return strip(p);
    },

    async updateProduct(tenantId, actorId, id, patch: ProductPatchData) {
      const p = products.get(id);
      if (!p || p.tenantId !== tenantId) return null;
      if (patch.name !== undefined) p.name = patch.name;
      if (patch.description !== undefined) p.description = patch.description;
      if (patch.categoryId !== undefined) {
        p.categoryId = patch.categoryId;
        p.categoryName = patch.categoryName ?? null;
      }
      if (patch.material !== undefined) p.material = patch.material;
      if (patch.color !== undefined) p.color = patch.color;
      if (patch.retailPrice !== undefined) p.pricing = { ...p.pricing, retail: patch.retailPrice };
      if (patch.wholesalePrice !== undefined) p.pricing = { ...p.pricing, wholesale: patch.wholesalePrice };
      if (patch.status !== undefined) p.status = patch.status;
      p.updatedAt = now();
      p.updatedBy = actorId;
      return strip(p);
    },

    async listCategories(tenantId) {
      return [...categories.values()].filter((c) => c.tenantId === tenantId).map(({ id, name }) => ({ id, name }));
    },

    async getCategory(tenantId, id) {
      const c = categories.get(id);
      return c && c.tenantId === tenantId ? { id: c.id, name: c.name } : null;
    },

    async insertCategory(tenantId, _actorId, name) {
      const dup = [...categories.values()].some((c) => c.tenantId === tenantId && c.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (dup) throw new CatalogError("CONFLICT", "Ya existe un registro con esos datos.");
      const c = { id: randomUUID(), tenantId, name };
      categories.set(c.id, c);
      return { id: c.id, name: c.name };
    },

    async listMedia(tenantId, productId) {
      return [...media.values()]
        .filter((m) => m.tenantId === tenantId && m.productId === productId)
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.order - b.order)
        .map(stripMedia);
    },

    async listPrimaryMedia(tenantId, productIds) {
      return [...media.values()].filter((m) => m.tenantId === tenantId && m.isPrimary && productIds.includes(m.productId)).map(stripMedia);
    },

    async countMedia(tenantId, productId) {
      return [...media.values()].filter((m) => m.tenantId === tenantId && m.productId === productId).length;
    },

    async attachMedia(tenantId, actorId, d: AttachMediaData) {
      const p = products.get(d.productId);
      if (!p || p.tenantId !== tenantId) throw new CatalogError("NOT_FOUND", "No se encontró el recurso.");
      // Igual que el CHECK de la BD: la ruta vive bajo el tenant/producto dueños.
      if (!d.storagePath.startsWith(`${tenantId}/${d.productId}/`)) throw new CatalogError("VALIDATION_ERROR", "Algún dato no cumple las reglas del catálogo.");
      if ([...media.values()].some((m) => m.storagePath === d.storagePath)) throw new CatalogError("CONFLICT", "Ya existe un registro con esos datos.");
      const propias = [...media.values()].filter((m) => m.tenantId === tenantId && m.productId === d.productId);
      const principal = d.makePrimary || !propias.some((m) => m.isPrimary);
      if (principal) propias.forEach((m) => (m.isPrimary = false));
      const m = {
        id: randomUUID(),
        tenantId,
        productId: d.productId,
        storagePath: d.storagePath,
        thumbPath: d.thumbPath,
        isPrimary: principal,
        order: propias.length === 0 ? 0 : Math.max(...propias.map((x) => x.order)) + 1,
        mimeType: d.mimeType,
        bytes: d.bytes,
        width: d.width,
        height: d.height,
      };
      media.set(m.id, m);
      if (principal) {
        p.primaryImage = { url: publicUrl(d.storagePath), thumbUrl: publicUrl(d.storagePath) };
        p.updatedBy = actorId;
      }
      return stripMedia(m);
    },

    async deleteMedia(tenantId, _actorId, mediaId) {
      const m = media.get(mediaId);
      if (!m || m.tenantId !== tenantId) return null;
      media.delete(mediaId);
      if (m.isPrimary) {
        const siguiente = [...media.values()].filter((x) => x.tenantId === tenantId && x.productId === m.productId).sort((a, b) => a.order - b.order)[0];
        if (siguiente) siguiente.isPrimary = true;
        const p = products.get(m.productId);
        if (p) p.primaryImage = siguiente ? { url: publicUrl(siguiente.storagePath), thumbUrl: publicUrl(siguiente.storagePath) } : null;
      }
      return stripMedia(m);
    },

    async createSignedUpload(path) {
      signedPaths.push(path);
      return { path, token: `token-${path}`, signedUrl: `https://storage.test/upload/${path}?token=x` };
    },

    async objectInfo(path) {
      const o = objects.get(path);
      return o ? { size: o.size, contentType: o.contentType } : null;
    },

    async readObjectHead(path, bytes) {
      const o = objects.get(path);
      return o ? o.head.slice(0, bytes) : null;
    },

    async removeObjects(paths) {
      for (const p of paths) {
        objects.delete(p);
        removed.push(p);
      }
    },

    publicUrl,
  };

  function strip(p: StoredProduct): CatalogProduct {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tenantId, createdBy, updatedBy, ...rest } = p;
    return { ...rest, pricing: { ...rest.pricing } };
  }

  function stripMedia(m: StoredMedia & { tenantId: string }): StoredMedia {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tenantId, ...rest } = m;
    return rest;
  }

  return {
    repo,
    /** Simula lo que el navegador sube directo a Storage. */
    putObject(path: string, obj: StoredObject) {
      objects.set(path, obj);
    },
    hasObject: (path: string) => objects.has(path),
    removed,
    signedPaths,
    auditTrail: (id: string) => products.get(id),
  };
}
