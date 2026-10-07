/**
 * POST /api/dashboard/tienda/entidades/[id]/validar — revisa el borrador (o lo publicado, si no hay borrador) y devuelve errores y advertencias con mensajes
 * claros. No cambia nada. Admin, agente y lectura.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { leerIdRuta, withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: crudo } = await params;
  return withCms(request, "read", async ({ servicio, actor }) => {
    const id = leerIdRuta(crudo);
    if (!id.ok) return id.response;
    return apiOk({ validacion: await servicio.validar(actor, id.data) });
  });
}
