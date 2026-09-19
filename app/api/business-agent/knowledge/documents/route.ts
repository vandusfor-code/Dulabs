/**
 * POST /api/business-agent/knowledge/documents — sube un documento (PDF/Excel/
 * CSV/TXT), extrae su texto, lo parte en chunks y lo indexa para recuperación
 * por relevancia. Auth admin; el tenant sale SIEMPRE de la sesión.
 *
 * Todo se valida en el SERVIDOR (nunca solo en el frontend): tamaño, extensión,
 * firma real del contenido (magic bytes), zip bomb en xlsx, nombre de archivo
 * saneado (es solo una etiqueta, nunca una ruta), tope de documentos/chunks por
 * tenant y duplicados por contenido. No se conserva el archivo original: solo
 * su texto extraído, así que no hay Storage ni URLs firmadas que proteger.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { KNOWLEDGE_LIMITS } from "@/lib/business-agent-knowledge/limits";
import { uploadDocument } from "@/lib/business-agent-knowledge/service";
import { createSupabaseKnowledgeStore } from "@/lib/business-agent-knowledge/store-supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Sobrecarga multipart tolerada por encima del tope del archivo. */
const MULTIPART_OVERHEAD_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  // Subida = operación costosa (extracción + indexado): límite más estricto por tenant.
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "business_agent_knowledge_upload", tenantId: miembro.tenantId, categoria: "costosa" });
  if (limite) return limite;

  // Rechazo temprano por Content-Length (antes de leer el cuerpo). El tope real lo verifica prepareDocument sobre el buffer.
  const declarado = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declarado) && declarado > KNOWLEDGE_LIMITS.docMaxBytes + MULTIPART_OVERHEAD_BYTES) {
    return apiError("TOO_LARGE", `El archivo supera el límite de ${Math.round(KNOWLEDGE_LIMITS.docMaxBytes / (1024 * 1024))} MB.`, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("REQUEST_INVALID_BODY", "La subida debe ser multipart/form-data.", 400);
  }
  const archivo = form.get("archivo");
  if (!(archivo instanceof File)) return apiError("REQUEST_INVALID_BODY", "Falta el archivo (campo 'archivo').", 400);
  if (archivo.size > KNOWLEDGE_LIMITS.docMaxBytes) {
    return apiError("TOO_LARGE", `El archivo supera el límite de ${Math.round(KNOWLEDGE_LIMITS.docMaxBytes / (1024 * 1024))} MB.`, 413);
  }

  const buffer = Buffer.from(await archivo.arrayBuffer());
  const r = await uploadDocument(createSupabaseKnowledgeStore(supabase), miembro.tenantId, {
    filename: archivo.name,
    mimeType: archivo.type || null,
    buffer,
    userId: miembro.userId,
  });
  if (!r.ok) return apiError(r.code, r.error, r.status);
  return apiOk({ document: r.value }, 201);
}
