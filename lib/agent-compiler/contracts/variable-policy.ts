// DuLabs Business — Business Agent 2.0, FASE 1 — variables protegidas.
//
// Clasificación de las variables de una ejecución de Business Agent. Se deriva del FlowDefinition COMPILADO
// (no de una lista a mano): cada nodo declara qué captura (question/buttons/save_data), qué configura el
// negocio (params estáticos de las acciones) y qué produce el runtime (salidas de las acciones con contrato).
//
//   USER_CONTROLLED      lo que escribió el cliente final y el SISTEMA capturó (question, buttons, save_data).
//                        Lo controla la persona, no la IA: la IA puede leerlo, nunca reescribirlo.
//   BUSINESS_CONFIGURED  lo que configuró el negocio y el compilador embebió en el nodo (horario, datos
//                        requeridos, fuentes...). mergeParams ya lo hace ganar; además la IA no puede proponerlo.
//   RUNTIME_DERIVED      lo que produce una acción (disponibilidad, catálogo, cotización, reserva...) o el canal
//                        (teléfono, primer mensaje).
//   SYSTEM_INTERNAL      identidad y control del runtime (tenant, ids, `__*`). Protegido para TODO flow
//                        en lib/flow/ai-runtime/protected-variables.ts.
//
// Lo único que la IA puede escribir son los campos de `llmArguments` del contrato de la acción que propone, y
// solo si no chocan con ninguna de las categorías anteriores.

import type { FlowDefinition } from "@/lib/flow/types";
import { FIRST_MESSAGE_TEXT_VARIABLE_KEY } from "@/lib/flow/constants";
import { isSystemInternalVariableKey } from "@/lib/flow/ai-runtime/protected-variables";
import { getActionContract } from "@/lib/agent-compiler/contracts/action-contracts";

export type VariableCategory = "USER_CONTROLLED" | "BUSINESS_CONFIGURED" | "RUNTIME_DERIVED" | "SYSTEM_INTERNAL";

/** Variables que el runtime siembra desde el canal (nunca la IA). */
const CHANNEL_DERIVED_KEYS = ["telefonoCliente", FIRST_MESSAGE_TEXT_VARIABLE_KEY] as const;

export interface FlowVariablePolicy {
  /** Categoría de cada variable conocida del flow. */
  categories: ReadonlyMap<string, VariableCategory>;
  /**
   * Acciones que producen cada variable RUNTIME_DERIVED. Una acción puede recibir como sugerencia de la IA una
   * clave que ella MISMA produce (p. ej. `fecha` en la consulta de disponibilidad), pero no una que produce OTRA
   * acción del flow (la `fecha` ya resuelta no se reescribe al reservar).
   */
  producers: ReadonlyMap<string, ReadonlySet<string>>;
}

function add(map: Map<string, VariableCategory>, key: string, category: VariableCategory): void {
  // Precedencia: lo capturado del cliente y lo configurado por el negocio nunca se degradan a "derivado".
  const actual = map.get(key);
  if (actual === "USER_CONTROLLED" || actual === "BUSINESS_CONFIGURED") return;
  map.set(key, category);
}

export function buildFlowVariablePolicy(flow: FlowDefinition): FlowVariablePolicy {
  const categories = new Map<string, VariableCategory>();
  const producers = new Map<string, Set<string>>();

  for (const node of flow.nodes) {
    if (node.type === "question") {
      categories.set(node.config.variableKey, "USER_CONTROLLED");
    } else if (node.type === "buttons" && node.config.variableKey) {
      categories.set(node.config.variableKey, "USER_CONTROLLED");
    } else if (node.type === "save_data") {
      for (const m of node.config.mappings) categories.set(m.variable, "USER_CONTROLLED");
    }
  }
  for (const node of flow.nodes) {
    if (node.type !== "action") continue;
    const config = node.config as { actionType: string; params?: Record<string, string>; pauseDurationHours?: number };
    for (const key of Object.keys(config.params ?? {})) add(categories, key, "BUSINESS_CONFIGURED");
    const contract = getActionContract(config.actionType);
    if (!contract) continue;
    for (const key of contract.businessConfiguredParams) add(categories, key, "BUSINESS_CONFIGURED");
    for (const key of contract.outputs) {
      add(categories, key, "RUNTIME_DERIVED");
      const set = producers.get(key) ?? new Set<string>();
      set.add(config.actionType);
      producers.set(key, set);
    }
  }
  for (const key of CHANNEL_DERIVED_KEYS) add(categories, key, "RUNTIME_DERIVED");

  return { categories, producers };
}

export function classifyVariable(policy: FlowVariablePolicy, key: string): VariableCategory | "AI_PROPOSABLE" {
  if (isSystemInternalVariableKey(key)) return "SYSTEM_INTERNAL";
  return policy.categories.get(key) ?? "AI_PROPOSABLE";
}

/**
 * ¿Puede la IA escribir `key` al proponer `forAction`? Nunca SYSTEM_INTERNAL, USER_CONTROLLED ni
 * BUSINESS_CONFIGURED; RUNTIME_DERIVED solo si la produce únicamente la propia acción propuesta.
 */
export function protectionFor(policy: FlowVariablePolicy, key: string, forAction: string): VariableCategory | null {
  const category = classifyVariable(policy, key);
  if (category === "AI_PROPOSABLE") return null;
  if (category === "RUNTIME_DERIVED") {
    const prod = policy.producers.get(key);
    if (prod && prod.size === 1 && prod.has(forAction)) return null;
  }
  return category;
}
