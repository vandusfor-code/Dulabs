/**
 * Filtros del catálogo público (tema "joyeria"): línea, categoría, color, material y rango de precio. SOLO LECTURA sobre lo que el catálogo ya tiene:
 * no escribe nada, no cambia ningún precio ni inventario y no crea datos nuevos. Aquí vive lo puro (sin red ni React):
 *   - las claves con que se agrupan los valores que los negocios escriben a mano ("Dorada", "dorado" y "Dorado" son un solo color; "RODIO" y "Rodio", un solo material);
 *   - las facetas (qué opciones hay y cuántos productos tiene cada una) y el rango de precio real;
 *   - qué productos cumplen los filtros elegidos (dentro de un grupo basta uno; entre grupos deben cumplirse todos);
 *   - cómo viajan los filtros en la dirección (`?categoria=…&color=…&material=…&precio_min=…&precio_max=…`), de modo que cada vista se puede compartir y funciona sin JavaScript.
 */

import { calcularLineas, esClaveDeLinea, lineasDeMaterial, type LineaConfig, type LineaFaceta } from "@/lib/catalogo/lineas";

/** Paso del deslizador de precio (pesos). */
export const PRECIO_PASO = 1_000;

/** «$ 38.000»: pesos con punto de miles y un espacio tras el signo, como el rango de la referencia (los precios de las tarjetas llevan el signo pegado). */
export function formatoPrecio(n: number): string {
  return `$ ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}
/** Valores por grupo que se aceptan desde la dirección (lo demás se ignora). */
const MAX_VALORES = 12;
const MAX_CLAVE = 40;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FiltrosCatalogo {
  /** Claves de línea (`?linea=plata`, ver lib/catalogo/lineas.ts): cualquiera de ellas. Solo existe cuando la dirección trae una; las líneas que el negocio no tiene se ignoran. */
  lineas?: string[];
  /** Ids de categoría (cualquiera de ellas). */
  categorias: string[];
  /** Claves de color (ver `claveDe`): cualquiera de ellas. */
  colores: string[];
  /** Claves de material: cualquiera de ellas. */
  materiales: string[];
  /** Rango de precio EFECTIVO (el que se muestra), en pesos y ambos extremos incluidos. */
  precioMin?: number;
  precioMax?: number;
}

export const SIN_FILTROS: FiltrosCatalogo = { categorias: [], colores: [], materiales: [] };

export function hayFiltros(f: FiltrosCatalogo): boolean {
  return f.categorias.length > 0 || f.colores.length > 0 || f.materiales.length > 0 || (f.lineas?.length ?? 0) > 0 || f.precioMin !== undefined || f.precioMax !== undefined;
}

/** Solo una categoría y nada más: es el listado de siempre (`?categoria=<id>`), con su consulta paginada en la base. */
export function soloUnaCategoria(f: FiltrosCatalogo): string | null {
  return f.categorias.length === 1 && f.colores.length === 0 && f.materiales.length === 0 && !f.lineas?.length && f.precioMin === undefined && f.precioMax === undefined ? f.categorias[0] : null;
}

/**
 * Clave con que se agrupan los valores escritos a mano: sin tildes ni mayúsculas, sin signos y con la última palabra sin su terminación de género o plural
 * ("Dorada", "dorado" y "Dorados" -> "dorad"; "RODIO" y "Rodio" -> "rodi"; "Oro Rosa" -> "oro ros"). Vacío o sin letras: null.
 */
export function claveDe(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpio = valor
    .replace(/ñ/gi, "\u0000")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\u0000/g, "ñ")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpio) return null;
  const palabras = limpio.split(" ");
  const ultima = palabras[palabras.length - 1];
  if (ultima.length >= 4) palabras[palabras.length - 1] = ultima.replace(/(os|as|o|a)$/, "");
  return palabras.join(" ").slice(0, MAX_CLAVE);
}

/** Texto que ve la persona para un grupo de variantes ({escrito: veces}): la forma en masculino más usada ("Dorado"), con la primera letra en mayúscula. */
function etiquetaDe(variantes: ReadonlyMap<string, number>): string {
  const lista = [...variantes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"));
  const masculina = lista.find(([v]) => /o$/i.test(v.trim()));
  const elegida = (masculina ?? lista[0])[0].trim().replace(/\s+/g, " ").toLowerCase();
  return elegida.charAt(0).toUpperCase() + elegida.slice(1);
}

export interface OpcionFaceta {
  clave: string;
  etiqueta: string;
  /** Productos activos con ese valor. */
  n: number;
}

export interface OpcionCategoria {
  id: string;
  nombre: string;
  n: number;
}

export interface FacetasCatalogo {
  /** Productos activos en total. */
  total: number;
  /** Solo las categorías que tienen productos, en el orden del catálogo. */
  categorias: OpcionCategoria[];
  /** En orden alfabético (como la referencia). Un valor vacío no es una opción. */
  colores: OpcionFaceta[];
  materiales: OpcionFaceta[];
  /** Menor y mayor precio EFECTIVO (>0), redondeados al paso del deslizador; null si ningún producto tiene precio. */
  precio: { min: number; max: number } | null;
  /** Las líneas del negocio, EN SU ORDEN y aunque no tengan piezas, con su conteo y el de cada categoría dentro de ella. Solo existe si se pidieron (el negocio tiene líneas). */
  lineas?: LineaFaceta[];
}

/** Lo mínimo de un producto para filtrar: nada de imágenes ni datos internos. */
export interface FilaFaceta {
  categoryId: string | null;
  color: string | null;
  material: string | null;
  /** Precio efectivo que se muestra (null = a consultar). */
  price: number | null;
}

function agrupar(valores: ReadonlyArray<string | null>): OpcionFaceta[] {
  const grupos = new Map<string, { variantes: Map<string, number>; n: number }>();
  for (const valor of valores) {
    const clave = claveDe(valor);
    if (!clave || !valor) continue;
    const g = grupos.get(clave) ?? { variantes: new Map<string, number>(), n: 0 };
    g.variantes.set(valor, (g.variantes.get(valor) ?? 0) + 1);
    g.n += 1;
    grupos.set(clave, g);
  }
  return [...grupos.entries()]
    .map(([clave, g]) => ({ clave, etiqueta: etiquetaDe(g.variantes), n: g.n }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es", { sensitivity: "base" }) || b.n - a.n);
}

/**
 * `lineas` (las del negocio) añade el conteo de cada línea. `lineasElegidas` (las de la dirección) hace que las CATEGORÍAS se cuenten solo dentro de esas líneas: en la página de «Plata», «Anillos»
 * dice cuántos anillos de plata hay, no cuántos anillos hay en toda la tienda. Lo demás (colores, materiales, precio) sigue siendo del catálogo completo.
 */
export function calcularFacetas(
  filas: readonly FilaFaceta[],
  categorias: ReadonlyArray<{ id: string; name: string }>,
  lineas?: readonly LineaConfig[],
  lineasElegidas?: readonly string[],
): FacetasCatalogo {
  const porCategoria = new Map<string, number>();
  const dentro = lineas && lineasElegidas && lineasElegidas.length > 0 ? filas.filter((f) => lineasDeMaterial(f.material, lineas).some((l) => lineasElegidas.includes(l))) : filas;
  for (const f of dentro) if (f.categoryId) porCategoria.set(f.categoryId, (porCategoria.get(f.categoryId) ?? 0) + 1);
  const positivos = filas.map((f) => f.price).filter((p): p is number => p !== null && p > 0);
  return {
    total: filas.length,
    categorias: categorias.map((c) => ({ id: c.id, nombre: c.name, n: porCategoria.get(c.id) ?? 0 })).filter((c) => c.n > 0),
    colores: agrupar(filas.map((f) => f.color)),
    materiales: agrupar(filas.map((f) => f.material)),
    precio: positivos.length === 0 ? null : { min: Math.floor(Math.min(...positivos) / PRECIO_PASO) * PRECIO_PASO, max: Math.ceil(Math.max(...positivos) / PRECIO_PASO) * PRECIO_PASO },
    ...(lineas && lineas.length > 0 ? { lineas: calcularLineas(filas, lineas) } : {}),
  };
}

/** Dentro de un grupo basta con uno de los valores elegidos; entre grupos deben cumplirse todos. Un producto sin precio (a consultar o en 0) no cumple ningún rango. */
export function cumpleFiltros(fila: FilaFaceta, f: FiltrosCatalogo, lineas?: readonly LineaConfig[]): boolean {
  // Sin las líneas del negocio una `?linea=` no significa nada: se ignora (nunca deja la lista vacía por una dirección vieja).
  if (f.lineas && f.lineas.length > 0 && lineas && lineas.length > 0) {
    const deLaFila = lineasDeMaterial(fila.material, lineas);
    if (!f.lineas.some((l) => deLaFila.includes(l))) return false;
  }
  if (f.categorias.length > 0 && (!fila.categoryId || !f.categorias.includes(fila.categoryId))) return false;
  if (f.colores.length > 0) {
    const c = claveDe(fila.color);
    if (!c || !f.colores.includes(c)) return false;
  }
  if (f.materiales.length > 0) {
    const m = claveDe(fila.material);
    if (!m || !f.materiales.includes(m)) return false;
  }
  if (f.precioMin !== undefined || f.precioMax !== undefined) {
    // Un 0 no es un precio barato: es un producto sin precio, igual que «a consultar» (el rango del deslizador tampoco lo cuenta).
    if (fila.price === null || fila.price <= 0) return false;
    if (f.precioMin !== undefined && fila.price < f.precioMin) return false;
    if (f.precioMax !== undefined && fila.price > f.precioMax) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Dirección (URL)
// ---------------------------------------------------------------------------

type Params = Record<string, string | string[] | undefined>;

const lista = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const entero = (v: string | string[] | undefined): number | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return s !== undefined && /^\d{1,9}$/.test(s) ? Number(s) : undefined;
};
const claves = (v: string | string[] | undefined): string[] => [...new Set(lista(v).map((x) => claveDe(x)).filter((x): x is string => Boolean(x)))].slice(0, MAX_VALORES);
/** Claves de línea de la dirección: solo las bien formadas (minúsculas, números y guiones); las demás se ignoran. */
const clavesDeLinea = (v: string | string[] | undefined): string[] => [...new Set(lista(v).map((x) => x.trim().toLowerCase()).filter(esClaveDeLinea))].slice(0, MAX_VALORES);

/** Los filtros que trae la dirección. Todo lo que no sea válido se ignora (nunca un error): ids que no son UUID, precios que no son enteros, valores de más. */
export function leerFiltros(sp: Params): FiltrosCatalogo {
  let precioMin = entero(sp.precio_min);
  let precioMax = entero(sp.precio_max);
  if (precioMin !== undefined && precioMax !== undefined && precioMin > precioMax) [precioMin, precioMax] = [precioMax, precioMin];
  const lineas = clavesDeLinea(sp.linea);
  return {
    ...(lineas.length > 0 ? { lineas } : {}),
    categorias: [...new Set(lista(sp.categoria).filter((c) => UUID_PATTERN.test(c)))].slice(0, MAX_VALORES),
    colores: claves(sp.color),
    materiales: claves(sp.material),
    ...(precioMin !== undefined ? { precioMin } : {}),
    ...(precioMax !== undefined ? { precioMax } : {}),
  };
}

/** Los filtros como pares de la dirección, en orden estable. */
export function paramsDeFiltros(f: FiltrosCatalogo): Array<[string, string]> {
  return [
    ...(f.lineas ?? []).map((l): [string, string] => ["linea", l]),
    ...f.categorias.map((c): [string, string] => ["categoria", c]),
    ...f.colores.map((c): [string, string] => ["color", c]),
    ...f.materiales.map((m): [string, string] => ["material", m]),
    ...(f.precioMin !== undefined ? [["precio_min", String(f.precioMin)] as [string, string]] : []),
    ...(f.precioMax !== undefined ? [["precio_max", String(f.precioMax)] as [string, string]] : []),
  ];
}

/** Los filtros como texto estable (`color=dorad&precio_max=30000`): sirve de argumento a las cargas con caché por petición, que solo comparan valores simples. */
export function textoDeFiltros(f: FiltrosCatalogo): string {
  return new URLSearchParams(paramsDeFiltros(f)).toString();
}

/** Lo contrario de `textoDeFiltros`. */
export function filtrosDeTexto(texto: string): FiltrosCatalogo {
  const params: Record<string, string[]> = {};
  for (const [nombre, valor] of new URLSearchParams(texto)) (params[nombre] ??= []).push(valor);
  return leerFiltros(params);
}

/** Dirección del listado con estos filtros (y página). Sin filtros ni página es el listado completo de siempre (`?todo=1`). */
export function urlFiltros(basePath: string, f: FiltrosCatalogo, pagina?: number): string {
  const qs = new URLSearchParams(paramsDeFiltros(f));
  if (pagina && pagina > 1) qs.set("pagina", String(pagina));
  if (!qs.toString()) qs.set("todo", "1");
  return `${basePath}?${qs.toString()}`;
}

// ---------------------------------------------------------------------------
// Puntos de color (solo para colores que se conocen; el resto, sin punto)
// ---------------------------------------------------------------------------

const PUNTOS: ReadonlyMap<string, string> = new Map(
  (
    [
      ["Negro", "#1c1b1a"],
      ["Blanco", "#ffffff"],
      ["Rojo", "#c0392b"],
      ["Azul", "#2563b8"],
      ["Verde", "#2f7d52"],
      ["Rosa", "#e58aa8"],
      ["Rosado", "#e58aa8"],
      ["Oro rosa", "#d8a597"],
      ["Dorado", "#d4af37"],
      ["Plateado", "#bfc3c7"],
      ["Platinado", "#d6d8da"],
      ["Plata", "#c4c7ca"],
      ["Morado", "#7b4aa5"],
      ["Lila", "#b79bd6"],
      ["Gris", "#8b8b8b"],
      ["Café", "#6f4e37"],
      ["Marrón", "#7a4a2b"],
      ["Naranja", "#e8892b"],
      ["Amarillo", "#e9c33c"],
      ["Turquesa", "#2fb7b0"],
      ["Beige", "#d9c7a9"],
      ["Cobre", "#b87333"],
      ["Bronce", "#b07a43"],
    ] as const
  ).map(([nombre, hex]) => [claveDe(nombre) as string, hex] as const),
);

/** Color del punto que acompaña a una opción de color, o null si no se conoce. */
export function puntoDeColor(clave: string): string | null {
  return PUNTOS.get(clave) ?? null;
}
