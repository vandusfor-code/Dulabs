import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getFlowById } from "@/lib/flow/flow-store";
import { activarFlowParaNumero } from "@/lib/flow/flow-activation";

export const runtime = "nodejs";

/**
 * Fase 4 (Self-Service Flow Activation, autorizado). Activa ESTE Flow
 * (`[id]`) en un número de WhatsApp del tenant autenticado. Recibe
 * `phoneNumberId` en el body -- el `tenantId` NUNCA sale del body, siempre
 * de `miembro.tenantId` (derivado del JWT vía requireFlowAccess), y
 * activarFlowParaNumero() revalida por su cuenta que ese phone_number_id
 * pertenezca a ese mismo tenant antes de escribir nada.
 *
 * Solo Flows con status "published" pueden activarse (mismo criterio que ya
 * usa dulabs_clientes_config: un Flow en draft/archived nunca debería
 * atender tráfico real). No toca trigger_routing_activo ni ninguna otra
 * columna -- eso es Bloque 3, fuera de alcance acá.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  let body: { phoneNumberId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.phoneNumberId || typeof body.phoneNumberId !== "string") {
    return Response.json({ error: "Falta 'phoneNumberId'" }, { status: 400 });
  }

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });
    if (flow.status !== "published") {
      return Response.json({ error: "Solo se puede activar un Flow publicado" }, { status: 409 });
    }

    const resultado = await activarFlowParaNumero(supabase, {
      tenantId: miembro.tenantId,
      flowId: id,
      phoneNumberId: body.phoneNumberId,
    });
    if (!resultado.ok) {
      return Response.json({ error: "Número no encontrado" }, { status: 404 });
    }
    return Response.json({ negocio: resultado.row });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
