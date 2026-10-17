/**
 * CMS comercial — la PÁGINA de mayoristas de una tienda de joyería, ARMADA: lo que la tienda dice (su configuración y su WhatsApp), lo que la administradora publicó en «Fotos y videos» (el video y los textos
 * del bloque «Compras por mayor») y las preguntas del CMS. Las lecturas llegan inyectadas (se prueba sin red ni base de datos); la ruta de Next solo las conecta.
 *
 * Lo publicado se aplica ANTES de armar el enlace de WhatsApp: el botón lleva el mensaje que ella escribió, no el de siempre. Nada de esto puede romper la página: sin nada publicado, o ante cualquier
 * problema al leerlo, se dibuja con los textos y el video de la tienda.
 */
import { mayoristasVisible, type MayoristasVisible } from "@/lib/catalogo/joyeria";
import { joyeriaOf, storefrontConfigFor } from "@/lib/catalogo/vitrina";
import { aplicarMultimedia, type MultimediaTienda } from "@/lib/cms-comercial/multimedia-tienda";
import type { OpcionesPaginaMayoristas, PaginaMayoristas } from "@/lib/cms-comercial/pagina-mayoristas";

/** Lo mínimo que la página necesita saber de la tienda publicada. */
export interface TiendaDeMayoristas {
  slug: string;
  whatsapp: string | null;
}

export interface DepsTiendaMayoristas<T extends TiendaDeMayoristas> {
  /** La tienda publicada y visible (null si no existe). Una sola lectura por petición. */
  tienda(slug: string): Promise<T | null>;
  /** Lo publicado en «Fotos y videos» (null = nada que reemplazar). Se pide a la vez que la tienda; nunca debería lanzar, y si lanza la página sale con lo de siempre. */
  multimedia(slug: string): Promise<MultimediaTienda | null>;
  /** Lo publicado en el CMS para la página (null = sin contenido: la página se dibuja con el texto de la tienda). */
  pagina(slug: string, opciones: OpcionesPaginaMayoristas): Promise<PaginaMayoristas | null>;
}

export interface PaginaDeMayoristas<T extends TiendaDeMayoristas> {
  tienda: T;
  /** El bloque tal como se pinta: con el video y los textos publicados en lugar de los de siempre y el enlace de WhatsApp con su mensaje. */
  mayoristas: MayoristasVisible;
  pagina: PaginaMayoristas | null;
}

/**
 * La página de mayoristas de la tienda con ese slug; null si no existe la tienda o no tiene la página (la ruta responde entonces 404: nunca una página vacía). Solo existe si la tienda es de tema
 * «joyería», configura la página y tiene un WhatsApp válido al que escribir.
 */
export async function armarPaginaMayoristas<T extends TiendaDeMayoristas>(slug: string, deps: DepsTiendaMayoristas<T>): Promise<PaginaDeMayoristas<T> | null> {
  // En camino mientras se lee la tienda; si falla, la página sale con lo de siempre (y si la tienda no existe, nadie espera su resultado).
  const publicada = deps.multimedia(slug).catch(() => null);
  const tienda = await deps.tienda(slug);
  if (!tienda) return null;
  const joyeria = joyeriaOf(storefrontConfigFor(tienda.slug));
  if (!joyeria) return null;
  const mayoristas = mayoristasVisible(aplicarMultimedia(joyeria, await publicada), tienda.whatsapp);
  if (!mayoristas?.pagina) return null;
  return { tienda, mayoristas, pagina: await deps.pagina(tienda.slug, mayoristas.pagina) };
}
