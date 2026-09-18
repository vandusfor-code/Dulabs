/**
 * POST /api/business-agent/rollback — Bloque 12F (Authoring API, autorizado).
 *
 * Rollback = MISMO mecanismo que publish (re-apuntar published_version_id a
 * una versión ANTERIOR ya validada, vía la RPC atómica existente) -- nunca
 * copia ni recrea una versión. Requiere `confirm:true` explícito en el body
 * (confirmación explícita del usuario, spec §BLOQUE 12F). `flowId` derivado
 * del tenant autenticado, igual que /publish. Rol admin.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import { rollbackToVersion, isPlainObject } from "@/lib/agent-compiler/api/business-agent-api";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";

export const runtime = "nodejs";

const REASON_STATUS: Record<string, number> = {
  confirmation_required: 400,
  not_found: 404,
  not_validated: 422,
  tenant_mismatch: 404,
  store_error: 500,
};

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro, esAdminOverride } = access.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }
  if (!isPlainObject(body) || typeof body.flowVersionId !== "string" || !body.flowVersionId) {
    return apiError("REQUEST_INVALID_BODY", "Falta 'flowVersionId'.", 400);
  }

  try {
    const result = await rollbackToVersion(
      { store: createSupabaseBusinessAgentRegistryStore(supabase) },
      { tenantId: miembro.tenantId, flowVersionId: body.flowVersionId, confirm: body.confirm === true },
    );
    if (!result.ok) return apiError(result.reason.toUpperCase(), result.message, REASON_STATUS[result.reason] ?? 500);

    if (esAdminOverride) {
      await registrarAuditoriaAdmin(supabase, {
        operador: miembro,
        accion: "ROLLBACK_BUSINESS_AGENT",
        idTenant: miembro.tenantId,
        recurso: result.flowId,
        metadata: { flowVersionId: result.flowVersionId },
      });
    }
    return apiOk(result);
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo hacer rollback.", 500);
  }
}
