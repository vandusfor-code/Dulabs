/**
 * Columnas de la planilla de carga masiva: encabezados de la plantilla,
 * sinónimos aceptados y ejemplos. Puro (sin exceljs): lo usan el lector del
 * servidor, la plantilla y la interfaz.
 */

export const COLUMN_KEYS = ["name", "category", "retailPrice", "wholesalePrice", "stock", "material", "color", "description", "images"] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

export interface ColumnDef {
  key: ColumnKey;
  /** Encabezado de la plantilla. */
  header: string;
  /** Nombre para mensajes ("el precio detal"). */
  label: string;
  required: boolean;
  /** Ayuda para la hoja de instrucciones. */
  help: string;
  /** Otros encabezados aceptados (se comparan sin tildes, mayúsculas, guiones ni espacios de más). */
  aliases: readonly string[];
}

export const COLUMNS: readonly ColumnDef[] = [
  {
    key: "name",
    header: "nombre",
    label: "el nombre",
    required: true,
    help: "Nombre del producto tal como lo verá tu cliente. Obligatorio.",
    aliases: ["nombre del producto", "producto", "name", "titulo"],
  },
  {
    key: "category",
    header: "categoria",
    label: "la categoría",
    required: false,
    help: "Ej. Anillos. Si no existe en tu catálogo, podrás crearla o elegir una existente antes de importar.",
    aliases: ["category", "linea", "tipo"],
  },
  {
    key: "retailPrice",
    header: "precio_detal",
    label: "el precio detal",
    required: true,
    help: "Precio al detal en pesos, sin decimales. Ej. 129900 o 129.900. Obligatorio.",
    aliases: ["precio detal", "precio", "precio al detal", "precio de venta", "precio venta", "precio publico", "pvp"],
  },
  {
    key: "wholesalePrice",
    header: "precio_mayor",
    label: "el precio mayor",
    required: false,
    help: "Precio al por mayor en pesos. Opcional.",
    aliases: ["precio mayor", "precio mayorista", "precio al por mayor", "precio por mayor", "mayor"],
  },
  {
    key: "stock",
    header: "stock",
    label: "el stock",
    required: true,
    help: "Unidades disponibles para venta (0 si está agotado). Obligatorio.",
    aliases: ["stock disponible", "cantidad", "unidades", "inventario", "existencias"],
  },
  { key: "material", header: "material", label: "el material", required: false, help: "Ej. Oro laminado 18k. Opcional.", aliases: [] },
  { key: "color", header: "color", label: "el color", required: false, help: "Ej. Dorado. Opcional.", aliases: [] },
  {
    key: "description",
    header: "descripcion",
    label: "la descripción",
    required: false,
    help: "Detalles que ayuden a vender: medidas, cierre, garantía. Opcional.",
    aliases: ["description", "detalle", "detalles"],
  },
  {
    key: "images",
    header: "imagenes",
    label: "las imágenes",
    required: false,
    help: "Nombre del archivo de cada foto, tal como está en tu computador. Varias fotos separadas por coma: la primera es la principal. Ej. anillo-corazon.jpg, anillo-corazon-2.jpg",
    aliases: ["imagen", "imagen principal", "imagenes", "fotos", "foto", "fotografia", "fotografias", "images", "image"],
  },
] as const;

/** Encabezados que se reconocen pero se IGNORAN a propósito (la referencia la asigna DuLabs). */
export const IGNORED_HEADERS: readonly string[] = ["referencia", "ref", "codigo", "sku", "id"];

/** Normaliza un encabezado: sin tildes, minúsculas, `_`/`-`/`.` como espacio, sin paréntesis ni asteriscos. */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[*:]/g, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_HEADER = new Map<string, ColumnKey>();
for (const c of COLUMNS) {
  for (const h of [c.header, ...c.aliases]) BY_HEADER.set(normalizeHeader(h), c.key);
}
const IGNORED = new Set(IGNORED_HEADERS.map(normalizeHeader));

export function columnFor(header: string): ColumnKey | "ignored" | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  if (IGNORED.has(h)) return "ignored";
  return BY_HEADER.get(h) ?? null;
}

export function columnDef(key: ColumnKey): ColumnDef {
  return COLUMNS.find((c) => c.key === key)!;
}

/** Filas de ejemplo de la plantilla (joyería real, datos ficticios). */
export const TEMPLATE_EXAMPLES: ReadonlyArray<Record<ColumnKey, string | number>> = [
  {
    name: "Anillo corazón",
    category: "Anillos",
    retailPrice: 129900,
    wholesalePrice: 79900,
    stock: 5,
    material: "Oro laminado 18k",
    color: "Dorado",
    description: "Anillo con corazón central. Talla ajustable.",
    images: "anillo-corazon.jpg, anillo-corazon-detalle.jpg",
  },
  {
    name: "Aretes perla",
    category: "Aretes",
    retailPrice: 89900,
    wholesalePrice: 52000,
    stock: 12,
    material: "Plata 925",
    color: "Plateado",
    description: "Aretes tipo topo con perla de río de 8 mm.",
    images: "aretes-perla.jpg",
  },
  {
    name: "Dije luna",
    category: "Dijes",
    retailPrice: 64900,
    wholesalePrice: "",
    stock: 0,
    material: "Oro laminado 18k",
    color: "",
    description: "",
    images: "dije-luna.jpg",
  },
];
