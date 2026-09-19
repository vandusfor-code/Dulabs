/**
 * R4 — límites del conocimiento del Business Agent. Fuente ÚNICA de verdad:
 * los usan la validación server-side, el pipeline de ingesta, la recuperación y
 * la UI. Todos son topes DEFENSIVOS de costo/abuso, muy por encima de un uso
 * legítimo, y se aplican en el SERVIDOR (nunca solo en el frontend).
 */
export const KNOWLEDGE_LIMITS = {
  // --- FAQ ---
  faqMaxPerTenant: 100,
  faqQuestionMin: 3,
  faqQuestionMax: 300,
  faqAnswerMax: 2000,

  // --- Documentos ---
  /** Tope de subida (Vercel rechaza ~4.5 MB a nivel plataforma; mismo valor que upload-validacion). */
  docMaxBytes: 4 * 1024 * 1024,
  docMaxPerTenant: 10,
  /** Caracteres de texto extraído que se indexan por documento (el resto se descarta y se marca `truncated`). */
  docMaxChars: 200_000,
  docMaxChunks: 300,
  /** Tope de chunks indexados en TOTAL por tenant (control de crecimiento de la tabla/índice). */
  tenantMaxChunks: 1500,
  filenameMax: 120,

  // --- Chunking ---
  chunkTargetChars: 900,
  chunkMaxChars: 1200,
  chunkOverlapChars: 150,

  // --- Recuperación (por consulta) ---
  /** Términos de la consulta que se usan (los primeros, sin stopwords). */
  queryMaxTerms: 12,
  queryMaxChars: 500,
  /** Candidatos que pide el backend a la BD (la BD además topa en 20). */
  searchCandidates: 12,
  /** Fragmentos que llegan a la IA. */
  resultsMax: 4,
  /** Presupuesto TOTAL de caracteres de contexto que llega a la IA por consulta (evita explosión de tokens). */
  resultsMaxChars: 3000,
  /** Cobertura mínima de términos de la consulta que debe tener un fragmento para considerarse relevante. */
  minCoverage: 0.5,
} as const;

export const KNOWLEDGE_SOURCES = ["faq", "documento"] as const;
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];

/** Extensiones aceptadas para documentos de conocimiento. */
export const KNOWLEDGE_DOC_EXTENSIONS = ["pdf", "xlsx", "csv", "txt"] as const;
export type KnowledgeDocExtension = (typeof KNOWLEDGE_DOC_EXTENSIONS)[number];

/** Mensaje por defecto cuando no hay información (política "message"). Configurable en el Spec. */
export const DEFAULT_NO_ANSWER_MESSAGE =
  "No tengo información sobre eso por ahora. ¿Puedes preguntármelo de otra forma o quieres consultar algo distinto?";
export const NO_ANSWER_MESSAGE_MAX = 300;
