/**
 * R4 — implementación Supabase del KnowledgeStore. Se usa SOLO con el cliente
 * service_role del servidor (las tablas tienen RLS sin políticas para
 * anon/authenticated y el RPC de búsqueda está revocado a esos roles). Cada
 * consulta filtra por id_tenant explícito.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToFaq, type BusinessAgentFaq, type FaqRow, type NormalizedFaqInput } from "@/lib/business-agent-knowledge/faq";
import type { KnowledgeSource } from "@/lib/business-agent-knowledge/limits";
import type { CompleteDocumentInput, KnowledgeDocumentRecord, KnowledgeDocumentStatus, KnowledgeStore, RawSearchHit } from "@/lib/business-agent-knowledge/store";

const FAQ_COLUMNS = "id, question, answer, active, created_at, updated_at";
const DOC_COLUMNS = "id, filename, mime_type, size_bytes, status, error_message, char_count, chunk_count, truncated, created_at";
/** Inserción de chunks en lotes (evita payloads enormes en una sola request). */
const CHUNK_BATCH = 100;
/** Un documento que lleva más de esto en "processing" se considera abandonado (la función serverless murió). */
const STALE_PROCESSING_MS = 5 * 60 * 1000;

interface DocRow {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  status: KnowledgeDocumentStatus;
  error_message: string | null;
  char_count: number;
  chunk_count: number;
  truncated: boolean;
  created_at: string;
}

function rowToDoc(r: DocRow, now = Date.now()): KnowledgeDocumentRecord {
  const abandonado = r.status === "processing" && now - new Date(r.created_at).getTime() > STALE_PROCESSING_MS;
  return {
    id: r.id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    status: abandonado ? "error" : r.status,
    errorMessage: abandonado ? "El procesamiento no terminó. Elimina el documento y vuelve a subirlo." : r.error_message,
    charCount: r.char_count,
    chunkCount: r.chunk_count,
    truncated: r.truncated,
    createdAt: r.created_at,
  };
}

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  return n ?? 0;
}

export function createSupabaseKnowledgeStore(supabase: SupabaseClient): KnowledgeStore {
  return {
    // ---- FAQ ----
    async listFaqs(tenantId) {
      const { data, error } = await supabase.from("dulabs_ba_faqs").select(FAQ_COLUMNS).eq("id_tenant", tenantId).order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as FaqRow[]).map(rowToFaq);
    },
    countFaqs: (tenantId) => count(supabase.from("dulabs_ba_faqs").select("id", { count: "exact", head: true }).eq("id_tenant", tenantId)),
    countActiveFaqs: (tenantId) =>
      count(supabase.from("dulabs_ba_faqs").select("id", { count: "exact", head: true }).eq("id_tenant", tenantId).eq("active", true)),
    async createFaq(tenantId, input: NormalizedFaqInput) {
      const { data, error } = await supabase.from("dulabs_ba_faqs").insert({ id_tenant: tenantId, ...input }).select(FAQ_COLUMNS).single();
      if (error || !data) throw new Error(error?.message ?? "insert vacío");
      return rowToFaq(data as FaqRow);
    },
    async updateFaq(tenantId, id, input) {
      const { data, error } = await supabase.from("dulabs_ba_faqs").update(input).eq("id", id).eq("id_tenant", tenantId).select(FAQ_COLUMNS).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? rowToFaq(data as FaqRow) : null;
    },
    async deleteFaq(tenantId, id) {
      const { data, error } = await supabase.from("dulabs_ba_faqs").delete().eq("id", id).eq("id_tenant", tenantId).select("id");
      if (error) throw new Error(error.message);
      return (data?.length ?? 0) > 0;
    },

    // ---- Documentos ----
    async listDocuments(tenantId) {
      const { data, error } = await supabase.from("dulabs_ba_knowledge_documents").select(DOC_COLUMNS).eq("id_tenant", tenantId).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as DocRow[]).map((r) => rowToDoc(r));
    },
    countDocuments: (tenantId) =>
      count(supabase.from("dulabs_ba_knowledge_documents").select("id", { count: "exact", head: true }).eq("id_tenant", tenantId).in("status", ["processing", "ready"])),
    countReadyDocuments: (tenantId) =>
      count(supabase.from("dulabs_ba_knowledge_documents").select("id", { count: "exact", head: true }).eq("id_tenant", tenantId).eq("status", "ready")),
    countChunks: (tenantId) => count(supabase.from("dulabs_ba_knowledge_chunks").select("id", { count: "exact", head: true }).eq("id_tenant", tenantId)),
    async findDocumentBySha(tenantId, sha256) {
      const { data, error } = await supabase
        .from("dulabs_ba_knowledge_documents")
        .select(DOC_COLUMNS)
        .eq("id_tenant", tenantId)
        .eq("content_sha256", sha256)
        .neq("status", "error")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? rowToDoc(data as DocRow) : null;
    },
    async createDocument(tenantId, input) {
      const { data, error } = await supabase
        .from("dulabs_ba_knowledge_documents")
        .insert({ id_tenant: tenantId, filename: input.filename, mime_type: input.mimeType, size_bytes: input.sizeBytes, created_by: input.createdBy, status: "processing" })
        .select(DOC_COLUMNS)
        .single();
      if (error || !data) throw new Error(error?.message ?? "insert vacío");
      return rowToDoc(data as DocRow);
    },
    async completeDocument(tenantId, documentId, input: CompleteDocumentInput) {
      for (let i = 0; i < input.chunks.length; i += CHUNK_BATCH) {
        const lote = input.chunks.slice(i, i + CHUNK_BATCH).map((content, j) => ({ id_tenant: tenantId, document_id: documentId, position: i + j, content }));
        const { error } = await supabase.from("dulabs_ba_knowledge_chunks").insert(lote);
        if (error) throw new Error(error.message);
      }
      const { data, error } = await supabase
        .from("dulabs_ba_knowledge_documents")
        .update({ status: "ready", error_message: null, char_count: input.charCount, chunk_count: input.chunks.length, truncated: input.truncated, content_sha256: input.sha256 })
        .eq("id", documentId)
        .eq("id_tenant", tenantId)
        .select(DOC_COLUMNS)
        .single();
      if (error || !data) throw new Error(error?.message ?? "documento no encontrado");
      return rowToDoc(data as DocRow);
    },
    async failDocument(tenantId, documentId, message) {
      await supabase.from("dulabs_ba_knowledge_chunks").delete().eq("document_id", documentId).eq("id_tenant", tenantId);
      await supabase
        .from("dulabs_ba_knowledge_documents")
        .update({ status: "error", error_message: message.slice(0, 500), chunk_count: 0, content_sha256: null })
        .eq("id", documentId)
        .eq("id_tenant", tenantId);
    },
    async deleteDocument(tenantId, documentId) {
      // Los chunks se eliminan por ON DELETE CASCADE de la FK compuesta.
      const { data, error } = await supabase.from("dulabs_ba_knowledge_documents").delete().eq("id", documentId).eq("id_tenant", tenantId).select("id");
      if (error) throw new Error(error.message);
      return (data?.length ?? 0) > 0;
    },

    // ---- Búsqueda (RPC con el tenant filtrado adentro) ----
    async search(tenantId, terms, sources: KnowledgeSource[], limit) {
      const { data, error } = await supabase.rpc("dulabs_ba_knowledge_search", { p_tenant: tenantId, p_tokens: terms, p_sources: sources, p_limit: limit });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<Record<string, unknown>>).map(
        (r): RawSearchHit => ({
          sourceType: r.source_type as KnowledgeSource,
          sourceId: String(r.source_id),
          title: String(r.title ?? ""),
          content: String(r.content ?? ""),
          rank: Number(r.rank ?? 0),
          matched: Number(r.matched ?? 0),
          total: Number(r.total ?? 0),
        }),
      );
    },
  };
}

/** Para tests: expone la política de "abandonado". */
export const __STALE_PROCESSING_MS = STALE_PROCESSING_MS;
export { rowToDoc as __rowToDoc };
export type { BusinessAgentFaq };
