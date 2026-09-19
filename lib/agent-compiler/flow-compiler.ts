// DuLabs Business — Agent Compiler (Fase 1), Step 6 + Step 7.1 — IR → FlowDefinition.
//
// Generador DETERMINISTA: CompiledBusinessAgentIR -> FlowDefinition válido para
// el Flow Engine EXISTENTE. No construye otro runtime; produce una máquina
// conversacional declarativa MULTI-TURNO que el motor ya sabe ejecutar, y la
// valida con la API real (validateFlowDefinition / validateFlowForPublish). No
// publica, no toca lib/flow. Reglas duras (Step 7.1):
//  - Los guardrails PRE-LLM NO se duplican en el grafo: viven en el Business
//    Guardrail Gate (buildGateRules sobre la misma IR). El grafo es el diálogo
//    comercial POSTERIOR al Gate. La trazabilidad de la regla queda en la IR.
//  - Tools: patrón AI(propose_action, allowedTools) --success--> ACTION. El nodo
//    AI SOLO propone; el runtime/validator autoriza; el nodo action ejecuta. Los
//    precios/stock/disponibilidad NUNCA se embeben en prompt ni en texto estático.
//  - Turn-taking real: cada estado que necesita input del usuario termina en un
//    nodo question (waiting_input). Un mensaje NO recorre todos los estados.
//  - BOOKING solo si scheduling.enabled y hay runtime real; si no, ERROR (nunca
//    inventa una integración). La acción crítica lleva rama failure -> human.
//  - Si una IR no puede representarse con seguridad => ERROR (nunca best-effort).

import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import { checksumOf } from "@/lib/agent-compiler/checksum";
import { validateFlowDefinition } from "@/lib/flow/validate-graph";
import type {
  ActionNodeConfig,
  FlowActionType,
  FlowDefinition,
  FlowEdge,
  FlowNode,
  VariableDefinition,
} from "@/lib/flow/types";
import type { CompiledBusinessAgentIR, CommercialState } from "@/lib/agent-compiler/ir";
import { diagError, type CompilerDiagnostic } from "@/lib/agent-compiler/diagnostics";
import type { CompilerContext } from "@/lib/agent-compiler/semantic-analysis";
import { BUSINESS_TYPE_OTRO, type CustomerField } from "@/lib/agent-compiler/spec/types";
import { askableFields, buildQuestionText, buildQuestionValidation, sanitizeText } from "@/lib/customer-data";

export type { CompilerContext } from "@/lib/agent-compiler/semantic-analysis";

export type FlowCompilationResult =
  | { success: true; flow: FlowDefinition; checksum: string; diagnostics: CompilerDiagnostic[] }
  | { success: false; diagnostics: CompilerDiagnostic[] };

/** Mensaje fijo seguro (sin afirmaciones externas) cuando una tool no está disponible. */
const MENSAJE_TOOL_NO_DISPONIBLE = "En este momento no puedo completar esa consulta. Dame un momento, por favor.";


/** Builder de grafo con dedupe determinista de nodos/edges/variables. */
class GraphBuilder {
  private nodes: FlowNode[] = [];
  private edges: FlowEdge[] = [];
  private vars = new Map<string, VariableDefinition>();
  private nodeIds = new Set<string>();
  private edgeKeys = new Set<string>();

  addNode(node: FlowNode): string {
    if (!this.nodeIds.has(node.id)) {
      this.nodeIds.add(node.id);
      this.nodes.push(node);
    }
    return node.id;
  }

  addEdge(source: string, target: string, sourceHandle?: string): void {
    const key = `${source}|${sourceHandle ?? ""}|${target}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    const id = `e:${source}:${sourceHandle ?? "default"}:${target}`;
    this.edges.push({ id, source, target, sourceHandle });
  }

  declareVar(key: string, type: VariableDefinition["type"] = "string"): void {
    if (!this.vars.has(key)) this.vars.set(key, { key, label: key, type, required: false });
  }

  build(): Pick<FlowDefinition, "nodes" | "edges" | "variables"> {
    return { nodes: this.nodes, edges: this.edges, variables: [...this.vars.values()] };
  }
}

/** Instrucción MÍNIMA para un nodo AI: propósito + estilo. Nunca datos de negocio. */
/**
 * Contexto de negocio inyectado en TODA instrucción de IA: nombre + tipo. El
 * tipo de negocio es SOLO contexto (nunca una lista rígida en lógica); con
 * "Otro" se usa el texto libre. Si no hay tipo (Specs previos), se omite.
 */
function businessContexto(ir: CompiledBusinessAgentIR): string {
  const { businessName, businessType, businessTypeCustom } = ir.identity;
  const tipo = businessType === BUSINESS_TYPE_OTRO ? businessTypeCustom : businessType;
  const tipoTxt = tipo && tipo.trim() ? ` (${tipo.trim()})` : "";
  return `Negocio: ${businessName}${tipoTxt}.`;
}

function aiInstruction(purpose: string, ir: CompiledBusinessAgentIR): string {
  return `${businessContexto(ir)} ${purpose} Estilo: ${ir.personality.styleHints.join(", ")}. Nunca inventes precios, stock ni disponibilidad: usa exclusivamente las herramientas autorizadas de este paso.`;
}

/**
 * Acción de creación de cita según el provider real (o null si no hay runtime).
 * Bloque 16 (autorizado): "nylas" mapea a crear_cita_nylas_generico -- la
 * acción PROPIA del Business Agent Compiler (params simples fecha/hora,
 * mismo contrato que agendar_cita_especialista) -- NUNCA a crear_cita_nylas
 * (AMORE, exige request.payload.agendamiento que solo produce su propio
 * motor de escenarios; un Business Agent genérico no puede producir eso).
 */
function bookingCreateAction(provider: string): FlowActionType | null {
  if (provider === "nylas") return "crear_cita_nylas_generico";
  if (provider === "internal") return "agendar_cita_especialista";
  return null;
}

/**
 * Config de un action node "simple" (params-only) desde un FlowActionType. Los
 * actionType que emite el compiler (catálogo/agenda) tienen config params-only;
 * el cast está acotado a ese conjunto y validateFlowForPublish lo re-verifica
 * (Zod) antes de publicar. No aplica a webhook_http/asignar_miembro/etc.
 */
function actionConfig(actionType: FlowActionType, params?: Record<string, string>): ActionNodeConfig {
  // `params` = config estática embebida por el compiler (p. ej. el horario de
  // atención). mergeParams en el executor la hace ganar sobre el payload del
  // LLM, así que la IA no puede alterarla. Ver internal-action-executor.ts.
  return (params ? { actionType, params } : { actionType }) as ActionNodeConfig;
}

/**
 * Valida que cada guardrail PRE-LLM de la IR sea representable por el Gate
 * (un FIXED_RESPONSE exige respuesta). NO emite nodos en el grafo: los
 * guardrails viven en el Business Guardrail Gate (buildGateRules). Devuelve un
 * diagnóstico si algo no es representable.
 */
function validarGuardrailsGateRepresentables(ir: CompiledBusinessAgentIR, diags: CompilerDiagnostic[]): boolean {
  for (const g of ir.guardrails) {
    if (g.action === "FIXED_RESPONSE" && !g.response?.trim()) {
      diags.push(
        diagError(
          "GUARDRAIL_NO_RESPONSE",
          "ir_generation",
          `El guardrail "${g.id}" es FIXED_RESPONSE pero no tiene respuesta; no puede representarse en el Business Guardrail Gate.`,
          { source: g.id },
        ),
      );
      return false;
    }
  }
  return true;
}

/** Salida abierta de un tramo del grafo: arista (source, handle) que aún debe conectarse al siguiente estado. */
interface Exit {
  source: string;
  handle?: string;
}

/** Nodo save_data que persiste en el contacto los datos de alcance "customer". */
const DATA_SAVE_NODE_ID = "sd-data";

function dataNodeVariableType(field: CustomerField): VariableDefinition["type"] {
  return field.type === "number" || field.type === "email" || field.type === "phone" ? field.type : "string";
}

/**
 * R3 — captura de datos del cliente. Por cada campo pedible (en el orden del
 * Spec) emite, de forma DETERMINISTA y sin LLM:
 *
 *   cond-data:<k>  (¿la variable <k> ya existe?  -- p. ej. sembrada desde el contacto)
 *     ├─ sí ─────────────────────────────► siguiente campo (no se vuelve a preguntar)
 *     └─ no ─► [requerido]  q-data:<k>  ─► siguiente campo
 *              [opcional]   btn-data:<k> ─ Sí ─► q-data:<k> ─► siguiente campo
 *                                         └ No ─────────────► siguiente campo
 *
 * La pregunta valida con las validaciones REALES del Flow Engine (email/phone/
 * number/hora_colombia/regex). Los campos opcionales se ofrecen con botones
 * (Sí/No) para que "omitir" nunca contamine el dato guardado.
 *
 * Devuelve el nodo de entrada, el último nodo con arista por defecto (`lastNode`)
 * y las salidas abiertas restantes (`exits`) para que el caller las conecte
 * al siguiente estado.
 */
function emitirCapturaDatos(g: GraphBuilder, campos: CustomerField[]): { entry: string; lastNode: string; exits: Exit[] } {
  const condId = (k: string) => `cond-data:${k}`;
  const preguntaId = (k: string) => `q-data:${k}`;
  const botonesId = (k: string) => `btn-data:${k}`;

  campos.forEach((campo, i) => {
    const siguiente = campos[i + 1] ? condId(campos[i + 1]!.key) : null;
    g.declareVar(campo.key, dataNodeVariableType(campo));
    g.addNode({ id: condId(campo.key), type: "condition", config: { rules: [{ field: campo.key, operator: "exists" }], match: "all" } });
    g.addNode({
      id: preguntaId(campo.key),
      type: "question",
      config: { text: buildQuestionText(campo), variableKey: campo.key, required: true, validation: buildQuestionValidation(campo) },
    });
    if (campo.required) {
      g.addEdge(condId(campo.key), preguntaId(campo.key), FLOW_EDGE_HANDLE.conditionFalse);
    } else {
      g.addNode({
        id: botonesId(campo.key),
        type: "buttons",
        config: {
          text: `Es opcional: ${sanitizeText(campo.label, 80)}. ¿Quieres indicarlo?`,
          buttons: [
            { id: "si", label: "Sí" },
            { id: "no", label: "No, omitir" },
          ],
        },
      });
      g.addEdge(condId(campo.key), botonesId(campo.key), FLOW_EDGE_HANDLE.conditionFalse);
      g.addEdge(botonesId(campo.key), preguntaId(campo.key), FLOW_EDGE_HANDLE.button("si"));
    }
    if (siguiente) {
      g.addEdge(condId(campo.key), siguiente, FLOW_EDGE_HANDLE.conditionTrue);
      g.addEdge(preguntaId(campo.key), siguiente);
      if (!campo.required) g.addEdge(botonesId(campo.key), siguiente, FLOW_EDGE_HANDLE.button("no"));
    }
  });

  const ultimo = campos[campos.length - 1]!;
  const exits: Exit[] = [{ source: condId(ultimo.key), handle: FLOW_EDGE_HANDLE.conditionTrue }];
  if (!ultimo.required) exits.push({ source: botonesId(ultimo.key), handle: FLOW_EDGE_HANDLE.button("no") });
  return { entry: condId(campos[0]!.key), lastNode: preguntaId(ultimo.key), exits };
}

/**
 * Construye la máquina conversacional comercial (posterior al Gate). Lineal con
 * puntos de espera (turn-taking) y sub-grafos de tool propose_action->action.
 * Devuelve el id del nodo de entrada, o null si algún estado no puede
 * representarse con runtime real (ej. BOOKING sin provider soportado).
 */
function construirMaquina(g: GraphBuilder, ir: CompiledBusinessAgentIR, endId: string, diags: CompilerDiagnostic[]): string | null {
  const activos = new Set<CommercialState>(ir.states.map((s) => s.id));

  // Las tools autorizadas se derivan EXCLUSIVAMENTE de los bindings reales de
  // la IR (nunca inventadas). El allowlist de cada nodo es EXACTAMENTE la
  // acción que el grafo cablea aguas abajo (propose_action -> action): una
  // tool sin nodo action nunca podría ejecutarse.
  const toolsOf = (s: CommercialState): FlowActionType[] => ir.states.find((x) => x.id === s)?.toolBindings ?? [];
  const primaryTool = (tools: FlowActionType[], preferido: FlowActionType): FlowActionType | null =>
    tools.includes(preferido) ? preferido : (tools[0] ?? null);

  // Mensaje de fallback seguro (sin claims) que siempre alcanza el end.
  let failCounter = 0;
  const safeFail = (): string => {
    const id = `msg-fail:${failCounter++}`;
    g.addNode({ id, type: "message", config: { text: MENSAJE_TOOL_NO_DISPONIBLE, messageRole: "informational" } });
    g.addEdge(id, endId);
    return id;
  };

  // --- WELCOME (siempre): saludo + primera pregunta (primer punto de espera) ---
  g.addNode({
    id: "welcome",
    type: "message",
    config: { text: `¡Hola! Soy ${ir.identity.agentName} de ${ir.identity.businessName}. ¿En qué puedo ayudarte?`, messageRole: "informational" },
  });
  g.declareVar("user_request");
  g.addNode({
    id: "q-need",
    type: "question",
    config: { text: "Cuéntame, ¿qué necesitas hoy?", variableKey: "user_request", required: true, validation: { kind: "text" } },
  });
  g.addEdge("welcome", "q-need");
  const entry = "welcome";
  let prev = "q-need";
  // Salidas "abiertas" del tramo anterior (ramas condicionales que también deben
  // continuar al siguiente estado). Ver link().
  let pendingExits: Exit[] = [];
  /** Conecta el tramo anterior (nodo por defecto + ramas abiertas) con `target`. */
  const link = (target: string): void => {
    g.addEdge(prev, target);
    for (const e of pendingExits) g.addEdge(e.source, target, e.handle);
    pendingExits = [];
  };

  // --- IDENTIFICATION (leadCapture / datos del cliente) ---
  if (activos.has("IDENTIFICATION")) {
    const preguntables = askableFields(ir.customerData?.fields);
    if (preguntables.length > 0) {
      // R3: captura configurada (datos estructurados del Spec). Reemplaza la
      // pregunta genérica de nombre -- nunca se pregunta dos veces.
      const captura = emitirCapturaDatos(g, preguntables);
      link(captura.entry);
      prev = captura.lastNode;
      pendingExits = captura.exits;
      const persistentes = preguntables.filter((f) => f.scope === "customer");
      if (persistentes.length > 0) {
        // Guarda en el CONTACTO (custom_fields) lo que pertenece a la persona:
        // el orquestador ya persiste este export (merge) y lo re-siembra en la
        // próxima conversación, así que no se vuelve a preguntar.
        g.addNode({
          id: DATA_SAVE_NODE_ID,
          type: "save_data",
          config: { mappings: persistentes.map((f) => ({ variable: f.key, target: "custom_field" as const, targetKey: f.key })) },
        });
        link(DATA_SAVE_NODE_ID);
        prev = DATA_SAVE_NODE_ID;
      }
    } else {
      g.declareVar("customer_name");
      g.addNode({
        id: "q-identify",
        type: "question",
        config: { text: "¿Con quién tengo el gusto de hablar?", variableKey: "customer_name", required: true, validation: { kind: "text" } },
      });
      link("q-identify");
      prev = "q-identify";
    }
  }

  // --- QUALIFICATION ---
  if (activos.has("QUALIFICATION")) {
    g.declareVar("qualification");
    g.addNode({
      id: "q-qualify",
      type: "question",
      config: { text: "Para orientarte mejor, ¿qué servicio o producto te interesa?", variableKey: "qualification", required: true, validation: { kind: "text" } },
    });
    link("q-qualify");
    prev = "q-qualify";
  }

  // --- INFORMATION (faq): respuesta conversacional con conocimiento secundario ---
  if (activos.has("INFORMATION")) {
    g.addNode({
      id: "ai-info",
      type: "ai",
      config: { instruction: aiInstruction("Responde la consulta del cliente usando únicamente el conocimiento permitido (fuente secundaria).", ir), mode: "respond", allowedTools: [] },
    });
    link("ai-info");
    prev = "ai-info";
  }

  // --- CATALOG: propose_action -> action(catálogo) -> present -> choose ---
  const catalogAction = primaryTool(toolsOf("CATALOG"), "listar_catalogo_servicios");
  if (activos.has("CATALOG") && catalogAction) {
    g.declareVar("service_choice");
    g.addNode({ id: "ai-catalog-propose", type: "ai", config: { instruction: aiInstruction("Propón consultar el catálogo real para lo que pidió el cliente.", ir), mode: "propose_action", allowedTools: [catalogAction] } });
    g.addNode({ id: "act-catalog", type: "action", config: actionConfig(catalogAction) });
    g.addNode({ id: "ai-catalog-present", type: "ai", config: { instruction: aiInstruction("Presenta las opciones del catálogo consultado. Nunca inventes precios ni servicios que no estén en el resultado.", ir), mode: "respond", allowedTools: [] } });
    g.addNode({ id: "q-catalog-choose", type: "question", config: { text: "¿Cuál de estas opciones te interesa?", variableKey: "service_choice", required: true, validation: { kind: "text" } } });
    link("ai-catalog-propose");
    g.addEdge("ai-catalog-propose", "act-catalog", FLOW_EDGE_HANDLE.aiSuccess);
    g.addEdge("ai-catalog-propose", safeFail(), FLOW_EDGE_HANDLE.aiFailure);
    g.addEdge("act-catalog", "ai-catalog-present");
    g.addEdge("act-catalog", safeFail(), FLOW_EDGE_HANDLE.aiFailure);
    g.addEdge("ai-catalog-present", "q-catalog-choose");
    prev = "q-catalog-choose";
  }

  // --- QUOTING (catalog && sales): propose_action -> action(precio/disponibilidad) -> present ---
  const quoteAction = primaryTool(toolsOf("QUOTING"), "consultar_disponibilidad_catalogo");
  if (activos.has("QUOTING") && quoteAction) {
    g.addNode({ id: "ai-quote-propose", type: "ai", config: { instruction: aiInstruction("Propón resolver el precio/disponibilidad real del servicio elegido.", ir), mode: "propose_action", allowedTools: [quoteAction] } });
    g.addNode({ id: "act-quote", type: "action", config: actionConfig(quoteAction) });
    g.addNode({ id: "ai-quote-present", type: "ai", config: { instruction: aiInstruction("Da el precio y detalles EXACTOS del servicio resuelto por la herramienta. Jamás un precio de memoria.", ir), mode: "respond", allowedTools: [] } });
    link("ai-quote-propose");
    g.addEdge("ai-quote-propose", "act-quote", FLOW_EDGE_HANDLE.aiSuccess);
    g.addEdge("ai-quote-propose", safeFail(), FLOW_EDGE_HANDLE.aiFailure);
    g.addEdge("act-quote", "ai-quote-present");
    g.addEdge("act-quote", safeFail(), FLOW_EDGE_HANDLE.aiFailure);
    prev = "ai-quote-present";
  }

  // --- BOOKING (scheduling): question(cuándo) -> propose_action -> action CRÍTICA -> present; failure -> human ---
  if (activos.has("BOOKING")) {
    if (!ir.scheduling.available) {
      diags.push(
        diagError(
          "SCHEDULING_NO_RUNTIME",
          "ir_generation",
          `El agendamiento con provider "${ir.scheduling.provider}" no tiene un runtime real; no se puede compilar BOOKING sin inventar una integración.`,
          { source: "scheduling" },
        ),
      );
      return null;
    }
    const createAction = bookingCreateAction(ir.scheduling.provider);
    // La acción DEBE existir en los bindings reales de la IR (nunca inventada).
    if (!createAction || !toolsOf("BOOKING").includes(createAction)) {
      diags.push(diagError("SCHEDULING_NO_RUNTIME", "ir_generation", `Sin acción de creación de cita real para el provider "${ir.scheduling.provider}".`, { source: "scheduling" }));
      return null;
    }
    g.declareVar("appointment_request");
    g.addNode({ id: "q-booking-when", type: "question", config: { text: "¿Para qué fecha y hora te gustaría?", variableKey: "appointment_request", required: true, validation: { kind: "text" } } });
    // Con datos del cliente configurados (R3) ya fueron recopilados y validados
    // por el sistema en pasos previos y viajan con la solicitud: la IA no los pide
    // ni los reescribe.
    const notaDatos = ir.customerData?.fields.length
      ? " Los datos del cliente ya fueron recopilados por el sistema: no los pidas, no los repitas y no los incluyas en la propuesta."
      : "";
    g.addNode({ id: "ai-book-propose", type: "ai", config: { instruction: aiInstruction(`Propón crear la reserva incluyendo el servicio elegido (su nombre exacto si el cliente lo mencionó) y la fecha/hora indicada. La disponibilidad, el horario y la duración los valida el sistema con los datos estructurados, no tú.${notaDatos}`, ir), mode: "propose_action", allowedTools: [createAction] } });
    // El compiler EMBEBE en la acción de agendamiento genérico Nylas las reglas
    // deterministas -- horario de atención y definición de los datos del cliente
    // (R3) -- para que el Runtime las valide sin que la IA pueda alterarlas
    // (mergeParams hace ganar la config estática). Otros providers (internal)
    // validan por su propia vía.
    const bookParams: Record<string, string> = {};
    if (createAction === "crear_cita_nylas_generico") {
      if (ir.scheduling.businessHours) bookParams.businessHoursJson = JSON.stringify(ir.scheduling.businessHours);
      if (ir.customerData?.fields.length) bookParams.customerFieldsJson = JSON.stringify(ir.customerData.fields);
    }
    g.addNode({ id: "act-book", type: "action", config: actionConfig(createAction, Object.keys(bookParams).length > 0 ? bookParams : undefined) });
    g.addNode({ id: "ai-book-present", type: "ai", config: { instruction: aiInstruction("Comunica el resultado REAL de la solicitud según el sistema. Si no fue posible, dilo con claridad.", ir), mode: "respond", allowedTools: [] } });
    g.addNode({ id: "human-book-fail", type: "human", config: { message: "Te comunico con una persona del equipo para completar tu solicitud.", pauseDurationHours: 24 } });
    link("q-booking-when");
    g.addEdge("q-booking-when", "ai-book-propose");
    g.addEdge("ai-book-propose", "act-book", FLOW_EDGE_HANDLE.aiSuccess);
    g.addEdge("ai-book-propose", "human-book-fail", FLOW_EDGE_HANDLE.aiFailure);
    g.addEdge("act-book", "ai-book-present");
    // Rama failure OBLIGATORIA para acción crítica (validateSecurityRules).
    g.addEdge("act-book", "human-book-fail", FLOW_EDGE_HANDLE.aiFailure);
    g.addEdge("human-book-fail", endId);
    prev = "ai-book-present";
  }

  // --- CONFIRMATION (scheduling): cierre neutral (sin claims) ---
  if (activos.has("CONFIRMATION")) {
    g.addNode({ id: "st-confirmation", type: "message", config: { text: "¿Hay algo más en lo que pueda ayudarte?", messageRole: "informational" } });
    link("st-confirmation");
    prev = "st-confirmation";
  }

  // Cierre: último nodo del diálogo -> end.
  link(endId);
  return entry;
}

function construirFlow(ir: CompiledBusinessAgentIR, diags: CompilerDiagnostic[]): FlowDefinition | null {
  // Los guardrails PRE-LLM viven en el Gate; acá solo se valida que sean
  // representables (no se emiten nodos de guardrail en el grafo).
  if (!validarGuardrailsGateRepresentables(ir, diags)) return null;

  const g = new GraphBuilder();
  const endId = g.addNode({ id: "end", type: "end", config: {} });
  const startId = g.addNode({ id: "start", type: "start", config: { triggerType: "first_message" } });

  const entry = construirMaquina(g, ir, endId, diags);
  if (entry === null) return null;
  g.addEdge(startId, entry);

  const parts = g.build();
  return {
    name: `${ir.identity.businessName} — ${ir.identity.agentName}`,
    description: `Compilado desde BusinessAgentSpec (spec v${ir.specVersion}). Guardrails en el Business Guardrail Gate.`,
    tenantId: ir.tenantId,
    version: ir.specVersion,
    status: "draft",
    ...parts,
    metadata: { notes: `agent-compiler ir:${ir.checksum}` },
  };
}

/**
 * Compila una IR a FlowDefinition y la valida con la API REAL del Flow Engine.
 * No publica. @param context.tenantId debe coincidir con ir.tenantId (servidor).
 */
export function compileIRToFlowDefinition(ir: CompiledBusinessAgentIR, context: CompilerContext): FlowCompilationResult {
  const diagnostics: CompilerDiagnostic[] = [];

  // Aislamiento: el tenant del contexto debe ser el mismo de la IR.
  if (context.tenantId !== ir.tenantId) {
    diagnostics.push(diagError("TENANT_MISMATCH", "ir_generation", "El tenant del contexto no coincide con el de la IR; posible referencia cross-tenant.", { source: "context" }));
    return { success: false, diagnostics };
  }

  const flow = construirFlow(ir, diagnostics);
  if (!flow) return { success: false, diagnostics };

  // Validación REAL (reutiliza lib/flow, no se copia).
  const validation = validateFlowDefinition(flow);
  if (!validation.valid) {
    for (const err of validation.errors) {
      diagnostics.push(diagError(`FLOW_${err.code}`, "ir_generation", err.message, { path: err.path, source: err.nodeId ?? err.edgeId }));
    }
    return { success: false, diagnostics };
  }

  const checksum = checksumOf(flow);
  return { success: true, flow, checksum, diagnostics };
}
