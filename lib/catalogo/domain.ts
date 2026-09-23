/**
 * Catálogo DuLabs — DOMINIO (puro: sin I/O, sin Supabase, sin Next).
 *
 * El Catálogo es la FUENTE DE VERDAD de los productos de un negocio. Este
 * archivo define el modelo que ven la UI, las APIs y (en una fase futura) las
 * herramientas del agente de IA -- independiente de la estructura física de
 * la tabla (eso lo encapsula lib/catalogo/repository.ts).
 *
 * Reglas que viven aquí (y se prueban sin base de datos):
 *   - identidad dual: `id` técnico interno + `reference` comercial (DL-000184)
 *     que genera la BASE DE DATOS; ningún input acepta `reference`;
 *   - un producto, dos contextos de precio (detal / mayor) -- nunca se
 *     duplica un producto por tener dos precios;
 *   - estados ACTIVE / INACTIVE (desactivar nunca borra);
 *   - validación/normalización de todo input (zod), con topes de tamaño.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------

export const PRODUCT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRICE_CONTEXTS = ["retail", "wholesale"] as const;
/** retail = detal, wholesale = mayor. Extensible sin tocar CatalogProduct: ver priceFor(). */
export type PriceContext = (typeof PRICE_CONTEXTS)[number];

export interface ProductPricing {
  /** Precio detal en COP enteros (>= 0). Siempre presente. */
  retail: number;
  /** Precio al por mayor en COP enteros (>= 0), o null si el negocio no lo definió. */
  wholesale: number | null;
}

export interface CatalogImage {
  id: string;
  /** URL pública estable de la imagen optimizada (la que enviará el agente por WhatsApp). */
  url: string;
  /** URL de la miniatura (listado); cae a `url` si no hay miniatura. */
  thumbUrl: string;
  isPrimary: boolean;
  order: number;
  mimeType: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
}

export interface CatalogCategory {
  id: string;
  name: string;
}

export interface CatalogProduct {
  /** Identificador técnico interno (UUID). Nunca se muestra como "referencia". */
  id: string;
  /** Referencia comercial asignada por la BD (ej. DL-000184). Inmutable. */
  reference: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  material: string | null;
  color: string | null;
  pricing: ProductPricing;
  status: ProductStatus;
  /** false = el negocio no controla inventario desde DuLabs (no hay "agotado"). */
  tracksStock: boolean;
  /** Unidades en inventario (>= 0). Solo significa algo si tracksStock = true. */
  stock: number;
  /** Imagen principal (listado/detalle/agente). Puede venir de la foto legada si el producto no tiene media. */
  primaryImage: Pick<CatalogImage, "url" | "thumbUrl"> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogProductDetail extends CatalogProduct {
  images: CatalogImage[];
}

export interface ProductPage {
  items: CatalogProduct[];
  total: number;
  page: number;
  pageSize: number;
}

/** Precio del producto para un contexto comercial. null = no definido para ese contexto (nunca 0 inventado). */
export function priceFor(product: Pick<CatalogProduct, "pricing">, context: PriceContext): number | null {
  return context === "retail" ? product.pricing.retail : product.pricing.wholesale;
}

// ---------------------------------------------------------------------------
// Disponibilidad — ÚNICA fuente de las reglas de inventario (tienda, carrito,
// pedido, agente). La decide el backend, nunca el navegador ni la IA.
// ---------------------------------------------------------------------------

/**
 * Umbral de "Últimas unidades": con inventario controlado y 1..N unidades.
 * Regla de negocio centralizada (hoy común a todos los negocios; mañana puede
 * venir de la configuración del catálogo sin tocar a los consumidores).
 */
export const LOW_STOCK_THRESHOLD = 3;

export type Availability = "available" | "low" | "sold_out";

type StockView = Pick<CatalogProduct, "status" | "tracksStock" | "stock">;

/**
 * inactivo => no disponible ("sold_out" para quien lo consulte: el producto
 * existe pero no se vende); sin control de inventario => disponible; con
 * control => agotado con 0, "últimas unidades" hasta el umbral, disponible
 * por encima.
 */
export function availabilityOf(product: StockView): Availability {
  if (product.status !== "ACTIVE") return "sold_out";
  if (!product.tracksStock) return "available";
  if (product.stock <= 0) return "sold_out";
  return product.stock <= LOW_STOCK_THRESHOLD ? "low" : "available";
}

export function isAvailable(product: StockView): boolean {
  return availabilityOf(product) !== "sold_out";
}

/** Máximo que se puede pedir de un producto: el stock si se controla; null = sin límite de inventario. */
export function maxOrderableUnits(product: StockView): number | null {
  if (!isAvailable(product)) return 0;
  return product.tracksStock ? product.stock : null;
}

/**
 * Stock DISCRETO para el público: el backend conoce el número exacto, pero la
 * tienda solo necesita "Disponible / Últimas unidades / Agotado". El límite
 * exacto se publica únicamente cuando es pequeño (para no dejar pedir de más
 * en el carrito); por encima, el público no ve cuántas hay (null = sin tope
 * visible) y el backend igual valida contra el stock real al preparar el
 * pedido ("Solo quedan N" solo aparece si alguien pide más de lo que hay).
 */
export const PUBLIC_STOCK_VISIBLE = 10;

export function publicOrderLimit(product: StockView): number | null {
  const max = maxOrderableUnits(product);
  return max !== null && max > PUBLIC_STOCK_VISIBLE ? null : max;
}

// ---------------------------------------------------------------------------
// Referencia comercial (espejo EXACTO del formato de la BD, solo para
// validar/mostrar: la BD es la única que la genera)
// ---------------------------------------------------------------------------

export const REFERENCE_PATTERN = /^[A-Z]{1,6}-\d{6,}$/;

/** Mismo formato que dulabs_catalogo_formatear_referencia: nunca trunca (DL-1000000 tras DL-999999). */
export function formatReference(prefix: string, sequence: number): string {
  const digits = String(sequence);
  return `${prefix}-${digits.padStart(Math.max(6, digits.length), "0")}`;
}

export function isReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Límites
// ---------------------------------------------------------------------------

export const CATALOG_LIMITS = {
  name: 120,
  description: 1000,
  material: 80,
  color: 80,
  categoryName: 60,
  price: 1_000_000_000,
  searchQuery: 80,
  pageSizeDefault: 24,
  pageSizeMax: 60,
  imagesPerProduct: 12,
  /** Imagen principal ya comprimida en el navegador (WebP/JPEG, <= 2048 px). */
  imageBytes: 3 * 1024 * 1024,
  /** Miniatura (<= 400 px). */
  thumbBytes: 400 * 1024,
  imageMaxSide: 2048,
  stock: 1_000_000,
  /** Miniatura: tarjetas de la tienda, carrito y listados (≈ 150–200 px en pantalla, nítida a 2–3×). */
  thumbMaxSide: 400,
  /** Variante "detalle": ficha del producto y galería (a lo ancho del móvil, nítida a 2–3×). */
  detailMaxSide: 1200,
  detailBytes: 600 * 1024,
} as const;

/** Formatos aceptados para media del catálogo (el navegador produce WebP; JPEG es el respaldo cuando el navegador no codifica WebP). */
export const IMAGE_MIME_TYPES = ["image/webp", "image/jpeg"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export function extensionForMime(mime: ImageMimeType): "webp" | "jpg" {
  return mime === "image/webp" ? "webp" : "jpg";
}

// ---------------------------------------------------------------------------
// Validación de input (zod). `.strict()`: cualquier campo no permitido --
// en particular `reference`/`referencia`/`id`/`tenant` -- se RECHAZA con 400,
// nunca se ignora en silencio.
// ---------------------------------------------------------------------------

/** "" / espacios => null; recorta; aplica tope. `.optional()` al final: la clave es opcional en el tipo de salida. */
const optionalText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .transform((v) => {
      if (v === null) return null;
      const t = v.trim();
      return t.length === 0 ? null : t;
    })
    .refine((v) => v === null || v.length <= max, { message: `Máximo ${max} caracteres.` })
    .optional();

const priceNumber = z
  .number({ error: "El precio debe ser un número." })
  .int({ message: "El precio debe ser un número entero (COP, sin decimales)." })
  .min(0, { message: "El precio no puede ser negativo." })
  .max(CATALOG_LIMITS.price, { message: "El precio es demasiado alto." });

/** Stock: entero >= 0 (0 = agotado). La BD lo garantiza también (CHECK stock >= 0). */
const stockNumber = z
  .number({ error: "El stock debe ser un número." })
  .int({ message: "El stock debe ser un número entero." })
  .min(0, { message: "El stock no puede ser negativo." })
  .max(CATALOG_LIMITS.stock, { message: "El stock es demasiado alto." });

const uuid = z.uuid({ message: "Identificador inválido." });

export const productCreateSchema = z
  .object({
    name: z
      .string({ error: "El nombre es obligatorio." })
      .trim()
      .min(1, { message: "El nombre es obligatorio." })
      .max(CATALOG_LIMITS.name, { message: `El nombre admite máximo ${CATALOG_LIMITS.name} caracteres.` }),
    categoryId: uuid.nullable().optional(),
    description: optionalText(CATALOG_LIMITS.description),
    material: optionalText(CATALOG_LIMITS.material),
    color: optionalText(CATALOG_LIMITS.color),
    retailPrice: priceNumber,
    wholesalePrice: priceNumber.nullable().optional(),
    /** Unidades disponibles para venta. Obligatorio: todo producto nuevo nace con inventario controlado. */
    stock: stockNumber,
  })
  .strict();

export type ProductCreateInput = z.output<typeof productCreateSchema>;

export const productUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: "El nombre no puede quedar vacío." })
      .max(CATALOG_LIMITS.name, { message: `El nombre admite máximo ${CATALOG_LIMITS.name} caracteres.` })
      .optional(),
    categoryId: uuid.nullable().optional(),
    description: optionalText(CATALOG_LIMITS.description),
    material: optionalText(CATALOG_LIMITS.material),
    color: optionalText(CATALOG_LIMITS.color),
    retailPrice: priceNumber.optional(),
    wholesalePrice: priceNumber.nullable().optional(),
    /** Fijar el stock activa el control de inventario del producto (la referencia nunca cambia). */
    stock: stockNumber.optional(),
    status: z.enum(PRODUCT_STATUSES).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "No hay cambios para guardar." });

export type ProductUpdateInput = z.output<typeof productUpdateSchema>;

export const categoryCreateSchema = z
  .object({
    name: z
      .string({ error: "El nombre de la categoría es obligatorio." })
      .trim()
      .min(1, { message: "El nombre de la categoría es obligatorio." })
      .max(CATALOG_LIMITS.categoryName, { message: `La categoría admite máximo ${CATALOG_LIMITS.categoryName} caracteres.` }),
  })
  .strict();

export type CategoryCreateInput = z.output<typeof categoryCreateSchema>;

export const STATUS_FILTERS = ["ALL", "ACTIVE", "INACTIVE"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Query del listado. Llega como strings desde searchParams. */
export const productListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(CATALOG_LIMITS.searchQuery)
    .optional()
    .transform((v) => (v ? v : undefined)),
  categoryId: uuid.optional(),
  status: z.enum(STATUS_FILTERS).default("ALL"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(CATALOG_LIMITS.pageSizeMax).default(CATALOG_LIMITS.pageSizeDefault),
});

export type ProductListQuery = z.output<typeof productListQuerySchema>;

export const imageUploadRequestSchema = z
  .object({
    mimeType: z.enum(IMAGE_MIME_TYPES, { message: "Formato de imagen no permitido (WebP o JPEG)." }),
    bytes: z.number().int().min(1).max(CATALOG_LIMITS.imageBytes, { message: "La imagen supera el tamaño máximo permitido." }),
    thumbBytes: z.number().int().min(1).max(CATALOG_LIMITS.thumbBytes, { message: "La miniatura supera el tamaño máximo permitido." }),
    /** Variante de detalle (opcional: navegadores con una versión anterior de la app no la envían). */
    detailBytes: z.number().int().min(1).max(CATALOG_LIMITS.detailBytes, { message: "La versión de detalle supera el tamaño máximo permitido." }).optional(),
  })
  .strict();

export type ImageUploadRequest = z.output<typeof imageUploadRequestSchema>;

export const imageConfirmSchema = z
  .object({
    uploadId: uuid,
    mimeType: z.enum(IMAGE_MIME_TYPES),
    width: z.number().int().min(1).max(CATALOG_LIMITS.imageMaxSide),
    height: z.number().int().min(1).max(CATALOG_LIMITS.imageMaxSide),
    makePrimary: z.boolean().default(false),
  })
  .strict();

export type ImageConfirmInput = z.output<typeof imageConfirmSchema>;

/** Mensaje legible del primer problema de validación (para la UI). */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Datos inválidos.";
  if (issue.code === "unrecognized_keys") {
    const keys = (issue as { keys?: string[] }).keys ?? [];
    return `Campo no permitido: ${keys.join(", ")}.`;
  }
  return issue.message || "Datos inválidos.";
}

// ---------------------------------------------------------------------------
// Rutas de Storage (convención EXISTENTE del bucket inventario-productos:
// {id_tenant}/{producto_id}/{uuid}.{ext}). La BD además exige que la ruta
// viva bajo el tenant y producto dueños de la fila.
// ---------------------------------------------------------------------------

export function imageStoragePaths(tenantId: string, productId: string, uploadId: string, mime: ImageMimeType): { path: string; thumbPath: string; detailPath: string } {
  const ext = extensionForMime(mime);
  const base = `${tenantId}/${productId}/${uploadId}`;
  return { path: `${base}.${ext}`, thumbPath: `${base}_thumb.${ext}`, detailPath: detailPathOf(`${base}.${ext}`) };
}

/**
 * Ruta de la variante de detalle, por CONVENCIÓN a partir de la principal
 * ("…/u.webp" -> "…/u_detail.webp"). Sin columna nueva ni cambio de RPC: las
 * fotos anteriores simplemente no la tienen y se sirve la principal.
 */
export function detailPathOf(storagePath: string): string {
  const i = storagePath.lastIndexOf(".");
  return i > storagePath.lastIndexOf("/") ? `${storagePath.slice(0, i)}_detail${storagePath.slice(i)}` : `${storagePath}_detail`;
}

// ---------------------------------------------------------------------------
// Verificación de firma de imagen (magic bytes) -- el content-type que
// declara quien sube no basta.
// ---------------------------------------------------------------------------

export function sniffImageMime(head: Uint8Array): ImageMimeType | null {
  if (head.length >= 12) {
    const riff = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
    const webp = head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    if (riff && webp) return "image/webp";
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  return null;
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

/**
 * Normaliza el texto de búsqueda para usarlo en un filtro ilike: quita los
 * caracteres con significado en la sintaxis de filtros de PostgREST
 * (, ( ) * % \ :) y comodines, colapsa espacios. Devuelve undefined si no
 * queda nada buscable.
 */
export function normalizeSearch(q: string | undefined): string | undefined {
  if (!q) return undefined;
  const cleaned = q.replace(/[,()*%\\:_"']/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned.slice(0, CATALOG_LIMITS.searchQuery) : undefined;
}
