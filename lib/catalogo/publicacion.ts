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
import { priceFor, type CatalogCategory, type CatalogProduct, type PriceContext } from "@/lib/catalogo/domain";

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
  imageUrl: string | null;
  thumbUrl: string | null;
}

export interface PublicCatalogPage {
  business: { name: string; whatsapp: string | null };
  context: PriceContext;
  products: PublicCatalogProduct[];
  categories: CatalogCategory[];
  total: number;
  page: number;
  pageSize: number;
}

export const PUBLIC_PAGE_SIZE = 48;
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

export function toPublicProduct(product: CatalogProduct, context: PriceContext): PublicCatalogProduct {
  return {
    reference: product.reference,
    name: product.name,
    description: product.description,
    material: product.material,
    color: product.color,
    categoryName: product.categoryName,
    price: priceFor(product, context),
    imageUrl: product.primaryImage?.url ?? null,
    thumbUrl: product.primaryImage?.thumbUrl ?? null,
  };
}

/** Link de WhatsApp con la referencia en el mensaje: el agente (y el asesor) identifican la pieza exacta. */
export function whatsappOrderLink(phone: string | null, product: Pick<PublicCatalogProduct, "reference" | "name">, context: PriceContext): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const tipo = context === "wholesale" ? " (precio mayorista)" : "";
  const text = `Hola, me interesa ${product.name} (ref. ${product.reference})${tipo}.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
