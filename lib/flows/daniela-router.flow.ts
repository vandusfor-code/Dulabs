import { FIRST_MESSAGE_TEXT_VARIABLE_KEY, FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import type { FlowDefinition, FlowNode, FlowEdge, VariableDefinition } from "@/lib/flow/types";
import { danielaAgendarCitaFlow } from "@/lib/flows/daniela-agendar-cita.flow";
import { danielaCancelarCitaFlow } from "@/lib/flows/daniela-cancelar-cita.flow";
import { danielaReagendarCitaFlow } from "@/lib/flows/daniela-reagendar-cita.flow";
import { DANIELA_BUTTON_IDS } from "@/lib/flows/daniela-button-ids";

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
 * "producto" envía el mensaje de derivación (mismo criterio que LEGACY
 * derivar_a_daniela_por_producto: mensaje + terminar, SIN pausar el chat).
 * "menu" muestra el menú inicial con botones; no es obligatorio si el
 * primer mensaje ya trae una intención clara. "handoff_tema"/"otro"/default
 * pasan la conversación a Daniela (pagos, temas administrativos, o mensaje
 * sin intención clara -- nunca inventar nada ahí).
 *
 * Corrección real (revisión de chats reales, sept. 2026) — "info_servicio"
 * (precio/horario/info de un servicio, SIN pedir cita) YA NO se traspasa a
 * un humano: responde con la información REAL del negocio (variable
 * baseConocimiento, sembrada por el orchestrator desde
 * dulabs_clientes_config.base_conocimiento / dulabs_agentes.base_conocimiento
 * -- ver flow-orchestrator.ts y lib/agentes.ts::resolverConfigAgente, MISMA
 * fuente que ya usaba LEGACY). Si esa información no cubre lo preguntado, el
 * propio nodo lo dice con honestidad -- nunca inventa un precio u horario.
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
          "'agendar' (quiere una cita NUEVA, ej. 'quiero una cita', 'quiero reservar', 'quiero un masaje', 'quiero hacerme las uñas', 'quiero una cita para el viernes', o el id de botón 'servicios_spa' -- aunque el servicio no exista, la intención es agendar). NO uses agendar si solo pregunta precio o información de un servicio SIN pedir cita. " +
          "'producto' (interés en un PRODUCTO físico para comprar o consultar: shampoo, crema, aceite, esmalte para llevar a casa; ej. 'cuánto cuesta el shampoo', 'venden cremas', 'quiero comprar un aceite', o el id de botón 'productos'). NO es un servicio de spa (semipermanente, uñas, pestañas, cejas). " +
          "'info_servicio' (pregunta de información, precio o recomendación de un SERVICIO del spa SIN pedir cita, ej. 'cuánto cuesta el semipermanente', 'cuánto vale el semipermanente', 'qué servicio me recomiendas'). " +
          "'menu' (saludo o apertura SIN otra intención: 'hola', 'buenos días', 'hey', 'buenas'). " +
          "'cancelar' (quiere cancelar o quitar una cita existente, ej. 'quiero cancelar', 'ya no puedo ir', 'quiero quitar la cita'), " +
          "'reagendar' (quiere cambiar la fecha/hora de una cita existente, sin cancelarla, ej. 'quiero cambiar mi cita', 'quiero moverla para mañana', '¿será posible mover la que tengo?', 'la hora que tengo no me sirve'), " +
          "'consultar' (quiere saber qué cita tiene o para cuándo es, sin cambiar nada, ej. '¿qué cita tengo?', '¿me recuerdas para cuándo estoy?'), " +
          "'handoff_tema' (pagos, métodos de pago, transferencias, comprobantes de pago, preguntas administrativas, temas fuera de servicios/citas del spa, o cualquier cosa donde no debes inventar datos — ej. '¿cómo pago?', '¿aceptan transferencia?', '¿cuál es la cuenta?'), " +
          "'otro' (mensaje ambiguo o sin intención clara tras leer el texto, ej. conversación suelta sin pedido concreto). " +
          "Ante la duda genuera entre agendar e info_servicio, si NO pidió cita usa 'info_servicio'. Pagos y temas administrativos SIEMPRE 'handoff_tema', nunca 'agendar' ni 'info_servicio'. Ante cualquier otra duda genuina sin intención clara, o si __firstMessageText no existe o no aporta nada claro, clasifica como 'otro' — nunca asumas 'agendar' por defecto.",
        mode: "classify",
        classifications: ["agendar", "cancelar", "reagendar", "consultar", "producto", "info_servicio", "menu", "handoff_tema", "otro"],
      },
    },

    {
      id: "bt-menu-inicial",
      type: "buttons",
      config: {
        text: "¡Hola! 👋💕 Bienvenido/a. ¿En qué podemos ayudarte?",
        variableKey: FIRST_MESSAGE_TEXT_VARIABLE_KEY,
        buttons: [
          { id: DANIELA_BUTTON_IDS.SERVICIOS_SPA, label: "Servicios de Spa" },
          { id: DANIELA_BUTTON_IDS.PRODUCTOS, label: "Productos" },
        ],
      },
    },
    {
      id: "msg-producto",
      type: "message",
      config: {
        text: "Perfecto 🛍️💕 En un momento Daniela te atenderá personalmente para brindarte información sobre nuestros productos. Espera un momento, por favor.",
        messageRole: "informational",
      },
    },
    {
      id: "msg-handoff-tema",
      type: "message",
      config: {
        text: "Ese tema prefiero que lo revise directamente Daniela para darte la información correcta 💕. Voy a pasarle tu conversación. Un momentico, por favor.",
        messageRole: "informational",
      },
    },
    // Corrección real (chats reales, sept. 2026) — precio/horario/info de un
    // servicio SIN pedir cita ya no se traspasa a un humano: el negocio SÍ
    // tiene esa información real (baseConocimiento), no hay motivo para no
    // contestarla. mode:"respond" -- nunca afirma un hecho externo verificado
    // (citas, disponibilidad), solo lee texto de negocio ya configurado.
    {
      id: "ai-responder-info-servicio",
      type: "ai",
      config: {
        instruction:
          "La clienta preguntó por precio, horario u otra información de un servicio del spa, SIN pedir cita. Tienes la información real del negocio en la variable baseConocimiento (precios, horarios, servicios que se manejan) -- respóndele con eso, con naturalidad y precisión, igual que lo diría Daniela. NUNCA inventes un precio, horario o dato que no esté en baseConocimiento. Si baseConocimiento no cubre lo que preguntó, dilo con honestidad (ej. 'esa información no la tengo a la mano, escríbele directo a Daniela y ella te cuenta') -- nunca improvises un dato que no tengas. No ofrezcas agendar cita ni le preguntes nada más, solo responde lo que preguntó.",
        mode: "respond",
      },
    },
    {
      id: "msg-handoff-duda",
      type: "message",
      config: {
        text: "No quiero darte una información incorrecta 😊. Voy a pasar tu conversación directamente con Daniela para que pueda ayudarte. Un momentico, por favor.",
        messageRole: "informational",
      },
    },
    {
      id: "act-handoff-daniela",
      type: "action",
      config: { actionType: "transferir_soporte", pauseDurationHours: 24 },
    },
    { id: "end-handoff", type: "end", config: {} },
    { id: "end-info-servicio", type: "end", config: {} },

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
    { id: "e-clasificar-producto", source: "ai-clasificar-intencion", target: "msg-producto", sourceHandle: FLOW_EDGE_HANDLE.aiClass("producto") },
    { id: "e-clasificar-info-servicio", source: "ai-clasificar-intencion", target: "ai-responder-info-servicio", sourceHandle: FLOW_EDGE_HANDLE.aiClass("info_servicio") },
    { id: "e-clasificar-handoff-tema", source: "ai-clasificar-intencion", target: "msg-handoff-tema", sourceHandle: FLOW_EDGE_HANDLE.aiClass("handoff_tema") },
    { id: "e-clasificar-menu", source: "ai-clasificar-intencion", target: "bt-menu-inicial", sourceHandle: FLOW_EDGE_HANDLE.aiClass("menu") },

    { id: "e-clasificar-otro", source: "ai-clasificar-intencion", target: "msg-handoff-duda", sourceHandle: FLOW_EDGE_HANDLE.aiClass("otro") },
    { id: "e-clasificar-default", source: "ai-clasificar-intencion", target: "msg-handoff-duda", sourceHandle: FLOW_EDGE_HANDLE.aiDefault },

    // servicios_spa es selección de MENÚ (intención de agendar), no un
    // servicio real del catálogo -- va directo a q-servicio, sin ai-extraer
    // (que interpretaría el id del botón como variables.servicio).
    { id: "e-menu-servicios", source: "bt-menu-inicial", target: "agendar__q-servicio", sourceHandle: FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.SERVICIOS_SPA) },
    { id: "e-menu-productos", source: "bt-menu-inicial", target: "msg-producto", sourceHandle: FLOW_EDGE_HANDLE.button(DANIELA_BUTTON_IDS.PRODUCTOS) },
    { id: "e-menu-texto", source: "bt-menu-inicial", target: "ai-clasificar-intencion", sourceHandle: FLOW_EDGE_HANDLE.text },

    { id: "e-producto-handoff", source: "msg-producto", target: "act-handoff-daniela" },
    { id: "e-handoff-tema-act", source: "msg-handoff-tema", target: "act-handoff-daniela" },
    { id: "e-handoff-duda-act", source: "msg-handoff-duda", target: "act-handoff-daniela" },
    { id: "e-handoff-end", source: "act-handoff-daniela", target: "end-handoff", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },
    { id: "e-info-servicio-end", source: "ai-responder-info-servicio", target: "end-info-servicio", sourceHandle: FLOW_EDGE_HANDLE.aiSuccess },

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
      "Clasifica la intención del primer mensaje (agendar/producto/info_servicio/menu/cancelar/reagendar/consultar/otro) y enruta al sub-grafo correspondiente. 'info_servicio' responde con la información real del negocio (baseConocimiento); 'otro'/'handoff_tema' pasan a Daniela.",
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
