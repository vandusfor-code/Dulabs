import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import type { FlowDefinition, FlowNode, FlowEdge, VariableDefinition } from "@/lib/flow/types";
import { danielaAgendarCitaFlow } from "@/lib/flows/daniela-agendar-cita.flow";
import { danielaCancelarCitaFlow } from "@/lib/flows/daniela-cancelar-cita.flow";
import { danielaReagendarCitaFlow } from "@/lib/flows/daniela-reagendar-cita.flow";

/**
 * Fase 1 (Blocker #7, autorizado) — Daniela: enrutamiento de intenciones.
 *
 * NO activado para ningún tenant. Combina los 3 flows ya construidos e
 * independientemente probados (agendar/cancelar/reagendar) en UN SOLO
 * FlowDefinition, con un nodo de clasificación al inicio que decide a cuál
 * sub-grafo entrar -- Flow-only, sin necesitar ningún cambio en
 * flow-engine.ts ni flow-orchestrator.ts (que no tienen ningún concepto de
 * "saltar a otro flow_id" en runtime, y no se modificaron para agregarlo).
 *
 * "Servicio no disponible" (ej. "quiero un masaje") NO es una categoría de
 * enrutamiento aparte: clasifica como "agendar" y el propio sub-grafo de
 * agendar (Blocker #3, categoriaDeServicioReconocida) ya maneja
 * correctamente un servicio no reconocido -- duplicar ese catálogo de
 * servicios en la instrucción del clasificador sería repetir conocimiento
 * de negocio que ya vive, correctamente, en el adaptador.
 *
 * "INFORMACIÓN" / "CONVERSACIÓN" (precios, dudas generales, "no sé qué
 * hacerme") NO tienen sub-grafo propio en Flow todavía -- caen en la
 * categoría "otro", que termina SIN enviar ningún mensaje. Esto es
 * deliberado: permite que lib/flow-runtime-bridge.ts (ver el ajuste de
 * este mismo blocker) reconozca "Flow terminó pero no dijo nada" y deje
 * pasar el mensaje a LEGACY, que sí tiene acceso completo a
 * base_conocimiento y al prompt real de Daniela -- no se duplicó ni se
 * intentó reconstruir esa capacidad en Flow.
 */

function importarSubflow(
  flow: FlowDefinition,
  prefijo: string,
): { nodes: FlowNode[]; edges: FlowEdge[]; variables: VariableDefinition[]; entryNodeId: string } {
  const startNode = flow.nodes.find((n) => n.type === "start");
  if (!startNode) throw new Error(`importarSubflow: "${prefijo}" no tiene nodo start`);
  const edgeDesdeStart = flow.edges.find((e) => e.source === startNode.id);
  if (!edgeDesdeStart) throw new Error(`importarSubflow: "${prefijo}" no tiene edge saliente de start`);

  const remapNodeId = (id: string) => `${prefijo}__${id}`;

  const nodes = flow.nodes
    .filter((n) => n.id !== startNode.id)
    .map((n) => ({ ...n, id: remapNodeId(n.id) }) as FlowNode);

  const edges = flow.edges
    .filter((e) => e.source !== startNode.id)
    .map((e) => ({
      ...e,
      id: remapNodeId(e.id),
      source: remapNodeId(e.source),
      target: remapNodeId(e.target),
    }));

  return { nodes, edges, variables: flow.variables, entryNodeId: remapNodeId(edgeDesdeStart.target) };
}

/** Variables por key -- si dos sub-flows declaran la misma key (ej.
 * citaObjetivoId en cancelar y reagendar), se conserva una sola entrada. */
function combinarVariables(...listas: VariableDefinition[][]): VariableDefinition[] {
  const porKey = new Map<string, VariableDefinition>();
  for (const lista of listas) {
    for (const v of lista) {
      if (!porKey.has(v.key)) porKey.set(v.key, v);
    }
  }
  return [...porKey.values()];
}

export function danielaRouterFlow(): FlowDefinition {
  const agendar = importarSubflow(danielaAgendarCitaFlow(), "agendar");
  const cancelar = importarSubflow(danielaCancelarCitaFlow(), "cancelar");
  const reagendar = importarSubflow(danielaReagendarCitaFlow(), "reagendar");

  const nodes: FlowNode[] = [
    { id: "start", type: "start", config: { triggerType: "first_message" } },

    // Fase 1 (Blocker #1) — __firstMessageText ya llega sembrada por el
    // Engine desde el evento "start" (sin modificar flow-engine.ts otra
    // vez -- ya se hizo en el Blocker #1). Este es el PRIMER uso real de
    // esa variable: una capa EXPLÍCITA de interpretación, nunca una
    // adivinanza automática del motor. Si __firstMessageText no existe
    // (mensaje vacío, ver Blocker #7 caso 12), la clasificación cae a
    // 'otro' por instrucción explícita -- nunca asume agendar por defecto.
    {
      id: "ai-clasificar-intencion",
      type: "ai",
      config: {
        instruction:
          "Lee el primer mensaje de la clienta en la variable __firstMessageText y clasifica su intención en UNA de estas categorías: " +
          "'agendar' (quiere una cita nueva, ej. 'quiero una cita', 'quiero reservar', 'quiero un masaje' -- aunque el servicio no exista, la intención es agendar), " +
          "'cancelar' (quiere cancelar o quitar una cita existente, ej. 'quiero cancelar', 'ya no puedo ir', 'quiero quitar la cita'), " +
          "'reagendar' (quiere cambiar la fecha/hora de una cita existente, sin cancelarla, ej. 'quiero cambiar mi cita', 'quiero moverla para mañana', '¿será posible mover la que tengo?', 'la hora que tengo no me sirve'), " +
          "'consultar' (quiere saber qué cita tiene o para cuándo es, sin cambiar nada, ej. '¿qué cita tengo?', '¿me recuerdas para cuándo estoy?'), " +
          "'otro' (cualquier otra cosa: preguntas de precios/información general, conversación sin intención clara, mensaje ambiguo, o mensaje vacío/sin texto reconocible). " +
          "Ante la duda genuina entre dos categorías, o si __firstMessageText no existe o no aporta nada claro, clasifica SIEMPRE como 'otro' -- nunca asumas 'agendar' por defecto.",
        mode: "classify",
        classifications: ["agendar", "cancelar", "reagendar", "consultar", "otro"],
      },
    },

    // Rama CONSULTAR -- propia de este blocker, no importada de ningún
    // sub-flow existente.
    {
      id: "act-consultar-citas-router",
      type: "action",
      config: { actionType: "consultar_citas_activas_especialista" },
    },
    {
      id: "cond-tiene-citas-router",
      type: "condition",
      config: { rules: [{ field: "cantidadCitas", operator: "greater_than", value: 0 }], match: "all" },
    },
    {
      id: "msg-sin-cita-router",
      type: "message",
      config: { text: "No encuentro ninguna cita activa por acá 🤔", messageRole: "informational" },
    },
    // GAP DE PROVENANCE DOCUMENTADO, NO RESUELTO EN ESTE BLOCKER (ver
    // reporte del Blocker #7): este nodo describe una cita REAL leída de
    // citasActivas, pero consultar_citas_activas_especialista no tiene
    // ninguna capability declarada en action-capabilities.ts, así que su
    // texto NO está protegido por el sistema de evidencia verificada de
    // external-claim-security.ts -- ni para bloquear una invención, ni
    // (irónicamente) para el caso legítimo, que hoy simplemente no pasa
    // por ese chequeo en absoluto. Cerrarlo requeriría tocar ese archivo
    // protegido -- NO se tocó sin autorización explícita.
    {
      id: "ai-responder-consulta",
      type: "ai",
      config: {
        instruction:
          "La clienta preguntó por su cita. Tienes su cita real en la variable citasActivas (contiene servicio, fecha y hora reales). Dile con naturalidad cuál es -- servicio, fecha y hora exactos, nunca inventados ni redondeados. No le preguntes nada más ni ofrezcas cambiarla, solo informa.",
        mode: "respond",
      },
    },

    { id: "end-otro", type: "end", config: {} },
    { id: "end-consultar-sin-cita", type: "end", config: {} },
    { id: "end-consultar-informado", type: "end", config: {} },

    ...agendar.nodes,
    ...cancelar.nodes,
    ...reagendar.nodes,
  ];

  const edges: FlowEdge[] = [
    { id: "e-start-clasificar", source: "start", target: "ai-clasificar-intencion" },

    { id: "e-clasificar-agendar", source: "ai-clasificar-intencion", target: agendar.entryNodeId, sourceHandle: FLOW_EDGE_HANDLE.aiClass("agendar") },
    { id: "e-clasificar-cancelar", source: "ai-clasificar-intencion", target: cancelar.entryNodeId, sourceHandle: FLOW_EDGE_HANDLE.aiClass("cancelar") },
    { id: "e-clasificar-reagendar", source: "ai-clasificar-intencion", target: reagendar.entryNodeId, sourceHandle: FLOW_EDGE_HANDLE.aiClass("reagendar") },
    { id: "e-clasificar-consultar", source: "ai-clasificar-intencion", target: "act-consultar-citas-router", sourceHandle: FLOW_EDGE_HANDLE.aiClass("consultar") },

    // "otro" y cualquier valor no reconocido (default) terminan SIN enviar
    // ningún mensaje -- ver docstring de cabecera sobre el hand-off a LEGACY.
    { id: "e-clasificar-otro", source: "ai-clasificar-intencion", target: "end-otro", sourceHandle: FLOW_EDGE_HANDLE.aiClass("otro") },
    { id: "e-clasificar-default", source: "ai-clasificar-intencion", target: "end-otro", sourceHandle: FLOW_EDGE_HANDLE.aiDefault },

    { id: "e-consultar-cond", source: "act-consultar-citas-router", target: "cond-tiene-citas-router" },
    { id: "e-consultar-sin-cita", source: "cond-tiene-citas-router", target: "msg-sin-cita-router", sourceHandle: FLOW_EDGE_HANDLE.conditionFalse },
    { id: "e-consultar-sin-cita-end", source: "msg-sin-cita-router", target: "end-consultar-sin-cita" },
    { id: "e-consultar-con-cita", source: "cond-tiene-citas-router", target: "ai-responder-consulta", sourceHandle: FLOW_EDGE_HANDLE.conditionTrue },
    { id: "e-consultar-informado-end", source: "ai-responder-consulta", target: "end-consultar-informado", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

    ...agendar.edges,
    ...cancelar.edges,
    ...reagendar.edges,
  ];

  return {
    name: "Daniela — Enrutador de intenciones (Fase 1, diseño)",
    description:
      "Clasifica la intención del primer mensaje (agendar/cancelar/reagendar/consultar/otro) y enruta al sub-grafo correspondiente. 'otro' termina sin mensaje, dejando pasar a LEGACY. NO activado para ningún tenant.",
    nodes,
    edges,
    variables: combinarVariables(
      [
        { key: "cantidadCitas", label: "Cantidad de citas activas (consulta)", type: "number" },
        { key: "citasActivas", label: "Lista de citas activas reales (consulta)", type: "string" },
      ],
      agendar.variables,
      cancelar.variables,
      reagendar.variables,
    ),
  };
}
