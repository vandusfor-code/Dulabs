// DuLabs Business — Business Agent 2.0, FASE 2 — contrato del entendimiento (versionado).
//
// Dos contratos distintos, a propósito:
//   1. LlmUnderstandingOutput — lo ÚNICO que el modelo puede devolver. Estricto: campo desconocido, tipo incorrecto,
//      confianza fuera de [0,1], intent fuera de la taxonomía o slot inexistente => AI_OUTPUT_ERROR. El modelo nunca
//      devuelve alcance (tenant, conversación), IDs, fechas normalizadas ni decisiones.
//   2. StructuredUnderstanding — lo que produce el BACKEND después de validar y normalizar. Es la entrada de la
//      decisión del backend (FASE 3). Lleva versión de contrato y de taxonomía para poder persistirse y reproducirse.

import { z } from "zod";
import { MAX_SECONDARY_INTENTS, TAXONOMY_VERSION, UNDERSTANDING_INTENTS, type UnderstandingIntent } from "@/lib/agent-compiler/understanding/taxonomy";
import { MAX_SLOT_RAW_LENGTH, type NormalizedSlotValue, type SlotDefinition } from "@/lib/agent-compiler/understanding/slots";
import type { NormalizedMessage, UnderstandingScope } from "@/lib/agent-compiler/understanding/context";
import type { TemporalContext } from "@/lib/agent-compiler/understanding/temporal";

export const UNDERSTANDING_CONTRACT_VERSION = "business-agent.understanding/1.0.0";

export const MAX_LLM_SLOTS = 12;
export const MAX_LLM_AMBIGUITIES = 5;
const MAX_MODEL_VALUE_LENGTH = 60;

export const LLM_AMBIGUITY_REASONS = ["multiple_readings", "missing_detail", "unclear_reference", "other"] as const;

// ---------------------------------------------------------------------------
// 1. Salida del modelo
// ---------------------------------------------------------------------------

const intentScoreSchema = z
  .object({
    intent: z.enum(UNDERSTANDING_INTENTS),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const llmSlotSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    /** Texto LITERAL del mensaje actual donde aparece el dato. */
    raw: z.string().min(1).max(MAX_SLOT_RAW_LENGTH),
    /** Lectura del modelo (no autoritativa): "2026-10-03", "16:00", "16:00-". */
    value: z.string().max(MAX_MODEL_VALUE_LENGTH).optional(),
    /** true solo si el cliente CORRIGE explícitamente un dato que ya había dado. */
    correction: z.boolean().optional(),
  })
  .strict();

export const llmUnderstandingSchema = z
  .object({
    primaryIntent: intentScoreSchema,
    secondaryIntents: z.array(intentScoreSchema).max(MAX_SECONDARY_INTENTS),
    slots: z.array(llmSlotSchema).max(MAX_LLM_SLOTS),
    ambiguities: z
      .array(z.object({ slot: z.string().max(40).optional(), reason: z.enum(LLM_AMBIGUITY_REASONS) }).strict())
      .max(MAX_LLM_AMBIGUITIES),
    language: z.string().regex(/^[a-z]{2}$/),
  })
  .strict();

export type LlmUnderstandingOutput = z.infer<typeof llmUnderstandingSchema>;

/**
 * JSON Schema de la salida para el proveedor (guía la generación; la validación real es el schema Zod de arriba).
 * Solo usa el subconjunto que acepta el responseSchema de Gemini (type, properties, required, items, enum, maxItems;
 * `additionalProperties` lo quita toGeminiResponseSchema): rangos, largos y formatos los impone el schema Zod.
 * Los nombres de slot se restringen al catálogo de ESTE turno (universales + del negocio).
 */
export function buildUnderstandingToolSchema(slotCatalog: ReadonlyMap<string, SlotDefinition>): Record<string, unknown> {
  const intentScore = {
    type: "object",
    additionalProperties: false,
    properties: { intent: { type: "string", enum: [...UNDERSTANDING_INTENTS] }, confidence: { type: "number" } },
    required: ["intent", "confidence"],
  };
  const slotNames = [...slotCatalog.keys()];
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      primaryIntent: intentScore,
      secondaryIntents: { type: "array", maxItems: MAX_SECONDARY_INTENTS, items: intentScore },
      slots: {
        type: "array",
        maxItems: MAX_LLM_SLOTS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", enum: slotNames },
            raw: { type: "string" },
            value: { type: "string" },
            correction: { type: "boolean" },
          },
          required: ["name", "raw"],
        },
      },
      ambiguities: {
        type: "array",
        maxItems: MAX_LLM_AMBIGUITIES,
        items: {
          type: "object",
          additionalProperties: false,
          properties: { slot: { type: "string", enum: slotNames }, reason: { type: "string", enum: [...LLM_AMBIGUITY_REASONS] } },
          required: ["reason"],
        },
      },
      language: { type: "string" },
    },
    required: ["primaryIntent", "secondaryIntents", "slots", "ambiguities", "language"],
  };
}

// ---------------------------------------------------------------------------
// 2. Entendimiento estructurado (backend)
// ---------------------------------------------------------------------------

export type ConfidenceBand = "high" | "medium" | "low";

/** La confianza es una SEÑAL del modelo, no una verdad: la banda solo ordena cuánto verificar después. */
export const CONFIDENCE_BANDS = { high: 0.8, medium: 0.55 } as const;

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_BANDS.high) return "high";
  if (confidence >= CONFIDENCE_BANDS.medium) return "medium";
  return "low";
}

export interface ScoredIntent {
  intent: UnderstandingIntent;
  confidence: number;
  band: ConfidenceBand;
}

/**
 * Relación del valor con lo que ya se sabía en la conversación:
 *   new        no había valor
 *   restated   repite el valor conocido
 *   corrected  corrección EXPLÍCITA (el modelo la marcó y el mensaje tiene una expresión de corrección)
 *   conflict   trae un valor distinto sin corregir explícitamente: NO reemplaza el conocido; decide FASE 3
 */
export type SlotChange = "new" | "restated" | "corrected" | "conflict";

export interface UnderstoodSlot {
  name: string;
  origin: "universal" | "business";
  raw: string;
  status: "resolved" | "ambiguous" | "unresolved" | "invalid";
  value?: NormalizedSlotValue;
  normalizedBy?: "parser" | "validated_model_reading";
  reason?: string;
  candidates?: string[];
  change: SlotChange;
  previous?: string;
}

export type AmbiguityKind =
  | "low_confidence"
  | "competing_intents"
  | "slot_ambiguous"
  | "slot_unresolved"
  | "slot_invalid"
  | "model_flagged"
  | "slot_conflict"
  | "confirmation_without_pending"
  | "correction_without_previous";

export interface Ambiguity {
  kind: AmbiguityKind;
  slot?: string;
  detail?: string;
}

export interface StructuredUnderstanding {
  contractVersion: typeof UNDERSTANDING_CONTRACT_VERSION;
  taxonomyVersion: typeof TAXONOMY_VERSION;
  /** Alcance del turno: SIEMPRE del servidor, nunca del modelo. */
  scope: UnderstandingScope;
  language: string;
  message: { normalization: NormalizedMessage["normalization"] };
  intent: { primary: ScoredIntent; secondary: ScoredIntent[] };
  slots: Record<string, UnderstoodSlot>;
  /** Slots que el modelo devolvió pero no se aceptaron (p. ej. no aparecen en el mensaje). */
  rejectedSlots: Array<{ name: string; reason: string }>;
  ambiguities: Ambiguity[];
  /** Slots esperados por los intents detectados que no están ni en el mensaje ni en la conversación. */
  missingSlots: string[];
  signals: {
    unknown: boolean;
    handoff: { requested: boolean; source: "model" | "deterministic" | "both" | null };
    /** Solo significa algo con una confirmación pendiente del sistema (pendingRef). */
    confirmation: { kind: "affirm" | "deny"; pendingRef: string | null } | null;
    cancellation: boolean;
    rescheduling: boolean;
    correction: boolean;
  };
  temporal: TemporalContext;
  provenance: { provider: string; model?: string; latencyMs?: number };
}
