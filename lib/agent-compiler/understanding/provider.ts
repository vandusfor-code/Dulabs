// DuLabs Business — Business Agent 2.0, FASE 2 — UnderstandingProvider.
//
// Interfaz agnóstica del proveedor + implementación sobre un adapter EXISTENTE: el EffectExecutor kind "ai" en modo
// `extract`, con el mismo patrón de dispatch inyectable que el clasificador del Gate (runtime/production/ports.ts).
// Proveedor por defecto: Gemini (GeminiExecutor + GEMINI_KEY, lib/flow/gemini), el proveedor de IA de DuLabs. No se
// crea un cliente nuevo: se reutilizan la API key de plataforma, la salida JSON forzada por responseSchema, el
// presupuesto, el chequeo de tenant, el rechazo de campos de evidencia y la clasificación de errores del executor.
// El proveedor solo TRANSPORTA la salida: validarla es trabajo de validate.ts.

//
// FASE 7 — sin acoplar el Business Agent a Gemini: la interfaz `UnderstandingProvider` es la abstracción; Gemini es SU
// implementación de producción. Cambios aditivos:
//   - `signal`: el motor impone un timeout por intento (antes la llamada no tenía límite propio).
//   - temperatura 0 (clasificación/extracción; antes heredaba 0,7 del cliente) vía el cliente inyectable del executor,
//     sin modificar el GeminiExecutor compartido.
//   - cada falla dice si es TRANSITORIA (`retryable`) y su motivo; el éxito trae los tokens usados (costo).

import { randomUUID } from "node:crypto";
import { GeminiExecutor } from "@/lib/flow/executors/gemini-executor";
import { createGeminiGenerateContentClient, resolveGeminiApiKeyFromEnv } from "@/lib/flow/gemini/gemini-client";
import type { GeminiGenerateContentClient } from "@/lib/flow/gemini/gemini-types";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest, type EffectDispatchResult } from "@/lib/flow/executor-types";
import { categorizeEffectFailure, type BusinessAgentErrorCategory } from "@/lib/agent-compiler/contracts/errors";

export interface UnderstandingProviderRequest {
  tenantId: string;
  conversationId: string;
  instruction: string;
  userContent: string;
  outputSchema: Record<string, unknown>;
  /** FASE 7 — cancelación por timeout del intento (lo impone el motor). */
  signal?: AbortSignal;
}

/** Motivo de una falla del proveedor (para reintentos, circuito y observabilidad; nunca se muestra al cliente). */
export type ProviderFailureReason = "timeout" | "rate_limited" | "server" | "network" | "unavailable" | "auth" | "output_invalid" | "rejected" | "circuit_open";

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export type UnderstandingProviderResult =
  | { ok: true; output: unknown; provider: string; model?: string; latencyMs?: number; usage?: ProviderUsage }
  | { ok: false; category: BusinessAgentErrorCategory; code: string; retryable?: boolean; reason?: ProviderFailureReason };

export interface UnderstandingProvider {
  readonly name: string;
  understand(request: UnderstandingProviderRequest): Promise<UnderstandingProviderResult>;
}

/** Dispatch de IA inyectable (para test). En producción = GeminiExecutor real. */
export type UnderstandingDispatch = (req: EffectDispatchRequest, signal?: AbortSignal) => Promise<EffectDispatchResult>;

/** Interpretar no es creativo: misma entrada, misma lectura (en lo posible). */
export const UNDERSTANDING_TEMPERATURE = 0;

/**
 * Cliente Gemini del entorno: se crea por llamada con la clave (nunca se guarda ni se imprime); si falta, el executor ya
 * devolvió `gemini_api_key_missing` antes de llegar aquí.
 */
const envGeminiClient: GeminiGenerateContentClient = {
  generateContent(params, signal) {
    const apiKey = resolveGeminiApiKeyFromEnv();
    if (!apiKey) throw Object.assign(new Error("gemini_api_key_missing"), { status: 401 });
    return createGeminiGenerateContentClient(apiKey).generateContent(params, signal);
  },
};

/** Fija la temperatura del entendimiento sobre cualquier cliente Gemini (el executor compartido no la expone). */
export function withUnderstandingTemperature(client: GeminiGenerateContentClient): GeminiGenerateContentClient {
  return { generateContent: (params, signal) => client.generateContent({ ...params, temperature: UNDERSTANDING_TEMPERATURE }, signal) };
}

/**
 * Dispatch por el GeminiExecutor REAL (prompt builder confiable/no confiable, responseSchema, parse, campos prohibidos,
 * presupuesto). `client` permite sustituir SOLO el transporte HTTP (tests); en producción es el del entorno.
 */
export function geminiUnderstandingDispatch(client: GeminiGenerateContentClient = envGeminiClient, resolveApiKey: () => Promise<string | null> = async () => resolveGeminiApiKeyFromEnv()): UnderstandingDispatch {
  const executor = new GeminiExecutor({ resolveApiKey, geminiClient: withUnderstandingTemperature(client) });
  return (req, signal) => executor.dispatch(req, { tenantId: req.tenantId, internal: true }, signal);
}

const geminiDispatch: UnderstandingDispatch = (req, signal) => geminiUnderstandingDispatch()(req, signal);

/** ¿Hay un proveedor de IA configurado? Solo presencia: el valor nunca se lee fuera del cliente ni se registra. */
export function understandingProviderConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return typeof env.GEMINI_KEY === "string" && env.GEMINI_KEY.trim().length > 0;
}

const C = EFFECT_RESULT_CLASSIFICATIONS;
function failureReason(classification: string | undefined, category: BusinessAgentErrorCategory): { reason: ProviderFailureReason; retryable: boolean } {
  if (category === "AI_OUTPUT_ERROR") return { reason: "output_invalid", retryable: true };
  switch (classification) {
    case C.TIMEOUT:
      return { reason: "timeout", retryable: true };
    case C.RATE_LIMIT:
      return { reason: "rate_limited", retryable: true };
    case C.RETRYABLE:
      return { reason: "server", retryable: true };
    // Interpretar no tiene efectos: repetir una llamada de desenlace incierto es seguro.
    case C.EXTERNAL_AMBIGUOUS:
      return { reason: "network", retryable: true };
    case C.AUTH_ERROR:
      return { reason: "auth", retryable: false };
    default:
      return { reason: "rejected", retryable: false };
  }
}

export const UNDERSTANDING_NODE_ID = "business-agent-understanding";

export function createExecutorUnderstandingProvider(deps: { dispatch?: UnderstandingDispatch; name?: string } = {}): UnderstandingProvider {
  const dispatch = deps.dispatch ?? geminiDispatch;
  const name = deps.name ?? "gemini";
  return {
    name,
    async understand(request) {
      const req: EffectDispatchRequest = {
        effectId: randomUUID(),
        executionRowId: `understanding:${randomUUID()}`,
        tenantId: request.tenantId,
        nodeId: UNDERSTANDING_NODE_ID,
        attempt: 1,
        kind: "ai",
        payload: { __userMessage: request.userContent },
        ai: {
          mode: "extract",
          instruction: request.instruction,
          extractSchema: request.outputSchema,
          // Contexto mínimo: ni variables del flujo ni datos del contacto; solo lo que arma el motor de entendimiento.
          contextConfig: { includeVariables: false, includeContactFields: false, includeContactTags: false },
        },
      };

      let result: EffectDispatchResult;
      try {
        result = await dispatch(req, request.signal);
      } catch (err) {
        const aborted = request.signal?.aborted || (err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message)));
        return aborted
          ? { ok: false, category: "EXTERNAL_SERVICE_ERROR", code: "understanding_provider_timeout", retryable: true, reason: "timeout" }
          : { ok: false, category: "EXTERNAL_SERVICE_ERROR", code: "understanding_provider_unavailable", retryable: true, reason: "unavailable" };
      }
      if (!result.success) {
        const category = categorizeEffectFailure({ kind: "ai", classification: result.classification, error: result.error });
        const { reason, retryable } = failureReason(result.classification, category);
        const code = category === "AI_OUTPUT_ERROR" ? "understanding_provider_output_invalid" : reason === "timeout" ? "understanding_provider_timeout" : "understanding_provider_failed";
        return { ok: false, category, code, retryable: category === "TENANT_ERROR" ? false : retryable, reason };
      }
      const data = { ...((result.appliedResult ?? result.data ?? {}) as Record<string, unknown>) };
      delete data.__textProvenance;
      const meta = (result.metadata ?? {}) as { model?: unknown; latencyMs?: unknown; inputTokens?: unknown; outputTokens?: unknown };
      const usage: ProviderUsage = {
        ...(typeof meta.inputTokens === "number" ? { inputTokens: meta.inputTokens } : {}),
        ...(typeof meta.outputTokens === "number" ? { outputTokens: meta.outputTokens } : {}),
      };
      return {
        ok: true,
        output: data,
        provider: name,
        ...(typeof meta.model === "string" ? { model: meta.model } : {}),
        ...(typeof meta.latencyMs === "number" ? { latencyMs: meta.latencyMs } : {}),
        ...(Object.keys(usage).length ? { usage } : {}),
      };
    },
  };
}
