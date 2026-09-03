/**
 * Tipos del Flow Engine (Fase 2) — puro, sin I/O.
 */

import type {
  ActionNodeConfig,
  AiNodeConfig,
  FlowButton,
  FlowDefinition,
  FlowMessageContent,
  FlowVariableType,
  MessageOrigin,
  QuestionValidation,
  SaveDataTarget,
} from "@/lib/flow/types";

// ---------------------------------------------------------------------------
// Estado de ejecución
// ---------------------------------------------------------------------------

export type FlowEngineStatus =
  | "running"
  | "waiting_input"
  | "waiting_effect"
  | "completed"
  | "failed"
  | "transferred";

/** Destinos preparados por save_data para que flow-runtime persista. */
export type FlowExportBucket = {
  lead: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  webhook_body: Record<string, unknown>;
};

export interface FlowEngineState {
  flowId?: string;
  flowVersionId?: string;
  /** executionId estable para idempotencia en runtime. */
  executionId: string;
  lastEventId?: string;
  currentNodeId: string | null;
  variables: Record<string, unknown>;
  status: FlowEngineStatus;
  /** Qué tipo de input espera cuando status === waiting_input. */
  expectedInput?: "text" | "button";
  /** Efecto pendiente cuando status === waiting_effect. */
  pendingEffect?: PendingEffect;
  exports: FlowExportBucket;
  metadata: Record<string, unknown>;
}

export interface PendingEffect {
  effectId: string;
  nodeId: string;
  kind: "action" | "ai";
}

// ---------------------------------------------------------------------------
// Eventos de entrada
// ---------------------------------------------------------------------------

export type FlowEngineEvent =
  | {
      type: "start";
      eventId?: string;
      /**
       * Texto crudo del primer mensaje entrante, si lo hay. El Engine lo
       * siembra en variables[FIRST_MESSAGE_TEXT_VARIABLE_KEY] (ver
       * lib/flow/constants.ts) antes del auto-loop -- nunca se usa como
       * respuesta automática a ningún nodo. Opcional: omitirlo mantiene el
       * comportamiento exacto de antes.
       */
      text?: string;
    }
  | { type: "text"; text: string; eventId?: string }
  | { type: "button"; id: string; eventId?: string }
  | {
      type: "effect_result";
      success: boolean;
      effectId?: string;
      eventId?: string;
      data?: Record<string, unknown>;
      error?: string;
    };

// ---------------------------------------------------------------------------
// Efectos / resultados para flow-runtime
// ---------------------------------------------------------------------------

export type EngineEffect =
  | {
      type: "send_message";
      nodeId: string;
      content: FlowMessageContent;
      buttons?: FlowButton[];
      executionId: string;
      effectId: string;
      /**
       * Corrección Claim Security, Fase 1/2 (autorizada) -- CÓMO se produjo
       * este texto, calculado exclusivamente en flow-engine.ts (nunca un
       * input externo). Ver MessageOrigin en lib/flow/types.ts.
       */
      origin: MessageOrigin;
    }
  | {
      type: "wait_input";
      nodeId: string;
      inputKind: "text" | "button";
      executionId: string;
      effectId: string;
    }
  | {
      type: "effect_required";
      nodeId: string;
      effectId: string;
      executionId: string;
      kind: "action" | "ai";
      action?: ActionNodeConfig;
      ai?: AiNodeConfig;
      /** Snapshot de variables relevantes para la acción/IA. */
      context: Record<string, unknown>;
    }
  | {
      type: "completed";
      nodeId: string;
      executionId: string;
      effectId: string;
      tags?: string[];
    }
  | {
      type: "transferred";
      nodeId: string;
      executionId: string;
      effectId: string;
      pauseDurationHours: number;
      assignTo?: string;
    }
  | {
      type: "failed";
      nodeId: string | null;
      executionId: string;
      effectId: string;
      code: FlowEngineErrorCode;
      message: string;
    }
  | {
      type: "invalid_input";
      nodeId: string;
      executionId: string;
      effectId: string;
      message: string;
      /** Reenviar prompt del nodo actual (pregunta/botones). */
      resendPrompt: boolean;
    };

export const FLOW_ENGINE_ERROR_CODES = {
  NODE_NOT_FOUND: "NODE_NOT_FOUND",
  INVALID_STATE: "INVALID_STATE",
  INVALID_INPUT: "INVALID_INPUT",
  TRANSITION_NOT_FOUND: "TRANSITION_NOT_FOUND",
  MAX_STEPS_EXCEEDED: "MAX_STEPS_EXCEEDED",
  UNEXPECTED_EFFECT_RESULT: "UNEXPECTED_EFFECT_RESULT",
  MISSING_START_NODE: "MISSING_START_NODE",
  CONFIG_INVALID: "CONFIG_INVALID",
} as const;

export type FlowEngineErrorCode =
  (typeof FLOW_ENGINE_ERROR_CODES)[keyof typeof FLOW_ENGINE_ERROR_CODES];

export interface FlowEngineError {
  code: FlowEngineErrorCode;
  message: string;
  nodeId?: string | null;
}

export interface FlowEngineRunResult {
  state: FlowEngineState;
  effects: EngineEffect[];
  error?: FlowEngineError;
}

export interface FlowEngineOptions {
  maxAutoSteps?: number;
  eventId?: string;
  /** Generador de IDs para efectos (tests pueden fijarlo). */
  idGenerator?: () => string;
}

export type FlowGraphContext = {
  flow: FlowDefinition;
  nodeById: Map<string, FlowDefinition["nodes"][number]>;
};

export type SaveDataTargetKey = SaveDataTarget;

export type { FlowDefinition, QuestionValidation, FlowVariableType };
