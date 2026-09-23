/**
 * POST /api/dashboard/catalogo/importaciones/analizar — preview de una carga
 * masiva. NO escribe nada.
 *
 *   multipart/form-data  archivo=<CSV|XLSX>, extras={"images":[...],"decisions":{...}}
 *     -> el servidor lee la planilla (nunca el navegador decide qué hay en ella)
 *   application/json     {rows, images, decisions, force}
 *     -> re-análisis tras agregar fotos, decidir categorías o corregir filas
 *
 * Las fotos NO viajan aquí: solo su nombre, tamaño y validez.
 */
import type { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { parseBody, validationError } from "@/lib/catalogo/http";
import { analyzeFileExtrasSchema, analyzeRowsSchema } from "@/lib/catalogo/import/esquemas";
import { withImport } from "@/lib/catalogo/import/http";
import { IMPORT_LIMITS, formatBytes } from "@/lib/catalogo/import/limites";
import { ImportFileError, assertSpreadsheetFile, readSpreadsheet } from "@/lib/catalogo/import/planilla";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  return withImport(request, "write", async ({ imports, actor }) => {
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.includes("multipart/form-data")) {
      const body = await parseBody(request, analyzeRowsSchema);
      if (!body.ok) return body.response;
      return apiOk({ analysis: await imports.analyze(actor, body.data) });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError("VALIDATION_ERROR", `No pudimos recibir el archivo. Verifica que pese menos de ${formatBytes(IMPORT_LIMITS.spreadsheetBytes)}.`, 400);
    }
    const archivo = form.get("archivo");
    if (!(archivo instanceof File)) return apiError("VALIDATION_ERROR", "Falta la planilla.", 400);

    let extrasRaw: unknown = {};
    const extrasText = form.get("extras");
    if (typeof extrasText === "string" && extrasText) {
      try {
        extrasRaw = JSON.parse(extrasText);
      } catch {
        return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
      }
    }
    const extras = analyzeFileExtrasSchema.safeParse(extrasRaw);
    if (!extras.success) return validationError(extras.error);

    try {
      assertSpreadsheetFile(archivo.name, archivo.size);
      const sheet = await readSpreadsheet(archivo.name, new Uint8Array(await archivo.arrayBuffer()));
      const analysis = await imports.analyze(actor, { rows: sheet.rows, images: extras.data.images, decisions: extras.data.decisions, force: [] });
      return apiOk({
        file: { name: archivo.name, sheet: sheet.sheetName },
        rows: sheet.rows,
        analysis: { ...analysis, notices: [...sheet.notices, ...analysis.notices] },
      });
    } catch (err) {
      if (err instanceof ImportFileError) return apiError("FILE_INVALID", err.message, 422);
      throw err;
    }
  });
}
