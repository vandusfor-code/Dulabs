/**
 * /api/business-agent/onboarding — Business Agent 2.0, FASE 6 (configuración guiada).
 *
 *   GET  configuración guardada (o sembrada desde el agente existente), estado real, problemas en lenguaje humano,
 *        checklist de activación y números de WhatsApp. admin/agente.
 *   PUT  autosave del borrador: {expectedRevision, draft}. Guardar NO publica ni activa. Revisión vieja => 409
 *        (otra pestaña/sesión). Solo admin.
 *
 * El tenant sale SIEMPRE de la sesión (requireFlowAccess); nunca del cuerpo.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { createSupabaseOnboardingDeps } from "@/lib/agent-compiler/onboarding/deps-supabase";
import { getOnboarding, saveOnboardingDraft } from "@/lib/agent-compiler/onboarding/service";
import { isRevision, readBody, unexpected } from "@/lib/agent-compiler/onboarding/http";
import { SUPPORT_CODES } from "@/lib/agent-compiler/onboarding/issues";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_onboarding_read", tenantId: miembro.tenantId, categoria: "lectura" });
  if (limite) return limite;
  try {
    return apiOk(await getOnboarding(createSupabaseOnboardingDeps(supabase, { tenantId: miembro.tenantId, userId: miembro.userId })));
  } catch (err) {
    return unexpected("get", miembro.tenantId, err, SUPPORT_CODES.DRAFT_STORE, "No pudimos cargar tu configuración. Intenta de nuevo.");
  }
}

export async function PUT(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_onboarding_save", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;
  const read = await readBody(request, ["expectedRevision", "draft"]);
  if (!read.ok) return read.response;
  if (!isRevision(read.body.expectedRevision)) return apiError(SUPPORT_CODES.DRAFT_INVALID, "No pudimos guardar: falta la versión de tu configuración.", 400);
  try {
    const r = await saveOnboardingDraft(createSupabaseOnboardingDeps(supabase, { tenantId: miembro.tenantId, userId: miembro.userId }), { expectedRevision: read.body.expectedRevision, draft: read.body.draft });
    if (!r.ok) return apiError(r.code, r.message, r.reason === "conflict" ? 409 : 422, r.reason === "conflict" ? { currentRevision: r.currentRevision } : { details: r.details });
    return apiOk({ revision: r.revision, issues: r.issues });
  } catch (err) {
    return unexpected("save", miembro.tenantId, err, SUPPORT_CODES.DRAFT_STORE, "No pudimos guardar tus cambios. Tus datos siguen en esta pantalla; intenta de nuevo.");
  }
}
