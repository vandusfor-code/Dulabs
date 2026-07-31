import ExcelJS from "exceljs";

// Extractor de texto compartido para archivos subidos (base de conocimiento
// de agentes, importación de encuestas, etc.): Excel/CSV se aplana a texto
// tipo CSV por hoja, PDF se extrae con pdf-parse.
//
// "pdf-parse" se importa de forma perezosa (dentro de extraerTexto, nunca al
// nivel del módulo): su dependencia pdfjs-dist referencia DOMMatrix al
// evaluarse, que no existe en el runtime serverless de Vercel (es una API de
// navegador) — un import estático tumba con un ReferenceError CUALQUIER ruta
// que solo importe este archivo, incluso si nunca procesa un PDF.
export const TAMANO_MAXIMO_BYTES = 4 * 1024 * 1024; // 4 MB
// .xls (binario legacy) ya no se soporta — exceljs no lo lee. Cualquiera con
// un .xls real lo puede volver a guardar como .xlsx en un clic.
export const EXTENSIONES_PLANILLA = ["xlsx", "csv"];

export function extension(nombre: string): string {
  return nombre.split(".").pop()?.toLowerCase() ?? "";
}

export function celdaATexto(valor: ExcelJS.CellValue): string {
  if (valor == null) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === "object") {
    if ("result" in valor) return celdaATexto((valor as { result?: ExcelJS.CellValue }).result ?? "");
    if ("text" in valor) return String((valor as { text?: unknown }).text ?? "");
    if ("richText" in valor) {
      return (valor as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    }
  }
  return String(valor);
}

export function normalizarEncabezado(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Mapea encabezado normalizado (fila 1) -> número de columna. */
export function mapearColumnas(hoja: ExcelJS.Worksheet): Map<string, number> {
  const mapa = new Map<string, number>();
  hoja.getRow(1).eachCell({ includeEmpty: false }, (celda, colNumber) => {
    const texto = normalizarEncabezado(celdaATexto(celda.value));
    if (texto) mapa.set(texto, colNumber);
  });
  return mapa;
}

export function buscarHoja(libro: ExcelJS.Workbook, contiene: string): ExcelJS.Worksheet | undefined {
  return libro.worksheets.find((h) => normalizarEncabezado(h.name).includes(contiene));
}

// Google Sheets/Excel muestran un teléfono largo tecleado en una celda
// numérica en notación científica (ej. "5,73182E+11") si la columna no está
// formateada como texto — el valor interno sigue siendo el número exacto,
// así que String(numero) ya da el teléfono completo. El riesgo real es si la
// celda llega como STRING con esa misma notación (algunos exportadores
// "hornean" el texto mostrado en vez del número): un simple
// `.replace(/\D/g, "")` ahí mezclaría mantisa y exponente en un teléfono
// distinto y válido en apariencia (ej. "5.73182E+11" -> "57318211"), en vez
// de fallar visiblemente. Se detecta ese patrón y se reconstruye el número
// real antes de limpiar dígitos.
export function telefonoDeCelda(valor: ExcelJS.CellValue): string {
  if (typeof valor === "number") return String(Math.trunc(valor));
  const texto = celdaATexto(valor).trim();
  if (/^\d+(\.\d+)?[eE][+-]?\d+$/.test(texto)) {
    const numero = Number(texto);
    if (Number.isFinite(numero)) return String(Math.trunc(numero));
  }
  return texto;
}

export function filaACsv(valores: ExcelJS.CellValue[]): string {
  // exceljs indexa las filas desde 1; el índice 0 de row.values viene vacío.
  return valores
    .slice(1)
    .map((v) => {
      const texto = celdaATexto(v);
      return /[,"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    })
    .join(",");
}

/** Carga un .xlsx como workbook de ExcelJS (para parseo estructurado por columnas). null si no es .xlsx. */
export async function cargarLibroExcel(nombreArchivo: string, buffer: Buffer): Promise<ExcelJS.Workbook | null> {
  if (extension(nombreArchivo) !== "xlsx") return null;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return libro;
}

export async function extraerTexto(archivo: File, buffer: Buffer): Promise<string> {
  const ext = extension(archivo.name);
  if (ext === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const resultado = await parser.getText();
      return resultado.text;
    } finally {
      await parser.destroy();
    }
  }
  if (EXTENSIONES_PLANILLA.includes(ext)) {
    if (ext === "csv") {
      return `# ${archivo.name}\n${buffer.toString("utf8")}`;
    }
    const libro = await cargarLibroExcel(archivo.name, buffer);
    return (libro?.worksheets ?? [])
      .map((hoja) => {
        const filas: string[] = [];
        hoja.eachRow((fila) => filas.push(filaACsv(fila.values as ExcelJS.CellValue[])));
        return `# ${hoja.name}\n${filas.join("\n")}`;
      })
      .join("\n\n");
  }
  throw new Error("Formato no soportado. Sube un archivo .xlsx, .csv o .pdf");
}
