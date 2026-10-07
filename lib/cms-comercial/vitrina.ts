/**
 * CMS comercial — de LO PUBLICADO a la VITRINA de la tienda pública. PURO (sin I/O): el reloj, la tienda y los datos del catálogo llegan por parámetro.
 *
 * La tienda sigue hablando su contrato de siempre (`CatalogStorefrontConfig`, lib/catalogo/vitrina.ts): este módulo solo lo RELLENA con la página principal publicada
 * en el CMS. Reglas que no se negocian (cada una con su prueba y su mutante):
 *   - nada publicado => se devuelve EXACTAMENTE el registro actual (la tienda se ve idéntica a hoy: módulo apagado, sin portada publicada o con un error al leer);
 *   - una imagen que no está lista, o un destino que ya no existe o no está activo, NO se muestra: nunca una portada rota ni un botón que no lleva a ningún lado;
 *   - la portada solo sale completa (imagen y título); nunca «a medias»;
 *   - lo vigente (campañas) lo decide evaluacion.ts, el ÚNICO lugar donde se evalúa;
 *   - la tienda de tecnología (otro tema, con su propio contenido) no la maneja el CMS: se queda como está.
 */
import type { Destino, Imagen } from "@/lib/cms-comercial/esquemas";
import { campanasActivas, combosActivos, ofertasActivas, type ContextoEvaluacion } from "@/lib/cms-comercial/evaluacion";
import type { AssetPublicoCms, InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { ORDEN_INICIO_CLASICO, SECCIONES_DIBUJADAS, type CampanaVitrina, type CatalogStorefrontConfig, type SeccionInicio, type StorefrontImage } from "@/lib/catalogo/vitrina";

export interface ContextoVitrina {
  /** Slug público de la tienda (sale de la publicación; nunca el id del negocio). */
  slug: string;
  /** /catalogo/{slug} */
  basePath: string;
  /** /catalogo/{slug}?todo=1 */
  listPath: string;
  /** Número de pedidos del negocio, tal como lo entrega el catálogo (solo se usan sus dígitos). */
  whatsapp: string | null;
  /** Ids de las categorías que EXISTEN en el catálogo (un botón a una categoría borrada no se muestra). */
  categorias: ReadonlySet<string>;
  /** Instante de la evaluación en milisegundos (reloj inyectado). */
  ahora: number;
  /** Secciones que la tienda sabe dibujar (por defecto, las de hoy). */
  dibujadas?: readonly SeccionInicio[];
}

/** Ruta pública de una imagen del CMS: el servidor la resuelve (negocio, imagen lista y usada en contenido publicado) y la reenvía; nunca la URL de Storage. */
export const rutaImagenCms = (slug: string, assetId: string): string => `/catalogo/${slug}/vitrina/${assetId}.webp`;

/** Una imagen del CMS lista para la tienda, o null si no se puede mostrar (asset ausente o sin terminar de subir). */
export function imagenDeVitrina(imagen: Imagen | undefined, assets: ReadonlyMap<string, AssetPublicoCms>, slug: string): (StorefrontImage & { focus?: string }) | null {
  if (!imagen) return null;
  if (imagen.origen === "estatico") return { src: imagen.src, width: imagen.ancho, height: imagen.alto, alt: imagen.alt, ...(imagen.foco ? { focus: imagen.foco } : {}) };
  const asset = assets.get(imagen.asset);
  if (!asset || !(asset.ancho > 0) || !(asset.alto > 0)) return null;
  return { src: rutaImagenCms(slug, asset.id), width: asset.ancho, height: asset.alto, alt: imagen.alt, ...(imagen.foco ? { focus: imagen.foco } : {}) };
}

/** Todas las imágenes del CMS que el contenido PUBLICADO usa (la ruta pública solo sirve estas). */
export function assetsReferenciados(snap: InstantaneaCms): Set<string> {
  const ids = new Set<string>();
  const ver = (imagen: Imagen | undefined) => {
    if (imagen && imagen.origen === "cms") ids.add(imagen.asset);
  };
  if (snap.home) {
    ver(snap.home.contenido.portada.imagen);
    ver(snap.home.contenido.banner?.imagen);
  }
  for (const o of snap.ofertas) ver(o.contenido.imagen);
  for (const c of snap.combos) ver(c.contenido.imagen);
  for (const c of snap.campanas) {
    ver(c.contenido.imagen);
    ver(c.contenido.portada?.imagen);
  }
  return ids;
}

/** Los dígitos de un número de WhatsApp válido (8 o más, como el resto de la tienda), o null. */
function digitosWhatsapp(numero: string | null): string | null {
  const digitos = (numero ?? "").replace(/\D/g, "");
  return digitos.length >= 8 && digitos.length <= 15 ? digitos : null;
}

/**
 * A dónde lleva un botón o un banner. null = el destino no existe o no está disponible AHORA (el botón no se muestra):
 *   catálogo → el listado · categoría → solo si existe · búsqueda → el listado filtrado · WhatsApp → solo con un número válido ·
 *   oferta, combo o campaña → su sección de la página principal, solo si está publicada y ACTIVA hoy y la tienda ya dibuja esa sección.
 */
export function hrefDeDestino(destino: Destino | undefined, ctx: ContextoVitrina, ev: ContextoEvaluacion): string | null {
  if (!destino) return null;
  const dibujadas = ctx.dibujadas ?? SECCIONES_DIBUJADAS;
  switch (destino.tipo) {
    case "catalogo":
      return ctx.listPath;
    case "categoria":
      return ctx.categorias.has(destino.categoria_id) ? `${ctx.basePath}?categoria=${encodeURIComponent(destino.categoria_id)}` : null;
    case "busqueda":
      return destino.consulta.trim() === "" ? null : `${ctx.basePath}?q=${encodeURIComponent(destino.consulta.trim())}`;
    case "whatsapp": {
      const digitos = digitosWhatsapp(ctx.whatsapp);
      return digitos ? `https://wa.me/${digitos}` : null;
    }
    case "oferta":
      return dibujadas.includes("ofertas") && ofertasActivas(ev).some((o) => o.clave === destino.clave) ? `${ctx.basePath}#ofertas` : null;
    case "combo":
      return dibujadas.includes("combos") && combosActivos(ev).some((c) => c.clave === destino.clave) ? `${ctx.basePath}#combos` : null;
    case "campana":
      return dibujadas.includes("campana") && campanasActivas(ev).some((c) => c.clave === destino.clave) ? `${ctx.basePath}#campana` : null;
  }
}

/**
 * El bloque de la campaña ACTIVA de mayor prioridad que tenga algo que mostrar (portada o productos destacados). Una sola: la home tiene una sección «campaña».
 * Su portada usa la imagen propia y, si no la tiene, la de la campaña; el botón solo sale si su destino existe y está disponible hoy.
 */
function campanaParaInicio(snap: InstantaneaCms, ctx: ContextoVitrina, ev: ContextoEvaluacion): CampanaVitrina | undefined {
  for (const c of campanasActivas(ev)) {
    const p = c.contenido.portada;
    const productos = c.contenido.productos_destacados;
    if (!p && productos.length === 0) continue;
    let portada: CampanaVitrina["portada"];
    if (p) {
      const imagen = imagenDeVitrina(p.imagen ?? c.contenido.imagen, snap.assets, ctx.slug);
      const href = p.boton ? hrefDeDestino(p.boton.destino, ctx, ev) : null;
      portada = {
        ...(p.etiqueta ? { etiqueta: p.etiqueta } : {}),
        titulo: p.titulo,
        ...(p.subtitulo ? { subtitulo: p.subtitulo } : {}),
        ...(imagen ? { imagen } : {}),
        ...(p.boton && href ? { boton: { texto: p.boton.texto, href } } : {}),
      };
    }
    return { nombre: c.contenido.nombre, ...(portada ? { portada } : {}), productos };
  }
  return undefined;
}

/**
 * La vitrina de la tienda a partir de lo PUBLICADO. Sin página principal publicada (o con la tienda de tecnología) devuelve el registro SIN TOCAR (la misma referencia).
 * Con ella, la marca y el tema siguen siendo los del registro (el CMS no los maneja) y todo lo editorial —portada, banner, destacados, secciones y campaña— sale del CMS.
 */
export function vitrinaDesdeCms(snap: InstantaneaCms, registro: CatalogStorefrontConfig, ctx: ContextoVitrina): CatalogStorefrontConfig {
  if (registro.tema === "tecnologia" || snap.home === null) return registro;

  const h = snap.home.contenido;
  const ev: ContextoEvaluacion = { snap, canal: "retail", ahora: ctx.ahora };
  const dibujadas = ctx.dibujadas ?? SECCIONES_DIBUJADAS;
  // Las secciones del CMS y las de la tienda son la misma lista cerrada (una prueba vigila que no se separen).
  const visibles: SeccionInicio[] = h.secciones.filter((s) => s.visible).map((s) => s.tipo);
  const se = (s: SeccionInicio) => visibles.includes(s);

  const config: CatalogStorefrontConfig = { ...(registro.brand ? { brand: registro.brand } : {}), ...(registro.tema ? { tema: registro.tema } : {}) };

  // Portada: visible en su tarjeta Y en la lista de secciones, con imagen lista y título; si no, no hay portada (nunca a medias).
  const imagenPortada = h.portada.visible && se("portada") ? imagenDeVitrina(h.portada.imagen, snap.assets, ctx.slug) : null;
  if (imagenPortada) {
    const href = h.portada.boton ? hrefDeDestino(h.portada.boton.destino, ctx, ev) : null;
    config.heroImage = imagenPortada;
    config.heroTitle = h.portada.titulo;
    if (h.portada.etiqueta) config.heroEyebrow = h.portada.etiqueta;
    if (h.portada.subtitulo) config.heroDescription = h.portada.subtitulo;
    // Sin botón (o con un destino que ya no existe): `heroCta` vacío = no se dibuja el botón.
    config.heroCta = h.portada.boton && href ? h.portada.boton.texto : "";
    if (href) config.heroHref = href;
  }

  // Banner: la imagen ya trae su diseño; si tiene destino disponible, es un enlace.
  const imagenBanner = h.banner && h.banner.visible && se("banner") ? imagenDeVitrina(h.banner.imagen, snap.assets, ctx.slug) : null;
  if (imagenBanner) {
    config.bannerImage = { src: imagenBanner.src, width: imagenBanner.width, height: imagenBanner.height, alt: imagenBanner.alt };
    const href = hrefDeDestino(h.banner?.destino, ctx, ev);
    if (href) config.bannerHref = href;
  }

  // Secciones: las visibles que la tienda sabe dibujar, en el orden elegido (una sección repetida no existe: el esquema lo impide).
  const secciones = visibles.filter((s) => dibujadas.includes(s));
  config.secciones = secciones;

  if (secciones.includes("campana")) {
    const campana = campanaParaInicio(snap, ctx, ev);
    if (campana) config.campana = campana;
  }
  if (secciones.includes("destacados") && h.productos_destacados.length > 0) config.destacados = h.productos_destacados;
  if (secciones.includes("categorias") && h.categorias_destacadas.length > 0) config.categoriasDestacadas = h.categorias_destacadas;
  return config;
}

/** La lista de secciones que dibuja el inicio con este contenido (para saber qué cargar del catálogo): sin contenido del CMS, el orden de siempre. */
export function seccionesDeInicio(config: CatalogStorefrontConfig): readonly SeccionInicio[] {
  return config.secciones ?? ORDEN_INICIO_CLASICO;
}
