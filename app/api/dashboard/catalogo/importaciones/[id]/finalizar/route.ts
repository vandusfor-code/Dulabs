/**
 * POST /api/dashboard/catalogo/importaciones/{id}/finalizar — cierra la
 * importación en el historial. "Creados" lo cuenta la BD, no el navegador.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { parseBody, parseIdParam } from "@/lib/catalogo/http";
import { finishImportSchema } from "@/lib/catalogo/import/esquemas";
import { withImport } from "@/lib/catalogo/import/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const id = parseIdParam((await params).id, "La importación");
  if (!id.ok) return id.response;
  return withImport(request, "write", async ({ imports, actor }) => {
    const body = await parseBody(request, finishImportSchema);
    if (!body.ok) return body.response;
    return apiOk({ import: await imports.finish(actor, id.data, body.data) });
  });
}
