/**
 * Etapa 3 (Flow Builder, autorizado) — crea un FlowNode nuevo con config
 * mínima VÁLIDA por tipo (derivada de flowNodeSchema, lib/flow/schemas.ts --
 * ver auditoría de Etapa 3) y un id sin colisiones. Puro: no hace fetch, no
 * toca el DOM, no decide dónde insertarlo en el FlowDefinition -- eso es
 * addNode en lib/flow-builder/edit-flow.ts.
 */

import type { FlowDefinition, FlowNode, FlowNodeType, NodePosition } from "@/lib/flow/types";

export const NODE_TYPE_LABEL: Record<FlowNodeType, string> = {
  start: "Inicio",
  message: "Mensaje",
  question: "Pregunta",
  buttons: "Botones",
  condition: "Condición",
  ai: "IA",
  save_data: "Guardar datos",
  action: "Acción",
  human: "Humano",
  end: "Final",
};

/**
 * Genera un id sin colisiones contra `existingIds`. `factory` es inyectable
 * para poder probar el camino de reintento sin depender del azar de un UUID
 * real (ver node-factory.test.ts) -- en producción siempre es crypto.randomUUID().
 */
export function generateUniqueId(existingIds: ReadonlySet<string>, factory: () => string = () => crypto.randomUUID()): string {
  let id = factory();
  while (existingIds.has(id)) id = factory();
  return id;
}

export function generateNodeId(existingIds: ReadonlySet<string> = new Set()): string {
  return generateUniqueId(existingIds);
}

export function generateEdgeId(existingIds: ReadonlySet<string> = new Set()): string {
  return generateUniqueId(existingIds);
}

/**
 * Config mínima válida por tipo -- cada rama debe pasar flowNodeSchema tal
 * cual (ver node-factory.test.ts, que lo comprueba para los 10 tipos). No
 * inventa reglas: es exactamente el mínimo que exige el schema real.
 */
export function createDefaultNode(type: FlowNodeType, position: NodePosition, flow: FlowDefinition): FlowNode {
  const existingIds = new Set(flow.nodes.map((n) => n.id));
  const id = generateNodeId(existingIds);
  const base = { id, position, label: NODE_TYPE_LABEL[type] };

  switch (type) {
    case "start":
      return { ...base, type, config: { triggerType: "manual" } };
    case "message":
      return { ...base, type, config: { text: "Nuevo mensaje" } };
    case "question":
      return {
        ...base,
        type,
        config: { text: "Nueva pregunta", variableKey: "nueva_variable", required: true, validation: { kind: "text" } },
      };
    case "buttons":
      return {
        ...base,
        type,
        config: { text: "Elige una opción", buttons: [{ id: "btn_1", label: "Opción 1" }] },
      };
    case "condition":
      return {
        ...base,
        type,
        config: { rules: [{ field: "variable", operator: "exists" }], match: "all" },
      };
    case "ai":
      return {
        ...base,
        type,
        config: { instruction: "Responde de forma breve y clara.", mode: "respond" },
      };
    case "save_data":
      return {
        ...base,
        type,
        config: { mappings: [{ variable: "variable", target: "lead" }] },
      };
    case "action":
      return { ...base, type, config: { actionType: "crear_lead_enterprise" } };
    case "human":
      return { ...base, type, config: { pauseDurationHours: 1 } };
    case "end":
      return { ...base, type, config: {} };
  }
}
