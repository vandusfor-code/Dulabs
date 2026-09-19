// DuLabs Business — Agent Compiler (Fase 1), Step 4.
//
// Schemas Zod del BusinessAgentSpec. Reutiliza el MISMO validador (zod) que el
// resto del proyecto (lib/flow/schemas.ts). Valida estructura, enums y campos
// requeridos; las reglas cross-field (capabilities ancladas, incompatibilidades,
// referencias) se aplican en validate.ts sobre el resultado ya parseado.

import { z } from "zod";
import type { ConditionOperator } from "@/lib/flow/types";
import { CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";

const id = z.string().trim().min(1, "id requerido");
const texto = z.string().trim().min(1);

// Operadores: DEBEN coincidir con ConditionOperator de lib/flow/types (anclaje
// al Runtime). El `satisfies` falla en compilación si divergen.
const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "exists",
  "not_exists",
] as const satisfies readonly ConditionOperator[];

const conditionRuleSchema = z.object({
  field: texto,
  operator: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const policyConditionSchema = z.object({
  rules: z.array(conditionRuleSchema).min(1),
  match: z.enum(["all", "any"]),
});

export const identitySchema = z.object({
  businessName: texto,
  agentName: texto,
  description: z.string().trim().optional(),
  language: texto,
  timezone: texto,
});

export const personalitySchema = z.object({
  primary: z.enum(["professional", "friendly", "direct", "consultative"]),
  verbosity: z.enum(["concise", "balanced", "detailed"]),
  emojiPolicy: z.enum(["none", "limited"]),
  formality: z.enum(["formal", "neutral", "casual"]),
});

export const capabilitiesSchema = z.object(
  Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof CAPABILITY_KEYS)[number], z.ZodBoolean>,
);

export const catalogSchema = z.object({
  source: z.literal("structured"),
  useServices: z.boolean(),
  useProducts: z.boolean(),
  quoteBeforeQualification: z.boolean(),
});

export const prohibitionSchema = z
  .object({
    id,
    description: texto,
    scope: z.enum(["business", "state", "contextual"]),
    condition: policyConditionSchema.optional(),
    action: z.enum(["BLOCK", "FIXED_RESPONSE", "TRANSFER_HUMAN"]),
    response: z.string().trim().optional(),
    priority: z.number().int().min(0),
  })
  .refine((p) => p.scope !== "contextual" || !!p.condition, {
    message: "una prohibición contextual requiere `condition`",
    path: ["condition"],
  })
  .refine((p) => p.action !== "FIXED_RESPONSE" || !!p.response, {
    message: "action FIXED_RESPONSE requiere `response`",
    path: ["response"],
  });

export const ruleSchema = z.object({
  id,
  description: texto,
  kind: z.enum(["informative", "reminder", "requirement", "validation", "precondition"]),
  response: z.string().trim().optional(),
  priority: z.number().int().min(0),
});

export const handoffRuleSchema = z
  .object({
    id,
    description: texto,
    trigger: z.object({
      kind: z.enum(["agent_request", "complaint", "discount_request", "keyword", "intent"]),
      keywords: z.array(texto).optional(),
      intent: z.string().trim().optional(),
    }),
    action: z.enum(["TRANSFER_HUMAN", "FIXED_RESPONSE_THEN_PAUSE"]),
    response: z.string().trim().optional(),
    pauseHours: z.number().int().min(0).optional(),
  })
  .refine((h) => h.trigger.kind !== "keyword" || (h.trigger.keywords?.length ?? 0) > 0, {
    message: "un trigger de tipo keyword requiere `keywords`",
    path: ["trigger", "keywords"],
  })
  .refine((h) => h.trigger.kind !== "intent" || !!h.trigger.intent, {
    message: "un trigger de tipo intent requiere `intent`",
    path: ["trigger", "intent"],
  });

export const schedulingSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["none", "internal", "nylas", "google_calendar"]),
  timezone: texto,
  minNoticeMinutes: z.number().int().min(0),
  cancellation: z.object({ allowed: z.boolean(), minNoticeHours: z.number().int().min(0) }),
  confirmation: z.object({ required: z.boolean(), hoursBefore: z.number().int().min(0) }),
  resources: z.array(z.object({ kind: texto, label: texto, required: z.boolean() })),
});

export const knowledgeSchema = z.object({
  authority: z.literal("secondary"),
  documents: z.array(
    z.object({ id, filename: texto, textRef: z.string().optional(), uploadedAt: texto }),
  ),
});

export const metadataSchema = z.object({
  specVersion: z.number().int().min(1),
  status: z.enum(["draft", "compiled", "published", "archived"]),
  createdAt: texto,
  updatedAt: texto,
  authorId: z.string().trim().optional(),
});

export const businessAgentSpecSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  identity: identitySchema,
  personality: personalitySchema,
  capabilities: capabilitiesSchema,
  catalog: catalogSchema,
  policies: z.object({ prohibitions: z.array(prohibitionSchema), rules: z.array(ruleSchema) }),
  handoff: z.object({ rules: z.array(handoffRuleSchema), defaultPauseHours: z.number().int().min(0) }),
  scheduling: schedulingSchema,
  knowledge: knowledgeSchema,
  metadata: metadataSchema,
});

export type BusinessAgentSpecParsed = z.infer<typeof businessAgentSpecSchema>;

export function safeParseBusinessAgentSpec(input: unknown) {
  return businessAgentSpecSchema.safeParse(input);
}
