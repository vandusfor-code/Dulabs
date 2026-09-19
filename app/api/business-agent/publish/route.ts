/**
 * POST /api/business-agent/publish — Bloque 12D (Authoring API, autorizado).
 *
 * Publica una versión DRAFT ya validada del Business Agent del tenant. El
 * `flowId` NUNCA lo envía el cliente: se deriva de ensureAgentIdentity(tenantId)
 * -- el cliente solo puede publicar versiones del SUYO. `expectedChecksum`
 * opcional: si se envía, se verifica contra el flowChecksum persistido antes
 * de publicar (detecta que la config cambió bajo los pies del cliente).
 * Reutiliza publishBusinessAgentVersion -> dulabs_flow_publish_version (RPC
 * atómica existente) -- nunca una segunda implementación de publish. Rol
 * admin (igual que POST /api/flows/[id]/publish).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import { publishDraftVersion, isPlainObject } from "@/lib/agent-compiler/api/business-agent-api";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";

export const runtime = "nodejs";

const REASON_STATUS: Record<string, number> = {
  not_found: 404,
  not_validated: 422,
  tenant_mismatch: 404, // no revelar existencia cross-tenant, mismo criterio que /api/flows/*
  checksum_mismatch: 409,
  store_error: 500,
};

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro, esAdminOverride } = access.ctx;

  // Rate limit por tenant: publish ejecuta el RPC atómico de publicación.
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_publish", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }
  if (!isPlainObject(body) || typeof body.flowVersionId !== "string" || !body.flowVersionId) {
    return apiError("REQUEST_INVALID_BODY", "Falta 'flowVersionId'.", 400);
  }
  if (body.expectedChecksum !== undefined && typeof body.expectedChecksum !== "string") {
    return apiError("REQUEST_INVALID_BODY", "'expectedChecksum' debe ser texto.", 400);
  }

  try {
    const result = await publishDraftVersion(
      { store: createSupabaseBusinessAgentRegistryStore(supabase) },
      { tenantId: miembro.tenantId, flowVersionId: body.flowVersionId, expectedChecksum: body.expectedChecksum as string | undefined },
    );
    if (!result.ok) return apiError(result.reason.toUpperCase(), result.message, REASON_STATUS[result.reason] ?? 500);

    if (esAdminOverride) {
      await registrarAuditoriaAdmin(supabase, {
        operador: miembro,
        accion: "PUBLISH_BUSINESS_AGENT",
        idTenant: miembro.tenantId,
        recurso: result.flowId,
        metadata: { flowVersionId: result.flowVersionId },
      });
    }
    return apiOk(result);
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo publicar la versión.", 500);
  }
}
