/**
 * /api/business-agent/readiness?flowVersionId=… — R8. "¿Este agente puede funcionar de verdad?": bloqueos, advertencias
 * y resumen para el panel "Tu agente está configurado para…". Es EXACTAMENTE la misma evaluación que hace el servidor al
 * publicar (lib/business-agent-readiness.ts), así que la pantalla nunca promete algo que el gate luego rechaza.
 * Solo lectura. Auth + tenant de la sesión (nunca del query): la versión se busca por (tenant, id).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import { evaluateReadiness } from "@/lib/business-agent-readiness";
import { loadReadinessFacts } from "@/lib/business-agent-readiness-facts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_readiness", tenantId: miembro.tenantId, categoria: "lectura" });
  if (limite) return limite;

  const flowVersionId = new URL(request.url).searchParams.get("flowVersionId")?.trim();
  if (!flowVersionId) return apiError("REQUEST_INVALID_BODY", "Falta 'flowVersionId'.", 400);

  try {
    const version = await createSupabaseBusinessAgentRegistryStore(supabase).getVersion(miembro.tenantId, flowVersionId);
    if (!version) return apiError("NOT_FOUND", "Versión no encontrada.", 404);
    const facts = await loadReadinessFacts(supabase, miembro.tenantId, version.spec);
    return apiOk(evaluateReadiness(version.spec, facts));
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo evaluar el agente.", 500);
  }
}
