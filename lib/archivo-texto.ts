import ExcelJS from "exceljs";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-validacion";

// Extractor de texto compartido para archivos subidos (base de conocimiento
// de agentes, importación de encuestas, etc.): Excel/CSV se aplana a texto
// tipo CSV por hoja, PDF se extrae con pdf-parse.
//
// "pdf-parse" se importa de forma perezosa (dentro de extraerTexto, nunca al
// nivel del módulo): su dependencia pdfjs-dist referencia DOMMatrix al
// evaluarse, que no existe en el runtime serverless de Vercel (es una API de
// navegador) — un import estático tumba con un ReferenceError CUALQUIER ruta
// que solo importe este archivo, incluso si nunca procesa un PDF.
//
// Fuente única de verdad del límite de tamaño: MAX_UPLOAD_BYTES vive en
// lib/upload-validacion.ts (módulo ligero, compartido con el cliente).
export const TAMANO_MAXIMO_BYTES = MAX_UPLOAD_BYTES; // 4 MB

// Cota dura para la extracción de PDF EN EL SERVIDOR. pdf-parse (pdfjs) puede
// tardar muchísimo o, con un PDF corrupto, no resolver nunca: sin esta cota la
// función quedaría colgada hasta el maxDuration de Vercel y el cliente vería un
// spinner eterno. Con la cota, un PDF problemático devuelve un error CLARO y
// accionable dentro del tiempo de la función.
const PDF_TIMEOUT_MS = 45_000;

// Corre `promesa` con un tope de tiempo; si lo supera, rechaza con `mensaje`.
// Exportada para poder probar el comportamiento de timeout de forma
// determinista.
export async function conTimeout<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(mensaje)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
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
    // Verifica la firma real (%PDF-) ANTES de cargar pdf-parse: un archivo con
    // extensión .pdf pero otro contenido (renombrado, corrupto, descarga a
    // medias) haría que pdfjs lance un error genérico o se cuelgue. Mejor un
    // mensaje claro y barato.
    if (buffer.length < 5 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new Error("El archivo no es un PDF válido (firma incorrecta). Vuelve a exportarlo o súbelo de nuevo.");
    }
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    let texto: string;
    try {
      const resultado = await conTimeout(
        parser.getText(),
        PDF_TIMEOUT_MS,
        "El PDF tardó demasiado en procesarse. Prueba con un archivo más liviano o con menos páginas."
      );
      texto = resultado.text ?? "";
    } finally {
      await parser.destroy();
    }
    // Un PDF escaneado o solo-imágenes extrae cadena vacía: antes se guardaba
    // como "éxito" con 0 caracteres (el bot no aprendía nada). Ahora es un
    // error terminal explícito.
    if (!texto.trim()) {
      throw new Error(
        "Este PDF no contiene texto extraíble (parece escaneado o solo imágenes). Sube un PDF con texto seleccionable, o el contenido en Excel/CSV."
      );
    }
    return texto;
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
