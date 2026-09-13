import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getFlowById } from "@/lib/flow/flow-store";
import { activarTriggerRouterParaNumero } from "@/lib/flow/trigger-router-activation";

export const runtime = "nodejs";

/**
 * FASE F8.2 (Trigger Router SaaS — Self-Service Activation, autorizado).
 * Activa el Trigger Router SaaS (`trigger_routing_activo=true`) para ESTE
 * Flow (`[id]`) en un número de WhatsApp del tenant autenticado -- exige que
 * ese mismo Flow YA esté activo en ese número (F4, sin modificar) y
 * publicado. `tenantId` NUNCA sale del body, siempre de `miembro.tenantId`
 * (derivado del JWT vía requireFlowAccess); `activarTriggerRouterParaNumero`
 * revalida por su cuenta ownership + estado antes de escribir, y el UPDATE
 * real queda condicionado a ese mismo estado (ver lib/flow/trigger-router-activation.ts).
 *
 * Nunca toca flow_activo/flow_id -- eso sigue siendo responsabilidad
 * exclusiva de F4 (app/api/flows/[id]/activate, sin modificar). Respuesta
 * mínima: nunca devuelve la fila completa de dulabs_clientes_config (evita
 * exponer meta_permanent_token/api_key_ia, aunque estén cifrados).
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
      return Response.json({ error: "Solo se puede activar el Router en un Flow publicado" }, { status: 409 });
    }

    const resultado = await activarTriggerRouterParaNumero(supabase, {
      tenantId: miembro.tenantId,
      flowId: id,
      phoneNumberId: body.phoneNumberId,
    });
    if (!resultado.ok) {
      if (resultado.reason === "flow_no_activo_en_este_numero") {
        return Response.json(
          { error: "Este Flow debe estar activo en ese número (Activar en WhatsApp) antes de activar el Trigger Router" },
          { status: 409 },
        );
      }
      if (resultado.reason === "estado_cambio_durante_la_operacion") {
        return Response.json(
          { error: "El estado de este número cambió durante la operación -- vuelve a intentarlo" },
          { status: 409 },
        );
      }
      return Response.json({ error: "Número no encontrado" }, { status: 404 });
    }
    return Response.json({ success: true, triggerRoutingActivo: true });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
