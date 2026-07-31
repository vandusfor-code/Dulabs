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
