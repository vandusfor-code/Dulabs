/**
 * POST /api/dashboard/catalogo/importaciones/{id}/fotos/urls — URLs firmadas
 * para un lote de fotos (ya optimizadas en el navegador). Solo para productos
 * creados por ESTA importación; mismas reglas que la subida individual.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { parseBody, parseIdParam } from "@/lib/catalogo/http";
import { photoUrlsSchema } from "@/lib/catalogo/import/esquemas";
import { withImport } from "@/lib/catalogo/import/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const id = parseIdParam((await params).id, "La importación");
  if (!id.ok) return id.response;
  return withImport(request, "write", async ({ imports, actor }) => {
    const body = await parseBody(request, photoUrlsSchema);
    if (!body.ok) return body.response;
    return apiOk({ results: await imports.photoUploadUrls(actor, id.data, body.data.items) });
  });
}
