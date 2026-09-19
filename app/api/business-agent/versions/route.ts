/**
 * GET /api/business-agent/versions — Bloque 12E/12F (Authoring API, autorizado).
 *
 * Historial ligero de versiones (más reciente primero) del Business Agent
 * del tenant autenticado -- para el selector de rollback y la vista de
 * auditoría. Proyección sin Spec/IR/FlowDefinition (ver GET /versions/[id]
 * para el detalle completo de una versión puntual).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import { listAgentVersions } from "@/lib/agent-compiler/api/business-agent-api";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  try {
    const versions = await listAgentVersions({ store: createSupabaseBusinessAgentRegistryStore(supabase) }, { tenantId: miembro.tenantId });
    return apiOk({ versions });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo obtener el historial de versiones.", 500);
  }
}
