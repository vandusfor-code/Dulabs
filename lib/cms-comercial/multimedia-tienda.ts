/**
 * CMS comercial — de las FOTOS Y VIDEOS publicados a lo que la tienda de joyería dibuja. PURO (sin I/O).
 *
 * La tienda trae sus videos de siempre (los de DuLabs, en el registro del negocio). Lo que la administradora publica en «Fotos y videos» los REEMPLAZA espacio por espacio, y la imagen de
 * presentación de una categoría reemplaza la foto automática (la de uno de sus productos). Reglas que no se negocian (cada una con su prueba y su mutante):
 *   - nada publicado, o nada que se pueda mostrar => se devuelve EXACTAMENTE lo de siempre (la misma referencia: la tienda se ve idéntica a hoy);
 *   - un video solo se usa si es de verdad un video listo, tiene su imagen fija lista y sus medidas sirven para ESE espacio; si algo no cuadra, ese espacio vuelve al video de siempre
 *     (nunca un hueco, nunca un video deformado);
 *   - si se cambia el video horizontal pero no se sube uno vertical, el celular usa el horizontal recortado (jamás el vertical de siempre, que es de otra escena);
 *   - el punto focal del video de siempre no se hereda: pertenece a esa escena;
 *   - solo se reemplaza un espacio que la tienda YA tiene (no se inventan bloques que su diseño no trae);
 *   - los textos de cada bloque (título, botón…) no se tocan: son de la tienda.
 */
import type { PublicHome } from "@/lib/catalogo/service";
import type { ArchivoVideo, ConfigJoyeria, VideoAmbiente } from "@/lib/catalogo/vitrina";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { imagenDeVitrina, rutaImagenCms, rutaVideoCms } from "@/lib/cms-comercial/vitrina";
import { comprobarMedidas, comprobarProporcion, ESPECIFICACIONES, ESPACIOS_VIDEO, usosDeVideo, type EspacioVideo } from "@/lib/cms-comercial/video-requisitos";

/** Un video personalizado de un espacio: el horizontal y, si se subió, el vertical. */
export interface VideoPersonalizado {
  horizontal: ArchivoVideo;
  vertical?: ArchivoVideo;
}

export interface ImagenCategoria {
  src: string;
  ancho: number;
  alto: number;
}

export interface MultimediaTienda {
  /** Solo los espacios personalizados Y que se pueden mostrar. */
  videos: Partial<Record<EspacioVideo, VideoPersonalizado>>;
  /** La imagen de presentación de las categorías que tienen una elegida, por id de categoría. */
  categorias: ReadonlyMap<string, ImagenCategoria>;
}

/**
 * Lo que la tienda puede mostrar de las fotos y videos publicados, o null si no hay nada que mostrar. Cada archivo se vuelve a comprobar contra lo que la base conoce de él (el tipo, y las
 * medidas contra las del espacio): publicar ya lo exigió, pero lo que se muestra no depende de que alguien lo haya hecho bien.
 */
export function multimediaDesdeCms(snap: InstantaneaCms, slug: string): MultimediaTienda | null {
  const publicada = snap.multimedia;
  if (!publicada) return null;
  const contenido = publicada.contenido;

  const archivoValido = (video: string, poster: string, espacioArchivo: keyof typeof ESPECIFICACIONES): ArchivoVideo | null => {
    const v = snap.assets.get(video);
    const p = snap.assets.get(poster);
    if (!v || !p || v.mimeType !== "video/mp4" || !p.mimeType.startsWith("image/")) return null;
    const espec = ESPECIFICACIONES[espacioArchivo];
    if (!comprobarProporcion(v.ancho, v.alto, espec).ok || !comprobarMedidas(v.ancho, v.alto, espec).ok) return null;
    if (!(p.ancho > 0) || !(p.alto > 0)) return null;
    return { src: rutaVideoCms(slug, v.id), poster: rutaImagenCms(slug, p.id), width: v.ancho, height: v.alto };
  };

  const videos: MultimediaTienda["videos"] = {};
  const usos = usosDeVideo(contenido);
  for (const espacio of ESPACIOS_VIDEO) {
    const horizontal = usos.find((u) => u.archivo === `${espacio}.horizontal`);
    if (!horizontal) continue;
    const h = archivoValido(horizontal.video, horizontal.poster, horizontal.archivo);
    if (!h) continue; // sin un horizontal que sirva, el espacio vuelve al video de siempre (con su vertical)
    const vertical = usos.find((u) => u.archivo === `${espacio}.vertical`);
    const v = vertical ? archivoValido(vertical.video, vertical.poster, vertical.archivo) : null;
    videos[espacio] = { horizontal: h, ...(v ? { vertical: v } : {}) };
  }

  const categorias = new Map<string, ImagenCategoria>();
  for (const c of contenido.categorias ?? []) {
    const img = imagenDeVitrina(c.imagen, snap.assets, slug);
    if (img) categorias.set(c.categoria_id, { src: img.src, ancho: img.width, alto: img.height });
  }

  return Object.keys(videos).length === 0 && categorias.size === 0 ? null : { videos, categorias };
}

const conVideo = (original: VideoAmbiente, nuevo: VideoPersonalizado): VideoAmbiente => ({ horizontal: nuevo.horizontal, ...(nuevo.vertical ? { vertical: nuevo.vertical } : {}), etiqueta: original.etiqueta });

/**
 * La configuración de la tienda con los videos personalizados en lugar de los de siempre. Sin nada que reemplazar devuelve la MISMA referencia. Solo cambia los espacios que la tienda ya tiene.
 */
export function aplicarMultimedia(joyeria: ConfigJoyeria, m: MultimediaTienda | null): ConfigJoyeria {
  if (!m) return joyeria;
  let cambio = false;
  const sig: ConfigJoyeria = { ...joyeria };
  const { portada, coleccion, marca, mayoristas } = m.videos;
  if (portada && joyeria.portada) {
    sig.portada = { ...joyeria.portada, video: conVideo(joyeria.portada.video, portada) };
    cambio = true;
  }
  if (coleccion && joyeria.coleccion) {
    sig.coleccion = { ...joyeria.coleccion, video: conVideo(joyeria.coleccion.video, coleccion) };
    cambio = true;
  }
  if (marca && joyeria.marca) {
    sig.marca = { ...joyeria.marca, video: conVideo(joyeria.marca.video, marca) };
    cambio = true;
  }
  if (mayoristas && joyeria.mayoristas?.video) {
    sig.mayoristas = aplicarVideoMayoristas(joyeria.mayoristas, m);
    cambio = true;
  }
  return cambio ? sig : joyeria;
}

/** El bloque (o la página) de mayoristas con el video personalizado, si lo hay y el bloque ya tenía video. Sin cambio, el MISMO objeto. */
export function aplicarVideoMayoristas<T extends { video?: VideoAmbiente }>(mayoristas: T, m: MultimediaTienda | null): T {
  const nuevo = m?.videos.mayoristas;
  return nuevo && mayoristas.video ? { ...mayoristas, video: conVideo(mayoristas.video, nuevo) } : mayoristas;
}

/** Los videos con los que la tienda se ve hoy en cada espacio (los de DuLabs), solo de los espacios que la tienda tiene: lo que el panel muestra como «el de siempre» y a lo que se puede volver. */
export function videosDeSiempre(joyeria: ConfigJoyeria | null): Partial<Record<EspacioVideo, VideoPersonalizado>> {
  if (!joyeria) return {};
  const salida: Partial<Record<EspacioVideo, VideoPersonalizado>> = {};
  const poner = (espacio: EspacioVideo, v: VideoAmbiente | undefined) => {
    if (v) salida[espacio] = { horizontal: v.horizontal, ...(v.vertical ? { vertical: v.vertical } : {}) };
  };
  poner("portada", joyeria.portada?.video);
  poner("coleccion", joyeria.coleccion?.video);
  poner("marca", joyeria.marca?.video);
  poner("mayoristas", joyeria.mayoristas?.video);
  return salida;
}

/** Las categorías del inicio con la imagen que la administradora eligió para cada una (las demás conservan la foto de uno de sus productos). Sin nada que cambiar, la MISMA lista. */
export function aplicarCategorias(categorias: PublicHome["categories"], m: MultimediaTienda | null): PublicHome["categories"] {
  if (!m || m.categorias.size === 0) return categorias;
  let cambio = false;
  const salida = categorias.map((c) => {
    const imagen = m.categorias.get(c.id);
    if (!imagen) return c;
    cambio = true;
    return { ...c, coverUrl: imagen.src };
  });
  return cambio ? salida : categorias;
}
