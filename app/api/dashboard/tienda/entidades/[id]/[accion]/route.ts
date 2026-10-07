/**
 * POST /api/dashboard/tienda/entidades/[id]/{pausar|reanudar|despublicar|archivar|desarchivar} — cambios de estado de un elemento. Solo administrador.
 * Cualquier otra acción es 404 antes de tocar nada.
 */
import type { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { esAccionDeEstado } from "@/lib/cms-comercial/http-esquemas";
import { leerIdRuta, withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; accion: string }> }) {
  const { id: crudo, accion } = await params;
  return withCms(request, "write", async ({ servicio, actor }) => {
    if (!esAccionDeEstado(accion)) return apiError("NOT_FOUND", "Esa acción no existe.", 404);
    const id = leerIdRuta(crudo);
    if (!id.ok) return id.response;
    return apiOk({ entidad: await servicio[accion](actor, id.data) });
  });
}
