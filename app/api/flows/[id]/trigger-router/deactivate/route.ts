import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getFlowById } from "@/lib/flow/flow-store";
import { desactivarTriggerRouterParaNumero } from "@/lib/flow/trigger-router-activation";

export const runtime = "nodejs";

/**
 * FASE F8.2 (Trigger Router SaaS — Self-Service Activation, autorizado).
 * Desactiva el Trigger Router SaaS (`trigger_routing_activo=false`) para un
 * número del tenant autenticado. Nunca toca flow_activo/flow_id -- el Flow
 * activado por F4 sigue exactamente igual; el runtime existente
 * (resolverActivacionTriggerRouter) simplemente deja de autorizar el Router
 * para este número en la próxima conversación nueva, volviendo al
 * comportamiento legacy (cliente.flow_id directo).
 *
 * `[id]` se usa solo para confirmar que el Flow pertenece al tenant
 * autenticado (mismo patrón 404 que el resto de /api/flows/[id]/*) --
 * desactivar el Router no exige que sea el Flow actualmente activo en el
 * número (a diferencia de F4/deactivate, que sí lo exige porque además
 * limpia flow_id).
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

    const resultado = await desactivarTriggerRouterParaNumero(supabase, {
      tenantId: miembro.tenantId,
      phoneNumberId: body.phoneNumberId,
    });
    if (!resultado.ok) {
      return Response.json({ error: "Número no encontrado" }, { status: 404 });
    }
    return Response.json({ success: true, triggerRoutingActivo: false });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
