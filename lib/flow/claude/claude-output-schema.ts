/**
 * Schema Zod estricto para output de Claude (Fase 4.2).
 */

import { z } from "zod";
import { PROHIBITED_EVIDENCE_FIELDS, type ClaudeAiMode } from "@/lib/flow/claude/claude-types";

const prohibitedFieldSet = new Set<string>(PROHIBITED_EVIDENCE_FIELDS);

export function containsProhibitedEvidenceFields(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = containsProhibitedEvidenceFields(item);
      if (nested) return nested;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (prohibitedFieldSet.has(key)) return key;
      const nested = containsProhibitedEvidenceFields(v);
      if (nested) return nested;
    }
  }
  return null;
}

const actionProposalSchema = z
  .object({
    actionType: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const aiOutputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("respond"), responseText: z.string() }).strict(),
  z
    .object({
      mode: z.literal("classify"),
      classification: z.string().min(1),
      responseText: z.string().optional(),
    })
    .strict(),
  z.object({ mode: z.literal("extract"), extracted: z.record(z.string(), z.unknown()) }).strict(),
  z
    .object({
      mode: z.literal("propose_action"),
      actionProposal: actionProposalSchema,
      responseText: z.string().optional(),
    })
    .strict(),
]);

export type ParsedAIOutput = z.infer<typeof aiOutputSchema>;

export function buildAiOutputToolSchema(mode: ClaudeAiMode): Record<string, unknown> {
  switch (mode) {
    case "respond":
      return {
        type: "object",
        additionalProperties: false,
        properties: { mode: { type: "string", enum: ["respond"] }, responseText: { type: "string" } },
        required: ["mode", "responseText"],
      };
    case "classify":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["classify"] },
          classification: { type: "string" },
          responseText: { type: "string" },
        },
        required: ["mode", "classification"],
      };
    case "extract":
      return {
        type: "object",
        additionalProperties: false,
        properties: { mode: { type: "string", enum: ["extract"] }, extracted: { type: "object" } },
        required: ["mode", "extracted"],
      };
    case "propose_action":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["propose_action"] },
          actionProposal: {
            type: "object",
            additionalProperties: false,
            properties: { actionType: { type: "string" }, arguments: { type: "object" } },
            required: ["actionType"],
          },
          responseText: { type: "string" },
        },
        required: ["mode", "actionProposal"],
      };
  }
}

export function parseAiOutputJson(raw: unknown): {
  ok: true;
  output: ParsedAIOutput;
} | {
  ok: false;
  error: string;
} {
  if (raw === null || raw === undefined) {
    return { ok: false, error: "empty_output" };
  }

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "malformed_json" };
    }
  }

  const prohibited = containsProhibitedEvidenceFields(parsed);
  if (prohibited) {
    return { ok: false, error: `prohibited_field:${prohibited}` };
  }

  const result = aiOutputSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: `schema_validation:${result.error.issues[0]?.message ?? "invalid"}` };
  }

  return { ok: true, output: result.data };
}
