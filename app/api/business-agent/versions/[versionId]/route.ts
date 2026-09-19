/**
 * GET /api/business-agent/versions/[versionId] — Bloque 12E (Authoring API, autorizado).
 *
 * Detalle completo de UNA versión (draft, publicada o archivada) del
 * Business Agent del tenant autenticado: Spec completo (para re-poblar el
 * formulario), diagnostics, checksums, estado de validación. 404 genérico
 * (nunca 403) si la versión no existe o es de otro tenant -- mismo criterio
 * de no revelar existencia cross-tenant que /api/flows/*.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import { getAgentVersionDetail } from "@/lib/agent-compiler/api/business-agent-api";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { versionId } = await params;

  try {
    const version = await getAgentVersionDetail({ store: createSupabaseBusinessAgentRegistryStore(supabase) }, { tenantId: miembro.tenantId, flowVersionId: versionId });
    if (!version) return apiError("VERSION_NOT_FOUND", "Versión no encontrada.", 404);
    return apiOk(version);
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo obtener la versión.", 500);
  }
}
