/**
 * Planilla -> filas (RawRow[]). La parte de encabezados y filas es PURA
 * (`rowsFromTable`); la lectura del archivo (`readSpreadsheet`) usa exceljs,
 * que ya usa el proyecto para AMORE y contactos. Solo servidor.
 */
import { COLUMNS, columnDef, columnFor, type ColumnKey } from "@/lib/catalogo/import/columnas";
import { CsvError, decodeCsv, parseCsv } from "@/lib/catalogo/import/csv";
import { IMPORT_LIMITS, formatBytes } from "@/lib/catalogo/import/limites";
import { spreadsheetKind, type SpreadsheetKind } from "@/lib/catalogo/import/planilla-tipo";
import type { RawRow } from "@/lib/catalogo/import/types";

/** Error del ARCHIVO completo (no de una fila), con un mensaje listo para mostrar. */
export class ImportFileError extends Error {}

export interface TableRow {
  /** Número de fila en la hoja (1 = primera). */
  row: number;
  cells: string[];
}

export interface SpreadsheetRows {
  rows: RawRow[];
  /** Avisos del archivo: columnas ignoradas o no reconocidas. */
  notices: string[];
  sheetName: string | null;
}

const HEADER_SCAN_ROWS = 10;

function mapHeaders(cells: string[]): { map: Map<ColumnKey, number>; ignored: string[]; unknown: string[] } {
  const map = new Map<ColumnKey, number>();
  const ignored: string[] = [];
  const unknown: string[] = [];
  cells.forEach((raw, i) => {
    const text = raw.trim();
    if (!text) return;
    const key = columnFor(text);
    if (key === "ignored") ignored.push(text);
    else if (key === null) unknown.push(text);
    else if (!map.has(key)) map.set(key, i);
  });
  return { map, ignored, unknown };
}

/** Tabla de celdas -> filas con columnas reconocidas. Lanza ImportFileError con un mensaje claro. */
export function rowsFromTable(table: TableRow[]): Omit<SpreadsheetRows, "sheetName"> {
  // El encabezado es la primera fila (de las primeras 10) con "nombre" y al menos otra columna conocida.
  let headerIndex = -1;
  let header: ReturnType<typeof mapHeaders> | null = null;
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, table.length); i++) {
    const m = mapHeaders(table[i].cells);
    if (m.map.has("name") && m.map.size >= 2) {
      headerIndex = i;
      header = m;
      break;
    }
  }
  if (!header) {
    throw new ImportFileError(
      "No encontramos los encabezados de la planilla. La primera fila debe tener los nombres de las columnas (nombre, categoria, precio_detal, precio_mayor, stock…). Descarga la plantilla para ver un ejemplo.",
    );
  }
  const missing = COLUMNS.filter((c) => c.required && !header.map.has(c.key)).map((c) => `«${c.header}»`);
  if (missing.length > 0) {
    throw new ImportFileError(
      missing.length === 1
        ? `Falta la columna ${missing[0]}. Agrégala (o descarga la plantilla) y vuelve a subir el archivo.`
        : `Faltan las columnas ${missing.join(" y ")}. Agrégalas (o descarga la plantilla) y vuelve a subir el archivo.`,
    );
  }

  const rows: RawRow[] = [];
  for (const { row, cells } of table.slice(headerIndex + 1)) {
    const values: RawRow["values"] = {};
    let empty = true;
    for (const [key, col] of header.map) {
      const text = (cells[col] ?? "").replace(/ /g, " ").trim().slice(0, IMPORT_LIMITS.cellChars);
      if (text) {
        values[key] = text;
        empty = false;
      }
    }
    if (empty) continue;
    rows.push({ row, values });
    if (rows.length > IMPORT_LIMITS.rows) {
      throw new ImportFileError(`El archivo tiene más de ${IMPORT_LIMITS.rows} productos. Divídelo en varios archivos e impórtalos por partes.`);
    }
  }
  if (rows.length === 0) throw new ImportFileError("La planilla no tiene productos debajo de los encabezados.");

  const notices: string[] = [];
  if (header.ignored.length > 0) {
    notices.push(`Ignoramos la columna ${header.ignored.map((h) => `«${h}»`).join(", ")}: DuLabs asigna la referencia de cada producto automáticamente.`);
  }
  if (header.unknown.length > 0) {
    notices.push(`Columnas que no reconocimos y se ignoran: ${header.unknown.map((h) => `«${h}»`).join(", ")}.`);
  }
  if (!header.map.has("images")) notices.push(`El archivo no tiene la columna «${columnDef("images").header}»: los productos se crearán sin foto.`);
  return { rows, notices };
}

/** Valida nombre y tamaño ANTES de leer (mensajes claros, sin tocar el contenido). */
export function assertSpreadsheetFile(fileName: string, size: number): SpreadsheetKind {
  const kind = spreadsheetKind(fileName);
  if (kind === "xls") throw new ImportFileError("Los archivos .xls (Excel antiguo) no son compatibles. Ábrelo en Excel y guárdalo como .xlsx.");
  if (!kind) throw new ImportFileError("Sube la planilla en formato Excel (.xlsx) o CSV.");
  if (size <= 0) throw new ImportFileError("El archivo está vacío.");
  if (size > IMPORT_LIMITS.spreadsheetBytes) {
    throw new ImportFileError(`La planilla pesa más de ${formatBytes(IMPORT_LIMITS.spreadsheetBytes)}. Quita las fotos pegadas dentro del Excel (las fotos van aparte) o divide el archivo.`);
  }
  return kind;
}

/** Lee CSV o XLSX -> filas. Solo servidor (exceljs se carga bajo demanda). */
export async function readSpreadsheet(fileName: string, bytes: Uint8Array): Promise<SpreadsheetRows> {
  const kind = assertSpreadsheetFile(fileName, bytes.byteLength);
  if (kind === "csv") {
    let cells: string[][];
    try {
      cells = parseCsv(decodeCsv(bytes), IMPORT_LIMITS.rows + HEADER_SCAN_ROWS + 1);
    } catch (err) {
      if (err instanceof CsvError && err.message === "too_many_rows") {
        throw new ImportFileError(`El archivo tiene más de ${IMPORT_LIMITS.rows} productos. Divídelo en varios archivos e impórtalos por partes.`);
      }
      throw new ImportFileError("No pudimos leer el CSV (hay comillas sin cerrar). Revísalo o guárdalo de nuevo desde Excel.");
    }
    return { ...rowsFromTable(cells.map((c, i) => ({ row: i + 1, cells: c }))), sheetName: null };
  }

  // XLSX = ZIP: firma "PK\x03\x04". Un archivo renombrado a .xlsx se rechaza sin cargar exceljs.
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new ImportFileError("El archivo no es un Excel válido. Ábrelo en Excel y guárdalo de nuevo como .xlsx.");
  }
  const ExcelJS = (await import("exceljs")).default;
  const { celdaATexto } = await import("@/lib/archivo-texto");
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError("No pudimos abrir el Excel. Puede estar dañado o protegido con contraseña: guárdalo de nuevo como .xlsx.");
  }

  // Hoja: la que se llame "Productos" o, si no, la primera con encabezados reconocibles.
  const hojas = [...libro.worksheets].sort((a, b) => Number(/productos/i.test(b.name)) - Number(/productos/i.test(a.name)));
  let lastError: unknown = null;
  for (const hoja of hojas) {
    const table: TableRow[] = [];
    hoja.eachRow({ includeEmpty: false }, (fila, rowNumber) => {
      if (table.length > IMPORT_LIMITS.rows + HEADER_SCAN_ROWS + 1) return;
      const values = fila.values as unknown[];
      const cells: string[] = [];
      for (let c = 1; c < values.length; c++) cells.push(celdaATexto(values[c] as Parameters<typeof celdaATexto>[0]));
      table.push({ row: rowNumber, cells });
    });
    try {
      return { ...rowsFromTable(table), sheetName: hoja.name };
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError instanceof ImportFileError) throw lastError;
  throw new ImportFileError("El Excel no tiene hojas con productos.");
}
