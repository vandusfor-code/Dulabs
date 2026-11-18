/**
 * Búsqueda LOCAL (en memoria) sobre un conjunto PEQUEÑO y conocido de piezas.
 *
 * La búsqueda de siempre del agente vive en la base (`dulabs_catalogo_buscar`: texto completo en español, filtros y precio en SQL). Esa función no sabe
 * de qué lado de la tienda (Hombre / Mujer) es cada pieza —ese dato es una columna aparte (migración 20261215000000)—, así que «solo lo de hombre» no se
 * puede pedir a SQL sin cambiarla. Las piezas de hombre son pocas (decenas) y se conocen por su lista de referencias: se leen y se buscan AQUÍ, con las
 * MISMAS reglas que la función SQL:
 *
 *   - sin tildes ni mayúsculas (conserva la ñ), plurales y singulares («aretes» ~ «arete», «dijes» ~ «dije»), prefijos («dora» encuentra «dorado»);
 *   - modo `all` (todas las palabras) o `any` (alguna, para relajar), máximo 8 palabras;
 *   - pesos: nombre > color / material / categoría > descripción;
 *   - filtros: categoría (por id o por nombre), color, material, precio máximo DEL CANAL (el de lista, como la función SQL) y referencias excluidas;
 *   - orden: relevancia, disponibles primero, más recientes primero.
 *
 * Es una función PURA (sin red ni base): `busqueda-local.test.ts` la compara con la emulación de la función SQL que usan las pruebas.
 */
import type { CatalogProduct, PriceContext } from "@/lib/catalogo/domain";

/** Minúsculas y sin tildes (conserva la ñ): igual que `dulabs_catalogo_normalizar`. */
export function normalizarParaBusqueda(text: string): string {
  return text
    .replace(/ñ/g, "\u0000")
    .replace(/Ñ/g, "\u0000")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\u0000/g, "ñ")
    .toLowerCase();
}

/**
 * Palabras que no buscan nada: artículos, preposiciones, pronombres y posesivos (sin tildes). Son las del configurador español de la base (las descarta solo), para que «collar para mi mamá»
 * busque «collar» y «mamá» aquí igual que allá.
 */
export const PALABRAS_VACIAS: ReadonlySet<string> = new Set([
  "a", "al", "ante", "con", "contra", "como", "cuando", "de", "del", "desde", "donde", "durante", "e", "el", "ella", "ellas", "ellos", "en", "entre", "es", "esa", "esas", "ese", "eso", "esos", "esta", "estas",
  "este", "esto", "estos", "hasta", "hay", "la", "las", "le", "les", "lo", "los", "me", "mas", "mi", "mis", "muy", "ni", "no", "nos", "nuestra", "nuestras", "nuestro", "nuestros", "o", "os", "otra", "otras",
  "otro", "otros", "para", "pero", "por", "porque", "que", "se", "si", "sin", "sobre", "su", "sus", "te", "ti", "tu", "tus", "un", "una", "unas", "uno", "unos", "y", "ya", "yo",
]);

/**
 * Raíz aproximada de una palabra en español: quita el plural («es» solo si queda una raíz de 3 letras o más; si no, «s») y la vocal final
 * (aretes/arete → aret, dijes/dije → dij, anillos/anillo → anill, collares/collar → collar). Se compara por PREFIJO, como la base.
 */
export function raizDePalabra(palabra: string): string {
  let w = palabra;
  if (w.length > 3) {
    if (w.endsWith("es") && w.length - 2 >= 3) w = w.slice(0, -2);
    else if (w.endsWith("s")) w = w.slice(0, -1);
  }
  if (w.length > 3) w = w.replace(/[aeiou]$/, "");
  return w;
}

/** Las raíces de las palabras de un texto (sin las vacías ni las de una sola letra). */
export function palabrasDeBusqueda(text: string): string[] {
  return normalizarParaBusqueda(text)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 2 && !PALABRAS_VACIAS.has(w))
    .map(raizDePalabra);
}

/** Máximo de palabras de una consulta (igual que la función SQL). */
const BUSQUEDA_MAX_PALABRAS = 8;

export interface ConsultaLocal {
  text: string;
  /** all = todas las palabras; any = alguna. */
  mode: "all" | "any";
  channel: PriceContext;
  category?: string | null;
  color?: string | null;
  material?: string | null;
  categoryId?: string | null;
  maxPrice?: number | null;
  exclude?: readonly string[];
}

/**
 * Referencias de las piezas ACTIVAS que cumplen la consulta, en el orden de la búsqueda SQL (relevancia, disponibles primero, más recientes primero).
 * Sin texto (o solo con palabras vacías) cumplen todas las que pasan los filtros.
 */
export function buscarEnPiezas(piezas: readonly CatalogProduct[], q: ConsultaLocal): string[] {
  const palabras = palabrasDeBusqueda(q.text).slice(0, BUSQUEDA_MAX_PALABRAS);
  const norm = (v: string | null | undefined) => normalizarParaBusqueda(v ?? "");
  const excluidas = new Set(q.exclude ?? []);
  const categoria = q.category ? norm(q.category) : null;
  const color = q.color ? norm(q.color) : null;
  const material = q.material ? norm(q.material) : null;
  const puntuadas = piezas
    .filter((p) => p.status === "ACTIVE" && !excluidas.has(p.reference))
    .filter((p) => !q.categoryId || p.categoryId === q.categoryId)
    .filter((p) => categoria === null || norm(p.categoryName).includes(categoria))
    .filter((p) => color === null || norm(p.color).includes(color))
    .filter((p) => material === null || norm(p.material).includes(material))
    .filter((p) => {
      if (q.maxPrice == null) return true;
      const precio = q.channel === "wholesale" ? p.pricing.wholesale : p.pricing.retail;
      return precio !== null && precio <= q.maxPrice;
    })
    .map((p) => {
      const campos: Array<[string[], number]> = [
        [palabrasDeBusqueda(p.name), 1],
        [[...palabrasDeBusqueda(p.color ?? ""), ...palabrasDeBusqueda(p.material ?? ""), ...palabrasDeBusqueda(p.categoryName ?? "")], 0.6],
        [palabrasDeBusqueda((p.description ?? "").slice(0, 2000)), 0.2],
      ];
      let puntaje = 0;
      let coinciden = 0;
      for (const w of palabras) {
        const peso = Math.max(0, ...campos.map(([tokens, valor]) => (tokens.some((t) => t.startsWith(w)) ? valor : 0)));
        if (peso > 0) coinciden++;
        puntaje += peso;
      }
      const cumple = palabras.length === 0 || (q.mode === "all" ? coinciden === palabras.length : coinciden > 0);
      return { p, puntaje, cumple, disponible: !p.tracksStock || p.stock > 0 };
    })
    .filter((x) => x.cumple)
    .sort((a, b) => b.puntaje - a.puntaje || Number(b.disponible) - Number(a.disponible) || b.p.createdAt.localeCompare(a.p.createdAt) || b.p.id.localeCompare(a.p.id));
  return puntuadas.map((x) => x.p.reference);
}
