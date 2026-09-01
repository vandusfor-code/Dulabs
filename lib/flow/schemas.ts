/**
 * Schemas Zod del contrato Flow Builder.
 * Parsea JSON entrante antes de validaciones de grafo.
 */

import { z } from "zod";
import type { FlowDefinition } from "@/lib/flow/types";

const nonEmptyId = z.string().trim().min(1, "id requerido");

export const nodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const flowTemplateRefSchema = z.object({
  templateId: z.string().trim().min(1).optional(),
  templateName: z.string().trim().min(1).optional(),
  variables: z.record(z.string(), z.string()).optional(),
});

export const flowMediaRefSchema = z.object({
  type: z.enum(["image", "video", "document", "audio"]),
  url: z.string().url().optional(),
  mediaId: z.string().trim().min(1).optional(),
  caption: z.string().optional(),
});

export const assertionCapabilitySchema = z.enum([
  "appointment.reserved",
  "appointment.available",
  "payment.completed",
  "lead.created",
  "support.transferred",
]);

export const messageRoleSchema = z.enum(["informational", "intent_offer", "external_assertion"]);

export const flowMessageContentSchema = z
  .object({
    text: z.string().optional(),
    parts: z.array(z.string().min(1)).min(1).optional(),
    template: flowTemplateRefSchema.optional(),
    media: flowMediaRefSchema.optional(),
    messageRole: messageRoleSchema.optional(),
    asserts: z.array(assertionCapabilitySchema).min(1).optional(),
  })
  .superRefine((val, ctx) => {
    const hasText = Boolean(val.text?.trim());
    const hasParts = Boolean(val.parts?.length);
    const hasTemplate = Boolean(val.template?.templateId || val.template?.templateName);
    const hasMedia = Boolean(val.media);
    if (!hasText && !hasParts && !hasTemplate && !hasMedia) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "message requiere text, parts, template o media",
      });
    }
    if (val.messageRole === "external_assertion" && !val.asserts?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "external_assertion requiere asserts",
        path: ["asserts"],
      });
    }
  });

export const flowButtonSchema = z.object({
  id: nonEmptyId,
  label: z.string().trim().min(1).max(20),
});

export const questionValidationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text") }),
  z.object({ kind: z.literal("number") }),
  z.object({ kind: z.literal("email") }),
  z.object({ kind: z.literal("phone") }),
  z.object({
    kind: z.literal("regex"),
    pattern: z.string().min(1),
    flags: z.string().optional(),
  }),
  z.object({ kind: z.literal("hora_colombia") }),
]);

export const conditionRuleSchema = z
  .object({
    field: z.string().trim().min(1),
    operator: z.enum([
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
    ]),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .superRefine((rule, ctx) => {
    const needsValue = rule.operator !== "exists" && rule.operator !== "not_exists";
    if (needsValue && rule.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "value es obligatorio para este operador",
        path: ["value"],
      });
    }
  });

export const aiNodeConfigSchema = z.object({
  agentId: z.string().uuid().optional(),
  instruction: z.string().trim().min(1),
  mode: z.enum(["classify", "extract", "respond", "hybrid", "propose_action"]),
  outputVariables: z.array(z.string().trim().min(1)).optional(),
  allowedTools: z.array(z.string().trim().min(1)).optional(),
  classifications: z.array(z.string().trim().min(1)).optional(),
});

export const saveDataMappingSchema = z
  .object({
    variable: z.string().trim().min(1),
    target: z.enum(["lead", "custom_field", "webhook_body"]),
    targetKey: z.string().trim().min(1).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.target === "custom_field" && !m.targetKey?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetKey es obligatorio cuando target es custom_field",
        path: ["targetKey"],
      });
    }
  });

const semanticTagSchema = z.string().trim().min(1).optional();

const actionNodeConfigSchema = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("crear_lead_enterprise"),
    semanticTag: semanticTagSchema,
    params: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    actionType: z.literal("crear_lead_campana"),
    semanticTag: semanticTagSchema,
    params: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    actionType: z.literal("transferir_soporte"),
    semanticTag: semanticTagSchema,
    pauseDurationHours: z.number().positive().optional(),
  }),
  z.object({
    actionType: z.literal("etiquetar_conversacion"),
    semanticTag: semanticTagSchema,
    tagId: z.string().trim().min(1),
  }),
  z.object({
    actionType: z.literal("asignar_miembro"),
    semanticTag: semanticTagSchema,
    memberId: z.string().trim().min(1),
  }),
  z.object({
    actionType: z.literal("agendar_cita_marketplace"),
    semanticTag: semanticTagSchema,
    params: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    actionType: z.literal("consultar_disponibilidad_especialista"),
    semanticTag: semanticTagSchema,
    params: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    actionType: z.literal("agendar_cita_especialista"),
    semanticTag: semanticTagSchema,
    params: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    actionType: z.literal("cancelar_cita_especialista"),
    semanticTag: semanticTagSchema,
    params: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    actionType: z.literal("consultar_citas_activas_especialista"),
    semanticTag: semanticTagSchema,
    params: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    actionType: z.literal("mover_cita_especialista"),
    semanticTag: semanticTagSchema,
    params: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    actionType: z.literal("webhook_http"),
    semanticTag: semanticTagSchema,
    url: z.string().url(),
    method: z.enum(["GET", "POST", "PUT", "PATCH"]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    bodyVariableKeys: z.array(z.string().trim().min(1)).optional(),
  }),
  z.object({
    actionType: z.literal("enviar_plantilla"),
    semanticTag: semanticTagSchema,
    templateName: z.string().trim().min(1),
    variables: z.record(z.string(), z.string()).optional(),
  }),
]);

const nodeBaseSchema = z.object({
  id: nonEmptyId,
  position: nodePositionSchema.optional(),
  label: z.string().optional(),
});

export const flowNodeSchema = z.discriminatedUnion("type", [
  nodeBaseSchema.extend({
    type: z.literal("start"),
    config: z.object({
      triggerType: z.enum(["first_message", "keyword", "campaign_reply", "manual"]),
      keywords: z.array(z.string().trim().min(1)).optional(),
    }),
  }),
  nodeBaseSchema.extend({
    type: z.literal("message"),
    config: flowMessageContentSchema,
  }),
  nodeBaseSchema.extend({
    type: z.literal("question"),
    config: z.object({
      text: z.string().trim().min(1),
      variableKey: z.string().trim().min(1),
      required: z.boolean(),
      validation: questionValidationSchema,
    }),
  }),
  nodeBaseSchema.extend({
    type: z.literal("buttons"),
    config: z.object({
      text: z.string().trim().min(1),
      buttons: z.array(flowButtonSchema).min(1).max(3),
      variableKey: z.string().trim().min(1).optional(),
    }),
  }),
  nodeBaseSchema.extend({
    type: z.literal("condition"),
    config: z.object({
      rules: z.array(conditionRuleSchema).min(1),
      match: z.enum(["all", "any"]),
    }),
  }),
  nodeBaseSchema.extend({
    type: z.literal("ai"),
    config: aiNodeConfigSchema,
  }),
  nodeBaseSchema.extend({
    type: z.literal("save_data"),
    config: z.object({
      mappings: z.array(saveDataMappingSchema).min(1),
    }),
  }),
  nodeBaseSchema.extend({
    type: z.literal("action"),
    config: actionNodeConfigSchema,
  }),
  nodeBaseSchema.extend({
    type: z.literal("human"),
    config: z.object({
      message: z.string().optional(),
      pauseDurationHours: z.number().positive(),
      assignTo: z.string().trim().min(1).optional(),
    }),
  }),
  nodeBaseSchema.extend({
    type: z.literal("end"),
    config: z.object({
      message: z.string().optional(),
      tags: z.array(z.string().trim().min(1)).optional(),
    }),
  }),
]);

export const flowEdgeSchema = z.object({
  id: nonEmptyId,
  source: nonEmptyId,
  target: nonEmptyId,
  sourceHandle: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const variableDefinitionSchema = z.object({
  key: z.string().trim().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "key de variable inválida"),
  label: z.string().trim().min(1),
  type: z.enum(["string", "number", "boolean", "date", "email", "phone"]),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  linkedCapability: assertionCapabilitySchema.optional(),
});

export const flowMetadataSchema = z.object({
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  authorId: z.string().optional(),
  notes: z.string().optional(),
});

export const flowDefinitionSchema = z.object({
  id: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  version: z.number().int().positive().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
  variables: z.array(variableDefinitionSchema),
  metadata: flowMetadataSchema.optional(),
});

export type ParsedFlowDefinition = z.infer<typeof flowDefinitionSchema>;

export function parseFlowDefinition(input: unknown): FlowDefinition {
  return flowDefinitionSchema.parse(input) as FlowDefinition;
}

export function safeParseFlowDefinition(input: unknown) {
  return flowDefinitionSchema.safeParse(input);
}
