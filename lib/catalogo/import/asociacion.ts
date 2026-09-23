/**
 * Carga masiva — ASOCIACIÓN fila <-> fotos. PURA y DETERMINISTA: el mismo
 * archivo y las mismas fotos dan siempre el mismo resultado, y NUNCA se
 * adivina por parecido.
 *
 * Una fila toma sus fotos de UNA fuente, en este orden:
 *   1. picked — las que la persona eligió en el preview (ids exactos);
 *   2. cell   — la columna «imagenes» (nombre de archivo, ruta o carpeta;
 *               «sin foto» = ninguna);
 *   3. auto   — por nombre, con la clave "slug" (ver photoKey) del código,
 *               de nombre + color o del nombre, la primera que encuentre algo:
 *                 anillo-corazon.jpg            principal
 *                 anillo-corazon-2.jpg, (3)…    galería, por número
 *                 Anillo Corazón/…              carpeta con su nombre
 *
 * Si hay duda NO se asigna nada y se devuelven los candidatos para que la
 * persona elija: dos fotos con la misma clave (misma foto en .jpg y .png, o
 * en dos carpetas), dos carpetas con el nombre del producto, fotos sueltas
 * además de la carpeta, o una foto que coincide con dos filas a la vez.
 * Una foto indicada expresamente por otra fila nunca se asigna sola.
 */
import { baseName, fileKey, folderPathOf, pathKey, photoKey, stemOf } from "@/lib/catalogo/import/fotos";
import type { ImageInfo } from "@/lib/catalogo/import/types";

/** Candidatos que se muestran al haber duda (el selector permite buscar entre todas). */
export const MAX_CANDIDATES = 24;

const NO_PHOTO = new Set(["-", "sin foto", "sin fotos", "ninguna", "no"]);

/** ¿La celda «imagenes» dice expresamente que el producto no lleva foto? */
export function isNoPhotoCell(cell: string | undefined): boolean {
  return NO_PHOTO.has((cell ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim());
}

/** Orden natural determinista ("2.jpg" antes que "10.jpg"), sin depender del idioma del equipo. */
export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const pa = a.toLowerCase().match(re) ?? [];
  const pb = b.toLowerCase().match(re) ?? [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) continue;
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
      return x.length - y.length;
    }
    return x < y ? -1 : 1;
  }
  if (pa.length !== pb.length) return pa.length - pb.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

const byId = (a: ImageInfo, b: ImageInfo) => naturalCompare(a.id, b.id);

export type Lookup = { kind: "found"; images: ImageInfo[] } | { kind: "ambiguous"; candidates: ImageInfo[] } | { kind: "none" };

export interface PhotoCatalog {
  all: readonly ImageInfo[];
  /** Foto por su id exacto (elegida en el preview). */
  byId(id: string): ImageInfo | null;
  /**
   * Lo escrito en la columna «imagenes», en este orden: ruta exacta, final de
   * ruta, nombre de archivo, nombre sin extensión, nombre "slug" y, por
   * último, carpeta. Un nombre que corresponde a varias fotos es una duda.
   */
  lookup(requested: string): Lookup;
}

function group<K>(images: readonly ImageInfo[], key: (img: ImageInfo) => K | null): Map<K, ImageInfo[]> {
  const out = new Map<K, ImageInfo[]>();
  for (const img of images) {
    const k = key(img);
    if (k === null || k === "") continue;
    const list = out.get(k);
    if (list) list.push(img);
    else out.set(k, [img]);
  }
  return out;
}

function one(list: readonly ImageInfo[] | undefined): Lookup | null {
  if (!list || list.length === 0) return null;
  return list.length === 1 ? { kind: "found", images: [list[0]] } : { kind: "ambiguous", candidates: [...list].sort(byId).slice(0, MAX_CANDIDATES) };
}

export function buildPhotoCatalog(images: readonly ImageInfo[]): PhotoCatalog {
  const ids = new Map<string, ImageInfo>();
  for (const img of images) if (!ids.has(pathKey(img.id))) ids.set(pathKey(img.id), img);
  const byName = group(images, (i) => fileKey(i.name));
  const byStem = group(images, (i) => fileKey(stemOf(i.name)));
  const bySlug = group(images, (i) => photoKey(stemOf(i.name)));
  const folders = group(images, (i) => folderPathOf(i.id));
  const foldersBySlug = new Map<string, string[]>();
  for (const f of folders.keys()) {
    const k = photoKey(baseName(f));
    if (k) foldersBySlug.set(k, [...(foldersBySlug.get(k) ?? []), f]);
  }

  return {
    all: images,
    byId: (id) => ids.get(pathKey(id)) ?? null,
    lookup(requested) {
      const exact = ids.get(pathKey(requested));
      if (exact) return { kind: "found", images: [exact] };
      if (/[\\/]/.test(requested)) {
        const suffix = `/${pathKey(requested)}`;
        const r = one(images.filter((i) => pathKey(i.id).endsWith(suffix)));
        if (r) return r;
      }
      const name = baseName(requested);
      const r =
        one(byName.get(fileKey(name))) ?? one(byStem.get(fileKey(stemOf(name)))) ?? one(bySlug.get(photoKey(stemOf(name))));
      if (r) return r;
      const inFolders = foldersBySlug.get(photoKey(name)) ?? [];
      if (inFolders.length === 1) return { kind: "found", images: [...folders.get(inFolders[0])!].sort(byId) };
      if (inFolders.length > 1) return { kind: "ambiguous", candidates: inFolders.flatMap((f) => folders.get(f)!).sort(byId).slice(0, MAX_CANDIDATES) };
      return { kind: "none" };
    },
  };
}

// ---------------------------------------------------------------------------
// Detección automática por nombre
// ---------------------------------------------------------------------------

/** Claves de una fila, de la más específica a la más general. */
export function rowPhotoKeys(values: { name?: string; color?: string; code?: string }): string[] {
  const name = (values.name ?? "").trim();
  const color = (values.color ?? "").trim();
  const keys = [photoKey(values.code ?? ""), color && name ? photoKey(`${name} ${color}`) : "", photoKey(name)].filter((k) => k.length > 0);
  return [...new Set(keys)];
}

export interface AutoRow {
  row: number;
  keys: string[];
}

export interface AutoResult {
  /** Fotos asignadas (en orden: la primera es la principal). Vacío si hay duda o no hay fotos. */
  images: ImageInfo[];
  /** Si hay duda: las fotos posibles (nunca se asignan solas). */
  candidates: ImageInfo[];
  /** Otras filas que reclaman alguna de estas fotos. */
  conflictRows: number[];
}

const GALLERY = /^(.+)-(\d{1,2})$/;

/**
 * Fotos de cada fila SIN fotos indicadas, por nombre. `claimed` = ids ya
 * indicados expresamente por alguna fila: nunca se reparten solos.
 */
export function autoAssociate(rows: readonly AutoRow[], images: readonly ImageInfo[], claimed: ReadonlySet<string>): Map<number, AutoResult> {
  const pool = images.filter((i) => !claimed.has(pathKey(i.id)));
  const stems = group(pool, (i) => photoKey(stemOf(i.name)));
  const gallery = new Map<string, Array<{ n: number; img: ImageInfo }>>();
  for (const [k, list] of stems) {
    const m = GALLERY.exec(k);
    if (!m) continue;
    const entries = gallery.get(m[1]) ?? [];
    for (const img of list) entries.push({ n: Number(m[2]), img });
    gallery.set(m[1], entries);
  }
  const folderImages = group(pool, (i) => folderPathOf(i.id));
  const folders = new Map<string, string[]>();
  for (const f of folderImages.keys()) {
    const k = photoKey(baseName(f));
    if (k) folders.set(k, [...(folders.get(k) ?? []), f]);
  }

  const out = new Map<number, AutoResult>();
  for (const r of rows) {
    let result: AutoResult = { images: [], candidates: [], conflictRows: [] };
    for (const key of r.keys) {
      const principal = stems.get(key) ?? [];
      const numbered = [...(gallery.get(key) ?? [])].sort((a, b) => a.n - b.n || byId(a.img, b.img));
      const inFolders = folders.get(key) ?? [];
      if (principal.length === 0 && numbered.length === 0 && inFolders.length === 0) continue;

      const folder = inFolders.length === 1 ? inFolders[0] : null;
      const loose = [...principal, ...numbered.map((g) => g.img)];
      const repeatedNumber = numbered.some((g, i) => i > 0 && numbered[i - 1].n === g.n);
      const outsideFolder = folder !== null && loose.some((i) => folderPathOf(i.id) !== folder);
      if (inFolders.length > 1 || principal.length > 1 || repeatedNumber || outsideFolder) {
        const all = new Map<string, ImageInfo>();
        for (const img of [...loose, ...inFolders.flatMap((f) => folderImages.get(f)!)]) all.set(img.id, img);
        result = { images: [], candidates: [...all.values()].sort(byId).slice(0, MAX_CANDIDATES), conflictRows: [] };
        break;
      }
      if (folder) {
        // Dentro de la carpeta: la que se llama como el producto, luego las numeradas, luego el resto en orden.
        const rank = (img: ImageInfo) => {
          const i = loose.indexOf(img);
          return i >= 0 ? i : loose.length;
        };
        const inside = [...folderImages.get(folder)!].sort((a, b) => rank(a) - rank(b) || byId(a, b));
        result = { images: inside, candidates: [], conflictRows: [] };
      } else {
        result = { images: loose, candidates: [], conflictRows: [] };
      }
      break;
    }
    out.set(r.row, result);
  }

  // Una foto que dos filas reclaman no es de ninguna hasta que la persona decida.
  const claims = new Map<string, number[]>();
  for (const [row, res] of out) for (const img of res.images) claims.set(img.id, [...(claims.get(img.id) ?? []), row]);
  for (const [row, res] of out) {
    const others = new Set<number>();
    for (const img of res.images) for (const other of claims.get(img.id) ?? []) if (other !== row) others.add(other);
    if (others.size > 0) out.set(row, { images: [], candidates: res.images.slice(0, MAX_CANDIDATES), conflictRows: [...others].sort((a, b) => a - b) });
  }
  return out;
}
