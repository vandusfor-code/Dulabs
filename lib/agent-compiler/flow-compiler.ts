// DuLabs Business — Agent Compiler (Fase 1), Step 6 — IR → FlowDefinition.
//
// Generador DETERMINISTA: CompiledBusinessAgentIR -> FlowDefinition válido para
// el Flow Engine EXISTENTE. No construye otro runtime; solo produce una
// definición declarativa que el motor ya sabe ejecutar, y la valida con la API
// real (validateFlowDefinition). No publica, no toca lib/flow. Reglas duras:
//  - Los precios/stock/disponibilidad NUNCA se embeben en el prompt del nodo AI:
//    se acceden por tool binding (allowedTools) → internal-action-executor.
//  - Los guardrails críticos se evalúan ANTES del nodo AI (rama mutuamente
//    excluyente). El contexto (ej. ESTUDIO + MASCOTA) se preserva íntegro.
//  - Las tools de un nodo están autorizadas por el estado/capability, no porque
//    el LLM pudiera quererlas.
//  - Si una IR no puede representarse con seguridad => ERROR (nunca best-effort).

import { createHash } from "node:crypto";
import { FLOW_EDGE_HANDLE } from "@/lib/flow/constants";
import { validateFlowDefinition } from "@/lib/flow/validate-graph";
import type {
  ConditionRule,
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

const PAUSA_TRANSFER_HORAS = 24;

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

/** Condición de un handoff por keywords (determinista, usa las keywords dadas). */
function condicionKeywords(keywords: string[]): { rules: ConditionRule[]; match: "any" } {
  return { rules: keywords.map((k) => ({ field: "message", operator: "contains", value: k })), match: "any" };
}

type Interceptor = {
  id: string;
  kind: "deterministic" | "semantic";
  label: string;
  condition?: { rules: ConditionRule[]; match: "all" | "any" };
  action: "BLOCK" | "FIXED_RESPONSE" | "TRANSFER_HUMAN";
  response?: string;
  pauseHours: number;
};

function recolectarInterceptores(ir: CompiledBusinessAgentIR): Interceptor[] {
  const out: Interceptor[] = [];
  // Prohibiciones (ya vienen ordenadas por prioridad en la IR).
  for (const g of ir.guardrails) {
    if (g.condition) {
      out.push({ id: `grd-${g.id}`, kind: "deterministic", label: g.id, condition: g.condition, action: g.action, response: g.response, pauseHours: PAUSA_TRANSFER_HORAS });
    } else {
      // Sin condición determinista => detección semántica (LLM clasifica, DuLabs decide la acción).
      out.push({ id: `grd-${g.id}`, kind: "semantic", label: g.id, action: g.action, response: g.response, pauseHours: PAUSA_TRANSFER_HORAS });
    }
  }
  // Handoff (ordenado por id en la IR).
  for (const h of ir.handoff) {
    if (h.trigger.kind === "keyword" && (h.trigger.keywords?.length ?? 0) > 0) {
      out.push({ id: `hof-${h.id}`, kind: "deterministic", label: h.id, condition: condicionKeywords(h.trigger.keywords!), action: "TRANSFER_HUMAN", response: h.response, pauseHours: h.pauseHours });
    } else {
      out.push({ id: `hof-${h.id}`, kind: "semantic", label: h.id, action: h.action === "FIXED_RESPONSE_THEN_PAUSE" ? "TRANSFER_HUMAN" : "TRANSFER_HUMAN", response: h.response, pauseHours: h.pauseHours });
    }
  }
  return out;
}

/** Construye el nodo destino de un interceptor que hace match (mensaje/humano) → end. */
function construirDestinoInterceptor(g: GraphBuilder, ir: CompiledBusinessAgentIR, it: Interceptor, endId: string, diags: CompilerDiagnostic[]): string | null {
  if (it.action === "TRANSFER_HUMAN") {
    const hid = `it-human:${it.id}`;
    g.addNode({ id: hid, type: "human", config: { message: it.response, pauseDurationHours: it.pauseHours } });
    g.addEdge(hid, endId);
    return hid;
  }
  if (it.action === "FIXED_RESPONSE") {
    if (!it.response) {
      diags.push(diagError("GUARDRAIL_NO_RESPONSE", "ir_generation", `El interceptor "${it.label}" es FIXED_RESPONSE pero no tiene respuesta; no se puede representar.`, { source: it.id }));
      return null;
    }
    const mid = `it-msg:${it.id}`;
    g.addNode({ id: mid, type: "message", config: { text: it.response, messageRole: "informational" } });
    g.addEdge(mid, endId);
    return mid;
  }
  // BLOCK: con respuesta => mensaje; sin respuesta => corta al end (bloqueo silencioso).
  if (it.response) {
    const mid = `it-msg:${it.id}`;
    g.addNode({ id: mid, type: "message", config: { text: it.response, messageRole: "informational" } });
    g.addEdge(mid, endId);
    return mid;
  }
  void ir;
  return endId;
}

/** Construye el sub-grafo de estados comerciales activados. Devuelve el id de entrada. */
function construirEstados(g: GraphBuilder, ir: CompiledBusinessAgentIR, endId: string): string {
  const activos = new Set(ir.states.map((s) => s.id));
  const orden: CommercialState[] = ["WELCOME", "IDENTIFICATION", "QUALIFICATION", "INFORMATION", "CATALOG", "QUOTING", "BOOKING", "CONFIRMATION"];
  const secuencia = orden.filter((s) => activos.has(s));

  const nodeIdOf = (s: CommercialState) => `st:${s}`;
  const toolsOf = (s: CommercialState): string[] => ir.states.find((x) => x.id === s)?.toolBindings.map(String) ?? [];

  for (const s of secuencia) {
    const id = nodeIdOf(s);
    switch (s) {
      case "WELCOME":
        g.addNode({ id, type: "message", config: { text: `¡Hola! Soy ${ir.identity.agentName} de ${ir.identity.businessName}. ¿En qué puedo ayudarte?`, messageRole: "informational" } });
        break;
      case "IDENTIFICATION":
        g.declareVar("customer_name");
        g.addNode({ id, type: "ai", config: { instruction: aiInstruction("Identifica y capta el nombre del cliente de forma natural.", ir), mode: "extract", outputVariables: ["customer_name"], allowedTools: toolsOf(s) } });
        break;
      case "QUALIFICATION":
        g.declareVar("qualification");
        g.addNode({ id, type: "ai", config: { instruction: aiInstruction("Determina servicio/categoría/contexto ANTES de cotizar. No des precios en este paso.", ir), mode: "hybrid", outputVariables: ["qualification"], allowedTools: [] } });
        break;
      case "INFORMATION":
        g.addNode({ id, type: "ai", config: { instruction: aiInstruction("Responde preguntas usando el conocimiento permitido (fuente secundaria).", ir), mode: "respond", allowedTools: [] } });
        break;
      case "CATALOG":
        g.declareVar("service_id");
        g.addNode({ id, type: "ai", config: { instruction: aiInstruction("Presenta el catálogo consultando SOLO las herramientas de catálogo.", ir), mode: "hybrid", outputVariables: ["service_id"], allowedTools: toolsOf(s) } });
        break;
      case "QUOTING":
        g.addNode({ id, type: "ai", config: { instruction: aiInstruction("Cotiza usando EXCLUSIVAMENTE el resultado de las herramientas; jamás un precio de memoria.", ir), mode: "hybrid", allowedTools: toolsOf(s) } });
        break;
      case "BOOKING":
        g.declareVar("appointment_request");
        g.addNode({ id, type: "ai", config: { instruction: aiInstruction("Agenda consultando la disponibilidad real por herramienta.", ir), mode: "hybrid", outputVariables: ["appointment_request"], allowedTools: toolsOf(s) } });
        break;
      case "CONFIRMATION":
        g.addNode({ id, type: "message", config: { text: "Confirmamos los detalles. ¡Gracias!", messageRole: "informational" } });
        break;
    }
  }

  // Enlace lineal entre estados consecutivos; el último → end.
  for (let i = 0; i < secuencia.length; i++) {
    const from = nodeIdOf(secuencia[i]!);
    if (i < secuencia.length - 1) g.addEdge(from, nodeIdOf(secuencia[i + 1]!));
    else g.addEdge(from, endId);
  }
  return secuencia.length > 0 ? nodeIdOf(secuencia[0]!) : endId;
}

function construirFlow(ir: CompiledBusinessAgentIR, diags: CompilerDiagnostic[]): FlowDefinition | null {
  const g = new GraphBuilder();
  g.declareVar("message"); // usado por condiciones de keywords

  const endId = g.addNode({ id: "end", type: "end", config: { messageRole: "informational" } });
  const startId = g.addNode({ id: "start", type: "start", config: { triggerType: "first_message" } });

  const mainEntry = construirEstados(g, ir, endId);

  // Declarar como variables todos los campos usados por condiciones deterministas.
  const interceptores = recolectarInterceptores(ir);
  for (const it of interceptores) for (const r of it.condition?.rules ?? []) g.declareVar(r.field);

  const deterministas = interceptores.filter((i) => i.kind === "deterministic");
  const semanticos = interceptores.filter((i) => i.kind === "semantic");

  // Cadena de guardrails deterministas (condition nodes) antes del flujo.
  let prev = startId;
  let prevHandle: string | undefined = undefined; // start usa default; los siguientes usan "false"
  for (const it of deterministas) {
    const cid = `cond:${it.id}`;
    g.addNode({ id: cid, type: "condition", config: { rules: it.condition!.rules, match: it.condition!.match } });
    g.addEdge(prev, cid, prevHandle);
    const destino = construirDestinoInterceptor(g, ir, it, endId, diags);
    if (destino === null) return null;
    g.addEdge(cid, destino, FLOW_EDGE_HANDLE.conditionTrue);
    prev = cid;
    prevHandle = FLOW_EDGE_HANDLE.conditionFalse;
  }

  // Router semántico (ai classify) para intents/prohibiciones sin condición.
  if (semanticos.length > 0) {
    const rid = "policy-router";
    const classifications = [...semanticos.map((s) => s.label), "continue"];
    g.addNode({ id: rid, type: "ai", config: { instruction: "Clasifica la intención del mensaje para aplicar políticas y transferencias. No respondas al cliente aquí.", mode: "classify", classifications } });
    g.addEdge(prev, rid, prevHandle);
    for (const it of semanticos) {
      const destino = construirDestinoInterceptor(g, ir, it, endId, diags);
      if (destino === null) return null;
      g.addEdge(rid, destino, FLOW_EDGE_HANDLE.aiClass(it.label));
    }
    g.addEdge(rid, mainEntry, FLOW_EDGE_HANDLE.aiClass("continue"));
  } else {
    g.addEdge(prev, mainEntry, prevHandle);
  }

  const parts = g.build();
  return {
    name: `${ir.identity.businessName} — ${ir.identity.agentName}`,
    description: `Compilado desde BusinessAgentSpec (spec v${ir.specVersion}).`,
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
