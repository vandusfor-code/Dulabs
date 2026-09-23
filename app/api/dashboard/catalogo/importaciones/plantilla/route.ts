/**
 * GET /api/dashboard/catalogo/importaciones/plantilla?formato=xlsx|csv —
 * plantilla de la carga masiva, con ejemplos y (en XLSX) las categorías
 * reales del catálogo de la sesión como lista sugerida.
 */
import type { NextRequest } from "next/server";
import { withImport } from "@/lib/catalogo/import/http";
import { buildTemplateCsv, buildTemplateXlsx } from "@/lib/catalogo/import/plantilla";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withImport(request, "read", async ({ service, actor }) => {
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (request.nextUrl.searchParams.get("formato") === "csv") {
      return new Response(buildTemplateCsv(), {
        headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="plantilla-productos.csv"' },
      });
    }
    const categories = await service.listCategories(actor);
    const body = await buildTemplateXlsx(categories.map((c) => c.name));
    return new Response(body as BodyInit, {
      headers: {
        ...headers,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="plantilla-productos.xlsx"',
      },
    });
  });
}
