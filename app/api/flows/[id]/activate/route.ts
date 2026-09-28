import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getFlowById } from "@/lib/flow/flow-store";
import { activarFlowParaNumero } from "@/lib/flow/flow-activation";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import { evaluateBusinessAgentActivation } from "@/lib/agent-compiler/lifecycle/activation-gate";
import { createSupabaseActivationGateDeps } from "@/lib/agent-compiler/lifecycle/supabase";

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
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro, esAdminOverride } = access.ctx;
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

    // Business Agent 2.0, FASE 1 — gate de activación server-side (solo para flows que SON Business Agent; un
    // flow de Flow Studio sigue exactamente igual): versión servible, readiness con datos reales, plan activo y
    // ningún otro motor atendiendo ese número. La UI no puede saltárselo.
    const gate = await evaluateBusinessAgentActivation(
      createSupabaseActivationGateDeps(supabase, createSupabaseBusinessAgentRegistryStore(supabase)),
      { tenantId: miembro.tenantId, flowId: id, phoneNumberId: body.phoneNumberId },
    );
    if (gate.kind === "blocked") {
      const [primero] = gate.blockers;
      const status = primero!.code === "NUMBER_NOT_FOUND" ? 404 : 409;
      return Response.json(
        { error: primero!.message, code: primero!.code, category: primero!.category, blockers: gate.blockers.map(({ code, category, message }) => ({ code, category, message })) },
        { status },
      );
    }

    const resultado = await activarFlowParaNumero(supabase, {
      tenantId: miembro.tenantId,
      flowId: id,
      phoneNumberId: body.phoneNumberId,
    });
    if (!resultado.ok) {
      return Response.json({ error: "Número no encontrado" }, { status: 404 });
    }
    if (esAdminOverride) {
      await registrarAuditoriaAdmin(supabase, {
        operador: miembro,
        accion: "ACTIVATE_FLOW",
        idTenant: miembro.tenantId,
        recurso: body.phoneNumberId,
        metadata: { flowId: id },
      });
    }
    return Response.json({ negocio: resultado.row });
  } catch (error) {
    // Contrato de errores (FASE 1): el detalle real se registra internamente, nunca se devuelve al cliente.
    console.error(`[flows/activate] error tenant=${miembro.tenantId} flow=${id}:`, error instanceof Error ? error.message : String(error));
    return Response.json({ error: "No se pudo activar. Intenta de nuevo.", code: "INTERNAL_ERROR", category: "INTERNAL_ERROR" }, { status: 500 });
  }
}
