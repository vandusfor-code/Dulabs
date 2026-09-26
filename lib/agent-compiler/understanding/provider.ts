// DuLabs Business — Business Agent 2.0, FASE 2 — UnderstandingProvider.
//
// Interfaz agnóstica del proveedor + implementación sobre un adapter EXISTENTE: el EffectExecutor kind "ai" en modo
// `extract`, con el mismo patrón de dispatch inyectable que el clasificador del Gate (runtime/production/ports.ts).
// Proveedor por defecto: Gemini (GeminiExecutor + GEMINI_KEY, lib/flow/gemini), el proveedor de IA de DuLabs. No se
// crea un cliente nuevo: se reutilizan la API key de plataforma, la salida JSON forzada por responseSchema, el
// presupuesto, el chequeo de tenant, el rechazo de campos de evidencia y la clasificación de errores del executor.
// El proveedor solo TRANSPORTA la salida: validarla es trabajo de validate.ts.

import { randomUUID } from "node:crypto";
import { GeminiExecutor } from "@/lib/flow/executors/gemini-executor";
import { resolveGeminiApiKeyFromEnv } from "@/lib/flow/gemini/gemini-client";
import type { EffectDispatchRequest, EffectDispatchResult } from "@/lib/flow/executor-types";
import { categorizeEffectFailure, type BusinessAgentErrorCategory } from "@/lib/agent-compiler/contracts/errors";

export interface UnderstandingProviderRequest {
  tenantId: string;
  conversationId: string;
  instruction: string;
  userContent: string;
  outputSchema: Record<string, unknown>;
}

export type UnderstandingProviderResult =
  | { ok: true; output: unknown; provider: string; model?: string; latencyMs?: number }
  | { ok: false; category: BusinessAgentErrorCategory; code: string };

export interface UnderstandingProvider {
  readonly name: string;
  understand(request: UnderstandingProviderRequest): Promise<UnderstandingProviderResult>;
}

/** Dispatch de IA inyectable (para test). En producción = GeminiExecutor real. */
export type UnderstandingDispatch = (req: EffectDispatchRequest) => Promise<EffectDispatchResult>;

function geminiDispatch(req: EffectDispatchRequest): Promise<EffectDispatchResult> {
  const executor = new GeminiExecutor({ resolveApiKey: async () => resolveGeminiApiKeyFromEnv() });
  return executor.dispatch(req, { tenantId: req.tenantId, internal: true });
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
        result = await dispatch(req);
      } catch {
        return { ok: false, category: "EXTERNAL_SERVICE_ERROR", code: "understanding_provider_unavailable" };
      }
      if (!result.success) {
        const category = categorizeEffectFailure({ kind: "ai", classification: result.classification, error: result.error });
        return { ok: false, category, code: category === "AI_OUTPUT_ERROR" ? "understanding_provider_output_invalid" : "understanding_provider_failed" };
      }
      const data = { ...((result.appliedResult ?? result.data ?? {}) as Record<string, unknown>) };
      delete data.__textProvenance;
      const meta = (result.metadata ?? {}) as { model?: unknown; latencyMs?: unknown };
      return {
        ok: true,
        output: data,
        provider: name,
        ...(typeof meta.model === "string" ? { model: meta.model } : {}),
        ...(typeof meta.latencyMs === "number" ? { latencyMs: meta.latencyMs } : {}),
      };
    },
  };
}
