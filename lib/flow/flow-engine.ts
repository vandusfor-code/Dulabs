/**
 * Flow Engine — motor determinístico puro (Fase 2).
 *
 * DECIDE transiciones y emite instrucciones (effects).
 * NO ejecuta WhatsApp, IA, Supabase ni acciones externas.
 */

import { FIRST_MESSAGE_TEXT_VARIABLE_KEY, FLOW_EDGE_HANDLE, HORA_AMBIGUA_VARIABLE_KEY } from "@/lib/flow/constants";
import { parseHoraColombia } from "@/lib/parse-hora-colombia";
import type {
  FlowEngineError,
  FlowEngineEvent,
  FlowEngineOptions,
  FlowEngineRunResult,
  FlowEngineState,
  FlowGraphContext,
  EngineEffect,
  PendingEffect,
} from "@/lib/flow/engine-types";
import {
  FLOW_ENGINE_ERROR_CODES,
  type FlowEngineErrorCode,
} from "@/lib/flow/engine-types";
import type {
  ConditionRule,
  FlowDefinition,
  FlowNode,
  QuestionValidation,
  SaveDataMapping,
} from "@/lib/flow/types";
import { interpolateTemplate } from "@/lib/flow/message-interpolation";

export const DEFAULT_MAX_AUTO_STEPS = 64;

let effectCounter = 0;

function nextEffectId(prefix: string, idGenerator?: () => string): string {
  if (idGenerator) return idGenerator();
  effectCounter += 1;
  return `${prefix}-${effectCounter}`;
}

function emptyExports(): FlowEngineState["exports"] {
  return { lead: {}, custom_fields: {}, webhook_body: {} };
}

export function createFlowEngineState(
  flow: FlowDefinition,
  opts?: {
    flowId?: string;
    flowVersionId?: string;
    executionId?: string;
  },
): FlowEngineState {
  const start = flow.nodes.find((n) => n.type === "start");
  return {
    flowId: opts?.flowId ?? flow.id,
    flowVersionId: opts?.flowVersionId,
    executionId: opts?.executionId ?? `exec-${Date.now()}`,
    currentNodeId: start?.id ?? null,
    variables: buildInitialVariables(flow),
    status: "running",
    exports: emptyExports(),
    metadata: {},
  };
}

function buildInitialVariables(flow: FlowDefinition): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  for (const def of flow.variables) {
    if (def.defaultValue !== undefined) vars[def.key] = def.defaultValue;
  }
  return vars;
}

function buildGraph(flow: FlowDefinition): FlowGraphContext {
  return {
    flow,
    nodeById: new Map(flow.nodes.map((n) => [n.id, n])),
  };
}

function fail(
  state: FlowEngineState,
  code: FlowEngineErrorCode,
  message: string,
  nodeId: string | null,
  executionId: string,
  idGen?: () => string,
): FlowEngineRunResult {
  return {
    state: { ...state, status: "failed", currentNodeId: nodeId },
    effects: [
      {
        type: "failed",
        nodeId,
        executionId,
        effectId: nextEffectId("fail", idGen),
        code,
        message,
      },
    ],
    error: { code, message, nodeId },
  };
}

// ---------------------------------------------------------------------------
// Transiciones centralizadas
// ---------------------------------------------------------------------------

export function resolveNextNodeId(
  flow: FlowDefinition,
  sourceNodeId: string,
  sourceHandle?: string,
): string | null {
  const edges = flow.edges.filter((e) => e.source === sourceNodeId);
  if (edges.length === 0) return null;

  if (sourceHandle !== undefined) {
    const exact = edges.find((e) => e.sourceHandle === sourceHandle);
    return exact ? exact.target : null;
  }

  const def = edges.find(
    (e) => !e.sourceHandle || e.sourceHandle === FLOW_EDGE_HANDLE.default,
  );
  if (def) return def.target;

  if (edges.length === 1) return edges[0]!.target;

  return null;
}

// ---------------------------------------------------------------------------
// Validación de respuestas
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-()]{7,20}$/;

export function validateQuestionValue(
  validation: QuestionValidation,
  raw: string,
  required: boolean,
  context?: { horaPendiente?: number },
): { ok: true; value: unknown } | { ok: false; message: string; horaAmbigua?: number } {
  const text = raw.trim();
  if (!text) {
    if (required) return { ok: false, message: "Este campo es obligatorio." };
    return { ok: true, value: "" };
  }

  switch (validation.kind) {
    case "text":
      return { ok: true, value: text };
    case "number": {
      const n = Number(text.replace(",", "."));
      if (Number.isNaN(n)) return { ok: false, message: "Ingresa un número válido." };
      return { ok: true, value: n };
    }
    case "email":
      if (!EMAIL_RE.test(text)) return { ok: false, message: "Ingresa un correo válido." };
      return { ok: true, value: text };
    case "phone":
      if (!PHONE_RE.test(text)) return { ok: false, message: "Ingresa un teléfono válido." };
      return { ok: true, value: text };
    case "regex": {
      try {
        const re = new RegExp(validation.pattern, validation.flags);
        if (!re.test(text)) return { ok: false, message: "La respuesta no cumple el formato esperado." };
        return { ok: true, value: text };
      } catch {
        return { ok: false, message: "Configuración de validación inválida." };
      }
    }
    case "hora_colombia": {
      const parsed = parseHoraColombia(text, context?.horaPendiente);
      if (parsed.ok) return { ok: true, value: parsed.hhmm };
      return { ok: false, message: parsed.message, horaAmbigua: parsed.kind === "ambiguous" ? parsed.horaAmbigua : undefined };
    }
    default:
      return { ok: true, value: text };
  }
}

function evaluateRule(rule: ConditionRule, variables: Record<string, unknown>): boolean {
  const actual = variables[rule.field];
  const op = rule.operator;

  if (op === "exists") return actual !== undefined && actual !== null && actual !== "";
  if (op === "not_exists") return actual === undefined || actual === null || actual === "";

  const expected = rule.value;

  if (op === "equals") return String(actual ?? "") === String(expected ?? "");
  if (op === "not_equals") return String(actual ?? "") !== String(expected ?? "");
  if (op === "contains")
    return String(actual ?? "")
      .toLowerCase()
      .includes(String(expected ?? "").toLowerCase());
  if (op === "not_contains")
    return !String(actual ?? "")
      .toLowerCase()
      .includes(String(expected ?? "").toLowerCase());

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
  match: "all" | "any",
  variables: Record<string, unknown>,
): boolean {
  if (rules.length === 0) return false;
  return match === "all"
    ? rules.every((r) => evaluateRule(r, variables))
    : rules.some((r) => evaluateRule(r, variables));
}

function applySaveDataMappings(
  mappings: SaveDataMapping[],
  variables: Record<string, unknown>,
  exports: FlowEngineState["exports"],
): FlowEngineState["exports"] {
  const next = {
    lead: { ...exports.lead },
    custom_fields: { ...exports.custom_fields },
    webhook_body: { ...exports.webhook_body },
  };

  for (const m of mappings) {
    const value = variables[m.variable];
    if (value === undefined) continue;
    switch (m.target) {
      case "lead":
        next.lead[m.variable] = value;
        break;
      case "custom_field":
        next.custom_fields[m.targetKey ?? m.variable] = value;
        break;
      case "webhook_body":
        next.webhook_body[m.variable] = value;
        break;
    }
  }
  return next;
}

function cloneState(state: FlowEngineState): FlowEngineState {
  return {
    ...state,
    variables: { ...state.variables },
    exports: {
      lead: { ...state.exports.lead },
      custom_fields: { ...state.exports.custom_fields },
      webhook_body: { ...state.exports.webhook_body },
    },
    metadata: { ...state.metadata },
    pendingEffect: state.pendingEffect ? { ...state.pendingEffect } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Procesamiento de nodos
// ---------------------------------------------------------------------------

type StepOutcome =
  | { kind: "continue"; nextNodeId: string; state: FlowEngineState; effects?: EngineEffect[] }
  | { kind: "halt"; state: FlowEngineState; effects: EngineEffect[] }
  | { kind: "fail"; code: FlowEngineErrorCode; message: string };

function processAutomaticNode(
  ctx: FlowGraphContext,
  state: FlowEngineState,
  node: FlowNode,
  idGen?: () => string,
): StepOutcome {
  const executionId = state.executionId;
  const effects: EngineEffect[] = [];

  switch (node.type) {
    case "start": {
      const next = resolveNextNodeId(ctx.flow, node.id);
      if (!next) {
        return {
          kind: "fail",
          code: FLOW_ENGINE_ERROR_CODES.TRANSITION_NOT_FOUND,
          message: "Nodo start sin transición saliente",
        };
      }
      return { kind: "continue", nextNodeId: next, state: { ...state, currentNodeId: next } };
    }

    case "message": {
      const next = resolveNextNodeId(ctx.flow, node.id);
      if (!next) {
        return {
          kind: "fail",
          code: FLOW_ENGINE_ERROR_CODES.TRANSITION_NOT_FOUND,
          message: "Nodo message sin transición saliente",
        };
      }
      return {
        kind: "continue",
        nextNodeId: next,
        state: { ...state, currentNodeId: next },
        effects: [
          {
            type: "send_message",
            nodeId: node.id,
            content: {
              ...node.config,
              text:
                typeof node.config.text === "string"
                  ? interpolateTemplate(node.config.text, state.variables)
                  : node.config.text,
            },
            executionId,
            effectId: nextEffectId("msg", idGen),
          },
        ],
      };
    }

    case "condition": {
      const result = evaluateCondition(node.config.rules, node.config.match, state.variables);
      const handle = result ? FLOW_EDGE_HANDLE.conditionTrue : FLOW_EDGE_HANDLE.conditionFalse;
      const next = resolveNextNodeId(ctx.flow, node.id, handle);
      if (!next) {
        return {
          kind: "fail",
          code: FLOW_ENGINE_ERROR_CODES.TRANSITION_NOT_FOUND,
          message: `Nodo condition sin rama ${handle}`,
        };
      }
      return { kind: "continue", nextNodeId: next, state: { ...state, currentNodeId: next } };
    }

    case "save_data": {
      const exports = applySaveDataMappings(node.config.mappings, state.variables, state.exports);
      const next = resolveNextNodeId(ctx.flow, node.id);
      if (!next) {
        return {
          kind: "fail",
          code: FLOW_ENGINE_ERROR_CODES.TRANSITION_NOT_FOUND,
          message: "Nodo save_data sin transición saliente",
        };
      }
      return {
        kind: "continue",
        nextNodeId: next,
        state: { ...state, exports, currentNodeId: next },
      };
    }

    case "action": {
      const effectId = nextEffectId("action", idGen);
      const pending: PendingEffect = { effectId, nodeId: node.id, kind: "action" };
      effects.push({
        type: "effect_required",
        nodeId: node.id,
        effectId,
        executionId,
        kind: "action",
        action: node.config,
        context: { ...state.variables },
      });
      return {
        kind: "halt",
        state: {
          ...state,
          status: "waiting_effect",
          pendingEffect: pending,
        },
        effects,
      };
    }

    case "ai": {
      const effectId = nextEffectId("ai", idGen);
      const pending: PendingEffect = { effectId, nodeId: node.id, kind: "ai" };
      effects.push({
        type: "effect_required",
        nodeId: node.id,
        effectId,
        executionId,
        kind: "ai",
        ai: node.config,
        context: { ...state.variables },
      });
      return {
        kind: "halt",
        state: {
          ...state,
          status: "waiting_effect",
          pendingEffect: pending,
        },
        effects,
      };
    }

    case "human": {
      if (node.config.message?.trim()) {
        effects.push({
          type: "send_message",
          nodeId: node.id,
          content: { text: node.config.message },
          executionId,
          effectId: nextEffectId("msg", idGen),
        });
      }
      effects.push({
        type: "transferred",
        nodeId: node.id,
        executionId,
        effectId: nextEffectId("xfer", idGen),
        pauseDurationHours: node.config.pauseDurationHours,
        assignTo: node.config.assignTo,
      });
      return {
        kind: "halt",
        state: {
          ...state,
          status: "transferred",
          currentNodeId: node.id,
        },
        effects,
      };
    }

    case "end": {
      if (node.config.message?.trim()) {
        effects.push({
          type: "send_message",
          nodeId: node.id,
          content: { text: node.config.message },
          executionId,
          effectId: nextEffectId("msg", idGen),
        });
      }
      effects.push({
        type: "completed",
        nodeId: node.id,
        executionId,
        effectId: nextEffectId("done", idGen),
        tags: node.config.tags,
      });
      return {
        kind: "halt",
        state: {
          ...state,
          status: "completed",
          currentNodeId: node.id,
        },
        effects,
      };
    }

    default:
      return {
        kind: "fail",
        code: FLOW_ENGINE_ERROR_CODES.CONFIG_INVALID,
        message: `Nodo ${node.type} requiere input del usuario`,
      };
  }
}

function enterInputNode(
  ctx: FlowGraphContext,
  state: FlowEngineState,
  node: FlowNode,
  idGen?: () => string,
): StepOutcome {
  const executionId = state.executionId;
  const effects: EngineEffect[] = [];

  if (node.type === "question") {
    effects.push({
      type: "send_message",
      nodeId: node.id,
      content: { text: interpolateTemplate(node.config.text, state.variables) },
      executionId,
      effectId: nextEffectId("msg", idGen),
    });
    effects.push({
      type: "wait_input",
      nodeId: node.id,
      inputKind: "text",
      executionId,
      effectId: nextEffectId("wait", idGen),
    });
    return {
      kind: "halt",
      state: {
        ...state,
        status: "waiting_input",
        expectedInput: "text",
        currentNodeId: node.id,
      },
      effects,
    };
  }

  if (node.type === "buttons") {
    effects.push({
      type: "send_message",
      nodeId: node.id,
      content: { text: interpolateTemplate(node.config.text, state.variables) },
      buttons: node.config.buttons,
      executionId,
      effectId: nextEffectId("msg", idGen),
    });
    effects.push({
      type: "wait_input",
      nodeId: node.id,
      inputKind: "button",
      executionId,
      effectId: nextEffectId("wait", idGen),
    });
    return {
      kind: "halt",
      state: {
        ...state,
        status: "waiting_input",
        expectedInput: "button",
        currentNodeId: node.id,
      },
      effects,
    };
  }

  return processAutomaticNode(ctx, state, node, idGen);
}

function normalizeButtonToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function matchButtonFromFreeText(
  buttons: { id: string; label: string }[],
  text: string,
): { id: string; label: string } | undefined {
  const raw = text.trim();
  if (!raw) return undefined;
  const byId = buttons.find((b) => b.id === raw);
  if (byId) return byId;
  const normalized = normalizeButtonToken(raw);
  if (!normalized) return undefined;
  return buttons.find((b) => normalizeButtonToken(b.label) === normalized);
}

function handleTextOnButtons(
  ctx: FlowGraphContext,
  state: FlowEngineState,
  node: Extract<FlowNode, { type: "buttons" }>,
  text: string,
  idGen?: () => string,
): StepOutcome {
  const matched = matchButtonFromFreeText(node.config.buttons, text);
  if (matched) {
    return handleButtonInput(ctx, state, node, matched.id, idGen);
  }

  const textNext = resolveNextNodeId(ctx.flow, node.id, FLOW_EDGE_HANDLE.text);
  if (textNext) {
    const variables = node.config.variableKey
      ? { ...state.variables, [node.config.variableKey]: text }
      : { ...state.variables };
    return {
      kind: "continue",
      nextNodeId: textNext,
      state: {
        ...state,
        variables,
        status: "running",
        expectedInput: undefined,
        currentNodeId: textNext,
      },
    };
  }

  return {
    kind: "halt",
    state,
    effects: [
      {
        type: "invalid_input",
        nodeId: node.id,
        executionId: state.executionId,
        effectId: nextEffectId("invalid", idGen),
        message: "Opción no válida.",
        resendPrompt: true,
      },
    ],
  };
}

function handleTextInput(
  ctx: FlowGraphContext,
  state: FlowEngineState,
  node: FlowNode,
  text: string,
  idGen?: () => string,
): StepOutcome {
  if (node.type === "buttons") {
    return handleTextOnButtons(ctx, state, node, text, idGen);
  }
  if (node.type !== "question") {
    return {
      kind: "fail",
      code: FLOW_ENGINE_ERROR_CODES.INVALID_INPUT,
      message: "Se esperaba un botón, no texto",
    };
  }

  // Bug real (Daniela) — memoria de UN turno para hora_colombia: si esta
  // MISMA pregunta ya dejó una hora ambigua pendiente (ver
  // HORA_AMBIGUA_VARIABLE_KEY), se pasa para que parseHoraColombia pueda
  // combinarla con una respuesta que sea solo "tarde"/"mañana"/etc.
  const horaPendiente =
    node.config.validation.kind === "hora_colombia" && typeof state.variables[HORA_AMBIGUA_VARIABLE_KEY] === "number"
      ? (state.variables[HORA_AMBIGUA_VARIABLE_KEY] as number)
      : undefined;

  const validated = validateQuestionValue(node.config.validation, text, node.config.required, { horaPendiente });
  if (!validated.ok) {
    // Si esta respuesta también quedó ambigua, se recuerda (o se actualiza)
    // la hora pendiente para el próximo intento; cualquier otro tipo de
    // respuesta inválida no la toca -- sigue pendiente hasta que se
    // resuelva o se dé una hora nueva.
    const haltVariables =
      validated.horaAmbigua !== undefined
        ? { ...state.variables, [HORA_AMBIGUA_VARIABLE_KEY]: validated.horaAmbigua }
        : state.variables;
    return {
      kind: "halt",
      state: { ...state, variables: haltVariables },
      effects: [
        {
          type: "invalid_input",
          nodeId: node.id,
          executionId: state.executionId,
          effectId: nextEffectId("invalid", idGen),
          message: validated.message,
          resendPrompt: true,
        },
        {
          type: "send_message",
          nodeId: node.id,
          content: { text: validated.message },
          executionId: state.executionId,
          effectId: nextEffectId("msg", idGen),
        },
        {
          type: "wait_input",
          nodeId: node.id,
          inputKind: "text",
          executionId: state.executionId,
          effectId: nextEffectId("wait", idGen),
        },
      ],
    };
  }

  // Resuelta (o nunca hubo ambigüedad): nunca debe quedar colgada para la
  // siguiente pregunta que use hora_colombia en el mismo flow.
  const { [HORA_AMBIGUA_VARIABLE_KEY]: _horaAmbiguaResuelta, ...variablesSinHoraAmbigua } = state.variables;
  const variables = { ...variablesSinHoraAmbigua, [node.config.variableKey]: validated.value };
  const next = resolveNextNodeId(ctx.flow, node.id);
  if (!next) {
    return {
      kind: "fail",
      code: FLOW_ENGINE_ERROR_CODES.TRANSITION_NOT_FOUND,
      message: "Nodo question sin transición saliente",
    };
  }

  return {
    kind: "continue",
    nextNodeId: next,
    state: {
      ...state,
      variables,
      status: "running",
      expectedInput: undefined,
      currentNodeId: next,
    },
  };
}

function handleButtonInput(
  ctx: FlowGraphContext,
  state: FlowEngineState,
  node: FlowNode,
  buttonId: string,
  idGen?: () => string,
): StepOutcome {
  if (node.type !== "buttons") {
    return {
      kind: "fail",
      code: FLOW_ENGINE_ERROR_CODES.INVALID_INPUT,
      message: "Se esperaba texto, no botón",
    };
  }

  const button = node.config.buttons.find((b) => b.id === buttonId);
  if (!button) {
    return {
      kind: "halt",
      state,
      effects: [
        {
          type: "invalid_input",
          nodeId: node.id,
          executionId: state.executionId,
          effectId: nextEffectId("invalid", idGen),
          message: "Opción no válida.",
          resendPrompt: true,
        },
      ],
    };
  }

  let variables = state.variables;
  if (node.config.variableKey) {
    variables = { ...variables, [node.config.variableKey]: button.id };
  }

  const handle = FLOW_EDGE_HANDLE.button(button.id);
  const next = resolveNextNodeId(ctx.flow, node.id, handle);
  if (!next) {
    return {
      kind: "fail",
      code: FLOW_ENGINE_ERROR_CODES.TRANSITION_NOT_FOUND,
      message: `Sin transición para botón ${buttonId}`,
    };
  }

  return {
    kind: "continue",
    nextNodeId: next,
    state: {
      ...state,
      variables,
      status: "running",
      expectedInput: undefined,
      currentNodeId: next,
    },
  };
}

function handleEffectResult(
  ctx: FlowGraphContext,
  state: FlowEngineState,
  event: Extract<FlowEngineEvent, { type: "effect_result" }>,
  idGen?: () => string,
): StepOutcome {
  const pending = state.pendingEffect;
  if (!pending || state.status !== "waiting_effect") {
    return {
      kind: "fail",
      code: FLOW_ENGINE_ERROR_CODES.UNEXPECTED_EFFECT_RESULT,
      message: "No hay efecto pendiente",
    };
  }

  if (event.effectId && event.effectId !== pending.effectId) {
    return {
      kind: "fail",
      code: FLOW_ENGINE_ERROR_CODES.UNEXPECTED_EFFECT_RESULT,
      message: "effectId no coincide con el efecto pendiente",
    };
  }

  const node = ctx.nodeById.get(pending.nodeId);
  if (!node) {
    return {
      kind: "fail",
      code: FLOW_ENGINE_ERROR_CODES.NODE_NOT_FOUND,
      message: "Nodo del efecto pendiente no encontrado",
    };
  }

  if (!event.success) {
    const failureNext = resolveNextNodeId(ctx.flow, node.id, FLOW_EDGE_HANDLE.aiFailure);
    if (failureNext) {
      return {
        kind: "continue",
        nextNodeId: failureNext,
        state: {
          ...state,
          status: "running",
          pendingEffect: undefined,
          currentNodeId: failureNext,
        },
      };
    }
    return {
      kind: "fail",
      code: FLOW_ENGINE_ERROR_CODES.INVALID_INPUT,
      message: event.error ?? "El efecto externo falló",
    };
  }

  const variables = { ...state.variables };
  const effects: EngineEffect[] = [];
  let sourceHandle: string | undefined = FLOW_EDGE_HANDLE.aiSuccess;

  if (node.type === "ai") {
    const cfg = node.config;
    const data = event.data ?? {};

    if (cfg.outputVariables?.length) {
      for (const key of cfg.outputVariables) {
        if (data[key] !== undefined) variables[key] = data[key];
      }
    }

    if (cfg.mode === "classify") {
      const classification = String(data.classification ?? "");
      sourceHandle = classification
        ? FLOW_EDGE_HANDLE.aiClass(classification)
        : FLOW_EDGE_HANDLE.aiDefault;
      const classNext = resolveNextNodeId(ctx.flow, node.id, sourceHandle);
      const defaultNext = resolveNextNodeId(ctx.flow, node.id, FLOW_EDGE_HANDLE.aiDefault);
      const next = classNext ?? defaultNext;
      if (!next) {
        return {
          kind: "fail",
          code: FLOW_ENGINE_ERROR_CODES.TRANSITION_NOT_FOUND,
          message: `Sin transición IA para clasificación ${classification}`,
        };
      }
      const aiEffects: EngineEffect[] = [];
      if (typeof data.responseText === "string" && data.responseText.trim()) {
        aiEffects.push({
          type: "send_message",
          nodeId: node.id,
          content: { text: String(data.responseText) },
          executionId: state.executionId,
          effectId: nextEffectId("msg", idGen),
        });
      }
      return {
        kind: "continue",
        nextNodeId: next,
        state: {
          ...state,
          variables,
          status: "running",
          pendingEffect: undefined,
          currentNodeId: next,
        },
        effects: aiEffects.length ? aiEffects : undefined,
      };
    }

    if (cfg.mode === "respond") {
      if (typeof data.responseText === "string" && data.responseText.trim()) {
        effects.push({
          type: "send_message",
          nodeId: node.id,
          content: { text: String(data.responseText) },
          executionId: state.executionId,
          effectId: nextEffectId("msg", idGen),
        });
      }
    }
  } else if (node.type === "action" && event.data) {
    for (const [key, value] of Object.entries(event.data)) {
      variables[key] = value;
    }
  }

  const next =
    resolveNextNodeId(ctx.flow, node.id, sourceHandle) ?? resolveNextNodeId(ctx.flow, node.id);

  if (!next) {
    return {
      kind: "fail",
      code: FLOW_ENGINE_ERROR_CODES.TRANSITION_NOT_FOUND,
      message: "Sin transición tras effect_result exitoso",
    };
  }

  return {
    kind: "continue",
    nextNodeId: next,
    state: {
      ...state,
      variables,
      status: "running",
      pendingEffect: undefined,
      currentNodeId: next,
    },
    effects: effects.length ? effects : undefined,
  };
}

function isInputWaitNode(node: FlowNode): boolean {
  return node.type === "question" || node.type === "buttons";
}

function runAutoLoop(
  ctx: FlowGraphContext,
  initialState: FlowEngineState,
  initialEffects: EngineEffect[],
  maxSteps: number,
  idGen?: () => string,
): FlowEngineRunResult {
  let state = initialState;
  const effects = [...initialEffects];
  let steps = 0;

  while (steps < maxSteps) {
    if (
      state.status === "waiting_input" ||
      state.status === "waiting_effect" ||
      state.status === "completed" ||
      state.status === "transferred" ||
      state.status === "failed"
    ) {
      return { state, effects };
    }

    const nodeId = state.currentNodeId;
    if (!nodeId) {
      return fail(
        state,
        FLOW_ENGINE_ERROR_CODES.NODE_NOT_FOUND,
        "Sin nodo actual",
        null,
        state.executionId,
        idGen,
      );
    }

    const node = ctx.nodeById.get(nodeId);
    if (!node) {
      return fail(
        state,
        FLOW_ENGINE_ERROR_CODES.NODE_NOT_FOUND,
        `Nodo no encontrado: ${nodeId}`,
        nodeId,
        state.executionId,
        idGen,
      );
    }

    steps += 1;

    const outcome = isInputWaitNode(node)
      ? enterInputNode(ctx, state, node, idGen)
      : processAutomaticNode(ctx, state, node, idGen);

    if (outcome.kind === "fail") {
      return fail(state, outcome.code, outcome.message, nodeId, state.executionId, idGen);
    }

    if (outcome.kind === "halt") {
      effects.push(...outcome.effects);
      return { state: outcome.state, effects };
    }

    if (outcome.effects?.length) effects.push(...outcome.effects);
    state = { ...outcome.state, currentNodeId: outcome.nextNodeId, status: "running" };
  }

  return fail(
    state,
    FLOW_ENGINE_ERROR_CODES.MAX_STEPS_EXCEEDED,
    `Límite de pasos automáticos (${maxSteps}) excedido`,
    state.currentNodeId,
    state.executionId,
    idGen,
  );
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export function runFlowEngine(
  flow: FlowDefinition,
  state: FlowEngineState,
  event: FlowEngineEvent,
  options?: FlowEngineOptions,
): FlowEngineRunResult {
  const idGen = options?.idGenerator;
  const maxSteps = options?.maxAutoSteps ?? DEFAULT_MAX_AUTO_STEPS;
  const ctx = buildGraph(flow);
  let working = cloneState(state);

  if (event.eventId) working.lastEventId = event.eventId;
  if (options?.eventId) working.lastEventId = options.eventId;

  if (event.type === "start") {
    const start = flow.nodes.find((n) => n.type === "start");
    if (!start) {
      return fail(
        working,
        FLOW_ENGINE_ERROR_CODES.MISSING_START_NODE,
        "Flow sin nodo start",
        null,
        working.executionId,
        idGen,
      );
    }
    working = {
      ...working,
      status: "running",
      currentNodeId: start.id,
      expectedInput: undefined,
      pendingEffect: undefined,
      // Solo siembra el dato -- nunca decide por sí solo qué nodo lo
      // consume. Un flow que no lee esta variable no cambia de
      // comportamiento (ver FIRST_MESSAGE_TEXT_VARIABLE_KEY).
      variables:
        typeof event.text === "string" && event.text.trim()
          ? { ...working.variables, [FIRST_MESSAGE_TEXT_VARIABLE_KEY]: event.text }
          : working.variables,
    };
    return runAutoLoop(ctx, working, [], maxSteps, idGen);
  }

  if (event.type === "text") {
    // Un nodo buttons espera botón, PERO el texto libre sigue siendo válido
    // (lenguaje natural equivalente: "Sí", "quiero una cita", etc.).
    const esperabaTextoOBoton =
      working.status === "waiting_input" &&
      (working.expectedInput === "text" || working.expectedInput === "button");
    if (!esperabaTextoOBoton) {
      return fail(
        working,
        FLOW_ENGINE_ERROR_CODES.INVALID_STATE,
        "No se esperaba input de texto",
        working.currentNodeId,
        working.executionId,
        idGen,
      );
    }
    const node = working.currentNodeId ? ctx.nodeById.get(working.currentNodeId) : undefined;
    if (!node) {
      return fail(
        working,
        FLOW_ENGINE_ERROR_CODES.NODE_NOT_FOUND,
        "Nodo actual no encontrado",
        working.currentNodeId,
        working.executionId,
        idGen,
      );
    }
    const outcome = handleTextInput(ctx, working, node, event.text, idGen);
    if (outcome.kind === "fail") {
      return fail(
        working,
        outcome.code,
        outcome.message,
        node.id,
        working.executionId,
        idGen,
      );
    }
    if (outcome.kind === "halt") {
      return { state: outcome.state, effects: outcome.effects ?? [] };
    }
    return runAutoLoop(ctx, outcome.state, [], maxSteps, idGen);
  }

  if (event.type === "button") {
    if (working.status !== "waiting_input" || working.expectedInput !== "button") {
      return fail(
        working,
        FLOW_ENGINE_ERROR_CODES.INVALID_STATE,
        "No se esperaba input de botón",
        working.currentNodeId,
        working.executionId,
        idGen,
      );
    }
    const node = working.currentNodeId ? ctx.nodeById.get(working.currentNodeId) : undefined;
    if (!node) {
      return fail(
        working,
        FLOW_ENGINE_ERROR_CODES.NODE_NOT_FOUND,
        "Nodo actual no encontrado",
        working.currentNodeId,
        working.executionId,
        idGen,
      );
    }
    const outcome = handleButtonInput(ctx, working, node, event.id, idGen);
    if (outcome.kind === "fail") {
      return fail(working, outcome.code, outcome.message, node.id, working.executionId, idGen);
    }
    if (outcome.kind === "halt") {
      return { state: outcome.state, effects: outcome.effects ?? [] };
    }
    return runAutoLoop(ctx, outcome.state, [], maxSteps, idGen);
  }

  if (event.type === "effect_result") {
    const outcome = handleEffectResult(ctx, working, event, idGen);
    if (outcome.kind === "fail") {
      return fail(
        working,
        outcome.code,
        outcome.message,
        working.currentNodeId,
        working.executionId,
        idGen,
      );
    }
    if (outcome.kind === "halt") {
      return { state: outcome.state, effects: outcome.effects ?? [] };
    }
    return runAutoLoop(ctx, outcome.state, outcome.effects ?? [], maxSteps, idGen);
  }

  return fail(
    working,
    FLOW_ENGINE_ERROR_CODES.INVALID_INPUT,
    "Evento no soportado",
    working.currentNodeId,
    working.executionId,
    idGen,
  );
}

export type { FlowEngineState, FlowEngineEvent, FlowEngineRunResult, EngineEffect, FlowEngineError };
