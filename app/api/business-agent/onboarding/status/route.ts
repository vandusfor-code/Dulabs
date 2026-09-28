/**
 * GET /api/business-agent/onboarding/status — Business Agent 2.0, FASE 6.
 * Estado real de la publicación y la activación (versión publicada, cambios pendientes, checklist). admin/agente.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { createSupabaseOnboardingDeps } from "@/lib/agent-compiler/onboarding/deps-supabase";
import { getOnboarding } from "@/lib/agent-compiler/onboarding/service";
import { unexpected } from "@/lib/agent-compiler/onboarding/http";
import { SUPPORT_CODES } from "@/lib/agent-compiler/onboarding/issues";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_onboarding_read", tenantId: miembro.tenantId, categoria: "lectura" });
  if (limite) return limite;
  try {
    const o = await getOnboarding(createSupabaseOnboardingDeps(supabase, { tenantId: miembro.tenantId, userId: miembro.userId }));
    return apiOk({ status: o.status, pendingChanges: o.pendingChanges, revision: o.revision, publication: o.publication, checklist: o.checklist, numbers: o.numbers });
  } catch (err) {
    return unexpected("status", miembro.tenantId, err, SUPPORT_CODES.DRAFT_STORE, "No pudimos consultar el estado de tu agente.");
  }
}
