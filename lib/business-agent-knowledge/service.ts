/**
 * R4 — servicio de conocimiento: orquesta FAQ y subida de documentos sobre el
 * KnowledgeStore aplicando TODOS los límites en el servidor. Los routes de
 * app/api/business-agent/knowledge/* son adaptadores delgados sobre esto.
 * `tenantId` es siempre el de la sesión autenticada (nunca del body).
 */
import { KNOWLEDGE_LIMITS } from "@/lib/business-agent-knowledge/limits";
import { assessClaimRisk } from "@/lib/business-agent-knowledge/claim-risk";
import { validateFaqInput, type BusinessAgentFaq } from "@/lib/business-agent-knowledge/faq";
import { prepareDocument, type IngestErrorCode } from "@/lib/business-agent-knowledge/ingest";
import type { KnowledgeDocumentRecord, KnowledgeStore } from "@/lib/business-agent-knowledge/store";

export type ServiceErrorCode = IngestErrorCode | "VALIDATION_ERROR" | "LIMIT_REACHED" | "DUPLICATE" | "NOT_FOUND" | "STORE_ERROR";

export interface ServiceError {
  ok: false;
  code: ServiceErrorCode;
  status: number;
  error: string;
}

export type Outcome<T> = { ok: true; value: T } | ServiceError;

const fail = (code: ServiceErrorCode, status: number, error: string): ServiceError => ({ ok: false, code, status, error });

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------
/** Una FAQ guardada + avisos no bloqueantes para el autor (p. ej. riesgo de que el filtro de seguridad la bloquee). */
export interface FaqSaved {
  faq: BusinessAgentFaq;
  warnings: string[];
}

function faqSaved(faq: BusinessAgentFaq): FaqSaved {
  const risk = assessClaimRisk(faq.answer);
  return { faq, warnings: risk.risky && risk.message ? [risk.message] : [] };
}

export async function createFaq(store: KnowledgeStore, tenantId: string, body: unknown): Promise<Outcome<BusinessAgentFaq>> {
  const v = validateFaqInput(body);
  if (!v.ok) return fail("VALIDATION_ERROR", 400, v.error);
  try {
    if ((await store.countFaqs(tenantId)) >= KNOWLEDGE_LIMITS.faqMaxPerTenant) {
      return fail("LIMIT_REACHED", 409, `Llegaste al máximo de ${KNOWLEDGE_LIMITS.faqMaxPerTenant} preguntas frecuentes.`);
    }
    return { ok: true, value: await store.createFaq(tenantId, v.value) };
  } catch {
    return fail("STORE_ERROR", 500, "No se pudo crear la pregunta frecuente.");
  }
}

/** Igual que createFaq pero devuelve además los avisos de riesgo (lo usa la API). */
export async function createFaqWithWarnings(store: KnowledgeStore, tenantId: string, body: unknown): Promise<Outcome<FaqSaved>> {
  const r = await createFaq(store, tenantId, body);
  return r.ok ? { ok: true, value: faqSaved(r.value) } : r;
}

export async function updateFaqWithWarnings(store: KnowledgeStore, tenantId: string, id: string, body: unknown): Promise<Outcome<FaqSaved>> {
  const r = await updateFaq(store, tenantId, id, body);
  return r.ok ? { ok: true, value: faqSaved(r.value) } : r;
}

export async function updateFaq(store: KnowledgeStore, tenantId: string, id: string, body: unknown): Promise<Outcome<BusinessAgentFaq>> {
  const v = validateFaqInput(body);
  if (!v.ok) return fail("VALIDATION_ERROR", 400, v.error);
  try {
    const updated = await store.updateFaq(tenantId, id, v.value);
    return updated ? { ok: true, value: updated } : fail("NOT_FOUND", 404, "No se encontró la pregunta frecuente.");
  } catch {
    return fail("STORE_ERROR", 500, "No se pudo actualizar la pregunta frecuente.");
  }
}

export async function removeFaq(store: KnowledgeStore, tenantId: string, id: string): Promise<Outcome<true>> {
  try {
    return (await store.deleteFaq(tenantId, id)) ? { ok: true, value: true } : fail("NOT_FOUND", 404, "No se encontró la pregunta frecuente.");
  } catch {
    return fail("STORE_ERROR", 500, "No se pudo eliminar la pregunta frecuente.");
  }
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------
const STATUS_BY_INGEST: Record<IngestErrorCode, number> = {
  INVALID_FILE: 400,
  UNSUPPORTED_TYPE: 415,
  TOO_LARGE: 413,
  EMPTY: 400,
  NO_TEXT: 422,
  EXTRACTION_FAILED: 422,
  SUSPICIOUS_ARCHIVE: 422,
};

export interface UploadDocumentInput {
  filename: string;
  mimeType: string | null;
  buffer: Buffer;
  userId: string | null;
  /** Solo tests. */
  extract?: (name: string, buffer: Buffer) => Promise<string>;
}

/**
 * Sube, extrae, chunkea e indexa un documento. Un archivo inválido se RECHAZA
 * sin dejar filas; una falla de persistencia deja el documento en "error" sin
 * chunks parciales (nunca un documento medio indexado como "ready").
 */
export async function uploadDocument(store: KnowledgeStore, tenantId: string, input: UploadDocumentInput): Promise<Outcome<KnowledgeDocumentRecord>> {
  let prepared;
  try {
    if ((await store.countDocuments(tenantId)) >= KNOWLEDGE_LIMITS.docMaxPerTenant) {
      return fail("LIMIT_REACHED", 409, `Llegaste al máximo de ${KNOWLEDGE_LIMITS.docMaxPerTenant} documentos. Elimina alguno para subir otro.`);
    }
    prepared = await prepareDocument({ filename: input.filename, size: input.buffer.length, buffer: input.buffer, extract: input.extract });
  } catch {
    return fail("STORE_ERROR", 500, "No se pudo procesar el documento.");
  }
  if (!prepared.ok) return fail(prepared.code, STATUS_BY_INGEST[prepared.code], prepared.error);

  try {
    const existente = await store.findDocumentBySha(tenantId, prepared.sha256);
    if (existente) return fail("DUPLICATE", 409, `Este contenido ya está cargado como "${existente.filename}".`);

    const total = await store.countChunks(tenantId);
    if (total + prepared.chunks.length > KNOWLEDGE_LIMITS.tenantMaxChunks) {
      return fail("LIMIT_REACHED", 409, "Tu base de conocimiento alcanzó su tamaño máximo. Elimina algún documento para subir otro.");
    }
  } catch {
    return fail("STORE_ERROR", 500, "No se pudo procesar el documento.");
  }

  let doc: KnowledgeDocumentRecord;
  try {
    doc = await store.createDocument(tenantId, { filename: prepared.filename, mimeType: input.mimeType, sizeBytes: input.buffer.length, createdBy: input.userId });
  } catch {
    return fail("STORE_ERROR", 500, "No se pudo registrar el documento.");
  }
  try {
    const listo = await store.completeDocument(tenantId, doc.id, {
      chunks: prepared.chunks,
      charCount: prepared.charCount,
      truncated: prepared.truncated,
      sha256: prepared.sha256,
    });
    return { ok: true, value: listo };
  } catch {
    await store.failDocument(tenantId, doc.id, "No se pudo indexar el documento. Vuelve a subirlo.").catch(() => undefined);
    return fail("STORE_ERROR", 500, "No se pudo indexar el documento. Vuelve a subirlo.");
  }
}

export async function removeDocument(store: KnowledgeStore, tenantId: string, id: string): Promise<Outcome<true>> {
  try {
    return (await store.deleteDocument(tenantId, id)) ? { ok: true, value: true } : fail("NOT_FOUND", 404, "No se encontró el documento.");
  } catch {
    return fail("STORE_ERROR", 500, "No se pudo eliminar el documento.");
  }
}

/** ¿Hay conocimiento utilizable? (una FAQ activa o un documento listo). Base del gate de publicación. */
export async function hasUsableKnowledge(store: Pick<KnowledgeStore, "countActiveFaqs" | "countReadyDocuments">, tenantId: string): Promise<boolean> {
  const [faqs, docs] = await Promise.all([store.countActiveFaqs(tenantId), store.countReadyDocuments(tenantId)]);
  return faqs + docs > 0;
}
