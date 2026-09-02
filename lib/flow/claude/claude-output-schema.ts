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
  // Blocker #7 (Fix A, autorizado) — classify SOLO puede producir una
  // clasificación estructurada. Sin responseText: Claude no tiene forma de
  // colar texto libre que el motor reenvíe como mensaje real (ver
  // flow-engine.ts, rama classify -- no se modifica, pero deja de poder
  // dispararse porque este campo ya no existe en la salida validada).
  z
    .object({
      mode: z.literal("classify"),
      classification: z.string().min(1),
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

/**
 * Bug raíz real (Daniela, sept. 2026) — el schema de "classify" aceptaba
 * `classification` como string libre, sin restringirlo a las categorías
 * reales del nodo (node.config.classifications). Claude, guiado solo por el
 * texto de la instrucción, a veces devolvía una variante que no calzaba
 * carácter por carácter con ninguna (mayúscula, sinónimo, espacio) -- y
 * flow-engine.ts hace match EXACTO de string contra `class:{valor}` (ver
 * ese archivo, rama "classify"), así que cualquier variante caía al
 * default -- que en el router de Daniela es SIEMPRE handoff a humano. Con
 * `enum` en el tool schema, la API de Claude directamente no permite que el
 * tool_use devuelva un valor fuera de la lista: no es una validación
 * posterior, es una restricción real de la llamada.
 */
export function buildAiOutputToolSchema(mode: ClaudeAiMode, classifications?: string[]): Record<string, unknown> {
  switch (mode) {
    case "respond":
      return {
        type: "object",
        additionalProperties: false,
        properties: { mode: { type: "string", enum: ["respond"] }, responseText: { type: "string" } },
        required: ["mode", "responseText"],
      };
    case "classify":
      // Blocker #7 (Fix A) — sin responseText en el schema que ve Claude:
      // el modelo no puede ofrecer un campo que no existe en la herramienta.
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["classify"] },
          classification:
            classifications && classifications.length > 0
              ? { type: "string", enum: classifications }
              : { type: "string" },
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
