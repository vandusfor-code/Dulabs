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
 *
 * TEMAS. Cada negocio elige el aspecto de su vitrina: "clasico" (por defecto: claro
 * cálido, el de Delacour) o "tecnologia" (tienda de tecnología: azul eléctrico sobre
 * navy y blanco). El tema "tecnologia" tiene su propio contenido editorial
 * (`tecnologia`): textos del hero, beneficios y banners. Las categorías, los
 * productos, los precios, las fotos y el carrito siguen saliendo del catálogo real.
 */

export interface StorefrontImage {
  /** Ruta pública dentro de /public o ruta de una imagen del CMS (/catalogo/{slug}/vitrina/{id}.webp); next/image la optimiza. */
  src: string;
  width: number;
  height: number;
  alt: string;
}

/** Aspecto de la vitrina: "clasico" (por defecto) o "tecnologia". */
export type TemaVitrina = "clasico" | "tecnologia";

/** Iconos de los accesos de categoría de la vitrina de tecnología (cerrado: el componente los traduce a dibujos). */
export const ICONOS_CATEGORIA = ["celular", "tablet", "computador", "audio", "smartwatch", "gaming", "cocina", "general"] as const;
export type IconoCategoria = (typeof ICONOS_CATEGORIA)[number];

export const ICONOS_BENEFICIO = ["envio", "seguridad", "soporte", "ofertas", "pago", "garantia"] as const;
export type IconoBeneficio = (typeof ICONOS_BENEFICIO)[number];

/** Dibujos decorativos disponibles para los banners (no son fotos de productos: la foto real vive en el catálogo). */
export const ARTES_BANNER = ["tablet", "smartwatch", "celular"] as const;
export type ArteBanner = (typeof ARTES_BANNER)[number];

/**
 * Secciones que puede mostrar el INICIO clásico. Es la misma lista cerrada que usa el CMS (lib/cms-comercial/contrato.ts → SECCIONES_HOME): una prueba vigila
 * que no se separen. Cada sección tiene su dibujo en TiendaInicio; el CMS solo decide cuáles se ven y en qué orden.
 */
export const SECCIONES_INICIO = ["portada", "categorias", "destacados", "banner", "ofertas", "combos", "campana"] as const;
export type SeccionInicio = (typeof SECCIONES_INICIO)[number];

/** El orden de siempre del inicio clásico (el de Delacour hoy): portada, categorías, destacados y banner. Sin contenido del CMS, esto es lo que se ve. */
export const ORDEN_INICIO_CLASICO: readonly SeccionInicio[] = ["portada", "categorias", "destacados", "banner"];

/** Las secciones que la tienda SABE dibujar hoy (una que el CMS pida y no esté aquí se omite, nunca se dibuja a medias). */
export const SECCIONES_DIBUJADAS: readonly SeccionInicio[] = ["portada", "categorias", "destacados", "banner", "ofertas", "combos", "campana"];

/**
 * Una oferta vigente para mostrar en el inicio (la redacta el backend a partir de lo PUBLICADO; nada interno). El precio de cada producto ya refleja la oferta
 * en todas las tarjetas: este bloque la anuncia, con su vigencia y condiciones.
 */
export interface OfertaVitrina {
  /** Código público de la oferta (para anclas y claves). */
  clave: string;
  nombre: string;
  descripcion?: string;
  imagen?: StorefrontImage & { focus?: string };
  /** «20% de descuento», «$5.000 de descuento», «precio especial de $60.000». */
  beneficio: string;
  /** «hasta el 31 de octubre de 2026». */
  vigencia?: string;
  condiciones?: string;
  /** Qué cubre, en palabras: «Toda la tienda», «3 productos seleccionados», «2 categorías». */
  alcance: string;
  /** A dónde lleva «Ver productos»: el listado o la categoría si la oferta cubre una sola. */
  href: string;
}

/**
 * Un combo vigente para mostrar en el inicio (Etapa 1: se muestra y se consulta; NO se compra desde el carrito, lo cierra una asesora). Todo lo calcula el
 * backend: el precio normal (lo que el cliente pagaría HOY por separado), el ahorro y la disponibilidad. Nunca el stock exacto.
 */
export interface ComboVitrina {
  clave: string;
  nombre: string;
  descripcion?: string;
  imagen?: StorefrontImage & { focus?: string };
  componentes: ReadonlyArray<{ referencia: string; nombre: string; cantidad: number; disponible: boolean }>;
  /** Suma de los precios por separado de los componentes; null si algún componente no tiene precio. */
  precioNormal: number | null;
  precioCombo: number;
  /** precioNormal − precioCombo cuando es positivo; si no, no existe. */
  ahorro?: number;
  disponible: boolean;
  vigencia?: string;
  condiciones?: string;
  /** Enlace de WhatsApp con un mensaje listo para pedir el combo a una asesora; null si el negocio no tiene número válido o el combo no está disponible. */
  consultaHref: string | null;
}

/** Bloque de la campaña activa (contenido del CMS). Los productos de la campaña se cargan del catálogo por referencia. */
export interface CampanaVitrina {
  /** Nombre de la campaña: el título del bloque cuando no tiene portada propia. */
  nombre: string;
  /** Portada propia de la campaña. Sin ella, el bloque es un encabezado sencillo con el nombre y sus productos. */
  portada?: {
    /** Frase pequeña sobre el título. */
    etiqueta?: string;
    titulo: string;
    subtitulo?: string;
    imagen?: StorefrontImage & { /** Punto focal al recortar (CSS object-position). */ focus?: string };
    boton?: { texto: string; href: string };
  };
  /** Referencias de los productos destacados de la campaña, en el orden elegido. */
  productos: readonly string[];
}

export interface BeneficioVitrina {
  icono: IconoBeneficio;
  titulo: string;
  detalle: string;
}

export interface BannerVitrina {
  /** "TABLETS": etiqueta corta sobre el título. */
  etiqueta: string;
  /** Título; un "\n" parte la línea. */
  titulo: string;
  cta: string;
  /**
   * Búsqueda REAL en el catálogo a la que lleva el banner ("tablet", "reloj"): el listado la resuelve con los productos de la BD.
   * Nunca un enlace a algo que no exista.
   */
  consulta: string;
  arte: ArteBanner;
}

export interface HeroTecnologia {
  /** "Tecnología para": pequeña, en mayúsculas, sobre el título. */
  etiqueta: string;
  /** Dos líneas: la primera en blanco y la segunda en azul/cian. */
  lineas: readonly [string, string];
  descripcion: string;
  cta: string;
  /**
   * Render real (PNG/WebP con fondo transparente en /public) de los dispositivos del hero. Sin él se usa el dibujo decorativo:
   * este recurso lo sube el negocio cuando lo tenga; el texto NUNCA va dentro de la imagen.
   */
  imagen?: StorefrontImage;
}

export interface ConfigTecnologia {
  /** Texto de ayuda del buscador. */
  buscador: string;
  hero: HeroTecnologia;
  beneficios: readonly BeneficioVitrina[];
  banners: readonly BannerVitrina[];
}

export interface CatalogStorefrontConfig {
  /** Lockup del header. Sin configurar => el nombre público del catálogo (BD). */
  brand?: { name: string; descriptor?: string };
  /** Aspecto de la vitrina. Sin configurar => "clasico". */
  tema?: TemaVitrina;
  /** Contenido editorial del tema "tecnologia" (solo se usa con ese tema). */
  tecnologia?: ConfigTecnologia;
  /** Fotografía del hero: el texto NUNCA va dentro de la imagen, es HTML real. */
  heroImage?: StorefrontImage & { /** Punto focal al recortar (CSS object-position). */ focus?: string };
  heroEyebrow?: string;
  heroTitle?: string;
  heroDescription?: string;
  heroCta?: string;
  /** Banner editorial ya diseñado (la imagen lleva todo su contenido). */
  bannerImage?: StorefrontImage;
  /** Hacia dónde lleva el botón de la portada. Sin él, el listado completo (como siempre). Un `heroCta` vacío significa «sin botón». */
  heroHref?: string;
  /** Si el banner es un enlace, a dónde lleva. Sin él, el banner es solo una imagen (como siempre). */
  bannerHref?: string;
  /** Secciones visibles y su orden (las decide el CMS). Sin él, `ORDEN_INICIO_CLASICO`. */
  secciones?: readonly SeccionInicio[];
  /** Campaña activa con bloque propio (CMS). */
  campana?: CampanaVitrina;
  /** Ofertas vigentes que se anuncian en el inicio (CMS). */
  ofertas?: readonly OfertaVitrina[];
  /** Combos vigentes que se muestran en el inicio (CMS; Etapa 1: se consultan con una asesora, no se compran en el carrito). */
  combos?: readonly ComboVitrina[];
  /** Referencias de los productos destacados elegidos (CMS). Vacío o ausente => los más recientes con foto, como siempre. */
  destacados?: readonly string[];
  /** Categorías destacadas, por id (CMS). Vacío o ausente => todas. */
  categoriasDestacadas?: readonly string[];
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
    href: config.heroHref,
  };
}

/** Tema efectivo de la vitrina: "tecnologia" SOLO si el negocio lo pide y trae su contenido; si no, el clásico (nunca una vitrina a medias). */
export function temaDe(config: CatalogStorefrontConfig): TemaVitrina {
  return config.tema === "tecnologia" && config.tecnologia ? "tecnologia" : "clasico";
}

/** Contenido del tema "tecnologia" (null si la vitrina es clásica). */
export function tecnologiaOf(config: CatalogStorefrontConfig): ConfigTecnologia | null {
  return temaDe(config) === "tecnologia" ? (config.tecnologia ?? null) : null;
}

/** Parte el nombre de la marca en dos líneas para el lockup del header ("Aquí Sí Lo Compras" => "AQUÍ SÍ" / "LO COMPRAS"). */
export function partirMarca(nombre: string): [string, string] {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return ["", ""];
  if (palabras.length === 1) return [palabras[0].toLocaleUpperCase("es"), ""];
  const corte = Math.ceil(palabras.length / 2);
  return [palabras.slice(0, corte).join(" ").toLocaleUpperCase("es"), palabras.slice(corte).join(" ").toLocaleUpperCase("es")];
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const PALABRAS_ICONO: ReadonlyArray<readonly [IconoCategoria, RegExp]> = [
  ["smartwatch", /smartwatch|reloj|watch/],
  ["tablet", /tablet|ipad/],
  ["celular", /celular|telefono|smartphone|movil|iphone/],
  ["computador", /computador|portatil|laptop|notebook|\bpc\b|escritorio/],
  ["audio", /audio|audifono|auricular|parlante|bocina|sonido|headphone/],
  ["gaming", /gaming|gamer|juego|consola|videojuego/],
  ["cocina", /cocina|freidora|hogar|electrodomestico/],
];

/** Icono de una categoría REAL según su nombre (sin coincidencia => icono general). */
export function iconoDeCategoria(nombre: string): IconoCategoria {
  const n = sinTildes(nombre);
  return PALABRAS_ICONO.find(([, re]) => re.test(n))?.[0] ?? "general";
}

/** Enlace de un banner: la búsqueda REAL del listado público ("?q="). */
export function enlaceDeConsulta(basePath: string, consulta: string): string {
  return `${basePath}?q=${encodeURIComponent(consulta.trim())}`;
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
  // Aquí Sí Lo Compras: tienda de tecnología. Los banners llevan a líneas que el negocio vende de verdad (tablets y relojes);
  // las categorías de la franja salen del catálogo (las que el negocio cree en su panel), nunca de esta lista.
  "aqui-si-lo-compras": {
    brand: { name: "Aquí Sí Lo Compras" },
    tema: "tecnologia",
    tecnologia: {
      buscador: "Busca tu producto favorito...",
      hero: {
        etiqueta: "Tecnología para",
        lineas: ["Un mundo", "sin límites"],
        descripcion: "Descubre los mejores dispositivos al mejor precio.",
        cta: "Comprar ahora",
      },
      beneficios: [
        { icono: "envio", titulo: "Envío rápido", detalle: "A todo el país" },
        { icono: "seguridad", titulo: "Compra segura", detalle: "Pagos protegidos" },
        { icono: "soporte", titulo: "Soporte 24/7", detalle: "Atención personalizada" },
        { icono: "ofertas", titulo: "Ofertas exclusivas", detalle: "Todos los días" },
      ],
      banners: [
        { etiqueta: "Tablets", titulo: "Tablets y kits\ntodo en uno", cta: "Ver tablets", consulta: "tablet", arte: "tablet" },
        { etiqueta: "Smartwatch", titulo: "Smartwatch 4G\npara niños", cta: "Ver relojes", consulta: "reloj", arte: "smartwatch" },
      ],
    },
  },
};

export function storefrontConfigFor(slug: string): CatalogStorefrontConfig {
  return REGISTRO[slug] ?? {};
}
