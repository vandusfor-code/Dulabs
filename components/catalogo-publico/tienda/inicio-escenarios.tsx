/**
 * Datos y render compartidos por las pruebas del inicio de la tienda (el HTML guardado de hoy y la comparación con el contenido sembrado en el CMS).
 * Solo para pruebas: ningún código de producción lo importa.
 */
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { TiendaProvider } from "@/components/catalogo-publico/tienda/TiendaContext";
import { TiendaInicio } from "@/components/catalogo-publico/tienda/TiendaInicio";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";
import type { PublicHome } from "@/lib/catalogo/service";
import { storefrontConfigFor, type CatalogStorefrontConfig } from "@/lib/catalogo/vitrina";

export const BASE = "/catalogo/delacour";
export const LISTA = `${BASE}?todo=1`;
export const NOMBRE_NEGOCIO = "Delacour & Orus";

export const producto = (n: number, over: Partial<PublicCatalogProduct> = {}): PublicCatalogProduct => ({
  reference: `DL-${String(n).padStart(6, "0")}`,
  name: `Pieza de prueba ${n}`,
  description: null,
  material: null,
  color: null,
  categoryName: "Aretes",
  price: 90_000 + n * 1_000,
  imageUrl: `${BASE}/productos/dl-${String(n).padStart(6, "0")}/main.webp?v=1`,
  detailUrl: `${BASE}/productos/dl-${String(n).padStart(6, "0")}/detail.webp?v=1`,
  thumbUrl: `${BASE}/productos/dl-${String(n).padStart(6, "0")}/thumb.webp?v=1`,
  available: true,
  availability: "available",
  maxQuantity: null,
  ...over,
});

export const CATEGORIAS_PRUEBA = [
  { id: "c0000000-0000-4000-8000-0000000000a1", name: "Aretes", coverUrl: `${BASE}/productos/dl-000001/thumb.webp?v=1` } as PublicHome["categories"][number],
  { id: "c0000000-0000-4000-8000-0000000000a2", name: "Dijes", coverUrl: null } as PublicHome["categories"][number],
];

export const HOME_COMPLETO: PublicHome = {
  featured: [producto(1), producto(2, { price: null }), producto(3, { available: false, availability: "sold_out" }), producto(4, { availability: "low", maxQuantity: 3 })],
  featuredPolicy: "recent-with-photo",
  categories: CATEGORIAS_PRUEBA,
};
export const HOME_VACIO: PublicHome = { featured: [], featuredPolicy: "recent", categories: [] };
export const HOME_SIN_CATEGORIAS: PublicHome = { featured: [producto(7)], featuredPolicy: "recent", categories: [] };

/** El HTML del inicio con esa configuración (el mismo marco que la tienda: proveedor del carrito y de la tienda). */
export function renderizarInicio(home: PublicHome, config: CatalogStorefrontConfig): string {
  return renderToStaticMarkup(
    <TiendaProvider slug="delacour" context="retail" basePath={BASE} whatsapp="573000000000">
      <TiendaInicio home={home} config={config} basePath={BASE} listPath={LISTA} businessName={NOMBRE_NEGOCIO} />
    </TiendaProvider>,
  );
}

/** Carpeta del HTML guardado de cada escenario. */
export const CARPETA_DORADOS = path.join(__dirname, "__dorados__");

/** Los escenarios del inicio de hoy (no pueden cambiar mientras el negocio no tenga nada publicado en el CMS). */
export const ESCENARIOS: Array<{ nombre: string; html: () => string }> = [
  { nombre: "delacour-completo", html: () => renderizarInicio(HOME_COMPLETO, storefrontConfigFor("delacour")) },
  { nombre: "sin-configuracion-y-sin-productos", html: () => renderizarInicio(HOME_VACIO, storefrontConfigFor("negocio-sin-configuracion")) },
  { nombre: "delacour-sin-categorias", html: () => renderizarInicio(HOME_SIN_CATEGORIAS, storefrontConfigFor("delacour")) },
  { nombre: "solo-banner-sin-portada", html: () => renderizarInicio(HOME_COMPLETO, { bannerImage: storefrontConfigFor("delacour").bannerImage }) },
];
