/**
 * POST /api/dashboard/tienda/imagenes/[id]/confirmar — el servidor lee lo subido, comprueba que sea una imagen de verdad, la re-codifica a WebP (sin metadatos, tamaño
 * acotado) y la deja lista para usar. Idempotente. Solo administrador.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { leerIdRuta, withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: crudo } = await params;
  return withCms(request, "write", async ({ imagenes, actor }) => {
    const id = leerIdRuta(crudo, "La imagen");
    if (!id.ok) return id.response;
    return apiOk({ imagen: await imagenes.confirmar(actor, id.data) });
  });
}
