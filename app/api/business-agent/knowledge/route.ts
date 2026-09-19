/**
 * GET /api/business-agent/knowledge — resumen del conocimiento del tenant (FAQ
 * + documentos + límites) para el módulo "Conocimiento" del Wizard. Auth admin/
 * agente; el tenant sale SIEMPRE de la sesión. Solo lectura.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { KNOWLEDGE_DOC_EXTENSIONS, KNOWLEDGE_LIMITS } from "@/lib/business-agent-knowledge/limits";
import { createSupabaseKnowledgeStore } from "@/lib/business-agent-knowledge/store-supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_knowledge_get", tenantId: miembro.tenantId, categoria: "lectura" });
  if (limite) return limite;

  try {
    const store = createSupabaseKnowledgeStore(supabase);
    const [faqs, documents] = await Promise.all([store.listFaqs(miembro.tenantId), store.listDocuments(miembro.tenantId)]);
    return apiOk({
      faqs,
      documents,
      limits: {
        faqMax: KNOWLEDGE_LIMITS.faqMaxPerTenant,
        docMax: KNOWLEDGE_LIMITS.docMaxPerTenant,
        docMaxBytes: KNOWLEDGE_LIMITS.docMaxBytes,
        faqQuestionMax: KNOWLEDGE_LIMITS.faqQuestionMax,
        faqAnswerMax: KNOWLEDGE_LIMITS.faqAnswerMax,
        extensions: [...KNOWLEDGE_DOC_EXTENSIONS],
      },
    });
  } catch {
    return apiError("INTERNAL_ERROR", "No se pudo cargar el conocimiento.", 500);
  }
}
