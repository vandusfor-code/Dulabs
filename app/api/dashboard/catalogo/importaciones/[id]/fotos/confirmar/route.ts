/**
 * POST /api/dashboard/catalogo/importaciones/{id}/fotos/confirmar — confirma
 * un lote de fotos subidas. Cada una se verifica igual que en la subida
 * individual (tamaño, tipo y firma real) antes de entrar a la galería.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { parseBody, parseIdParam } from "@/lib/catalogo/http";
import { photoConfirmSchema } from "@/lib/catalogo/import/esquemas";
import { withImport } from "@/lib/catalogo/import/http";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const id = parseIdParam((await params).id, "La importación");
  if (!id.ok) return id.response;
  return withImport(request, "write", async ({ imports, actor }) => {
    const body = await parseBody(request, photoConfirmSchema);
    if (!body.ok) return body.response;
    return apiOk({ results: await imports.confirmPhotos(actor, id.data, body.data.items) });
  });
}
