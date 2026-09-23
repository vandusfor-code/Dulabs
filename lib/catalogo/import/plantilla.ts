/**
 * Plantilla descargable de la carga masiva (XLSX con ejemplos reales e
 * instrucciones, o CSV). Mismos encabezados que reconoce el lector: una sola
 * definición de columnas (columnas.ts). Solo servidor (exceljs).
 */
import { COLUMNS, TEMPLATE_EXAMPLES } from "@/lib/catalogo/import/columnas";
import { toCsv } from "@/lib/catalogo/import/csv";
import { IMPORT_LIMITS } from "@/lib/catalogo/import/limites";

export async function buildTemplateXlsx(categoryNames: readonly string[]): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const libro = new ExcelJS.Workbook();
  libro.creator = "DuLabs";

  const hoja = libro.addWorksheet("Productos", { views: [{ state: "frozen", ySplit: 1 }] });
  hoja.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.key === "description" ? 44 : c.key === "images" ? 40 : c.key === "code" ? 14 : c.key === "name" ? 28 : 16,
  }));
  const header = hoja.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F1A17" } };
  header.alignment = { vertical: "middle" };
  header.height = 22;
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.note = `${c.required ? "OBLIGATORIO. " : ""}${c.help}`;
  });
  for (const ex of TEMPLATE_EXAMPLES) hoja.addRow(ex);
  for (const key of ["retailPrice", "wholesalePrice"] as const) hoja.getColumn(key).numFmt = "#,##0";
  hoja.getColumn("stock").numFmt = "0";

  // Categorías existentes como lista sugerida (se permiten otras: podrás crearlas al importar).
  if (categoryNames.length > 0) {
    const listas = libro.addWorksheet("Categorias");
    listas.getColumn(1).width = 30;
    listas.addRow(["Categorías de tu catálogo"]).font = { bold: true };
    categoryNames.forEach((n) => listas.addRow([n]));
    const ultima = categoryNames.length + 1;
    const col = COLUMNS.findIndex((c) => c.key === "category") + 1;
    for (let r = 2; r <= IMPORT_LIMITS.rows + 1; r++) {
      hoja.getCell(r, col).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`Categorias!$A$2:$A$${ultima}`],
        showErrorMessage: false,
      };
    }
  }

  const ayuda = libro.addWorksheet("Instrucciones");
  ayuda.getColumn(1).width = 22;
  ayuda.getColumn(2).width = 100;
  const titulo = ayuda.addRow(["Carga masiva de productos — DuLabs"]);
  titulo.font = { bold: true, size: 14 };
  ayuda.addRow([]);
  const pasos = [
    ["1.", "Escribe un producto por fila en la hoja «Productos» (puedes borrar los ejemplos)."],
    ["2.", "Guarda todas las fotos en UNA carpeta, nombradas como el producto: «Anillo corazón» → anillo-corazon.jpg (principal), anillo-corazon-2.jpg, anillo-corazon-3.jpg (galería). Mayúsculas, tildes y espacios no importan."],
    ["", "También sirve una subcarpeta por producto (Anillo corazón/1.jpg, 2.jpg…: la primera en orden es la principal) o nombrar las fotos con tu código (columna «codigo»)."],
    ["3.", "La columna «imagenes» es opcional: úsala solo si una foto tiene otro nombre (varias separadas por coma, la primera es la principal)."],
    ["4.", "En DuLabs → Catálogo → Carga masiva, sube este archivo y selecciona la carpeta de fotos (o un .zip)."],
    ["5.", "Revisa el resumen: verás la foto de cada producto, podrás corregir filas, elegir fotos cuando haya dudas y luego confirmar."],
    ["", "La referencia (DL-000XXX) la asigna DuLabs automáticamente: no la escribas."],
    ["", `Máximo ${IMPORT_LIMITS.rows} productos por archivo y ${IMPORT_LIMITS.imagesPerProduct} fotos por producto. Fotos en JPG, PNG o WEBP.`],
  ];
  pasos.forEach((p) => ayuda.addRow(p));
  ayuda.addRow([]);
  ayuda.addRow(["Columna", "Qué escribir"]).font = { bold: true };
  COLUMNS.forEach((c) => ayuda.addRow([c.header, `${c.required ? "OBLIGATORIO. " : ""}${c.help}`]));
  ayuda.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const buffer = await libro.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/** CSV con encabezados y ejemplos (UTF-8 con BOM para que Excel respete las tildes). */
export function buildTemplateCsv(): string {
  const rows = [COLUMNS.map((c) => c.header), ...TEMPLATE_EXAMPLES.map((ex) => COLUMNS.map((c) => ex[c.key]))];
  return `﻿${toCsv(rows)}\r\n`;
}
