/**
 * POST /api/business-agent/onboarding/activate — Business Agent 2.0, FASE 6. Body: {phoneNumberId}.
 *
 * Activa el agente PUBLICADO en un número del negocio. Exige: la última configuración publicada (con su artefacto y
 * su versión del registro), y el gate de activación de FASE 1 (número del tenant, datos reales listos, plan activo,
 * ningún otro motor en el número). Solo admin. Tenant de la sesión.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";
import { createSupabaseOnboardingDeps } from "@/lib/agent-compiler/onboarding/deps-supabase";
import { activateOnboarding } from "@/lib/agent-compiler/onboarding/service";
import { readBody, unexpected } from "@/lib/agent-compiler/onboarding/http";
import { SUPPORT_CODES } from "@/lib/agent-compiler/onboarding/issues";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro, esAdminOverride } = access.ctx;
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_onboarding_activate", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;
  const read = await readBody(request, ["phoneNumberId"]);
  if (!read.ok) return read.response;
  const phoneNumberId = read.body.phoneNumberId;
  if (typeof phoneNumberId !== "string" || !phoneNumberId.trim() || phoneNumberId.length > 64) return apiError(SUPPORT_CODES.ACTIVATE_NUMBER, "Elige el número donde quieres activar tu agente.", 400);
  try {
    const r = await activateOnboarding(createSupabaseOnboardingDeps(supabase, { tenantId: miembro.tenantId, userId: miembro.userId }), { phoneNumberId });
    if (!r.ok) return apiError(r.code, r.message, r.code === SUPPORT_CODES.ACTIVATE_NUMBER ? 404 : 409, { reasons: r.reasons });
    if (esAdminOverride) {
      await registrarAuditoriaAdmin(supabase, { operador: miembro, accion: "ACTIVATE_FLOW", idTenant: miembro.tenantId, recurso: phoneNumberId, metadata: { via: "onboarding" } }).catch(() => {});
    }
    return apiOk(r);
  } catch (err) {
    return unexpected("activate", miembro.tenantId, err, SUPPORT_CODES.ACTIVATE_STORE, "No pudimos activar tu agente. Intenta de nuevo.");
  }
}
