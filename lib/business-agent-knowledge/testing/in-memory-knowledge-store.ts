/**
 * R4 — KnowledgeStore en memoria (SOLO tests). Imita el contrato del store real,
 * incluido el aislamiento por tenant, el borrado en cascada y la búsqueda.
 *
 * La búsqueda APROXIMA el FTS 'spanish' de Postgres con un stemmer ligero (raíz
 * por recorte de sufijos): sirve para probar el comportamiento del backend
 * (umbral, presupuesto, aislamiento, borrado). La relevancia REAL de Postgres
 * se verifica aparte con el E2E contra la base de datos.
 */
import { randomUUID } from "node:crypto";
import type { BusinessAgentFaq, NormalizedFaqInput } from "@/lib/business-agent-knowledge/faq";
import type { KnowledgeSource } from "@/lib/business-agent-knowledge/limits";
import type { CompleteDocumentInput, KnowledgeDocumentRecord, KnowledgeStore, RawSearchHit } from "@/lib/business-agent-knowledge/store";
import { unaccent } from "@/lib/business-agent-knowledge/tokenizer";

const SUFIJOS = [
  "aciones", "acion", "imientos", "imiento", "amente", "mente", "idades", "idad", "ables", "able", "ando", "iendo",
  "arse", "erse", "irse", "aron", "ieron", "ados", "adas", "ado", "ada", "idos", "idas", "ido", "ida", "ar", "er", "ir",
  "as", "es", "os", "s", "a", "o", "e",
];

export function stem(palabra: string): string {
  const p = unaccent(palabra);
  for (const s of SUFIJOS) {
    if (p.endsWith(s) && p.length - s.length >= 4) return p.slice(0, -s.length);
  }
  return p;
}

function stemsDe(texto: string): Set<string> {
  return new Set((unaccent(texto).match(/[a-z0-9ñ]+/g) ?? []).map(stem));
}

interface FaqReg { tenantId: string; faq: BusinessAgentFaq }
interface DocReg { tenantId: string; doc: KnowledgeDocumentRecord; sha: string | null }
interface ChunkReg { tenantId: string; documentId: string; position: number; content: string }

export interface InMemoryKnowledgeStore extends KnowledgeStore {
  /** Solo aserciones de test. */
  chunksOf(tenantId: string, documentId: string): string[];
  allChunkCount(): number;
  /** Simula una falla de persistencia al indexar chunks (para probar el rollback). */
  failNextCompleteWith(error: Error): void;
}

export function createInMemoryKnowledgeStore(): InMemoryKnowledgeStore {
  const faqs = new Map<string, FaqReg>();
  const docs = new Map<string, DocReg>();
  let chunks: ChunkReg[] = [];
  let failNext: Error | null = null;
  const now = () => new Date().toISOString();

  return {
    chunksOf: (tenantId, documentId) => chunks.filter((c) => c.tenantId === tenantId && c.documentId === documentId).map((c) => c.content),
    allChunkCount: () => chunks.length,
    failNextCompleteWith(error) { failNext = error; },

    async listFaqs(tenantId) { return [...faqs.values()].filter((f) => f.tenantId === tenantId).map((f) => f.faq); },
    async countFaqs(tenantId) { return [...faqs.values()].filter((f) => f.tenantId === tenantId).length; },
    async countActiveFaqs(tenantId) { return [...faqs.values()].filter((f) => f.tenantId === tenantId && f.faq.active).length; },
    async createFaq(tenantId, input: NormalizedFaqInput) {
      const faq: BusinessAgentFaq = { id: randomUUID(), ...input, createdAt: now(), updatedAt: now() };
      faqs.set(faq.id, { tenantId, faq });
      return faq;
    },
    async updateFaq(tenantId, id, input) {
      const reg = faqs.get(id);
      if (!reg || reg.tenantId !== tenantId) return null;
      reg.faq = { ...reg.faq, ...input, updatedAt: now() };
      return reg.faq;
    },
    async deleteFaq(tenantId, id) {
      const reg = faqs.get(id);
      if (!reg || reg.tenantId !== tenantId) return false;
      faqs.delete(id);
      return true;
    },

    async listDocuments(tenantId) { return [...docs.values()].filter((d) => d.tenantId === tenantId).map((d) => d.doc); },
    async countDocuments(tenantId) { return [...docs.values()].filter((d) => d.tenantId === tenantId && d.doc.status !== "error").length; },
    async countReadyDocuments(tenantId) { return [...docs.values()].filter((d) => d.tenantId === tenantId && d.doc.status === "ready").length; },
    async countChunks(tenantId) { return chunks.filter((c) => c.tenantId === tenantId).length; },
    async findDocumentBySha(tenantId, sha) {
      return [...docs.values()].find((d) => d.tenantId === tenantId && d.sha === sha && d.doc.status !== "error")?.doc ?? null;
    },
    async createDocument(tenantId, input) {
      const doc: KnowledgeDocumentRecord = {
        id: randomUUID(), filename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes, status: "processing",
        errorMessage: null, charCount: 0, chunkCount: 0, truncated: false, createdAt: now(),
      };
      docs.set(doc.id, { tenantId, doc, sha: null });
      return doc;
    },
    async completeDocument(tenantId, documentId, input: CompleteDocumentInput) {
      const reg = docs.get(documentId);
      if (!reg || reg.tenantId !== tenantId) throw new Error("documento no encontrado");
      if (failNext) {
        const e = failNext;
        failNext = null;
        // Falla a mitad del lote: quedan chunks parciales que failDocument debe limpiar.
        chunks.push({ tenantId, documentId, position: 0, content: input.chunks[0] ?? "" });
        throw e;
      }
      input.chunks.forEach((content, position) => chunks.push({ tenantId, documentId, position, content }));
      reg.sha = input.sha256;
      reg.doc = { ...reg.doc, status: "ready", errorMessage: null, charCount: input.charCount, chunkCount: input.chunks.length, truncated: input.truncated };
      return reg.doc;
    },
    async failDocument(tenantId, documentId, message) {
      const reg = docs.get(documentId);
      if (!reg || reg.tenantId !== tenantId) return;
      chunks = chunks.filter((c) => !(c.tenantId === tenantId && c.documentId === documentId));
      reg.sha = null;
      reg.doc = { ...reg.doc, status: "error", errorMessage: message, chunkCount: 0 };
    },
    async deleteDocument(tenantId, documentId) {
      const reg = docs.get(documentId);
      if (!reg || reg.tenantId !== tenantId) return false;
      docs.delete(documentId);
      chunks = chunks.filter((c) => !(c.tenantId === tenantId && c.documentId === documentId)); // cascada
      return true;
    },

    async search(tenantId, terms, sources: KnowledgeSource[], limit) {
      const distintos = [...new Set(terms)];
      const total = distintos.length;
      const qStems = distintos.map(stem);
      const hits: RawSearchHit[] = [];
      const evaluar = (sourceType: KnowledgeSource, sourceId: string, title: string, content: string, texto: string) => {
        const s = stemsDe(texto);
        const matched = qStems.filter((q) => s.has(q)).length;
        if (matched > 0) hits.push({ sourceType, sourceId, title, content, rank: matched, matched, total });
      };
      if (sources.includes("faq")) {
        for (const { tenantId: t, faq } of faqs.values()) if (t === tenantId && faq.active) evaluar("faq", faq.id, faq.question, faq.answer, `${faq.question} ${faq.answer}`);
      }
      if (sources.includes("documento")) {
        for (const c of chunks) {
          const d = docs.get(c.documentId);
          if (c.tenantId === tenantId && d && d.tenantId === tenantId && d.doc.status === "ready") evaluar("documento", `${c.documentId}:${c.position}`, d.doc.filename, c.content, c.content);
        }
      }
      return hits.sort((a, b) => b.rank - a.rank).slice(0, Math.min(Math.max(limit, 1), 20));
    },
  };
}
