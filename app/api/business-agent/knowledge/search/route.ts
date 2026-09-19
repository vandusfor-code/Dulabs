/**
 * POST /api/business-agent/knowledge/search — "Probar una pregunta": ejecuta la
 * MISMA recuperación real que usa el agente (tokenizador, umbral de relevancia,
 * presupuesto, tenant de la sesión) y devuelve los fragmentos que recibiría la
 * IA. Sirve para que el dueño verifique su conocimiento antes de publicar. Solo
 * lectura; auth admin/agente; el tenant sale SIEMPRE de la sesión.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { KNOWLEDGE_LIMITS } from "@/lib/business-agent-knowledge/limits";
import { buscarConocimiento } from "@/lib/business-agent-knowledge/retrieval";
import { createSupabaseKnowledgeStore } from "@/lib/business-agent-knowledge/store-supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_knowledge_search", tenantId: miembro.tenantId, categoria: "lectura" });
  if (limite) return limite;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("REQUEST_INVALID_JSON", "JSON inválido.", 400);
  }
  const query = typeof body === "object" && body !== null ? (body as { query?: unknown }).query : undefined;
  if (typeof query !== "string" || !query.trim()) return apiError("VALIDATION_ERROR", "Escribe una pregunta para probar.", 400);
  if (query.length > KNOWLEDGE_LIMITS.queryMaxChars) {
    return apiError("VALIDATION_ERROR", `La pregunta supera el máximo de ${KNOWLEDGE_LIMITS.queryMaxChars} caracteres.`, 400);
  }

  try {
    const r = await buscarConocimiento(createSupabaseKnowledgeStore(supabase), { tenantId: miembro.tenantId, query });
    return apiOk({
      found: r.found,
      emptyQuery: r.emptyQuery,
      hits: r.hits.map((h) => ({ source: h.source, title: h.title, content: h.content, coverage: Math.round(h.coverage * 100) / 100 })),
    });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo consultar el conocimiento.", 500);
  }
}
