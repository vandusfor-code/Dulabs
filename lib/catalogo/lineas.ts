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

export const palabrasDe = (valor: string | null | undefined): string[] => {
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

/** Los nombres de las líneas a las que pertenece un material, en el orden de la configuración (vacío si no está en ninguna). */
export function etiquetasDeLineas(material: string | null | undefined, lineas: readonly LineaConfig[]): string[] {
  const palabras = palabrasDe(material);
  if (palabras.length === 0) return [];
  return lineas.filter((l) => pertenece(palabras, formasDe(l))).map((l) => l.etiqueta);
}

// ---------------------------------------------------------------------------
// Clasificar una pieza en una línea desde el panel. La línea de una pieza ES su campo «Material»: elegirla escribe ahí, sin datos nuevos ni migración.
// ---------------------------------------------------------------------------

/** Valor del filtro del panel para «las piezas que no están en ninguna línea». Ninguna línea de la configuración puede usar esta clave. */
export const LINEA_SIN = "sin";

/** Lo que admite el campo «Material» (igual a `CATALOG_LIMITS.material`: una prueba vigila que no se separen). */
export const LARGO_MAX_MATERIAL = 80;

interface PalabraEnTexto {
  palabra: string;
  /** Dónde empieza y dónde termina (sin incluir) en el texto ORIGINAL. */
  ini: number;
  fin: number;
}

/**
 * null = una tilde o marca que `normalizar` borra sin cortar la palabra; "" = un separador; otra cosa = las letras y números que aporta. Aplica a UN carácter las mismas reglas de `normalizar`
 * (una prueba comprueba que las dos dan siempre las mismas palabras).
 */
function normalizarCaracter(caracter: string): string | null {
  const sinTilde = caracter
    .replace(/ñ/gi, "\u0000")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\u0000/g, "ñ")
    .toLowerCase();
  if (sinTilde === "") return null;
  return sinTilde.replace(/[^a-z0-9ñ]/g, "");
}

/** Las mismas palabras que `palabrasDe`, pero con dónde están en el texto ORIGINAL: así se puede cambiar una sola palabra sin tocar el resto de lo que la persona escribió. */
export function palabrasConPosicion(texto: string): PalabraEnTexto[] {
  const palabras: PalabraEnTexto[] = [];
  let actual: PalabraEnTexto | null = null;
  let pos = 0;
  for (const caracter of texto) {
    const siguiente = pos + caracter.length;
    const limpio = normalizarCaracter(caracter);
    if (limpio === null) {
      if (actual) actual.fin = siguiente;
    } else if (limpio === "") {
      actual = null;
    } else {
      if (!actual) {
        actual = { palabra: "", ini: pos, fin: siguiente };
        palabras.push(actual);
      }
      actual.palabra += limpio;
      actual.fin = siguiente;
    }
    pos = siguiente;
  }
  return palabras;
}

function enPosicion(palabras: readonly PalabraEnTexto[], desde: number, frase: readonly string[]): boolean {
  return desde + frase.length <= palabras.length && frase.every((p, j) => palabras[desde + j].palabra === p);
}

/** Cambia cada aparición de la línea `vieja` en el texto por `nuevo` y deja todo lo demás como estaba. */
function cambiarLinea(texto: string, vieja: LineaConfig, nuevo: string): string {
  const palabras = palabrasConPosicion(texto);
  const formas = formasDe(vieja);
  let salida = "";
  let desde = 0;
  for (let i = 0; i < palabras.length; ) {
    let largo = 0;
    for (const forma of formas) if (forma.length > largo && enPosicion(palabras, i, forma)) largo = forma.length;
    if (largo === 0) {
      i++;
      continue;
    }
    salida += texto.slice(desde, palabras[i].ini) + nuevo;
    desde = palabras[i + largo - 1].fin;
    i += largo;
  }
  return salida + texto.slice(desde);
}

/** Como se escribe la línea en el material: su nombre, salvo que sus alias no lo reconozcan (entonces su primer alias; así lo escrito SIEMPRE queda en la línea). */
function nombreEscrito(linea: LineaConfig): string {
  return coincideLinea(linea.etiqueta, linea) ? linea.etiqueta : (linea.alias?.[0] ?? linea.etiqueta);
}

/** Recorta sin dejar un pedazo de palabra al final (un pedazo podría leerse como el nombre de otra línea). */
function recortarEnPalabra(texto: string, max: number): string {
  if (max <= 0) return "";
  if (texto.length <= max) return texto;
  let corte = texto.slice(0, max).replace(/[\uD800-\uDBFF]$/, "");
  if (/[\p{L}\p{M}\p{N}]/u.test(texto[max] ?? "") && /[\p{L}\p{M}\p{N}]$/u.test(corte)) corte = corte.replace(/[\p{L}\p{M}\p{N}]+$/u, "");
  return corte.replace(/[\s·,;:/|-]+$/u, "");
}

/**
 * El texto de «Material» que deja a la pieza en esa línea, cambiando lo mínimo:
 *   - ya está en la línea: igual (nunca se reescribe lo que ya sirve);
 *   - sin material: el nombre de la línea («Plata»);
 *   - con un material que no es de ninguna línea («Oro laminado 18k»): «Plata · Oro laminado 18k» (no se pierde lo escrito);
 *   - con el de OTRA línea («Rodio · 3cm»): solo cambia esa palabra («Plata · 3cm»);
 *   - con el de varias líneas («Acero y Rodio»): solo el nombre de la línea elegida.
 * Cabe siempre en el campo (80) y lo que devuelve SIEMPRE pertenece a la línea elegida y a ninguna que la pieza no tuviera. Una clave que no es de la configuración no cambia nada.
 */
export function materialConLinea(material: string | null | undefined, clave: string, lineas: readonly LineaConfig[]): string {
  const original = material ?? "";
  const elegida = lineas.find((l) => l.clave === clave);
  if (!elegida) return original;
  const palabras = palabrasDe(original);
  const actuales = lineas.filter((l) => pertenece(palabras, formasDe(l)));
  if (actuales.some((l) => l.clave === clave)) return original;

  const nombre = nombreEscrito(elegida);
  const texto = original.trim();
  if (texto === "") return nombre;

  let nuevo: string;
  if (actuales.length === 0) {
    const resto = recortarEnPalabra(texto, LARGO_MAX_MATERIAL - nombre.length - 3);
    nuevo = resto === "" ? nombre : `${nombre} · ${resto}`;
  } else if (actuales.length === 1) {
    nuevo = cambiarLinea(texto, actuales[0], nombre).replace(/\s+/g, " ").trim();
  } else {
    nuevo = nombre;
  }
  const sirve = nuevo.length <= LARGO_MAX_MATERIAL && coincideLinea(nuevo, elegida) && (actuales.length !== 1 || !coincideLinea(nuevo, actuales[0]));
  return sirve ? nuevo : nombre;
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
