/**
 * Contratos Gemini Executor (FASE B, autorizado) — mismo boundary inyectable
 * que ClaudeExecutor (lib/flow/claude/claude-types.ts), nunca duplica la
 * lógica de negocio (mode/verifiedResults/prohibited-fields/budget siguen
 * siendo genéricos y se reutilizan tal cual). Solo cambia la forma real de
 * hablar con el proveedor: Gemini usa systemInstruction + contents (roles
 * "user"/"model", nunca "assistant") y JSON forzado vía responseSchema, en
 * vez del tool-calling de Anthropic.
 */
import type { AiBudgetLimits } from "@/lib/flow/claude/claude-types";
import type { ConversationKey } from "@/lib/flow/orchestrator-types";

export interface GeminiExecutorDeps {
  defaultModel?: string;
  budgetLimits?: AiBudgetLimits;
  resolveApiKey?: (tenantId: string) => Promise<string | null>;
  assertAgentOwnedByTenant?: (tenantId: string, agentId: string) => Promise<boolean>;
  loadConversationHistory?: (
    conversation: ConversationKey,
  ) => Promise<Array<{ role: "user" | "assistant"; content: string }>>;
  geminiClient?: GeminiGenerateContentClient;
}

export interface GeminiContentPart {
  role: "user" | "model";
  text: string;
}

export interface GeminiGenerateContentParams {
  model: string;
  systemInstruction: string;
  contents: GeminiContentPart[];
  /** Subconjunto de JSON Schema soportado por Gemini (nunca additionalProperties) -- forzado vía generationConfig.responseSchema + responseMimeType=application/json. */
  responseSchema: Record<string, unknown>;
  maxOutputTokens: number;
  temperature?: number;
  /**
   * Opcional -- generationConfig.thinkingConfig.thinkingLevel (Gemini 3.x).
   * Verificado contra la documentación oficial (ai.google.dev/gemini-api/docs/generate-content/thinking
   * y .../gemini-3) antes de agregarlo, no inventado. Si se omite, el
   * request queda BYTE A BYTE igual a como estaba antes de este campo --
   * los llamadores existentes (AMORE, GeminiExecutor del Flow Engine) no
   * cambian de comportamiento.
   */
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
}

export interface GeminiGenerateContentResult {
  /** JSON crudo en texto -- se parsea con el mismo parseAiOutputJson que usa Claude. */
  text: string | null;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number };
  model?: string;
}

/** Boundary inyectable — tests mockan esto, nunca la red real. */
export interface GeminiGenerateContentClient {
  generateContent(
    params: GeminiGenerateContentParams,
    signal?: AbortSignal,
  ): Promise<GeminiGenerateContentResult>;
}
