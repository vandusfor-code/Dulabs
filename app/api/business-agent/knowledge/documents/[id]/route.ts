/**
 * DELETE /api/business-agent/knowledge/documents/[id] — elimina un documento del
 * tenant y (por cascada) todos sus chunks: deja de aparecer en la recuperación
 * de inmediato. Auth admin; filtra por (id, id_tenant de la sesión).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { removeDocument } from "@/lib/business-agent-knowledge/service";
import { createSupabaseKnowledgeStore } from "@/lib/business-agent-knowledge/store-supabase";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;
  if (!UUID.test(id)) return apiError("NOT_FOUND", "No se encontró el documento.", 404);

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_knowledge_write", tenantId: miembro.tenantId, categoria: "escritura" });
  if (limite) return limite;

  const r = await removeDocument(createSupabaseKnowledgeStore(supabase), miembro.tenantId, id);
  if (!r.ok) return apiError(r.code, r.error, r.status);
  return apiOk({ ok: true });
}
