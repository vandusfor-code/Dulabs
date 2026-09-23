/** Tipo de planilla por extensión. Módulo mínimo: lo usa el navegador sin arrastrar exceljs. */
export type SpreadsheetKind = "xlsx" | "csv";

export function spreadsheetKind(fileName: string): SpreadsheetKind | "xls" | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "csv") return ext;
  if (ext === "xls") return "xls";
  return null;
}
