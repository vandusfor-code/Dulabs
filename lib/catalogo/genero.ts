/**
 * Hombre / Mujer en la tienda del tema "joyeria" (Delacour · Vértice) — decisiones PURAS (sin red ni React):
 *   - qué es el «para quién» de una pieza (Mujer u Hombre; lo que no se marca es Mujer) y cómo viaja en la dirección (`?genero=hombre`);
 *   - qué es «el lado de hombre» de la tienda (su nombre, su lema) y cómo se configura;
 *   - cuándo la tienda se pinta con la paleta de hombre (Vértice: grafito y plata): en el listado de hombre y en la ficha de una pieza de hombre.
 *
 * El «para quién» de cada pieza es la columna `genero` del producto (migración 20261215000000). El código LEE esa columna aparte de la lectura de siempre de los productos (no está en la lista de columnas
 * de `listProducts`): si la migración aún no se aplicó, la separación queda apagada y la tienda y el panel se ven EXACTAMENTE como antes. Nada de esto cambia precios, inventario, carrito ni pedidos.
 */
import { GENEROS, GENERO_PREDETERMINADO, type Genero } from "@/lib/catalogo/domain";
import { referenceFromUrl } from "@/lib/catalogo/publicacion";

export { GENEROS, GENERO_PREDETERMINADO, type Genero };

/** Nombre del atributo con que la página avisa «estoy en el lado de hombre»: el CSS pinta TODA la tienda (cabecera, listado, ficha y pie) con la paleta de Vértice cuando lo encuentra. */
export const ATRIBUTO_TEMA_GENERO = "data-tema-genero";

export function esGenero(valor: unknown): valor is Genero {
  return typeof valor === "string" && (GENEROS as readonly string[]).includes(valor);
}

/**
 * El lado de hombre de la tienda de un negocio. Es configuración de la tienda (código, como las líneas, los anuncios y los videos del inicio): cambiarla es un cambio pequeño y no necesita migración.
 * Los negocios sin `genero` en su configuración no tienen separación y su tienda no cambia.
 */
export interface GeneroJoyeria {
  /** Rótulos del selector de la cabecera y del menú. */
  mujer: { etiqueta: string };
  hombre: {
    /** «Hombre»: cómo se llama el lado en el selector. */
    etiqueta: string;
    /** La casa que firma la colección («Delacour»): va arriba del título, en letras abiertas, como en el catálogo de Vértice. */
    casa: string;
    /** El nombre de la colección («Vértice»): el título grande del lado de hombre. */
    marca: string;
    /** Línea pequeña sobre el título («Colección masculina»). */
    antetitulo: string;
    /** Frase bajo el título («Identidad forjada en acero»). */
    lema: string;
    /** Texto de la entrada del inicio («Para él»). */
    entrada: { etiqueta: string; titulo: string; texto: string; boton: string };
  };
}

/** `?genero=` de la dirección: solo «hombre» cuenta (el lado de mujer es el de siempre y no se escribe). Cualquier otra cosa se ignora: nunca deja una lista vacía ni da error. */
export function generoDeParam(valor: string | string[] | null | undefined): "hombre" | undefined {
  const v = (Array.isArray(valor) ? valor[0] : valor)?.trim().toLowerCase();
  return v === "hombre" ? "hombre" : undefined;
}

/** Referencia en la forma de comparar («dl-000769» y «DL-000769» son la misma pieza). */
export function claveDeReferencia(referencia: string): string {
  return referencia.trim().toUpperCase();
}

/** Las referencias de hombre como conjunto de claves (para preguntar «¿es de hombre?» sin recorrer la lista). */
export function conjuntoDeHombres(referencias: readonly string[] | ReadonlySet<string> | null | undefined): ReadonlySet<string> {
  return new Set([...(referencias ?? [])].map(claveDeReferencia));
}

/** Para quién es una pieza, dadas las referencias de hombre del negocio. Lo que no está en esa lista es de mujer. */
export function generoDe(referencia: string, hombres: ReadonlySet<string>): Genero {
  return hombres.has(claveDeReferencia(referencia)) ? "hombre" : GENERO_PREDETERMINADO;
}

/** Dirección del lado de la tienda: el de mujer es la tienda de siempre (`/catalogo/delacour`); el de hombre, el listado de hombre. */
export function hrefDeGenero(basePath: string, genero: Genero): string {
  return genero === "hombre" ? `${basePath}?genero=hombre` : basePath;
}

/** La referencia de la ficha que muestra una ruta («/catalogo/delacour/productos/dl-000769»), o null si la ruta no es de una ficha de este negocio. */
export function referenciaDeRuta(basePath: string, pathname: string): string | null {
  const prefijo = `${basePath}/productos/`;
  if (!pathname.startsWith(prefijo)) return null;
  const resto = pathname.slice(prefijo.length).split("/")[0];
  let texto = resto;
  try {
    texto = decodeURIComponent(resto);
  } catch {
    // una ruta mal codificada no es una referencia
  }
  return referenceFromUrl(texto);
}

/**
 * ¿La tienda se pinta con la paleta de hombre? Sí en el listado de hombre (`?genero=hombre`) y en la ficha de una pieza que es de hombre. Lo decide la dirección y la lista de referencias de hombre
 * del negocio, que el servidor ya mandó con la cabecera: así la primera pantalla sale con el color correcto (sin un parpadeo de claro a oscuro) y al tocar «Hombre» cambia al instante.
 */
export function temaDeHombre(entrada: { basePath: string; pathname: string; genero: string | null | undefined; hombres: ReadonlySet<string> }): boolean {
  if (entrada.hombres.size === 0) return false;
  if (generoDeParam(entrada.genero ?? undefined) === "hombre") return true;
  const referencia = referenciaDeRuta(entrada.basePath, entrada.pathname);
  return referencia !== null && entrada.hombres.has(referencia);
}
