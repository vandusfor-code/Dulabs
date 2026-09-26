/**
 * GET /api/business-agent — Bloque 12E (Authoring API, autorizado).
 *
 * Devuelve el Business Agent del tenant autenticado: draft pendiente (si lo
 * hay), versión publicada (si la hay), status y un historial ligero de
 * versiones. Mismo patrón de auth que /api/flows/* (requireFlowAccess,
 * tenantId SIEMPRE del usuario autenticado). Nunca expone gateRules ni el
 * FlowDefinition compilado (detalle interno del Compiler) ni secretos.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createSupabaseBusinessAgentRegistryStore } from "@/lib/agent-compiler/registry/registry-store-supabase";
import { getCurrentAgent } from "@/lib/agent-compiler/api/business-agent-api";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { loadAgentLifecycle } from "@/lib/agent-compiler/lifecycle/supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  try {
    const store = createSupabaseBusinessAgentRegistryStore(supabase);
    const agent = await getCurrentAgent({ store }, { tenantId: miembro.tenantId, userId: miembro.userId });
    // FASE 1 — estado de producto derivado (DRAFT/CONFIGURED/PUBLISHED/ACTIVE/PAUSED/ERROR). Aditivo: si no se
    // puede calcular, el resto de la respuesta no cambia (lifecycle: null).
    const lifecycle = await loadAgentLifecycle(supabase, store, miembro.tenantId, agent).catch((err) => {
      console.error(`[business-agent] lifecycle_error tenant=${miembro.tenantId}:`, err instanceof Error ? err.message : String(err));
      return null;
    });
    return apiOk({ ...agent, lifecycle });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo obtener el Business Agent.", 500);
  }
}
