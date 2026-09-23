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
    width: c.key === "description" ? 44 : c.key === "images" ? 46 : c.key === "name" ? 28 : 16,
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
    ["2.", "Guarda las fotos en una carpeta. En la columna «imagenes» escribe el nombre de cada archivo (ej. anillo-corazon.jpg)."],
    ["3.", "Varias fotos: sepáralas con coma. La primera es la principal; las demás van a la galería."],
    ["4.", "En DuLabs → Catálogo → Carga masiva, sube este archivo y selecciona (o arrastra) las fotos o la carpeta."],
    ["5.", "Revisa el resumen: puedes corregir filas, decidir categorías nuevas y luego confirmar."],
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
