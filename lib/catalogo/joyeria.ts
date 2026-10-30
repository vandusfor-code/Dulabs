/**
 * Tema "joyeria" (Bloque 30) — decisiones PURAS de presentación: qué anuncios se muestran, si hay bloque de mayoristas, cómo se rotulan el título de los destacados y las
 * migas de pan. Sin I/O y sin React: se prueba aparte (joyeria.test.ts). Nunca toca precios, stock, carrito ni pedidos.
 */
import { SIN_FILTROS, urlFiltros, type OpcionFaceta } from "@/lib/catalogo/filtros";
import type { LineaConfig, LineasJoyeria } from "@/lib/catalogo/lineas";
import { joyeriaOf, storefrontConfigFor, type ConfigJoyeria, type MayoristasJoyeria } from "@/lib/catalogo/vitrina";
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

/** Ruta de la página propia de mayoristas, bajo la tienda: /catalogo/{tienda}/mayoristas. */
export const RUTA_MAYORISTAS = "mayoristas";

/**
 * A dónde lleva el acceso «Mayorista» (cabecera, menú y pie): la página propia si la tienda la tiene; si no, el bloque del inicio (como siempre). null si no hay mayoristas que mostrar.
 */
export function hrefMayoristas(basePath: string, m: MayoristasVisible | null): string | null {
  if (!m) return null;
  return m.pagina ? `${basePath}/${RUTA_MAYORISTAS}` : `${basePath}#mayoristas`;
}

/** El bloque de mayoristas solo existe si hay contenido Y un WhatsApp válido al que escribir. */
export function mayoristasVisible(config: ConfigJoyeria, whatsapp: string | null | undefined): MayoristasVisible | null {
  const m = config.mayoristas;
  if (!m) return null;
  const href = enlaceWhatsapp(whatsapp, m.mensaje);
  if (!href) return null;
  return { etiqueta: m.etiqueta, titulo: m.titulo, texto: m.texto, boton: m.boton, href, ...(m.video ? { video: m.video } : {}), ...(m.pagina ? { pagina: m.pagina } : {}) };
}

export interface AcabadoVisible {
  clave: string;
  etiqueta: string;
  /** Listado filtrado por ese color (`?color=`): el mismo que arma el panel de filtros. */
  href: string;
}

/** Un acabado se muestra si el catálogo tiene al menos tantas piezas con ese color (un color con una o dos piezas no es una línea de la tienda). */
export const ACABADOS_MIN_PIEZAS = 3;
/** Cuántos acabados caben en la franja. */
export const ACABADOS_MAX = 4;

/**
 * Los acabados de la franja «Conoce nuestros acabados»: los colores REALES del catálogo activo con más piezas (nunca una lista escrita a mano), cada uno con su enlace al listado filtrado. Con menos de dos
 * opciones no hay franja (una sola no es una franja, y sin datos no se dibuja nada).
 */
export function acabadosVisibles(colores: readonly OpcionFaceta[] | null | undefined, basePath: string): AcabadoVisible[] {
  const elegidos = [...(colores ?? [])]
    .filter((c) => c.n >= ACABADOS_MIN_PIEZAS)
    .sort((a, b) => b.n - a.n || a.etiqueta.localeCompare(b.etiqueta, "es", { sensitivity: "base" }))
    .slice(0, ACABADOS_MAX);
  if (elegidos.length < 2) return [];
  return elegidos.map((c) => ({ clave: c.clave, etiqueta: c.etiqueta, href: urlFiltros(basePath, { ...SIN_FILTROS, colores: [c.clave] }) }));
}

/**
 * Rótulo del bloque de productos del inicio según de dónde salen: los más recientes con foto SON novedades; lo elegido a mano en el CMS es una selección. Nunca se
 * promete «más vendidos» ni nada que el catálogo no respalde.
 */
export function rotuloDeDestacados(politica: FeaturedPolicy): { etiqueta: string; titulo: string } {
  return politica === "cms" ? { etiqueta: "Selección", titulo: "Productos destacados" } : { etiqueta: "Nuevas piezas", titulo: "Novedades" };
}

export interface LineaVisible {
  clave: string;
  etiqueta: string;
  /** El listado de la línea (`?linea=plata`). */
  href: string;
  /** Las MISMAS categorías de la tienda, en su orden, cada una dentro de la línea (`?linea=plata&categoria=…`). Siempre todas: la estructura no depende de cuántas piezas haya. */
  categorias: ReadonlyArray<{ id: string; nombre: string; href: string }>;
}

/**
 * Las líneas que se muestran (menú, inicio): TODAS las de la configuración y en su orden, cada una con todas las categorías de la tienda, tenga o no piezas hoy. Se arman solo con la configuración y las
 * categorías que la tienda ya carga en cada pantalla (ninguna lectura de productos): el menú y el inicio nunca dependen de contar piezas. Sin líneas configuradas, la lista es vacía y la tienda se ve como siempre.
 */
export function lineasVisibles(config: LineasJoyeria | undefined, categorias: ReadonlyArray<{ id: string; name: string }>, basePath: string): LineaVisible[] {
  if (!config || config.lineas.length === 0) return [];
  return config.lineas.map((l) => ({
    clave: l.clave,
    etiqueta: l.etiqueta,
    href: urlFiltros(basePath, { ...SIN_FILTROS, lineas: [l.clave] }),
    categorias: categorias.map((c) => ({ id: c.id, nombre: c.name, href: urlFiltros(basePath, { ...SIN_FILTROS, lineas: [l.clave], categorias: [c.id] }) })),
  }));
}

/** Las líneas de la tienda de ese negocio, de su configuración; vacía si no tiene (entonces la tienda se ve como siempre). */
export function lineasDeLaTienda(slug: string): readonly LineaConfig[] {
  return joyeriaOf(storefrontConfigFor(slug))?.lineas?.lineas ?? [];
}

/** A dónde lleva el acceso «Líneas» de la cabecera: la franja de líneas del inicio. */
export function hrefLineas(basePath: string): string {
  return `${basePath}#lineas`;
}
