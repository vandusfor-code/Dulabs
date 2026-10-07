/**
 * POST /api/dashboard/tienda/entidades/[id]/publicar — valida el borrador y, SI NO HAY ERRORES, lo publica como una versión nueva e inmutable que pasa a ser
 * la activa (lo que ven la tienda, el pedido y ARIA). Publica exactamente la revisión que se validó (`rev`): si cambió, 409. Solo administrador.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { cuerpoPublicar } from "@/lib/cms-comercial/http-esquemas";
import { leerCuerpo, leerIdRuta, withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: crudo } = await params;
  return withCms(request, "write", async ({ servicio, actor }) => {
    const id = leerIdRuta(crudo);
    if (!id.ok) return id.response;
    const body = await leerCuerpo(request, cuerpoPublicar);
    if (!body.ok) return body.response;
    return apiOk(await servicio.publicar(actor, id.data, body.data));
  });
}
