/**
 * Catálogo DuLabs — publicación del catálogo como HTML público. PURO (sin I/O).
 *
 * Dos representaciones del MISMO catálogo (la fuente de verdad sigue siendo
 * la BD; el HTML nunca lo es):
 *   /catalogo/{slug}                        -> contexto "retail"   (detal)
 *   /catalogo/{slug}/mayor/{token}          -> contexto "wholesale" (mayor)
 *
 * La proyección pública lleva UN solo precio (el del contexto) y nada
 * interno: ni id técnico, ni tenant, ni el precio del otro contexto.
 */
import { availabilityOf, isReference, priceFor, publicOrderLimit, type Availability, type CatalogCategory, type CatalogProduct, type PriceContext } from "@/lib/catalogo/domain";

export interface CatalogPublication {
  slug: string;
  publicName: string;
  published: boolean;
  /** Secreto del link mayorista. Nunca sale del backend salvo hacia un admin. */
  wholesaleToken: string;
}

export interface PublicCatalogProduct {
  reference: string;
  name: string;
  description: string | null;
  material: string | null;
  color: string | null;
  categoryName: string | null;
  /** Precio del contexto del link; null = "precio a consultar" (nunca un 0 inventado ni el precio del otro contexto). */
  price: number | null;
  /** Original optimizado (≤ 2048 px). Para compartir o ampliar; NO para mostrar en tarjetas. */
  imageUrl: string | null;
  /** Detalle (≤ 1200 px): ficha del producto y vista previa al compartir. */
  detailUrl: string | null;
  /** Miniatura (≤ 400 px): tarjetas, carrito y listados. */
  thumbUrl: string | null;
  /** Decidido por el backend (activo + inventario); nunca por el navegador. */
  available: boolean;
  /** "available" | "low" (últimas unidades) | "sold_out" — reglas en availabilityOf (dominio). */
  availability: Availability;
  /**
   * Máximo pedible PÚBLICO (discreto, ver publicOrderLimit): el stock solo
   * cuando es pequeño; null = sin tope visible. Sirve para impedir cantidades
   * imposibles en el carrito; el backend valida SIEMPRE contra el stock real.
   */
  maxQuantity: number | null;
}

/** Ficha pública de un producto: la misma proyección + galería completa (principal primero). */
export interface PublicProductDetail extends PublicCatalogProduct {
  /** Categoría real (el mismo id que usan los links públicos ?categoria=). */
  categoryId: string | null;
  gallery: PublicProductImages[];
}

export interface PublicCatalogPage {
  business: { name: string; whatsapp: string | null };
  context: PriceContext;
  products: PublicCatalogProduct[];
  categories: CatalogCategory[];
  total: number;
  page: number;
  pageSize: number;
  /** Páginas navegables (una búsqueda por texto muestra como máximo PUBLIC_SEARCH_MAX_RESULTS). */
  pageCount: number;
  /**
   * Solo en búsquedas por texto:
   *   relaxed — ningún producto tenía TODAS las palabras: se muestran los que tienen alguna;
   *   capped  — hay más resultados de los que se muestran (se pide afinar la búsqueda).
   */
  search?: { relaxed: boolean; capped: boolean };
}

export const PUBLIC_PAGE_SIZE = 48;
/** Búsqueda por texto (dulabs_catalogo_buscar): páginas de 20, ordenadas por relevancia. */
export const PUBLIC_SEARCH_PAGE_SIZE = 20;
/** Tope de la función de búsqueda (offset ≤ 200): 11 páginas de 20. */
export const PUBLIC_SEARCH_MAX_RESULTS = 220;
export const SLUG_MAX = 50;

/** "DELACOUR JOYERÍA" -> "delacour-joyeria". Mismo alfabeto que el CHECK de la BD. */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return slug || "catalogo";
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/** Candidatos de slug en orden: base, base-2 … base-5 (el último intento lo decide el caller con un sufijo aleatorio). */
export function slugCandidates(base: string): string[] {
  const clean = slugify(base);
  const out = [clean];
  for (let i = 2; i <= 5; i++) out.push(`${clean.slice(0, SLUG_MAX - String(i).length - 1).replace(/-+$/g, "")}-${i}`);
  return out;
}

export function retailPath(slug: string): string {
  return `/catalogo/${slug}`;
}

export function wholesalePath(slug: string, token: string): string {
  return `/catalogo/${slug}/mayor/${token}`;
}

/** URLs PÚBLICAS de la foto (las de /catalogo/{slug}/productos/…), nunca las de Storage. */
export interface PublicProductImages {
  imageUrl: string;
  detailUrl: string;
  thumbUrl: string;
}

/**
 * Proyección pública de un producto. Las imágenes llegan APARTE y ya
 * convertidas a la ruta pública: `product.primaryImage` (URL de Storage con
 * {tenant}/{producto}/…) nunca se copia al HTML.
 */
export function toPublicProduct(product: CatalogProduct, context: PriceContext, images: PublicProductImages | null = null): PublicCatalogProduct {
  return {
    reference: product.reference,
    name: product.name,
    description: product.description,
    material: product.material,
    color: product.color,
    categoryName: product.categoryName,
    price: priceFor(product, context),
    imageUrl: images?.imageUrl ?? null,
    detailUrl: images?.detailUrl ?? null,
    thumbUrl: images?.thumbUrl ?? null,
    available: availabilityOf(product) !== "sold_out",
    availability: availabilityOf(product),
    // Discreto: el número exacto solo si es pequeño (ver publicOrderLimit).
    maxQuantity: publicOrderLimit(product),
  };
}

// ---------------------------------------------------------------------------
// URL pública de las fotos: /catalogo/{slug}/productos/{referencia}/{main|thumb}.{ext}?v={version}
// Solo slug + referencia (datos que el cliente ya ve). La ruta de Storage
// ({tenant}/{producto}/{upload}.webp) se resuelve en el servidor.
// ---------------------------------------------------------------------------

/**
 * Archivo de imagen pública de un producto. `index` 1 = foto principal
 * ("main" / "detail" / "thumb", URLs estables); 2..12 = galería en su orden.
 * Variantes: main (≤ 2048 px), detail (≤ 1200 px, ficha), thumb (≤ 400 px, tarjetas).
 */
export type PublicImageVariant = "main" | "detail" | "thumb";

export interface PublicImageFile {
  index: number;
  variant: PublicImageVariant;
}

const PRINCIPAL_PATTERN = /^(main|thumb|detail)\.(webp|jpe?g|png)$/;
const GALERIA_PATTERN = /^([2-9]|1[0-2])(?:-(thumb|detail))?\.(webp|jpe?g|png)$/;

/** "main.webp" -> {1,main}; "3-thumb.webp" -> {3,thumb}; "2-detail.webp" -> {2,detail}; otro -> null (404). */
export function parseImageFileName(name: string): PublicImageFile | null {
  const principal = PRINCIPAL_PATTERN.exec(name);
  if (principal) return { index: 1, variant: principal[1] as PublicImageVariant };
  const galeria = GALERIA_PATTERN.exec(name);
  if (galeria) return { index: Number(galeria[1]), variant: (galeria[2] as PublicImageVariant | undefined) ?? "main" };
  return null;
}

function imageBaseName(file: PublicImageFile): string {
  if (file.index === 1) return file.variant;
  return file.variant === "main" ? `${file.index}` : `${file.index}-${file.variant}`;
}

/** "dl-000184" (como va en la URL) -> "DL-000184"; null si no es una referencia válida. */
export function referenceFromUrl(value: string): string | null {
  const ref = value.toUpperCase();
  return isReference(ref) ? ref : null;
}

function extensionOf(storagePath: string): string {
  const match = /\.(webp|jpe?g|png)$/i.exec(storagePath);
  return match ? match[1].toLowerCase() : "webp";
}

/**
 * Versión de la imagen para la caché (FNV-1a 32 bits en base 36): cambia cuando
 * cambia la foto principal, así el CDN y el navegador nunca sirven una foto
 * vieja. Es un hash NO reversible de la ruta: no revela ningún id.
 */
export function imageVersion(storagePath: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < storagePath.length; i++) {
    hash ^= storagePath.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function productImagePath(slug: string, reference: string, file: PublicImageFile, storagePath: string): string {
  return `${productPath(slug, reference)}/${imageBaseName(file)}.${extensionOf(storagePath)}?v=${imageVersion(storagePath)}`;
}

/** Nombre del archivo JPEG para WhatsApp (Meta no acepta WebP como imagen): se convierte en el servidor. */
export const WHATSAPP_IMAGE_FILE = "whatsapp.jpg";

/**
 * Foto principal en JPEG para enviarla por WhatsApp:
 * /catalogo/{slug}/productos/{referencia}/whatsapp.jpg?v={version}. Misma
 * regla que las demás fotos públicas: solo slug + referencia, nunca la ruta
 * de Storage (que lleva los ids del negocio y del producto).
 */
export function whatsappImagePath(slug: string, reference: string, storagePath: string): string {
  return `${productPath(slug, reference)}/${WHATSAPP_IMAGE_FILE}?v=${imageVersion(storagePath)}`;
}

/** Ficha pública del producto: /catalogo/{slug}/productos/{referencia en minúsculas}. */
export function productPath(slug: string, reference: string): string {
  return `/catalogo/${slug}/productos/${reference.toLowerCase()}`;
}

/** Ficha del producto dentro de la tienda de un canal (detal: /catalogo/{slug}; mayor: /catalogo/{slug}/mayor/{token}). */
export function productPathIn(basePath: string, reference: string): string {
  return `${basePath}/productos/${reference.toLowerCase()}`;
}
