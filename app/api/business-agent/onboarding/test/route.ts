/**
 * POST /api/business-agent/onboarding/test — Business Agent 2.0, FASE 6 ("Prueba tu agente").
 * Conversaciones de ejemplo contra el borrador guardado, en SIMULACIÓN (sin efectos reales). admin/agente.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { createSupabaseOnboardingDeps, createSupabaseReadHandler } from "@/lib/agent-compiler/onboarding/deps-supabase";
import { testOnboardingAgent } from "@/lib/agent-compiler/onboarding/service";
import { unexpected } from "@/lib/agent-compiler/onboarding/http";
import { SUPPORT_CODES } from "@/lib/agent-compiler/onboarding/issues";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_onboarding_test", tenantId: miembro.tenantId, categoria: "costosa" });
  if (limite) return limite;
  try {
    const r = await testOnboardingAgent(createSupabaseOnboardingDeps(supabase, { tenantId: miembro.tenantId, userId: miembro.userId }), { readHandler: createSupabaseReadHandler(supabase) });
    if (!r.ok) return apiError(r.code, r.message, 422, { issues: r.issues });
    return apiOk(r);
  } catch (err) {
    return unexpected("test", miembro.tenantId, err, SUPPORT_CODES.SIM_UNAVAILABLE, "No pudimos probar tu agente en este momento.");
  }
}
