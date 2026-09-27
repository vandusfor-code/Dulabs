/**
 * POST /api/business-agent/onboarding/preview — Business Agent 2.0, FASE 6. Body: {text, state}.
 *
 * Un turno de la VISTA PREVIA con el borrador guardado: Gate + entendimiento real + state machine + Action Engine en
 * SIMULACIÓN (el servidor fija simulation=true: ninguna reserva, transferencia ni mensaje real). `state` es el que
 * devolvió el turno anterior (se verifica: mismo tenant/agente). admin/agente.
 */
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { createSupabaseOnboardingDeps, createSupabaseSimulationDeps } from "@/lib/agent-compiler/onboarding/deps-supabase";
import { previewOnboarding } from "@/lib/agent-compiler/onboarding/service";
import { readBody, unexpected } from "@/lib/agent-compiler/onboarding/http";
import { SUPPORT_CODES } from "@/lib/agent-compiler/onboarding/issues";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_onboarding_preview", tenantId: miembro.tenantId, categoria: "costosa" });
  if (limite) return limite;
  const read = await readBody(request, ["text", "state"]);
  if (!read.ok) return read.response;
  const text = read.body.text;
  if (typeof text !== "string" || !text.trim() || text.length > 1000) return apiError(SUPPORT_CODES.SIM_STATE, "Escribe un mensaje de hasta 1000 caracteres.", 400);
  try {
    const r = await previewOnboarding(
      createSupabaseOnboardingDeps(supabase, { tenantId: miembro.tenantId, userId: miembro.userId }),
      createSupabaseSimulationDeps(supabase, miembro.tenantId),
      { text: text.trim(), state: read.body.state ?? null, turnId: `preview-${randomUUID()}` },
    );
    if (!r.ok) return apiError(r.code, r.message, r.code === SUPPORT_CODES.SIM_UNAVAILABLE ? 503 : 422, { issues: r.issues });
    return apiOk(r);
  } catch (err) {
    return unexpected("preview", miembro.tenantId, err, SUPPORT_CODES.SIM_UNAVAILABLE, "La vista previa no está disponible en este momento.");
  }
}
