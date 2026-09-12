/**
 * Gemini Executor — EffectExecutor kind "ai" (FASE B, autorizado).
 *
 * Mismo contrato/mismas reglas de seguridad que ClaudeExecutor (nunca se
 * duplica la lógica de negocio): tenant_mismatch, ai_config_required,
 * ownership de agente, presupuesto (checkAiBudget/applyAiUsage genéricos),
 * schema estricto de salida (buildAiOutputToolSchema/parseAiOutputJson,
 * incluida la lista de campos prohibidos -- Gemini tampoco puede colar
 * "available"/"appointmentConfirmed"/etc.), y el mismo gate de
 * propose_action contra `allowedActionTypes` (para AMORE, el nodo IA del
 * flow nunca declara `allowedTools`, así que este executor -- igual que
 * Claude -- NUNCA puede proponer una acción real: ni crear, ni modificar, ni
 * cancelar, ni reservar una cita).
 *
 * Solo cambia el boundary real con el proveedor: Gemini habla por
 * systemInstruction + contents (roles "user"/"model", nunca "assistant") y
 * fuerza JSON vía generationConfig.responseSchema, en vez del tool-calling
 * de Anthropic -- ver lib/flow/gemini/gemini-client.ts.
 */
import { assertNotAborted } from "@/lib/flow/executor-framework";
import { applyAiUsage, checkAiBudget } from "@/lib/flow/claude/claude-budget";
import { buildAIExecutionContext, buildAIRequest } from "@/lib/flow/claude/claude-context-builder";
import { applyContactContextFlags, shouldLoadContactContext } from "@/lib/flow/ai-runtime/contact-context";
import { buildObservabilityMetadata, mapAiOutputToEngineData } from "@/lib/flow/claude/claude-engine-mapper";
import { buildAiOutputToolSchema, parseAiOutputJson } from "@/lib/flow/claude/claude-output-schema";
import { buildClaudeSystemPrompt, buildClaudeUserMessages } from "@/lib/flow/claude/claude-prompt-builder";
import { DEFAULT_AI_BUDGET_LIMITS } from "@/lib/flow/claude/claude-types";
import { classifyGeminiError } from "@/lib/flow/gemini/gemini-error-classifier";
import { createGeminiGenerateContentClient, GEMINI_DEFAULT_MODEL, resolveGeminiApiKeyFromEnv } from "@/lib/flow/gemini/gemini-client";
import { toGeminiResponseSchema } from "@/lib/flow/gemini/gemini-schema";
import type { GeminiExecutorDeps } from "@/lib/flow/gemini/gemini-types";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type InternalActionOperationClass,
} from "@/lib/flow/executor-types";

export class GeminiExecutor implements EffectExecutor {
  readonly kind = "ai" as const;
  readonly version = "1.0.0";
  readonly capabilities = {
    supportsIntegration: false,
    supportsAsync: true,
    operationClasses: [] as InternalActionOperationClass[],
  };

  private readonly budgetLimits;
  private readonly defaultModel;

  constructor(private readonly deps: GeminiExecutorDeps = {}) {
    this.budgetLimits = deps.budgetLimits ?? DEFAULT_AI_BUDGET_LIMITS;
    this.defaultModel = deps.defaultModel ?? GEMINI_DEFAULT_MODEL;
  }

  async dispatch(
    request: EffectDispatchRequest,
    context: EffectExecutionContext,
    signal?: AbortSignal,
  ): Promise<EffectDispatchResult> {
    assertNotAborted(signal);
    const started = Date.now();

    if (context.tenantId !== request.tenantId) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
        error: "tenant_mismatch",
      };
    }

    const ai = request.ai;
    if (!ai) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: "ai_config_required",
      };
    }

    if (ai.agentId && this.deps.assertAgentOwnedByTenant) {
      const owned = await this.deps.assertAgentOwnedByTenant(request.tenantId, ai.agentId);
      if (!owned) {
        return {
          success: false,
          classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
          error: "agent_tenant_mismatch",
        };
      }
    }

    const aiRequest = buildAIRequest({
      request,
      ai,
      aiContext: request.aiContext,
      model: this.defaultModel,
      budgetLimits: this.budgetLimits,
    });

    if (aiRequest.conversation && this.deps.loadConversationHistory) {
      aiRequest.conversationHistory = await this.deps.loadConversationHistory(aiRequest.conversation);
    }

    // FASE F7.3 (Contacto + Tags + IA, autorizado) -- mismo criterio EXACTO
    // que ClaudeExecutor (composition: ambos reutilizan
    // shouldLoadContactContext/applyContactContextFlags, cero lógica
    // duplicada). Ningún Flow existente configura `contextConfig`, así que
    // esto nunca se ejecuta para AMORE/Daniela/Solo Talento/Charlotte.
    if (aiRequest.conversation && shouldLoadContactContext(ai) && this.deps.loadContactContext) {
      const loaded = await this.deps.loadContactContext(aiRequest.conversation);
      aiRequest.contact = applyContactContextFlags(ai, loaded);
    }

    const budgetCheck = checkAiBudget(aiRequest.budget, aiRequest.budgetLimits);
    if (!budgetCheck.ok) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.NON_RETRYABLE,
        error: `ai_budget_exceeded:${budgetCheck.reason}`,
        metadata: { budget: aiRequest.budget, reason: budgetCheck.reason },
      };
    }

    assertNotAborted(signal);

    const apiKey =
      (this.deps.resolveApiKey ? await this.deps.resolveApiKey(request.tenantId) : null) ??
      resolveGeminiApiKeyFromEnv();
    if (!apiKey) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR,
        error: "gemini_api_key_missing",
      };
    }

    const execContext = buildAIExecutionContext(aiRequest);
    const client = this.deps.geminiClient ?? createGeminiGenerateContentClient(apiKey);

    let response;
    try {
      response = await client.generateContent(
        {
          model: this.defaultModel,
          systemInstruction: buildClaudeSystemPrompt(execContext),
          // Gemini usa "model" donde Claude usa "assistant" -- mismo boundary
          // TRUSTED/UNTRUSTED (buildClaudeUserMessages), solo se traduce el
          // nombre del rol al vocabulario real de la API de Gemini.
          contents: buildClaudeUserMessages(execContext).map((m) => ({
            role: m.role === "assistant" ? ("model" as const) : ("user" as const),
            text: m.content,
          })),
          responseSchema: toGeminiResponseSchema(
            buildAiOutputToolSchema(aiRequest.mode, aiRequest.classifications),
          ) as Record<string, unknown>,
          maxOutputTokens: 2048,
        },
        signal,
      );
    } catch (err) {
      const classified = classifyGeminiError(err);
      return {
        success: false,
        classification: classified.classification,
        error: classified.error,
        durationMs: Date.now() - started,
      };
    }

    assertNotAborted(signal);

    const parsed = parseAiOutputJson(response.text);
    if (!parsed.ok) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.VALIDATION_ERROR,
        error: parsed.error,
        durationMs: Date.now() - started,
      };
    }

    if (parsed.output.mode === "propose_action") {
      if (aiRequest.allowedActionTypes.length === 0) {
        return {
          success: false,
          classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
          error: "action_proposals_disabled",
        };
      }
      if (!aiRequest.allowedActionTypes.includes(parsed.output.actionProposal.actionType)) {
        return {
          success: false,
          classification: EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED,
          error: "action_proposal_not_allowed",
        };
      }
    }

    const budgetAfter = applyAiUsage(aiRequest.budget, {
      inputTokens: response.usage?.promptTokenCount,
      outputTokens: response.usage?.candidatesTokenCount,
      durationMs: Date.now() - started,
    });

    const engineData = mapAiOutputToEngineData(parsed.output);
    const metadata = buildObservabilityMetadata({
      executionId: aiRequest.executionId,
      effectId: aiRequest.effectId,
      flowVersionId: aiRequest.flowVersionId,
      agentId: aiRequest.agentId,
      model: response.model ?? this.defaultModel,
      latencyMs: Date.now() - started,
      inputTokens: response.usage?.promptTokenCount,
      outputTokens: response.usage?.candidatesTokenCount,
      mode: parsed.output.mode,
      budgetAfter,
    });

    return {
      success: true,
      classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
      data: engineData,
      appliedResult: engineData,
      rawResult: { mode: parsed.output.mode },
      metadata: metadata as unknown as Record<string, unknown>,
      durationMs: Date.now() - started,
    };
  }
}
