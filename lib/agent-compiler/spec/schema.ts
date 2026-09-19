// DuLabs Business — Agent Compiler (Fase 1), Step 4.
//
// Schemas Zod del BusinessAgentSpec. Reutiliza el MISMO validador (zod) que el
// resto del proyecto (lib/flow/schemas.ts). Valida estructura, enums y campos
// requeridos; las reglas cross-field (capabilities ancladas, incompatibilidades,
// referencias) se aplican en validate.ts sobre el resultado ya parseado.
//
// Bloque 18 (hardening de payload/costo): TODO string y array lleva un tope de
// tamaño. Son generosos —muy por encima de cualquier Spec real (una config
// típica tiene <30 ítems y textos de pocas líneas)— así que no rechazan ningún
// Spec legítimo, pero cortan el vector de un admin autenticado (o un token
// comprometido) que envíe un Spec gigante (strings de MB o arrays de millones)
// que infle el compile síncrono, la IR/Flow persistidos y el runtime compartido.

import { z } from "zod";
import type { ConditionOperator } from "@/lib/flow/types";
import { CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";

// Topes de tamaño (hardening Bloque 18). Ajustados para no rechazar Specs reales.
const MAX_ID = 200;
const MAX_TEXTO = 2000; // nombres, etiquetas, descripciones cortas, keywords, timezone…
const MAX_TEXTO_LARGO = 4000; // respuestas del agente / descripciones libres
const MAX_INTENT = 500;
const MAX_ARRAY_POLICIES = 200;
const MAX_ARRAY_HANDOFF = 100;
const MAX_ARRAY_RESOURCES = 50;
const MAX_ARRAY_DOCS = 200;
const MAX_ARRAY_KEYWORDS = 100;
const MAX_ARRAY_CONDITION_RULES = 50;

const id = z.string().trim().min(1, "id requerido").max(MAX_ID);
const texto = z.string().trim().min(1).max(MAX_TEXTO);
/** Texto opcional más largo (respuestas del agente / descripciones libres). */
const textoLargoOpc = z.string().trim().max(MAX_TEXTO_LARGO).optional();

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
  value: z.union([z.string().max(MAX_TEXTO), z.number(), z.boolean()]).optional(),
});

const policyConditionSchema = z.object({
  rules: z.array(conditionRuleSchema).min(1).max(MAX_ARRAY_CONDITION_RULES),
  match: z.enum(["all", "any"]),
});

export const identitySchema = z.object({
  businessName: texto,
  agentName: texto,
  description: textoLargoOpc,
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
    response: textoLargoOpc,
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
  response: textoLargoOpc,
  priority: z.number().int().min(0),
});

export const handoffRuleSchema = z
  .object({
    id,
    description: texto,
    trigger: z.object({
      kind: z.enum(["agent_request", "complaint", "discount_request", "keyword", "intent"]),
      keywords: z.array(texto).max(MAX_ARRAY_KEYWORDS).optional(),
      intent: z.string().trim().max(MAX_INTENT).optional(),
    }),
    action: z.enum(["TRANSFER_HUMAN", "FIXED_RESPONSE_THEN_PAUSE"]),
    response: textoLargoOpc,
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
  resources: z.array(z.object({ kind: texto, label: texto, required: z.boolean() })).max(MAX_ARRAY_RESOURCES),
});

export const knowledgeSchema = z.object({
  authority: z.literal("secondary"),
  documents: z
    .array(z.object({ id, filename: texto, textRef: z.string().max(MAX_TEXTO_LARGO).optional(), uploadedAt: texto }))
    .max(MAX_ARRAY_DOCS),
});

export const metadataSchema = z.object({
  specVersion: z.number().int().min(1),
  status: z.enum(["draft", "compiled", "published", "archived"]),
  createdAt: texto,
  updatedAt: texto,
  authorId: z.string().trim().max(MAX_ID).optional(),
});

export const businessAgentSpecSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  identity: identitySchema,
  personality: personalitySchema,
  capabilities: capabilitiesSchema,
  catalog: catalogSchema,
  policies: z.object({
    prohibitions: z.array(prohibitionSchema).max(MAX_ARRAY_POLICIES),
    rules: z.array(ruleSchema).max(MAX_ARRAY_POLICIES),
  }),
  handoff: z.object({
    rules: z.array(handoffRuleSchema).max(MAX_ARRAY_HANDOFF),
    defaultPauseHours: z.number().int().min(0),
  }),
  scheduling: schedulingSchema,
  knowledge: knowledgeSchema,
  metadata: metadataSchema,
});

export type BusinessAgentSpecParsed = z.infer<typeof businessAgentSpecSchema>;

export function safeParseBusinessAgentSpec(input: unknown) {
  return businessAgentSpecSchema.safeParse(input);
}
