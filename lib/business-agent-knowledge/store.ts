/**
 * R4 — puerto de persistencia del conocimiento del Business Agent. TODAS las
 * operaciones reciben `tenantId` explícito (derivado de la sesión autenticada o
 * de request.tenantId del runtime, NUNCA del payload/IA) y lo aplican como
 * filtro. Hay una implementación Supabase (store-supabase.ts) y una en memoria
 * para tests offline (testing/in-memory-knowledge-store.ts).
 */
import type { BusinessAgentFaq, NormalizedFaqInput } from "@/lib/business-agent-knowledge/faq";
import type { KnowledgeSource } from "@/lib/business-agent-knowledge/limits";

export type KnowledgeDocumentStatus = "processing" | "ready" | "error";

export interface KnowledgeDocumentRecord {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  status: KnowledgeDocumentStatus;
  errorMessage: string | null;
  charCount: number;
  chunkCount: number;
  truncated: boolean;
  createdAt: string;
}

/** Fila que devuelve la búsqueda (RPC dulabs_ba_knowledge_search). */
export interface RawSearchHit {
  sourceType: KnowledgeSource;
  sourceId: string;
  title: string;
  content: string;
  rank: number;
  /** Cuántos de los términos de la consulta contiene el fragmento. */
  matched: number;
  /** Cuántos términos distintos tenía la consulta. */
  total: number;
}

export interface CompleteDocumentInput {
  chunks: string[];
  charCount: number;
  truncated: boolean;
  sha256: string;
}

export interface KnowledgeStore {
  // --- FAQ ---
  listFaqs(tenantId: string): Promise<BusinessAgentFaq[]>;
  countFaqs(tenantId: string): Promise<number>;
  countActiveFaqs(tenantId: string): Promise<number>;
  createFaq(tenantId: string, input: NormalizedFaqInput): Promise<BusinessAgentFaq>;
  updateFaq(tenantId: string, id: string, input: NormalizedFaqInput): Promise<BusinessAgentFaq | null>;
  deleteFaq(tenantId: string, id: string): Promise<boolean>;

  // --- Documentos ---
  listDocuments(tenantId: string): Promise<KnowledgeDocumentRecord[]>;
  /** Documentos que cuentan contra el tope (processing + ready; los error no). */
  countDocuments(tenantId: string): Promise<number>;
  countReadyDocuments(tenantId: string): Promise<number>;
  /** Chunks indexados del tenant (control de crecimiento). */
  countChunks(tenantId: string): Promise<number>;
  findDocumentBySha(tenantId: string, sha256: string): Promise<KnowledgeDocumentRecord | null>;
  createDocument(tenantId: string, input: { filename: string; mimeType: string | null; sizeBytes: number; createdBy: string | null }): Promise<KnowledgeDocumentRecord>;
  completeDocument(tenantId: string, documentId: string, input: CompleteDocumentInput): Promise<KnowledgeDocumentRecord>;
  /** Marca error y elimina cualquier chunk parcial del documento. */
  failDocument(tenantId: string, documentId: string, message: string): Promise<void>;
  deleteDocument(tenantId: string, documentId: string): Promise<boolean>;

  // --- Búsqueda ---
  /** Candidatos ordenados por relevancia (el umbral y el presupuesto los aplica el backend). */
  search(tenantId: string, terms: string[], sources: KnowledgeSource[], limit: number): Promise<RawSearchHit[]>;
}
