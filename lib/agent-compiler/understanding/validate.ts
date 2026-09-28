// DuLabs Business — Business Agent 2.0, FASE 2 — validación de la salida del modelo.
//
// parse -> schema -> consistencia -> normalización -> (rechazo). Sin reparaciones peligrosas: nunca se reordena,
// completa, trunca ni "adivina" una salida defectuosa. Una salida fuera de contrato es AI_OUTPUT_ERROR completa; lo
// único que se descarta de forma individual es un slot cuyo `raw` no aparece en el mensaje actual (posible invención):
// quitarlo solo reduce información, nunca la agrega.

import { safeError, type BusinessAgentSafeError } from "@/lib/agent-compiler/contracts/errors";
import { containsProhibitedEvidenceFields } from "@/lib/flow/claude/claude-output-schema";
import { HUMAN_REQUEST_PHRASES } from "@/lib/agent-compiler/runtime/guardrail-gate";
import {
  UNDERSTANDING_CONTRACT_VERSION,
  confidenceBand,
  llmUnderstandingSchema,
  type Ambiguity,
  type LlmUnderstandingOutput,
  type ScoredIntent,
  type StructuredUnderstanding,
  type UnderstoodSlot,
} from "@/lib/agent-compiler/understanding/contract";
import { INTENT_DEFINITIONS, TAXONOMY_VERSION, type UnderstandingIntent } from "@/lib/agent-compiler/understanding/taxonomy";
import { foldText, normalizeSlotValue, type NormalizedSlotValue, type SlotDefinition } from "@/lib/agent-compiler/understanding/slots";
import type { PreparedContext } from "@/lib/agent-compiler/understanding/context";
import type { TemporalContext } from "@/lib/agent-compiler/understanding/temporal";

export type UnderstandingValidationResult =
  | { ok: true; understanding: StructuredUnderstanding }
  | { ok: false; error: BusinessAgentSafeError; detail: string };

/** Margen de confianza bajo el cual dos intents compiten (solo si el primario no es de confianza alta). */
const COMPETING_MARGIN = 0.1;

/** Expresiones de corrección explícita (texto plegado: minúsculas, sin tildes). */
const CORRECTION_MARKER =
  /\b(?:no|mejor|mas bien|en vez de|en lugar de|cambia|cambialo|cambiala|cambiar|corrijo|correccion|perdon|me equivoque|quise decir|mejor dicho|en realidad|disculpa)\b/;

const HANDOFF_PHRASES_FOLDED = HUMAN_REQUEST_PHRASES.map(foldText);

function reject(code: string, detail = code): UnderstandingValidationResult {
  return { ok: false, error: safeError("AI_OUTPUT_ERROR", code), detail };
}

/** 1. parse: objeto plano o JSON en texto. Vacío, truncado o no-objeto => rechazo. */
export function parseUnderstandingPayload(raw: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; code: string } {
  if (raw === null || raw === undefined) return { ok: false, code: "understanding_empty_output" };
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return { ok: false, code: "understanding_empty_output" };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, code: "understanding_malformed_json" };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, code: "understanding_not_an_object" };
  if (Object.keys(parsed).length === 0) return { ok: false, code: "understanding_empty_output" };
  return { ok: true, value: parsed as Record<string, unknown> };
}

/** 2. schema: traduce el primer problema de Zod a un código estable (nunca se expone el detalle al cliente). */
function schemaErrorCode(issue: { code: string; path: PropertyKey[] }): string {
  const path = issue.path.map(String);
  const last = path[path.length - 1];
  if (issue.code === "unrecognized_keys") return "understanding_unknown_field";
  if (last === "intent" && issue.code === "invalid_value") return "understanding_unknown_intent";
  if (last === "confidence" && (issue.code === "too_big" || issue.code === "too_small" || issue.code === "invalid_type")) return "understanding_confidence_invalid";
  if (last === "secondaryIntents" && issue.code === "too_big") return "understanding_too_many_intents";
  if (path.includes("slots") && last === "name") return "understanding_unknown_slot";
  return "understanding_schema_invalid";
}

/** 3. consistencia: reglas del contrato que un JSON Schema no expresa. */
function consistencyError(out: LlmUnderstandingOutput, catalog: ReadonlyMap<string, SlotDefinition>): string | null {
  const all = [out.primaryIntent, ...out.secondaryIntents];
  if (new Set(all.map((i) => i.intent)).size !== all.length) return "understanding_duplicate_intent";
  if (out.secondaryIntents.some((s) => s.confidence > out.primaryIntent.confidence)) return "understanding_intent_order_invalid";
  if (all.some((i) => i.intent === "UNKNOWN") && all.length > 1) return "understanding_inconsistent_unknown";
  const intents = new Set(all.map((i) => i.intent));
  if (intents.has("CONFIRMATION") && intents.has("REJECTION")) return "understanding_inconsistent_confirmation";
  const names = out.slots.map((s) => s.name);
  if (names.some((n) => !catalog.has(n))) return "understanding_unknown_slot";
  if (new Set(names).size !== names.length) return "understanding_duplicate_slot";
  if (out.ambiguities.some((a) => a.slot !== undefined && !catalog.has(a.slot))) return "understanding_unknown_slot";
  return null;
}

/** Representación de un valor normalizado para comparar con lo ya conocido en la conversación. */
export function slotDisplayValue(value: NormalizedSlotValue): string {
  switch (value.kind) {
    case "text":
      return value.text;
    case "number":
      return String(value.number);
    case "date":
      return value.date;
    case "time":
      return value.time;
    case "time_range":
      return value.period ?? `${value.from ?? ""}-${value.to ?? ""}`;
    case "phone":
      return value.phone;
    case "email":
      return value.email;
    case "select":
      return value.option;
    case "boolean":
      return String(value.value);
  }
}

function scored(i: { intent: UnderstandingIntent; confidence: number }): ScoredIntent {
  return { intent: i.intent, confidence: i.confidence, band: confidenceBand(i.confidence) };
}

export function validateAndNormalizeUnderstanding(input: {
  raw: unknown;
  context: PreparedContext;
  temporal: TemporalContext;
  slotCatalog: ReadonlyMap<string, SlotDefinition>;
  provenance: StructuredUnderstanding["provenance"];
}): UnderstandingValidationResult {
  const parsed = parseUnderstandingPayload(input.raw);
  if (!parsed.ok) return reject(parsed.code);

  const prohibited = containsProhibitedEvidenceFields(parsed.value);
  if (prohibited) return reject("understanding_prohibited_field", `prohibited_field:${prohibited}`);

  const schema = llmUnderstandingSchema.safeParse(parsed.value);
  if (!schema.success) {
    const issue = schema.error.issues[0]!;
    return reject(schemaErrorCode(issue), `${issue.code}:${issue.path.join(".")}`);
  }
  const out = schema.data;
  const inconsistent = consistencyError(out, input.slotCatalog);
  if (inconsistent) return reject(inconsistent);

  // 4. normalización
  const ctx = input.context;
  const message = foldText(ctx.message.text);
  const hasCorrectionMarker = CORRECTION_MARKER.test(message);
  const known = ctx.conversation.knownSlots;
  const ambiguities: Ambiguity[] = [];
  const slots: Record<string, UnderstoodSlot> = {};
  const rejectedSlots: StructuredUnderstanding["rejectedSlots"] = [];

  for (const s of out.slots) {
    const raw = s.raw.trim();
    // El dato tiene que estar en lo que el cliente escribió EN ESTE MENSAJE. Si no, el modelo lo trajo de otro lado.
    if (!raw || !message.includes(foldText(raw)) || !foldText(raw)) {
      rejectedSlots.push({ name: s.name, reason: "not_in_message" });
      continue;
    }
    const def = input.slotCatalog.get(s.name)!;
    const n = normalizeSlotValue(def, raw, s.value, input.temporal);
    const slot: UnderstoodSlot = { name: s.name, origin: def.origin, raw, status: n.status, change: "new" };
    if (n.status === "resolved") {
      slot.value = n.value;
      slot.normalizedBy = n.normalizedBy;
    } else {
      slot.reason = n.reason;
      if (n.status === "ambiguous") {
        if (n.candidates) slot.candidates = n.candidates;
        ambiguities.push({ kind: "slot_ambiguous", slot: s.name, detail: n.reason });
      } else {
        ambiguities.push({ kind: n.status === "invalid" ? "slot_invalid" : "slot_unresolved", slot: s.name, detail: n.reason });
      }
    }

    const previous = known[s.name];
    if (previous !== undefined) {
      slot.previous = previous;
      const same = foldText(raw) === foldText(previous) || (slot.value !== undefined && foldText(slotDisplayValue(slot.value)) === foldText(previous));
      if (same) slot.change = "restated";
      else if (s.correction && hasCorrectionMarker) slot.change = "corrected";
      else {
        // Valor distinto sin corrección explícita: no reemplaza el conocido.
        slot.change = "conflict";
        ambiguities.push({ kind: "slot_conflict", slot: s.name });
      }
    } else if (s.correction) {
      ambiguities.push({ kind: "correction_without_previous", slot: s.name });
    }
    slots[s.name] = slot;
  }

  for (const a of out.ambiguities) ambiguities.push({ kind: "model_flagged", ...(a.slot ? { slot: a.slot } : {}), detail: a.reason });

  const primary = scored(out.primaryIntent);
  const secondary = out.secondaryIntents.map(scored);
  if (primary.band === "low") ambiguities.push({ kind: "low_confidence", detail: primary.intent });
  if (primary.band !== "high" && secondary.some((s) => s.confidence >= primary.confidence - COMPETING_MARGIN)) {
    ambiguities.push({ kind: "competing_intents" });
  }

  const intents = new Set<UnderstandingIntent>([primary.intent, ...secondary.map((s) => s.intent)]);

  // Señales (nunca acciones).
  const handoffModel = intents.has("HUMAN_HANDOFF");
  const handoffDeterministic = HANDOFF_PHRASES_FOLDED.some((p) => message.includes(p));
  const pendingRef = ctx.conversation.pendingConfirmation?.ref ?? null;
  let confirmation: StructuredUnderstanding["signals"]["confirmation"] = null;
  if (intents.has("CONFIRMATION") || intents.has("REJECTION")) {
    confirmation = { kind: intents.has("CONFIRMATION") ? "affirm" : "deny", pendingRef };
    if (!pendingRef) ambiguities.push({ kind: "confirmation_without_pending" });
  }

  // Slots faltantes: pista a partir de los intents (la obligatoriedad real la decide el negocio en FASE 3).
  const present = (name: string) => slots[name]?.status === "resolved" || known[name] !== undefined;
  const missing = new Set<string>();
  for (const i of intents) {
    for (const name of INTENT_DEFINITIONS[i].expectedSlots) {
      if (present(name)) continue;
      if (name === "time" && present("time_range")) continue;
      if (name === "service" && present("product")) continue;
      missing.add(name);
    }
  }

  return {
    ok: true,
    understanding: {
      contractVersion: UNDERSTANDING_CONTRACT_VERSION,
      taxonomyVersion: TAXONOMY_VERSION,
      scope: { ...ctx.scope },
      language: out.language,
      message: { normalization: ctx.message.normalization },
      intent: { primary, secondary },
      slots,
      rejectedSlots,
      ambiguities,
      missingSlots: [...missing],
      signals: {
        unknown: primary.intent === "UNKNOWN",
        handoff: {
          requested: handoffModel || handoffDeterministic,
          source: handoffModel && handoffDeterministic ? "both" : handoffModel ? "model" : handoffDeterministic ? "deterministic" : null,
        },
        confirmation,
        cancellation: intents.has("CANCELLATION"),
        rescheduling: intents.has("RESCHEDULING"),
        correction: intents.has("CORRECTION") || Object.values(slots).some((s) => s.change === "corrected"),
      },
      temporal: input.temporal,
      provenance: input.provenance,
    },
  };
}
