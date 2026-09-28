/**
 * POST /api/business-agent/onboarding/validate — Business Agent 2.0, FASE 6.
 * Validación COMPLETA del borrador guardado: modelo del negocio, reglas compiladas para el runtime y datos reales
 * (servicios, calendario, conocimiento). No escribe nada. admin/agente. Tenant de la sesión.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { createSupabaseOnboardingDeps } from "@/lib/agent-compiler/onboarding/deps-supabase";
import { validateOnboarding } from "@/lib/agent-compiler/onboarding/service";
import { unexpected } from "@/lib/agent-compiler/onboarding/http";
import { SUPPORT_CODES } from "@/lib/agent-compiler/onboarding/issues";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_onboarding_validate", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;
  try {
    return apiOk(await validateOnboarding(createSupabaseOnboardingDeps(supabase, { tenantId: miembro.tenantId, userId: miembro.userId })));
  } catch (err) {
    return unexpected("validate", miembro.tenantId, err, SUPPORT_CODES.MODEL_OTHER, "No pudimos revisar tu configuración. Intenta de nuevo.");
  }
}
