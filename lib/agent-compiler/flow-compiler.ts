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

import { createHash } from "node:crypto";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
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

export type { CompilerContext } from "@/lib/agent-compiler/semantic-analysis";

export type FlowCompilationResult =
  | { success: true; flow: FlowDefinition; checksum: string; diagnostics: CompilerDiagnostic[] }
  | { success: false; diagnostics: CompilerDiagnostic[] };

/** Mensaje fijo seguro (sin afirmaciones externas) cuando una tool no está disponible. */
const MENSAJE_TOOL_NO_DISPONIBLE = "En este momento no puedo completar esa consulta. Dame un momento, por favor.";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

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
function aiInstruction(purpose: string, ir: CompiledBusinessAgentIR): string {
  return `${purpose} Estilo: ${ir.personality.styleHints.join(", ")}. Nunca inventes precios, stock ni disponibilidad: usa exclusivamente las herramientas autorizadas de este paso.`;
}

/** Acción de creación de cita según el provider real (o null si no hay runtime). */
function bookingCreateAction(provider: string): FlowActionType | null {
  if (provider === "nylas") return "crear_cita_nylas";
  if (provider === "internal") return "agendar_cita_especialista";
  return null;
}

/**
 * Config de un action node "simple" (params-only) desde un FlowActionType. Los
 * actionType que emite el compiler (catálogo/agenda) tienen config params-only;
 * el cast está acotado a ese conjunto y validateFlowForPublish lo re-verifica
 * (Zod) antes de publicar. No aplica a webhook_http/asignar_miembro/etc.
 */
function actionConfig(actionType: FlowActionType): ActionNodeConfig {
  return { actionType } as ActionNodeConfig;
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

  // --- IDENTIFICATION (leadCapture) ---
  if (activos.has("IDENTIFICATION")) {
    g.declareVar("customer_name");
    g.addNode({
      id: "q-identify",
      type: "question",
      config: { text: "¿Con quién tengo el gusto de hablar?", variableKey: "customer_name", required: true, validation: { kind: "text" } },
    });
    g.addEdge(prev, "q-identify");
    prev = "q-identify";
  }

  // --- QUALIFICATION ---
  if (activos.has("QUALIFICATION")) {
    g.declareVar("qualification");
    g.addNode({
      id: "q-qualify",
      type: "question",
      config: { text: "Para orientarte mejor, ¿qué servicio o producto te interesa?", variableKey: "qualification", required: true, validation: { kind: "text" } },
    });
    g.addEdge(prev, "q-qualify");
    prev = "q-qualify";
  }

  // --- INFORMATION (faq): respuesta conversacional con conocimiento secundario ---
  if (activos.has("INFORMATION")) {
    g.addNode({
      id: "ai-info",
      type: "ai",
      config: { instruction: aiInstruction("Responde la consulta del cliente usando únicamente el conocimiento permitido (fuente secundaria).", ir), mode: "respond", allowedTools: [] },
    });
    g.addEdge(prev, "ai-info");
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
    g.addEdge(prev, "ai-catalog-propose");
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
    g.addEdge(prev, "ai-quote-propose");
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
    g.addNode({ id: "ai-book-propose", type: "ai", config: { instruction: aiInstruction("Propón crear la reserva con la fecha/hora indicada. La disponibilidad la valida el sistema, no tú.", ir), mode: "propose_action", allowedTools: [createAction] } });
    g.addNode({ id: "act-book", type: "action", config: actionConfig(createAction) });
    g.addNode({ id: "ai-book-present", type: "ai", config: { instruction: aiInstruction("Comunica el resultado REAL de la solicitud según el sistema. Si no fue posible, dilo con claridad.", ir), mode: "respond", allowedTools: [] } });
    g.addNode({ id: "human-book-fail", type: "human", config: { message: "Te comunico con una persona del equipo para completar tu solicitud.", pauseDurationHours: 24 } });
    g.addEdge(prev, "q-booking-when");
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
    g.addEdge(prev, "st-confirmation");
    prev = "st-confirmation";
  }

  // Cierre: último nodo del diálogo -> end.
  g.addEdge(prev, endId);
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

  const checksum = createHash("sha256").update(stableStringify(flow)).digest("hex");
  return { success: true, flow, checksum, diagnostics };
}
