/**
 * Lector CSV (RFC 4180) para la carga masiva. Puro, sin dependencias.
 *
 * Tolerante con lo que produce la gente de verdad:
 *   - Excel en español guarda "CSV" separado por punto y coma: el separador
 *     (`,` `;` o tabulador) se detecta en la primera línea.
 *   - Excel en Windows guarda en Windows-1252, no UTF-8: si el texto no es
 *     UTF-8 válido se decodifica como Windows-1252 (tildes y ñ correctas).
 *   - BOM, fin de línea CRLF/LF/CR, comillas con comillas escapadas ("").
 */

export class CsvError extends Error {}

/** Bytes -> texto: UTF-8 (con o sin BOM) y, si no es UTF-8 válido, Windows-1252. */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function detectDelimiter(text: string): string {
  let firstLine = "";
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    firstLine += ch;
  }
  const count = (d: string) => {
    let n = 0;
    let q = false;
    for (const ch of firstLine) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    return n;
  };
  const candidates = [";", ",", "\t"].map((d) => ({ d, n: count(d) }));
  candidates.sort((a, b) => b.n - a.n);
  return candidates[0].n > 0 ? candidates[0].d : ",";
}

/**
 * Texto -> filas de celdas. `maxRows` corta la lectura (defensa ante archivos
 * enormes): lanza CsvError si hay más.
 */
export function parseCsv(text: string, maxRows = Number.POSITIVE_INFINITY): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  const endRow = () => {
    row.push(cell);
    cell = "";
    rows.push(row);
    row = [];
    if (rows.length > maxRows) throw new CsvError("too_many_rows");
  };

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.length === 0) {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRow();
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    cell += ch;
    i++;
  }
  if (inQuotes) throw new CsvError("unclosed_quote");
  if (cell.length > 0 || row.length > 0) endRow();
  return rows;
}

/** Escapa una celda para escribir CSV (plantilla, reporte de errores). */
export function csvCell(value: string | number | null | undefined, delimiter = ","): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>, delimiter = ","): string {
  return rows.map((r) => r.map((c) => csvCell(c, delimiter)).join(delimiter)).join("\r\n");
}
