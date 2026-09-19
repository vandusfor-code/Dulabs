/**
 * POST /api/business-agent/knowledge/faqs — crea una FAQ del tenant. Auth admin;
 * el tenant sale SIEMPRE de la sesión (nunca del body). Validación y límites en
 * el servidor (lib/business-agent-knowledge/service.ts). Devuelve además avisos
 * no bloqueantes (riesgo de que el filtro de seguridad bloquee la respuesta).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { createFaqWithWarnings } from "@/lib/business-agent-knowledge/service";
import { createSupabaseKnowledgeStore } from "@/lib/business-agent-knowledge/store-supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_knowledge_write", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }

  const r = await createFaqWithWarnings(createSupabaseKnowledgeStore(supabase), miembro.tenantId, body);
  if (!r.ok) return apiError(r.code, r.error, r.status);
  return apiOk({ faq: r.value.faq, warnings: r.value.warnings }, 201);
}
