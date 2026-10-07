/**
 * GET /api/dashboard/tienda/entidades/[id] — un elemento con su borrador y su contenido publicado. Admin, agente y lectura.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { leerIdRuta, withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: crudo } = await params;
  return withCms(request, "read", async ({ servicio, actor }) => {
    const id = leerIdRuta(crudo);
    if (!id.ok) return id.response;
    return apiOk({ entidad: await servicio.obtener(actor, id.data) });
  });
}
