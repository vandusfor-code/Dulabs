/**
 * Claude Executor — EffectExecutor kind "ai" (Fase 4.2).
 */

import { assertNotAborted } from "@/lib/flow/executor-framework";
import {
  CLAUDE_DEFAULT_MODEL,
  createAnthropicMessagesClient,
  resolveAnthropicApiKeyFromEnv,
} from "@/lib/flow/claude/anthropic-client";
import { applyAiUsage, checkAiBudget } from "@/lib/flow/claude/claude-budget";
import { buildAIExecutionContext, buildAIRequest } from "@/lib/flow/claude/claude-context-builder";
import { classifyAnthropicError } from "@/lib/flow/claude/claude-error-classifier";
import { buildObservabilityMetadata, mapAiOutputToEngineData } from "@/lib/flow/claude/claude-engine-mapper";
import { buildAiOutputToolSchema, parseAiOutputJson } from "@/lib/flow/claude/claude-output-schema";
import { buildClaudeSystemPrompt, buildClaudeUserMessages } from "@/lib/flow/claude/claude-prompt-builder";
import { DEFAULT_AI_BUDGET_LIMITS, type ClaudeExecutorDeps } from "@/lib/flow/claude/claude-types";
import {
  EFFECT_RESULT_CLASSIFICATIONS,
  type EffectDispatchRequest,
  type EffectDispatchResult,
  type EffectExecutionContext,
  type EffectExecutor,
  type InternalActionOperationClass,
} from "@/lib/flow/executor-types";

const STRUCTURED_TOOL_NAME = "structured_ai_output";

export class ClaudeExecutor implements EffectExecutor {
  readonly kind = "ai" as const;
  readonly version = "1.0.0";
  readonly capabilities = {
    supportsIntegration: false,
    supportsAsync: true,
    operationClasses: [] as InternalActionOperationClass[],
  };

  private readonly budgetLimits;
  private readonly defaultModel;

  constructor(private readonly deps: ClaudeExecutorDeps = {}) {
    this.budgetLimits = deps.budgetLimits ?? DEFAULT_AI_BUDGET_LIMITS;
    this.defaultModel = deps.defaultModel ?? CLAUDE_DEFAULT_MODEL;
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
      resolveAnthropicApiKeyFromEnv();
    if (!apiKey) {
      return {
        success: false,
        classification: EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR,
        error: "anthropic_api_key_missing",
      };
    }

    const execContext = buildAIExecutionContext(aiRequest);
    const client = this.deps.anthropicClient ?? createAnthropicMessagesClient(apiKey);

    let response;
    try {
      response = await client.createMessage(
        {
          model: this.defaultModel,
          max_tokens: 1024,
          system: buildClaudeSystemPrompt(execContext),
          messages: buildClaudeUserMessages(execContext),
          tools: [
            {
              name: STRUCTURED_TOOL_NAME,
              description: "Structured AI output for DuLabs Flow",
              input_schema: buildAiOutputToolSchema(aiRequest.mode, aiRequest.classifications),
            },
          ],
        },
        signal,
      );
    } catch (err) {
      const classified = classifyAnthropicError(err);
      return {
        success: false,
        classification: classified.classification,
        error: classified.error,
        durationMs: Date.now() - started,
      };
    }

    assertNotAborted(signal);

    const toolBlock = response.content.find(
      (b): b is Extract<(typeof response.content)[number], { type: "tool_use" }> =>
        b.type === "tool_use" && b.name === STRUCTURED_TOOL_NAME,
    );
    const parsed = parseAiOutputJson(toolBlock?.input ?? null);
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
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
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
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
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
