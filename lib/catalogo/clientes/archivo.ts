/**
 * Bloque 34 — lee el archivo de clientes (.xlsx o .csv) como tabla de texto (la primera fila son los
 * encabezados). Los celulares escritos como número en Excel se leen completos (sin notación científica).
 */
import { cargarLibroExcel, extension, telefonoDeCelda } from "@/lib/archivo-texto";
import { decodeCsv, parseCsv } from "@/lib/catalogo/import/csv";
import { IMPORTAR_MAX_FILAS } from "@/lib/catalogo/clientes/modelo";

export const ARCHIVO_MAX_BYTES = 2 * 1024 * 1024;

export async function leerTablaClientes(nombre: string, bytes: Buffer): Promise<string[][] | null> {
  const ext = extension(nombre);
  if (ext === "csv") return parseCsv(decodeCsv(new Uint8Array(bytes)), IMPORTAR_MAX_FILAS + 50);
  if (ext !== "xlsx") return null;
  const libro = await cargarLibroExcel(nombre, bytes);
  const hoja = libro?.worksheets.find((h) => h.name.toLowerCase().includes("cliente")) ?? libro?.worksheets[0];
  if (!hoja) return null;
  const tabla: string[][] = [];
  hoja.eachRow({ includeEmpty: false }, (fila) => {
    if (tabla.length > IMPORTAR_MAX_FILAS + 50) return;
    const celdas: string[] = [];
    for (let c = 1; c <= Math.min(fila.cellCount, 20); c++) celdas.push(telefonoDeCelda(fila.getCell(c).value));
    tabla.push(celdas);
  });
  return tabla;
}
