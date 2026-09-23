/**
 * Vitrina del catálogo público: contenido EDITORIAL por negocio (marca del
 * header, hero y banner). PURO: sin I/O.
 *
 * `CatalogStorefrontConfig` es el contrato definitivo: tiene la misma forma
 * que tendrá la configuración del catálogo en la BD
 *   negocio -> catalog_config { hero_image, hero_eyebrow, hero_title,
 *                               hero_description, hero_cta, banner_image }
 * y los componentes solo conocen ese contrato. Hoy la FUENTE es este
 * registro en código (temporal, fase visual); el siguiente paso es leerla de
 * la fila de publicación del tenant (dulabs_catalogo_publicacion, la misma
 * que ya define slug y nombre público), sin tocar la vista.
 *
 * Los datos comerciales (productos, precios, referencias, categorías,
 * WhatsApp) nunca viven aquí: salen del catálogo en la BD. Un negocio sin
 * configuración obtiene una vitrina correcta, sin hero ni banner.
 */

export interface StorefrontImage {
  /** Ruta pública dentro de /public (optimizada por next/image). */
  src: string;
  width: number;
  height: number;
  alt: string;
}

export interface CatalogStorefrontConfig {
  /** Lockup del header. Sin configurar => el nombre público del catálogo (BD). */
  brand?: { name: string; descriptor?: string };
  /** Fotografía del hero: el texto NUNCA va dentro de la imagen, es HTML real. */
  heroImage?: StorefrontImage & { /** Punto focal al recortar (CSS object-position). */ focus?: string };
  heroEyebrow?: string;
  heroTitle?: string;
  heroDescription?: string;
  heroCta?: string;
  /** Banner editorial ya diseñado (la imagen lleva todo su contenido). */
  bannerImage?: StorefrontImage;
}

/** Hero completo solo si hay foto y título: nunca un hero a medias. */
export function heroOf(config: CatalogStorefrontConfig) {
  if (!config.heroImage || !config.heroTitle) return null;
  return {
    image: config.heroImage,
    eyebrow: config.heroEyebrow,
    title: config.heroTitle,
    description: config.heroDescription,
    cta: config.heroCta ?? "Ver catálogo",
  };
}

// Fuente TEMPORAL (fase visual): configuración por publicación (slug).
const REGISTRO: Record<string, CatalogStorefrontConfig> = {
  delacour: {
    brand: { name: "Delacour & Orus", descriptor: "Joyería" },
    heroImage: {
      src: "/catalogo/delacour/pantalla1mujer_principal.png",
      width: 1669,
      height: 942,
      alt: "Mujer luciendo un dije de corazón y un anillo solitario en oro",
      focus: "72% 50%",
    },
    heroEyebrow: "Más que joyas",
    heroTitle: "Historias que brillan contigo",
    heroDescription: "Diseños únicos para cada momento de tu vida.",
    heroCta: "Ver catálogo",
    bannerImage: {
      src: "/catalogo/delacour/regalojoyeriapantalla1.png",
      width: 2172,
      height: 724,
      alt: "El regalo perfecto siempre es una joya. Hacé cada momento inolvidable.",
    },
  },
};

export function storefrontConfigFor(slug: string): CatalogStorefrontConfig {
  return REGISTRO[slug] ?? {};
}
