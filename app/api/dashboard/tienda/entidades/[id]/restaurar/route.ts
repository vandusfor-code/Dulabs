/**
 * POST /api/dashboard/tienda/entidades/[id]/restaurar — vuelve a poner en vivo una versión anterior COMO VERSIÓN NUEVA (la historia no se borra). Vuelve a
 * validarla con las reglas de hoy y verifica su integridad. Solo administrador.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { cuerpoRestaurar } from "@/lib/cms-comercial/http-esquemas";
import { leerCuerpo, leerIdRuta, withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: crudo } = await params;
  return withCms(request, "write", async ({ servicio, actor }) => {
    const id = leerIdRuta(crudo);
    if (!id.ok) return id.response;
    const body = await leerCuerpo(request, cuerpoRestaurar);
    if (!body.ok) return body.response;
    return apiOk(await servicio.restaurar(actor, id.data, body.data));
  });
}
