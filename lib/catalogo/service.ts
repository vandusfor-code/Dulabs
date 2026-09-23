/**
 * Catálogo DuLabs — SERVICE (casos de uso).
 *
 * Orquesta dominio + repositorio. No conoce HTTP ni Supabase: recibe un
 * CatalogRepository (inyectable, así se prueba sin base de datos) y un actor
 * ya autenticado cuyo tenantId salió de la sesión (lib/catalogo/auth.ts).
 *
 * Es la superficie que en una fase futura consumirán también las
 * herramientas del agente (search_products): el agente leerá productos,
 * precios e imágenes REALES de aquí, nunca de un prompt ni de un HTML.
 */
import { randomUUID } from "node:crypto";
import {
  CATALOG_LIMITS,
  imageStoragePaths,
  normalizeSearch,
  sniffImageMime,
  type CatalogCategory,
  type CatalogImage,
  type CatalogProduct,
  type CatalogProductDetail,
  type CategoryCreateInput,
  type ImageConfirmInput,
  type ImageMimeType,
  type ImageUploadRequest,
  type ProductCreateInput,
  type ProductListQuery,
  type ProductPage,
  type ProductUpdateInput,
} from "@/lib/catalogo/domain";
import { CatalogError } from "@/lib/catalogo/errors";
import type { CatalogRepository, ProductPatchData, StoredMedia } from "@/lib/catalogo/repository";

/** Quién ejecuta la operación. tenantId SIEMPRE proviene de la membresía autenticada. */
export interface CatalogActor {
  tenantId: string;
  userId: string;
}

export interface ImageUploadTicket {
  uploadId: string;
  bucket: string;
  mimeType: ImageMimeType;
  image: { path: string; token: string };
  thumb: { path: string; token: string };
}

export interface CatalogServiceDeps {
  repo: CatalogRepository;
  newId?: () => string;
}

const HEAD_BYTES = 16;

export function createCatalogService({ repo, newId = randomUUID }: CatalogServiceDeps) {
  async function requireProduct(actor: CatalogActor, productId: string): Promise<CatalogProduct> {
    const product = await repo.getProduct(actor.tenantId, productId);
    if (!product) throw new CatalogError("NOT_FOUND", "El producto no existe.");
    return product;
  }

  /** Resuelve la categoría DENTRO del tenant (el id del frontend nunca se usa sin verificarlo). */
  async function resolveCategory(actor: CatalogActor, categoryId: string | null): Promise<{ categoryId: string | null; categoryName: string | null }> {
    if (categoryId === null) return { categoryId: null, categoryName: null };
    const category = await repo.getCategory(actor.tenantId, categoryId);
    if (!category) throw new CatalogError("VALIDATION_ERROR", "La categoría no existe.");
    return { categoryId: category.id, categoryName: category.name };
  }

  function toImage(media: StoredMedia): CatalogImage {
    const url = repo.publicUrl(media.storagePath);
    return {
      id: media.id,
      url,
      thumbUrl: media.thumbPath ? repo.publicUrl(media.thumbPath) : url,
      isPrimary: media.isPrimary,
      order: media.order,
      mimeType: media.mimeType,
      bytes: media.bytes,
      width: media.width,
      height: media.height,
    };
  }

  function withPrimary(product: CatalogProduct, primary: StoredMedia | undefined): CatalogProduct {
    if (!primary) return product;
    const image = toImage(primary);
    return { ...product, primaryImage: { url: image.url, thumbUrl: image.thumbUrl } };
  }

  async function hydrate(actor: CatalogActor, product: CatalogProduct): Promise<CatalogProduct> {
    const [primary] = await repo.listPrimaryMedia(actor.tenantId, [product.id]);
    return withPrimary(product, primary);
  }

  async function discardUpload(paths: string[]): Promise<void> {
    await repo.removeObjects(paths);
  }

  return {
    async listProducts(actor: CatalogActor, query: ProductListQuery): Promise<ProductPage> {
      const { items, total } = await repo.listProducts(actor.tenantId, {
        search: normalizeSearch(query.q),
        categoryId: query.categoryId,
        status: query.status,
        offset: (query.page - 1) * query.pageSize,
        limit: query.pageSize,
      });
      // Una sola consulta extra por página para las miniaturas (nunca N+1).
      const primaries = await repo.listPrimaryMedia(
        actor.tenantId,
        items.map((p) => p.id),
      );
      const byProduct = new Map(primaries.map((m) => [m.productId, m]));
      return {
        items: items.map((p) => withPrimary(p, byProduct.get(p.id))),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async getProduct(actor: CatalogActor, productId: string): Promise<CatalogProductDetail> {
      const product = await requireProduct(actor, productId);
      const media = await repo.listMedia(actor.tenantId, productId);
      const images = media.map(toImage);
      return { ...withPrimary(product, media.find((m) => m.isPrimary)), images };
    },

    async createProduct(actor: CatalogActor, input: ProductCreateInput): Promise<CatalogProduct> {
      const category = await resolveCategory(actor, input.categoryId ?? null);
      // La referencia la asigna la BD (trigger, segura ante concurrencia):
      // el input ni siquiera tiene un campo para ella.
      return repo.insertProduct(actor.tenantId, actor.userId, {
        name: input.name,
        description: input.description ?? null,
        categoryId: category.categoryId,
        categoryName: category.categoryName,
        material: input.material ?? null,
        color: input.color ?? null,
        retailPrice: input.retailPrice,
        wholesalePrice: input.wholesalePrice ?? null,
      });
    },

    async updateProduct(actor: CatalogActor, productId: string, input: ProductUpdateInput): Promise<CatalogProduct> {
      await requireProduct(actor, productId);
      const patch: ProductPatchData = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description;
      if (input.material !== undefined) patch.material = input.material;
      if (input.color !== undefined) patch.color = input.color;
      if (input.retailPrice !== undefined) patch.retailPrice = input.retailPrice;
      if (input.wholesalePrice !== undefined) patch.wholesalePrice = input.wholesalePrice;
      if (input.status !== undefined) patch.status = input.status;
      if (input.categoryId !== undefined) {
        const category = await resolveCategory(actor, input.categoryId);
        patch.categoryId = category.categoryId;
        patch.categoryName = category.categoryName;
      }
      const updated = await repo.updateProduct(actor.tenantId, actor.userId, productId, patch);
      if (!updated) throw new CatalogError("NOT_FOUND", "El producto no existe.");
      return hydrate(actor, updated);
    },

    async listCategories(actor: CatalogActor): Promise<CatalogCategory[]> {
      return repo.listCategories(actor.tenantId);
    },

    async createCategory(actor: CatalogActor, input: CategoryCreateInput): Promise<CatalogCategory> {
      try {
        return await repo.insertCategory(actor.tenantId, actor.userId, input.name);
      } catch (err) {
        if (err instanceof CatalogError && err.code === "CONFLICT") {
          throw new CatalogError("CONFLICT", "Ya existe una categoría con ese nombre.");
        }
        throw err;
      }
    },

    /**
     * Emite URLs firmadas de subida (imagen + miniatura) para que el navegador
     * suba DIRECTO a Storage (sin pasar la foto por una función de Vercel).
     * La ruta la decide el servidor: {tenant}/{producto}/{uploadId}.{ext}.
     */
    async requestImageUpload(actor: CatalogActor, productId: string, request: ImageUploadRequest): Promise<ImageUploadTicket> {
      await requireProduct(actor, productId);
      if ((await repo.countMedia(actor.tenantId, productId)) >= CATALOG_LIMITS.imagesPerProduct) {
        throw new CatalogError("LIMIT_REACHED", `Un producto admite máximo ${CATALOG_LIMITS.imagesPerProduct} imágenes.`);
      }
      const uploadId = newId();
      const { path, thumbPath } = imageStoragePaths(actor.tenantId, productId, uploadId, request.mimeType);
      const [image, thumb] = await Promise.all([repo.createSignedUpload(path), repo.createSignedUpload(thumbPath)]);
      return {
        uploadId,
        bucket: repo.bucket,
        mimeType: request.mimeType,
        image: { path: image.path, token: image.token },
        thumb: { path: thumb.path, token: thumb.token },
      };
    },

    /**
     * Confirma una imagen ya subida. Nunca confía en el cliente: recalcula la
     * ruta desde (tenant, producto, uploadId), y verifica que el objeto
     * exista, su tamaño, su content-type y su FIRMA real (magic bytes) antes
     * de registrarla. Si algo no cuadra, borra lo subido y rechaza.
     */
    async confirmImage(actor: CatalogActor, productId: string, input: ImageConfirmInput): Promise<CatalogImage> {
      await requireProduct(actor, productId);
      const { path, thumbPath } = imageStoragePaths(actor.tenantId, productId, input.uploadId, input.mimeType);

      const [info, thumbInfo] = await Promise.all([repo.objectInfo(path), repo.objectInfo(thumbPath)]);
      if (!info) throw new CatalogError("IMAGE_INVALID", "No encontramos la imagen subida. Intenta subirla de nuevo.");

      const rechazar = async (message: string): Promise<never> => {
        await discardUpload(thumbInfo ? [path, thumbPath] : [path]);
        throw new CatalogError("IMAGE_INVALID", message);
      };

      if (info.size !== null && info.size > CATALOG_LIMITS.imageBytes) await rechazar("La imagen supera el tamaño máximo permitido.");
      if (info.contentType && info.contentType !== input.mimeType) await rechazar("El formato de la imagen no coincide con el declarado.");
      if (thumbInfo && thumbInfo.size !== null && thumbInfo.size > CATALOG_LIMITS.thumbBytes) await rechazar("La miniatura supera el tamaño máximo permitido.");

      const [head, thumbHead] = await Promise.all([
        repo.readObjectHead(path, HEAD_BYTES),
        thumbInfo ? repo.readObjectHead(thumbPath, HEAD_BYTES) : Promise.resolve(null),
      ]);
      if (!head) throw new CatalogError("INTERNAL_ERROR", "No se pudo verificar la imagen. Intenta de nuevo.");
      if (sniffImageMime(head) !== input.mimeType) await rechazar("El archivo no es una imagen válida.");
      if (thumbInfo && thumbHead && sniffImageMime(thumbHead) !== input.mimeType) await rechazar("La miniatura no es una imagen válida.");

      if ((await repo.countMedia(actor.tenantId, productId)) >= CATALOG_LIMITS.imagesPerProduct) {
        await rechazar(`Un producto admite máximo ${CATALOG_LIMITS.imagesPerProduct} imágenes.`);
      }

      try {
        const media = await repo.attachMedia(actor.tenantId, actor.userId, {
          productId,
          storagePath: path,
          thumbPath: thumbInfo ? thumbPath : null,
          mimeType: input.mimeType,
          bytes: info.size,
          width: input.width,
          height: input.height,
          makePrimary: input.makePrimary,
        });
        return toImage(media);
      } catch (err) {
        // Doble clic / reintento de la MISMA subida: idempotente, devuelve la ya registrada.
        if (err instanceof CatalogError && err.code === "CONFLICT") {
          const existing = (await repo.listMedia(actor.tenantId, productId)).find((m) => m.storagePath === path);
          if (existing) return toImage(existing);
        }
        throw err;
      }
    },

    async deleteImage(actor: CatalogActor, mediaId: string): Promise<{ deleted: true }> {
      const removed = await repo.deleteMedia(actor.tenantId, actor.userId, mediaId);
      if (!removed) throw new CatalogError("NOT_FOUND", "La imagen no existe.");
      await discardUpload([removed.storagePath, ...(removed.thumbPath ? [removed.thumbPath] : [])]);
      return { deleted: true };
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
