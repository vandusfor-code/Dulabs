/**
 * Tema "joyeria" (Bloque 30) — decisiones PURAS de presentación: qué anuncios se muestran, si hay bloque de mayoristas, cómo se rotulan el título de los destacados y las
 * migas de pan. Sin I/O y sin React: se prueba aparte (joyeria.test.ts). Nunca toca precios, stock, carrito ni pedidos.
 */
import type { ConfigJoyeria, MayoristasJoyeria } from "@/lib/catalogo/vitrina";
import type { FeaturedPolicy } from "@/lib/catalogo/service";

/** Dígitos de un número de WhatsApp si es utilizable (≥ 8, como en el resto de la tienda); null si no. */
export function digitosWhatsapp(numero: string | null | undefined): string | null {
  const digitos = (numero ?? "").replace(/\D/g, "");
  return digitos.length >= 8 ? digitos : null;
}

/** Enlace a WhatsApp del negocio (con mensaje escrito, si se pide). null si el negocio no tiene un número válido. */
export function enlaceWhatsapp(numero: string | null | undefined, mensaje?: string): string | null {
  const digitos = digitosWhatsapp(numero);
  if (!digitos) return null;
  return mensaje ? `https://wa.me/${digitos}?text=${encodeURIComponent(mensaje)}` : `https://wa.me/${digitos}`;
}

export interface AnuncioVisible {
  texto: string;
  /** Destino del anuncio (null = solo texto). */
  href: string | null;
}

/** Los anuncios que SE PUEDEN mostrar: sin texto, o pidiendo WhatsApp cuando no hay número válido, no existen (nunca un anuncio que lleva a la nada). */
export function anunciosVisibles(config: ConfigJoyeria, whatsapp: string | null | undefined): AnuncioVisible[] {
  const salida: AnuncioVisible[] = [];
  for (const a of config.anuncios) {
    const texto = a.texto.trim();
    if (texto === "") continue;
    if (a.enlace === "whatsapp") {
      const href = enlaceWhatsapp(whatsapp);
      if (href) salida.push({ texto, href });
    } else {
      salida.push({ texto, href: null });
    }
  }
  return salida;
}

export interface MayoristasVisible extends Omit<MayoristasJoyeria, "mensaje"> {
  href: string;
}

/** El bloque de mayoristas solo existe si hay contenido Y un WhatsApp válido al que escribir. */
export function mayoristasVisible(config: ConfigJoyeria, whatsapp: string | null | undefined): MayoristasVisible | null {
  const m = config.mayoristas;
  if (!m) return null;
  const href = enlaceWhatsapp(whatsapp, m.mensaje);
  if (!href) return null;
  return { etiqueta: m.etiqueta, titulo: m.titulo, texto: m.texto, boton: m.boton, href };
}

/**
 * Rótulo del bloque de productos del inicio según de dónde salen: los más recientes con foto SON novedades; lo elegido a mano en el CMS es una selección. Nunca se
 * promete «más vendidos» ni nada que el catálogo no respalde.
 */
export function rotuloDeDestacados(politica: FeaturedPolicy): { etiqueta: string; titulo: string } {
  return politica === "cms" ? { etiqueta: "Selección", titulo: "Productos destacados" } : { etiqueta: "Nuevas piezas", titulo: "Novedades" };
}
