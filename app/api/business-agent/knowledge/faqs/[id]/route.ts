/**
 * PUT/DELETE /api/business-agent/knowledge/faqs/[id] — editar/eliminar una FAQ
 * del tenant. Auth admin; toda operación filtra por (id, id_tenant de la
 * sesión): un admin nunca toca la FAQ de otro tenant.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { removeFaq, updateFaqWithWarnings } from "@/lib/business-agent-knowledge/service";
import { createSupabaseKnowledgeStore } from "@/lib/business-agent-knowledge/store-supabase";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;
  if (!UUID.test(id)) return apiError("NOT_FOUND", "No se encontró la pregunta frecuente.", 404);

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_knowledge_write", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }
  const r = await updateFaqWithWarnings(createSupabaseKnowledgeStore(supabase), miembro.tenantId, id, body);
  if (!r.ok) return apiError(r.code, r.error, r.status);
  return apiOk({ faq: r.value.faq, warnings: r.value.warnings });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;
  if (!UUID.test(id)) return apiError("NOT_FOUND", "No se encontró la pregunta frecuente.", 404);

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_knowledge_write", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;

  const r = await removeFaq(createSupabaseKnowledgeStore(supabase), miembro.tenantId, id);
  if (!r.ok) return apiError(r.code, r.error, r.status);
  return apiOk({ ok: true });
}
