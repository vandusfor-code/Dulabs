/**
 * Líneas de la tienda del tema "joyeria" (Plata, Rodio, Acero, Cover Gold…): el primer nivel de la navegación, con las MISMAS categorías del negocio dentro de cada una. SOLO LECTURA y sin datos
 * nuevos: una pieza pertenece a una línea según el texto que el negocio ya escribe en su campo «Material», así que no hay migración ni hay que volver a cargar nada. Aquí vive lo puro (sin red
 * ni React):
 *   - qué es una línea (clave de la dirección, nombre y las palabras con que se reconoce en el material);
 *   - a qué líneas pertenece un material escrito a mano («Plata 925» -> Plata; «Rodio · 3cm» y «Rodio platinado» -> Rodio; «COVERGOLD» y «Cover-Gold» -> Cover Gold);
 *   - cuántas piezas tiene cada línea y cuántas por categoría dentro de ella.
 *
 * Se reconoce por PALABRAS COMPLETAS, nunca por pedazos de palabra: «Plateado» (un color) o «Platería» no son «Plata». Una pieza puede estar en más de una línea («Acero y Rodio»); una sin
 * material no está en ninguna (sigue estando en todo el catálogo y en su categoría).
 *
 * No importa nada de filtros.ts a propósito (filtros.ts es quien usa este módulo): así no hay ciclos.
 */

/** Una línea de la tienda. */
export interface LineaConfig {
  /** Va en la dirección (`?linea=plata`): minúsculas, números y guiones (ver `esClaveDeLinea`). */
  clave: string;
  /** Cómo la ve la clienta («Cover Gold»). */
  etiqueta: string;
  /** Otras formas de escribirla en el material. Sin esto vale la propia etiqueta. Las palabras sueltas («covergold») y las frases («cover gold») se reconocen completas. */
  alias?: readonly string[];
}

/** Las líneas de un negocio con el título de su franja del inicio. */
export interface LineasJoyeria {
  titulo: string;
  lineas: readonly LineaConfig[];
}

const MAX_CLAVE_LINEA = 30;
const CLAVE_LINEA = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** ¿Es una clave de línea bien formada? Lo que no lo sea (ni se mire en la configuración) se ignora al leer la dirección. */
export function esClaveDeLinea(valor: string): boolean {
  return valor.length > 0 && valor.length <= MAX_CLAVE_LINEA && CLAVE_LINEA.test(valor);
}

/** Texto sin tildes (la «ñ» se conserva), en minúsculas, sin signos y con los espacios en uno: «Rodio · 3cm» -> «rodio 3cm», «Cover-Gold» -> «cover gold». */
function normalizar(valor: string): string {
  return valor
    .replace(/ñ/gi, "\u0000")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\u0000/g, "ñ")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const palabrasDe = (valor: string | null | undefined): string[] => {
  const limpio = valor ? normalizar(valor) : "";
  return limpio === "" ? [] : limpio.split(" ");
};

/** Las formas de reconocer una línea, ya en palabras: sus alias, o su etiqueta si no tiene. */
function formasDe(linea: LineaConfig): string[][] {
  const textos = linea.alias && linea.alias.length > 0 ? linea.alias : [linea.etiqueta];
  return textos.map(palabrasDe).filter((p) => p.length > 0);
}

/** ¿Aparece esa frase (varias palabras seguidas) completa dentro de las palabras del material? */
function contiene(palabras: readonly string[], frase: readonly string[]): boolean {
  for (let i = 0; i + frase.length <= palabras.length; i++) {
    if (frase.every((p, j) => palabras[i + j] === p)) return true;
  }
  return false;
}

function pertenece(palabras: readonly string[], formas: readonly string[][]): boolean {
  return palabras.length > 0 && formas.some((f) => contiene(palabras, f));
}

/** ¿Este material es de esta línea? */
export function coincideLinea(material: string | null | undefined, linea: LineaConfig): boolean {
  return pertenece(palabrasDe(material), formasDe(linea));
}

/** Las claves de TODAS las líneas a las que pertenece un material (puede ser más de una, o ninguna). */
export function lineasDeMaterial(material: string | null | undefined, lineas: readonly LineaConfig[]): string[] {
  const palabras = palabrasDe(material);
  if (palabras.length === 0) return [];
  return lineas.filter((l) => pertenece(palabras, formasDe(l))).map((l) => l.clave);
}

/** Lo mínimo de un producto para ubicarlo en una línea y en una categoría. */
export interface FilaDeLinea {
  categoryId: string | null;
  material: string | null;
}

/** Una línea con su conteo y el de cada categoría DENTRO de ella (solo las categorías con piezas). */
export interface LineaFaceta {
  clave: string;
  etiqueta: string;
  /** Piezas activas de la línea. */
  n: number;
  categorias: ReadonlyArray<{ id: string; n: number }>;
}

/**
 * Una entrada por cada línea de la configuración, EN SU ORDEN y aunque no tenga ninguna pieza (la estructura de la tienda no depende de cuántas piezas haya): cuántas piezas tiene y cuántas por
 * categoría. Cada material se resuelve una sola vez, aunque se repita en cientos de piezas.
 */
export function calcularLineas(filas: readonly FilaDeLinea[], lineas: readonly LineaConfig[]): LineaFaceta[] {
  const resueltos = new Map<string, readonly string[]>();
  const totales = new Map<string, number>(lineas.map((l) => [l.clave, 0]));
  const porCategoria = new Map<string, Map<string, number>>(lineas.map((l) => [l.clave, new Map()]));
  for (const fila of filas) {
    const material = fila.material;
    if (!material) continue;
    let claves = resueltos.get(material);
    if (!claves) {
      claves = lineasDeMaterial(material, lineas);
      resueltos.set(material, claves);
    }
    for (const clave of claves) {
      totales.set(clave, (totales.get(clave) ?? 0) + 1);
      if (fila.categoryId) {
        const categorias = porCategoria.get(clave);
        categorias?.set(fila.categoryId, (categorias.get(fila.categoryId) ?? 0) + 1);
      }
    }
  }
  return lineas.map((l) => ({
    clave: l.clave,
    etiqueta: l.etiqueta,
    n: totales.get(l.clave) ?? 0,
    categorias: [...(porCategoria.get(l.clave) ?? new Map<string, number>()).entries()].map(([id, n]) => ({ id, n })),
  }));
}

/**
 * Las claves de línea que la configuración conoce, en el orden en que llegaron y sin repetir. Lo que no es una línea de este negocio se ignora (nunca un error ni una página vacía por una
 * dirección vieja o mal escrita).
 */
export function clavesConocidas(claves: readonly string[] | undefined, lineas: readonly LineaConfig[] | undefined): string[] {
  if (!claves || claves.length === 0 || !lineas || lineas.length === 0) return [];
  const conocidas = new Set(lineas.map((l) => l.clave));
  return [...new Set(claves.filter((c) => conocidas.has(c)))];
}
