import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getFlowById } from "@/lib/flow/flow-store";
import { desactivarFlowParaNumero, FlowActivationCheckViolationError } from "@/lib/flow/flow-activation";

export const runtime = "nodejs";

/**
 * Fase 4 (Self-Service Flow Activation, autorizado). Desactiva ESTE Flow
 * (`[id]`) en un número de WhatsApp del tenant autenticado -- reversible,
 * pone flow_activo=false y flow_id=null (el CHECK preexistente
 * `..._flow_activo_requiere_flow_id` exige que ambos cambien juntos, ver
 * lib/flow/flow-activation.ts). No exige que el Flow siga "published" (se
 * puede desactivar aunque después se haya archivado). Rechaza si el número
 * no está hoy en ESTE Flow (evita que el botón "Desactivar" de un Flow
 * apague por error la activación de un Flow distinto en ese número).
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

    const resultado = await desactivarFlowParaNumero(supabase, {
      tenantId: miembro.tenantId,
      flowId: id,
      phoneNumberId: body.phoneNumberId,
    });
    if (!resultado.ok) {
      if (resultado.reason === "flow_no_activo_en_este_numero") {
        return Response.json({ error: "Este Flow no está activo en ese número" }, { status: 409 });
      }
      return Response.json({ error: "Número no encontrado" }, { status: 404 });
    }
    return Response.json({ negocio: resultado.row });
  } catch (error) {
    if (error instanceof FlowActivationCheckViolationError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
