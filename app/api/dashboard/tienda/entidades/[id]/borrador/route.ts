/**
 * PUT /api/dashboard/tienda/entidades/[id]/borrador — guarda el borrador (puede estar incompleto). Con `rev` (control optimista): si alguien más cambió el
 * elemento, responde 409 y no pisa nada. Lo publicado NO cambia hasta publicar. Solo administrador.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { cuerpoBorrador } from "@/lib/cms-comercial/http-esquemas";
import { leerCuerpo, leerIdRuta, withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: crudo } = await params;
  return withCms(request, "write", async ({ servicio, actor }) => {
    const id = leerIdRuta(crudo);
    if (!id.ok) return id.response;
    const body = await leerCuerpo(request, cuerpoBorrador);
    if (!body.ok) return body.response;
    return apiOk({ entidad: await servicio.guardarBorrador(actor, id.data, body.data) });
  });
}
