/**
 * POST /api/dashboard/catalogo/importaciones/{id}/filas — crea un LOTE de
 * filas (máx. IMPORT_LIMITS.rowsPerBatch). Cada fila se vuelve a validar en el
 * servidor y es independiente; un reintento de la misma fila no duplica.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { parseBody, parseIdParam } from "@/lib/catalogo/http";
import { importRowsSchema } from "@/lib/catalogo/import/esquemas";
import { withImport } from "@/lib/catalogo/import/http";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const id = parseIdParam((await params).id, "La importación");
  if (!id.ok) return id.response;
  return withImport(request, "write", async ({ imports, actor }) => {
    const body = await parseBody(request, importRowsSchema);
    if (!body.ok) return body.response;
    return apiOk({ results: await imports.createRows(actor, id.data, body.data) });
  });
}
