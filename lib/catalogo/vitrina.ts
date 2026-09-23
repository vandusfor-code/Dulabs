/**
 * Vitrina del catálogo público: identidad visual y contenido editorial por
 * negocio (marca del header, hero y banner). PURO: sin I/O.
 *
 * Los componentes de la tienda son genéricos y leen TODO lo específico de un
 * negocio desde aquí; un negocio sin configuración obtiene una vitrina
 * correcta sin hero ni banner (header con su nombre público, categorías y
 * productos reales). Los datos comerciales (productos, precios, referencias,
 * categorías, WhatsApp) nunca viven aquí: salen del catálogo en la BD.
 *
 * Siguiente paso natural: mover esta configuración a la BD / al dashboard
 * para que cada negocio la edite sin despliegues.
 */

export interface VitrinaImagen {
  /** Ruta pública dentro de /public (optimizada por next/image). */
  src: string;
  width: number;
  height: number;
  alt: string;
}

export interface VitrinaConfig {
  /** Lockup del header. Sin configurar => el nombre público del catálogo. */
  marca?: { nombre: string; descriptor?: string };
  /** Hero: fotografía + texto/CTA reales en HTML (el texto NO va en la imagen). */
  hero?: {
    imagen: VitrinaImagen;
    /** Punto focal de la foto cuando se recorta (CSS object-position). */
    enfoque?: string;
    eyebrow?: string;
    titulo: string;
    texto?: string;
    cta: string;
  };
  /** Banner editorial ya diseñado (la imagen lleva todo su contenido). */
  banner?: { imagen: VitrinaImagen };
}

const VITRINAS: Record<string, VitrinaConfig> = {
  delacour: {
    marca: { nombre: "Delacour & Orus", descriptor: "Joyería" },
    hero: {
      imagen: {
        src: "/catalogo/delacour/pantalla1mujer_principal.png",
        width: 1669,
        height: 942,
        alt: "Mujer luciendo un dije de corazón y un anillo solitario en oro",
      },
      enfoque: "72% 50%",
      eyebrow: "Más que joyas",
      titulo: "Historias que brillan contigo",
      texto: "Diseños únicos para cada momento de tu vida.",
      cta: "Ver catálogo",
    },
    banner: {
      imagen: {
        src: "/catalogo/delacour/regalojoyeriapantalla1.png",
        width: 2172,
        height: 724,
        alt: "El regalo perfecto siempre es una joya. Hacé cada momento inolvidable.",
      },
    },
  },
};

export function vitrinaDe(slug: string): VitrinaConfig {
  return VITRINAS[slug] ?? {};
}
