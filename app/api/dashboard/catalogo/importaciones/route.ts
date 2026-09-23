/**
 * /api/dashboard/catalogo/importaciones — historial (GET) e inicio (POST) de
 * una carga masiva. Tenant SIEMPRE de la sesión; solo admin importa.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { parseBody } from "@/lib/catalogo/http";
import { startImportSchema } from "@/lib/catalogo/import/esquemas";
import { withImport } from "@/lib/catalogo/import/http";

export const runtime = "nodejs";

/** Estado de la carga masiva + historial. `available: false` = falta aplicar la migración (no es un error). */
export async function GET(request: NextRequest) {
  return withImport(request, "read", async ({ imports, actor }) => {
    const { available } = await imports.availability();
    return apiOk({ available, imports: available ? await imports.history(actor) : [] });
  });
}

export async function POST(request: NextRequest) {
  return withImport(request, "write", async ({ imports, actor }) => {
    const body = await parseBody(request, startImportSchema);
    if (!body.ok) return body.response;
    return apiOk({ import: await imports.start(actor, body.data) }, 201);
  });
}
