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
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
  type PriceContext,
} from "@/lib/catalogo/domain";
import { CatalogError } from "@/lib/catalogo/errors";
import type { CatalogRepository, ProductPatchData, PublicImageObject, StoredMedia } from "@/lib/catalogo/repository";
import {
  PUBLIC_PAGE_SIZE,
  isValidSlug,
  productImagePath,
  referenceFromUrl,
  retailPath,
  slugCandidates,
  slugify,
  toPublicProduct,
  wholesalePath,
  type CatalogPublication,
  type PublicCatalogPage,
  type PublicCatalogProduct,
  type PublicImageFile,
  type PublicProductDetail,
  type PublicProductImages,
} from "@/lib/catalogo/publicacion";

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

/** Links públicos del catálogo, tal como los ve el dashboard. `wholesalePath` solo para administradores. */
export interface PublicationView {
  slug: string;
  publicName: string;
  published: boolean;
  retailPath: string;
  wholesalePath: string | null;
}

function publicationView(pub: CatalogPublication, includeWholesale: boolean): PublicationView {
  return {
    slug: pub.slug,
    publicName: pub.publicName,
    published: pub.published,
    retailPath: retailPath(pub.slug),
    wholesalePath: includeWholesale ? wholesalePath(pub.slug, pub.wholesaleToken) : null,
  };
}

/** Token nuevo del link mayorista: 32 bytes aleatorios (64 hex), mismo formato que exige la BD. */
export function newWholesaleToken(): string {
  return randomBytes(32).toString("hex");
}

export interface CatalogServiceDeps {
  repo: CatalogRepository;
  newId?: () => string;
}

const HEAD_BYTES = 16;

function imageFromMedia(repo: CatalogRepository, media: StoredMedia): CatalogImage {
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

function withPrimaryMedia(repo: CatalogRepository, product: CatalogProduct, primary: StoredMedia | undefined): CatalogProduct {
  if (!primary) return product;
  const image = imageFromMedia(repo, primary);
  return { ...product, primaryImage: { url: image.url, thumbUrl: image.thumbUrl } };
}

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

  const toImage = (media: StoredMedia) => imageFromMedia(repo, media);
  const withPrimary = (product: CatalogProduct, primary: StoredMedia | undefined) => withPrimaryMedia(repo, product, primary);

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

    /** Links públicos del catálogo. includeWholesale solo para administradores. */
    async getPublication(actor: CatalogActor, opts: { includeWholesale: boolean }): Promise<PublicationView | null> {
      const pub = await repo.getPublication(actor.tenantId);
      return pub ? publicationView(pub, opts.includeWholesale) : null;
    },

    /**
     * Crea la publicación si el negocio aún no tiene (idempotente). El slug se
     * deriva del nombre del negocio; si está tomado, prueba variantes y al
     * final un sufijo aleatorio. El token mayorista lo genera la BD.
     */
    async ensurePublication(actor: CatalogActor): Promise<PublicationView> {
      const existing = await repo.getPublication(actor.tenantId);
      if (existing) return publicationView(existing, true);
      const profile = await repo.getBusinessProfile(actor.tenantId);
      const name = profile.name?.trim() || "Catálogo";
      const candidates = [...slugCandidates(name), `${slugify(name).slice(0, 40).replace(/-+$/g, "")}-${randomBytes(3).toString("hex")}`];
      for (const slug of candidates) {
        try {
          return publicationView(await repo.insertPublication(actor.tenantId, slug, name.slice(0, 80)), true);
        } catch (err) {
          if (!(err instanceof CatalogError && err.code === "CONFLICT")) throw err;
          // Otra petición concurrente pudo crearla para este mismo negocio.
          const created = await repo.getPublication(actor.tenantId);
          if (created) return publicationView(created, true);
        }
      }
      throw new CatalogError("CONFLICT", "No se pudo crear el link del catálogo. Intenta de nuevo.");
    },

    /** Regenera el link mayorista: el anterior deja de funcionar de inmediato. */
    async rotateWholesaleToken(actor: CatalogActor): Promise<PublicationView> {
      const updated = await repo.updatePublicationToken(actor.tenantId, newWholesaleToken());
      if (!updated) throw new CatalogError("NOT_FOUND", "El catálogo todavía no tiene links.");
      return publicationView(updated, true);
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

// ---------------------------------------------------------------------------
// Catálogo PÚBLICO (HTML). Sin sesión: el negocio se resuelve por el slug del
// link y, para el contexto mayorista, por el token secreto. Ante CUALQUIER
// duda (slug inválido, no publicado, módulo apagado, token incorrecto)
// devuelve null => 404, sin revelar cuál de las condiciones falló.
// ---------------------------------------------------------------------------

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comparación en tiempo constante (no filtra por tiempo cuántos caracteres del token acertó un atacante). */
export function tokensMatch(received: string | undefined, expected: string): boolean {
  if (!received || !TOKEN_PATTERN.test(received) || !TOKEN_PATTERN.test(expected)) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export interface PublicCatalogQuery {
  slug: string;
  context: PriceContext;
  token?: string;
  q?: string;
  categoryId?: string;
  page?: number;
}

export interface PublicImageQuery {
  slug: string;
  /** Tal como llega en la URL ("dl-000184"). */
  reference: string;
  file: PublicImageFile;
}

/** Máximo de productos destacados en el inicio. */
export const FEATURED_LIMIT = 8;
/** Máximo de referencias por resolución de selección (= tope de líneas del carrito). */
export const SELECTION_MAX = 60;
/** Productos recientes con foto que se revisan para elegir la portada de cada categoría. */
const COVER_POOL = 200;

/**
 * Política con la que se eligen los destacados. HOY no existe un campo
 * explícito: se usan los productos activos más recientes con foto
 * ("recent-with-photo") y, si ninguno tiene foto, los más recientes
 * ("recent"). Cuando exista `destacado = true/false` (marcado por un
 * administrador) solo cambia `featuredProducts`: la vista y el contrato
 * (`PublicHome`) no se tocan.
 */
export type FeaturedPolicy = "recent-with-photo" | "recent";

/** Marco de la tienda: identidad pública + categorías + WhatsApp de pedidos (todo desde la BD). */
export interface PublicStorefront {
  slug: string;
  publicName: string;
  whatsapp: string | null;
  categories: CatalogCategory[];
}

export interface PublicHome {
  featured: PublicCatalogProduct[];
  featuredPolicy: FeaturedPolicy;
  /** Todas las categorías reales, con la miniatura de uno de sus productos cuando existe. */
  categories: Array<CatalogCategory & { coverUrl: string | null }>;
}

/** Selección del carrito resuelta por el backend: la verdad sobre cada referencia. */
export interface ResolvedSelection {
  context: PriceContext;
  /** Productos ACTIVOS encontrados, con su precio vigente del contexto y su disponibilidad. */
  items: PublicCatalogProduct[];
  /** Referencias que ya no existen o no están activas en este catálogo. */
  unknown: string[];
}

interface ImageSource {
  main: string;
  thumb: string;
}

/**
 * Rutas de Storage de las fotos de un producto, principal primero: la media
 * del Catálogo o, si no tiene, la foto legada (foto_url) SOLO si vive en este
 * bucket y bajo la carpeta del propio tenant. Una URL externa no se publica
 * (tampoco la permitiría el CSP img-src).
 */
function imageSources(repo: CatalogRepository, tenantId: string, product: CatalogProduct, media: StoredMedia[]): ImageSource[] {
  if (media.length > 0) {
    const ordered = [...media].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.order - b.order);
    return ordered.map((m) => ({ main: m.storagePath, thumb: m.thumbPath ?? m.storagePath }));
  }
  const legacy = product.primaryImage?.url ? repo.storagePathFromUrl(product.primaryImage.url) : null;
  if (!legacy || !legacy.startsWith(`${tenantId}/`) || legacy.includes("..")) return [];
  return [{ main: legacy, thumb: legacy }];
}

function publicImages(slug: string, reference: string, index: number, src: ImageSource): PublicProductImages {
  return {
    imageUrl: productImagePath(slug, reference, { index, thumb: false }, src.main),
    thumbUrl: productImagePath(slug, reference, { index, thumb: true }, src.thumb),
  };
}

/** "dl-000184, DL-000184 ,x" -> ["DL-000184"]: solo referencias con formato válido, sin duplicados, con tope. */
export function normalizeReferences(input: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of input) {
    const ref = referenceFromUrl(raw.trim());
    if (ref && !out.includes(ref)) out.push(ref);
    if (out.length >= SELECTION_MAX) break;
  }
  return out;
}

export function createPublicCatalogService({ repo }: { repo: CatalogRepository }) {
  type Publication = NonNullable<Awaited<ReturnType<CatalogRepository["getPublicationBySlug"]>>>;

  /** Publicación visible por slug: publicada y con el módulo habilitado; null en cualquier otro caso (=> 404). */
  async function openPublication(slug: string): Promise<Publication | null> {
    if (!isValidSlug(slug)) return null;
    const pub = await repo.getPublicationBySlug(slug);
    if (!pub || !pub.published) return null;
    if (!(await repo.isModuleEnabled(pub.tenantId))) return null;
    return pub;
  }

  /** Contexto de precio autorizado: el mayorista exige su token exacto. */
  function contextAllowed(pub: Publication, context: PriceContext, token: string | undefined): boolean {
    return context === "retail" || tokensMatch(token, pub.wholesaleToken);
  }

  /** Única proyección pública de productos (lista, inicio, ficha, selección): una consulta de media por lote. */
  async function project(pub: Publication, products: CatalogProduct[], context: PriceContext): Promise<PublicCatalogProduct[]> {
    const primaries = await repo.listPrimaryMedia(pub.tenantId, products.map((p) => p.id));
    const byProduct = new Map(primaries.map((m) => [m.productId, m]));
    return products.map((p) => {
      const media = byProduct.get(p.id);
      const [src] = imageSources(repo, pub.tenantId, p, media ? [media] : []);
      return toPublicProduct(p, context, src ? publicImages(pub.slug, p.reference, 1, src) : null);
    });
  }

  /** Destacados según la política vigente (ver FeaturedPolicy). */
  async function featuredProducts(tenantId: string): Promise<{ items: CatalogProduct[]; policy: FeaturedPolicy }> {
    const conFoto = await repo.listProducts(tenantId, { status: "ACTIVE", withImage: true, offset: 0, limit: FEATURED_LIMIT });
    if (conFoto.items.length > 0) return { items: conFoto.items, policy: "recent-with-photo" };
    const recientes = await repo.listProducts(tenantId, { status: "ACTIVE", offset: 0, limit: FEATURED_LIMIT });
    return { items: recientes.items, policy: "recent" };
  }

  return {
    async getStorefront(slug: string): Promise<PublicStorefront | null> {
      const pub = await openPublication(slug);
      if (!pub) return null;
      const [categories, business] = await Promise.all([repo.listCategories(pub.tenantId), repo.getBusinessProfile(pub.tenantId)]);
      return { slug: pub.slug, publicName: pub.publicName, whatsapp: business.whatsapp, categories };
    },

    async getCatalog(input: PublicCatalogQuery): Promise<PublicCatalogPage | null> {
      const pub = await openPublication(input.slug);
      if (!pub || !contextAllowed(pub, input.context, input.token)) return null;

      const page = Number.isInteger(input.page) && (input.page as number) >= 1 ? Math.min(input.page as number, 10_000) : 1;
      const categoryId = input.categoryId && UUID_PATTERN.test(input.categoryId) ? input.categoryId : undefined;
      const [{ items, total }, categories, business] = await Promise.all([
        // Solo ACTIVOS: un producto desactivado nunca aparece en el catálogo público.
        repo.listProducts(pub.tenantId, {
          status: "ACTIVE",
          search: normalizeSearch(input.q),
          categoryId,
          offset: (page - 1) * PUBLIC_PAGE_SIZE,
          limit: PUBLIC_PAGE_SIZE,
        }),
        repo.listCategories(pub.tenantId),
        repo.getBusinessProfile(pub.tenantId),
      ]);

      return {
        business: { name: pub.publicName, whatsapp: business.whatsapp },
        context: input.context,
        products: await project(pub, items, input.context),
        categories,
        total,
        page,
        pageSize: PUBLIC_PAGE_SIZE,
      };
    },

    /** Inicio de la tienda (detal): destacados + categorías con portada. Consultas acotadas, nunca el catálogo completo. */
    async getHome(slug: string): Promise<PublicHome | null> {
      const pub = await openPublication(slug);
      if (!pub) return null;
      const [featured, pool, categories] = await Promise.all([
        featuredProducts(pub.tenantId),
        repo.listProducts(pub.tenantId, { status: "ACTIVE", withImage: true, offset: 0, limit: COVER_POOL }),
        repo.listCategories(pub.tenantId),
      ]);
      const coverProduct = new Map<string, CatalogProduct>();
      for (const p of pool.items) if (p.categoryId && !coverProduct.has(p.categoryId)) coverProduct.set(p.categoryId, p);

      const covers = [...coverProduct.values()].filter((p) => !featured.items.some((f) => f.id === p.id));
      const projected = await project(pub, [...featured.items, ...covers], "retail");
      const byReference = new Map(projected.map((p) => [p.reference, p]));

      return {
        featured: projected.slice(0, featured.items.length),
        featuredPolicy: featured.policy,
        categories: categories.map((c) => {
          const cover = coverProduct.get(c.id);
          return { ...c, coverUrl: (cover && byReference.get(cover.reference)?.thumbUrl) ?? null };
        }),
      };
    },

    /**
     * Ficha pública de UN producto por su referencia (la identidad real del
     * producto). Solo ACTIVOS; el precio es el del contexto autorizado.
     */
    async getProduct(input: { slug: string; reference: string; context?: PriceContext; token?: string }): Promise<PublicProductDetail | null> {
      const reference = referenceFromUrl(input.reference);
      if (!reference) return null;
      const context = input.context ?? "retail";
      const pub = await openPublication(input.slug);
      if (!pub || !contextAllowed(pub, context, input.token)) return null;
      const product = await repo.getProductByReference(pub.tenantId, reference);
      if (!product || product.status !== "ACTIVE") return null;
      const media = await repo.listMedia(pub.tenantId, product.id);
      const gallery = imageSources(repo, pub.tenantId, product, media).map((src, i) => publicImages(pub.slug, product.reference, i + 1, src));
      return { ...toPublicProduct(product, context, gallery[0] ?? null), categoryId: product.categoryId, gallery };
    },

    /**
     * Resuelve una selección (carrito) contra la BD: referencia -> producto
     * real -> precio vigente del contexto -> disponibilidad. El navegador solo
     * aporta referencias y cantidades; nada de lo que envía se toma como verdad.
     */
    async resolveSelection(input: { slug: string; references: readonly string[]; context?: PriceContext; token?: string }): Promise<ResolvedSelection | null> {
      const context = input.context ?? "retail";
      const pub = await openPublication(input.slug);
      if (!pub || !contextAllowed(pub, context, input.token)) return null;
      const references = normalizeReferences(input.references);
      const found = references.length > 0 ? await repo.getProductsByReferences(pub.tenantId, references) : [];
      const activos = found.filter((p) => p.status === "ACTIVE");
      const items = await project(pub, activos, context);
      const resueltas = new Set(items.map((p) => p.reference));
      return { context, items, unknown: references.filter((r) => !resueltas.has(r)) };
    },

    /**
     * Foto de un producto para la ruta pública (principal o de la galería).
     * Mismas reglas que la vitrina: catálogo publicado, módulo habilitado y
     * producto ACTIVO. La imagen es la misma para detal y mayor, así que no
     * pide token (no contiene precios).
     */
    async getImage(input: PublicImageQuery): Promise<PublicImageObject | null> {
      const reference = referenceFromUrl(input.reference);
      if (!reference) return null;
      const pub = await openPublication(input.slug);
      if (!pub) return null;
      const product = await repo.getProductByReference(pub.tenantId, reference);
      if (!product || product.status !== "ACTIVE") return null;
      const media = input.file.index === 1 ? await repo.listPrimaryMedia(pub.tenantId, [product.id]) : await repo.listMedia(pub.tenantId, product.id);
      const src = imageSources(repo, pub.tenantId, product, media)[input.file.index - 1];
      if (!src) return null;
      return repo.openImage(input.file.thumb ? src.thumb : src.main);
    },
  };
}
