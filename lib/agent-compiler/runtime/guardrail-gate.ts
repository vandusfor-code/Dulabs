// DuLabs Business — Agent Compiler (Fase 1), Step 7 — Business Guardrail Gate.
//
// Gate PRE-LLM: se ejecuta ANTES del Flow Engine / orquestador. Los guardrails
// críticos NO dependen de que el Flow Engine haya avanzado a un nodo, ni de una
// variable `message` que el Runtime no alimenta: el Gate liga el texto del
// turno y el estado comercial (provisto por el Runtime, NUNCA por el LLM) y
// evalúa las reglas en código puro.
//
// - Deterministas (keywords/combinaciones/prohibiciones contextuales explícitas):
//   código puro, 0 llamadas al LLM. Reutilizan la MISMA semántica de
//   ConditionRule del Flow Engine (field/operator/value), sin depender de
//   lib/flow (matcher replicado, tipos importados solo como type).
// - Semánticas (misma intención con distintas palabras): clasificador LLM
//   CONTROLADO (solo clasifica; NUNCA decide la acción). La acción SIEMPRE la
//   decide DuLabs a partir de la regla que hizo match.
//
// La fuente de verdad son los guardrails que la IR ya conserva
// (CompiledGuardrailIR + HandoffBindingIR): condición, acción, respuesta,
// prioridad, runtimeBinding y procedencia. Este módulo NO modifica la IR.

import type { ConditionMatchMode, ConditionRule } from "@/lib/flow/types";
import type { CompiledBusinessAgentIR } from "@/lib/agent-compiler/ir";

export type GateAction = "BLOCK" | "FIXED_RESPONSE" | "TRANSFER_HUMAN";
export type GateEvaluation = "deterministic" | "semantic";

/** Prioridad base de las reglas de handoff (transferencia gana ante prohibiciones suaves). */
export const HANDOFF_GATE_PRIORITY = 100;
/** Horas de pausa por defecto para una transferencia sin pauseHours explícito. */
export const DEFAULT_TRANSFER_PAUSE_HOURS = 24;

/** Regla ejecutable del Gate, derivada de la IR (no se persiste en la IR). */
export interface GateRule {
  id: string;
  source: "prohibition" | "handoff";
  evaluation: GateEvaluation;
  priority: number;
  /** Presente en reglas deterministas. */
  condition?: { rules: ConditionRule[]; match: ConditionMatchMode };
  /** Etiqueta que el clasificador debe emitir para activar una regla semántica. */
  classification?: string;
  action: GateAction;
  response?: string;
  pauseHours?: number;
  /** Trazabilidad de origen (auditoría). */
  provenance: { kind: "prohibition" | "handoff"; sourceId: string };
}

export interface GateContext {
  /** Texto crudo del mensaje entrante del cliente. */
  message: string;
  /** Estado comercial actual — autoridad del Runtime, NUNCA del LLM (§15). */
  commercialState?: string;
  /** Variables adicionales para condiciones deterministas (opcional). */
  variables?: Record<string, unknown>;
}

export interface GateTrace {
  ruleId: string;
  source: "prohibition" | "handoff";
  matchedBy: GateEvaluation;
  priority: number;
  action: GateAction;
  /** Etiqueta devuelta por el clasificador (solo en match semántico). */
  classification?: string;
}

export type GateDecision =
  | { kind: "pass"; trace?: undefined }
  | {
      kind: "block" | "fixed_response" | "transfer_human";
      ruleId: string;
      matchedBy: GateEvaluation;
      priority: number;
      action: GateAction;
      response?: string;
      pauseHours?: number;
      trace: GateTrace;
    };

/**
 * Clasificador semántico CONTROLADO (inyectable). Solo clasifica entre las
 * etiquetas dadas (+ "continue"); nunca decide la acción ni genera respuesta.
 * En producción lo respalda el executor Claude en modo classify; en tests se
 * inyecta un doble determinista. Un fallo debe resolverse como "sin match"
 * (devolver null): las prohibiciones CRÍTICAS son deterministas y no dependen
 * de él.
 */
export type SemanticClassifier = (input: {
  message: string;
  labels: string[];
  context: GateContext;
}) => Promise<{ label: string } | null>;

/** Etiqueta reservada: "ninguna política aplica, continúa al flujo". */
export const GATE_CONTINUE_LABEL = "continue";

// ---------------------------------------------------------------------------
// Matcher determinista — misma semántica que flow-engine.ts::evaluateRule,
// replicada acá (pura, sin I/O) para no depender de internals no exportados
// de lib/flow y no modificarlo.
// ---------------------------------------------------------------------------

function evaluateRule(rule: ConditionRule, bag: Record<string, unknown>): boolean {
  const actual = bag[rule.field];
  const op = rule.operator;
  if (op === "exists") return actual !== undefined && actual !== null && actual !== "";
  if (op === "not_exists") return actual === undefined || actual === null || actual === "";

  const expected = rule.value;
  if (op === "equals") return String(actual ?? "") === String(expected ?? "");
  if (op === "not_equals") return String(actual ?? "") !== String(expected ?? "");
  if (op === "contains")
    return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
  if (op === "not_contains")
    return !String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());

  const numActual = Number(actual);
  const numExpected = Number(expected);
  if (Number.isNaN(numActual) || Number.isNaN(numExpected)) return false;
  if (op === "greater_than") return numActual > numExpected;
  if (op === "greater_or_equal") return numActual >= numExpected;
  if (op === "less_than") return numActual < numExpected;
  if (op === "less_or_equal") return numActual <= numExpected;
  return false;
}

function evaluateCondition(
  rules: ConditionRule[],
  match: ConditionMatchMode,
  bag: Record<string, unknown>,
): boolean {
  if (rules.length === 0) return false;
  return match === "all" ? rules.every((r) => evaluateRule(r, bag)) : rules.some((r) => evaluateRule(r, bag));
}

/** Variable bag que ven las condiciones: message + state + variables extra. */
function contextBag(context: GateContext): Record<string, unknown> {
  return {
    ...(context.variables ?? {}),
    message: context.message,
    state: context.commercialState ?? "",
  };
}

// ---------------------------------------------------------------------------
// Derivación de reglas del Gate desde la IR (prohibiciones + handoff).
// ---------------------------------------------------------------------------

/** Condición determinista por keywords (message contains any). */
function keywordCondition(keywords: string[]): { rules: ConditionRule[]; match: ConditionMatchMode } {
  return { rules: keywords.map((k) => ({ field: "message", operator: "contains", value: k })), match: "any" };
}

function actionToKind(action: GateAction): "block" | "fixed_response" | "transfer_human" {
  return action === "BLOCK" ? "block" : action === "FIXED_RESPONSE" ? "fixed_response" : "transfer_human";
}

/**
 * Construye el ruleset ejecutable del Gate desde la IR. Orden estable:
 * prioridad desc, luego source (handoff antes que prohibition a igual
 * prioridad, porque una transferencia explícita debe ganar), luego id asc.
 * NO muta la IR: es una proyección pura y determinista.
 */
export function buildGateRules(ir: CompiledBusinessAgentIR): GateRule[] {
  const rules: GateRule[] = [];

  // Prohibiciones (guardrails PRE_LLM). Determinista si trae condición.
  for (const g of ir.guardrails) {
    if (g.condition) {
      rules.push({
        id: g.id,
        source: "prohibition",
        evaluation: "deterministic",
        priority: g.priority,
        condition: g.condition,
        action: g.action,
        response: g.response,
        pauseHours: g.action === "TRANSFER_HUMAN" ? DEFAULT_TRANSFER_PAUSE_HOURS : undefined,
        provenance: { kind: "prohibition", sourceId: g.source.prohibitionId },
      });
    } else {
      rules.push({
        id: g.id,
        source: "prohibition",
        evaluation: "semantic",
        priority: g.priority,
        classification: g.id,
        action: g.action,
        response: g.response,
        pauseHours: g.action === "TRANSFER_HUMAN" ? DEFAULT_TRANSFER_PAUSE_HOURS : undefined,
        provenance: { kind: "prohibition", sourceId: g.source.prohibitionId },
      });
    }
  }

  // Handoff (transferencias). keyword -> determinista; el resto -> semántico.
  for (const h of ir.handoff) {
    const pauseHours = h.pauseHours ?? DEFAULT_TRANSFER_PAUSE_HOURS;
    if (h.trigger.kind === "keyword" && (h.trigger.keywords?.length ?? 0) > 0) {
      rules.push({
        id: h.id,
        source: "handoff",
        evaluation: "deterministic",
        priority: HANDOFF_GATE_PRIORITY,
        condition: keywordCondition(h.trigger.keywords!),
        action: "TRANSFER_HUMAN",
        response: h.response,
        pauseHours,
        provenance: { kind: "handoff", sourceId: h.id },
      });
    } else {
      rules.push({
        id: h.id,
        source: "handoff",
        evaluation: "semantic",
        priority: HANDOFF_GATE_PRIORITY,
        classification: h.id,
        action: "TRANSFER_HUMAN",
        response: h.response,
        pauseHours,
        provenance: { kind: "handoff", sourceId: h.id },
      });
    }
  }

  rules.sort(
    (a, b) =>
      b.priority - a.priority ||
      (a.source === b.source ? 0 : a.source === "handoff" ? -1 : 1) ||
      a.id.localeCompare(b.id),
  );
  return rules;
}

// ---------------------------------------------------------------------------
// Evaluación del Gate.
// ---------------------------------------------------------------------------

function decisionFromRule(rule: GateRule, matchedBy: GateEvaluation, classification?: string): GateDecision {
  return {
    kind: actionToKind(rule.action),
    ruleId: rule.id,
    matchedBy,
    priority: rule.priority,
    action: rule.action,
    response: rule.response,
    pauseHours: rule.pauseHours,
    trace: {
      ruleId: rule.id,
      source: rule.source,
      matchedBy,
      priority: rule.priority,
      action: rule.action,
      classification,
    },
  };
}

/**
 * Evalúa el Gate PRE-LLM. Deterministas primero (código puro, 0 LLM). Si
 * ninguna determinista hace match y hay reglas semánticas + clasificador, se
 * invoca el clasificador UNA vez; la acción la decide la regla, no el LLM. Un
 * error/ausencia de clasificador se resuelve como "pass" (no bloquea): las
 * prohibiciones críticas son deterministas y ya se evaluaron.
 */
export async function evaluateGuardrailGate(input: {
  rules: GateRule[];
  context: GateContext;
  classifier?: SemanticClassifier;
}): Promise<GateDecision> {
  const bag = contextBag(input.context);

  // 1) Deterministas (ya vienen ordenadas por prioridad).
  for (const rule of input.rules) {
    if (rule.evaluation !== "deterministic" || !rule.condition) continue;
    if (evaluateCondition(rule.condition.rules, rule.condition.match, bag)) {
      return decisionFromRule(rule, "deterministic");
    }
  }

  // 2) Semánticas (clasificador controlado, solo si hay reglas + clasificador).
  const semanticRules = input.rules.filter((r) => r.evaluation === "semantic" && r.classification);
  if (semanticRules.length === 0 || !input.classifier) {
    return { kind: "pass" };
  }

  const labels = [...new Set(semanticRules.map((r) => r.classification!)), GATE_CONTINUE_LABEL];
  let result: { label: string } | null = null;
  try {
    result = await input.classifier({ message: input.context.message, labels, context: input.context });
  } catch {
    // Fail-safe conversacional: un fallo del clasificador NO bloquea (las
    // críticas son deterministas). Se continúa al flujo controlado.
    return { kind: "pass" };
  }

  if (!result || result.label === GATE_CONTINUE_LABEL) return { kind: "pass" };
  // La primera regla semántica (ya ordenada por prioridad) cuya etiqueta coincide.
  const matched = semanticRules.find((r) => r.classification === result!.label);
  if (!matched) return { kind: "pass" };
  return decisionFromRule(matched, "semantic", result.label);
}
