/**
 * Mapea AIOutput validado → datos del Engine (Fase 4.2).
 */

import { AI_TEXT_PROVENANCE, type AIOutput, type ClaudeObservabilityMetadata } from "@/lib/flow/claude/claude-types";
import type { ParsedAIOutput } from "@/lib/flow/claude/claude-output-schema";

export function mapAiOutputToEngineData(output: ParsedAIOutput): Record<string, unknown> {
  const data: Record<string, unknown> = { __textProvenance: AI_TEXT_PROVENANCE };

  switch (output.mode) {
    case "respond":
      data.responseText = output.responseText;
      break;
    case "classify":
      data.classification = output.classification;
      if (output.responseText) data.responseText = output.responseText;
      break;
    case "extract":
      for (const [key, value] of Object.entries(output.extracted)) {
        data[key] = value;
      }
      break;
    case "propose_action":
      data.actionProposal = output.actionProposal;
      if (output.responseText) data.responseText = output.responseText;
      break;
  }

  return data;
}

export function buildObservabilityMetadata(input: {
  executionId: string;
  effectId: string;
  flowVersionId?: string;
  agentId?: string;
  agentVersionId?: string;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  mode: AIOutput["mode"];
  budgetAfter: ClaudeObservabilityMetadata["budgetAfter"];
}): ClaudeObservabilityMetadata {
  return {
    executionId: input.executionId,
    effectId: input.effectId,
    flowVersionId: input.flowVersionId,
    agentId: input.agentId,
    agentVersionId: input.agentVersionId,
    model: input.model,
    latencyMs: input.latencyMs,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    mode: input.mode,
    textProvenance: AI_TEXT_PROVENANCE,
    budgetAfter: input.budgetAfter,
  };
}
