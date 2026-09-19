// DuLabs Business — Agent Compiler (Fase 1), Step 5 — NÚCLEO.
//
// compileBusinessAgent: BusinessAgentSpec -> Semantic Analysis -> IR. NO genera
// FlowDefinition (Step posterior), NO publica, NO toca el Runtime. Determinista
// (mismo Spec + contexto -> misma IR, con checksum estable), sin fecha/azar/
// estado global. El tenant viene del contexto autenticado del servidor, jamás
// del Spec. Si algo no puede representarse con seguridad => error (nunca "best
// effort" ni fallback a LLM).

import type { FlowActionType } from "@/lib/flow/types";
import { checksumOf } from "@/lib/agent-compiler/checksum";
import { validateBusinessAgentSpec } from "@/lib/agent-compiler/spec/validate";
import { analyzeBusinessAgentSpec, type CompilerContext } from "@/lib/agent-compiler/semantic-analysis";
import { CAPABILITY_BACKING, CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import {
  CURRENT_IR_VERSION,
  type CapabilityBinding,
  type CatalogBinding,
  type CommercialState,
  type CompiledBusinessAgentIR,
  type CompiledGuardrailIR,
  type CompiledRuleIR,
  type CompiledState,
  type CompiledTransition,
  type HandoffBindingIR,
  type PersonalityBehaviorIR,
  type ProvenanceEntry,
  type SchedulingCapabilityIR,
} from "@/lib/agent-compiler/ir";
import { hasErrors, type CompilerDiagnostic } from "@/lib/agent-compiler/diagnostics";
import { askableFields, toCompiledFields } from "@/lib/customer-data";
import { DEFAULT_NO_ANSWER_MESSAGE, KNOWLEDGE_SOURCES } from "@/lib/business-agent-knowledge/limits";

export type { CompilerContext } from "@/lib/agent-compiler/semantic-analysis";

export type CompilationResult =
  | { success: true; ir: CompiledBusinessAgentIR; diagnostics: CompilerDiagnostic[] }
  | { success: false; diagnostics: CompilerDiagnostic[] };

const PROVIDERS_CON_RUNTIME = new Set(["internal", "nylas"]);

// Orden canónico y estable de estados (determinismo). HUMAN_TRANSFER y
// COMPLETED se tratan aparte (escape/terminal).
const ORDEN_ESTADOS: CommercialState[] = [
  "WELCOME",
  "IDENTIFICATION",
  "QUALIFICATION",
  "INFORMATION",
  "CATALOG",
  "QUOTING",
  "BOOKING",
  "CONFIRMATION",
  "COMPLETED",
];


function personalityToBehavior(spec: BusinessAgentSpec): PersonalityBehaviorIR {
  const p = spec.personality;
  const styleHints: string[] = [];
  styleHints.push({ professional: "tono profesional", friendly: "tono cercano y amable", direct: "tono directo", consultative: "tono consultivo (haz preguntas)" }[p.primary]);
  styleHints.push({ concise: "respuestas cortas", balanced: "respuestas equilibradas", detailed: "respuestas detalladas" }[p.verbosity]);
  styleHints.push(p.emojiPolicy === "none" ? "sin emojis" : "emojis con moderación");
  styleHints.push({ formal: "trato de usted", neutral: "trato neutral", casual: "trato informal" }[p.formality]);
  return { primary: p.primary, verbosity: p.verbosity, emojiPolicy: p.emojiPolicy, formality: p.formality, styleHints };
}

function activarEstados(spec: BusinessAgentSpec): CompiledState[] {
  const caps = spec.capabilities;
  const estados: CompiledState[] = [];
  const push = (id: CommercialState, enabledBy: CompiledState["enabledBy"], toolBindings: FlowActionType[], description: string) =>
    estados.push({ id, enabledBy, toolBindings, description });

  push("WELCOME", "always", [], "Saludo inicial y encuadre de la conversación.");
  if (caps.leadCapture) {
    push("IDENTIFICATION", ["leadCapture"], CAPABILITY_BACKING.leadCapture.actions.slice(), "Identificación/captura de datos del cliente.");
  } else if (caps.scheduling && askableFields(spec.customerData?.fields).length > 0) {
    // Agente de agenda con datos del cliente configurados (R3) pero sin captura
    // de leads: el segmento de captura lo habilita 'scheduling' (sin tools de lead).
    push("IDENTIFICATION", ["scheduling"], [], "Captura de los datos del cliente necesarios para la reserva.");
  }
  if (caps.sales || (caps.catalog && !spec.catalog.quoteBeforeQualification)) push("QUALIFICATION", caps.sales ? ["sales"] : ["catalog"], [], "Calificación antes de cotizar.");
  if (caps.faq) push("INFORMATION", ["faq"], CAPABILITY_BACKING.faq.actions.slice(), "Respuesta a preguntas frecuentes con recuperación de conocimiento (FAQ + documentos) del tenant.");
  if (caps.catalog) push("CATALOG", ["catalog"], ["listar_catalogo_servicios", "resolver_servicio_catalogo", "listar_profesionales_servicio"], "Presentación del catálogo desde datos estructurados.");
  if (caps.catalog && caps.sales) push("QUOTING", ["catalog", "sales"], ["calcular_cotizacion"], "Cotización calculada por el backend con precios del catálogo real (nunca del prompt).");
  if (caps.scheduling) push("BOOKING", ["scheduling"], CAPABILITY_BACKING.scheduling.actions.slice(), "Agendamiento contra el Runtime de disponibilidad.");
  if (caps.scheduling) push("CONFIRMATION", ["scheduling"], [], "Confirmación de la cita/pedido.");
  if (caps.humanHandoff) push("HUMAN_TRANSFER", ["humanHandoff"], ["transferir_soporte"], "Transferencia a un humano (control determinista).");
  push("COMPLETED", "always", [], "Cierre de la conversación.");
  return estados;
}

function construirTransiciones(estados: CompiledState[]): CompiledTransition[] {
  const activos = new Set(estados.map((e) => e.id));
  const secuencia = ORDEN_ESTADOS.filter((s) => activos.has(s));
  const transitions: CompiledTransition[] = [];
  for (let i = 0; i < secuencia.length - 1; i++) {
    transitions.push({ from: secuencia[i]!, to: secuencia[i + 1]!, kind: secuencia[i + 1] === "COMPLETED" ? "terminal" : "sequential", reason: "secuencia comercial activada por capabilities" });
  }
  // Escape a transferencia humana desde cualquier estado no terminal.
  if (activos.has("HUMAN_TRANSFER")) {
    for (const s of secuencia) {
      if (s === "COMPLETED") continue;
      transitions.push({ from: s, to: "HUMAN_TRANSFER", kind: "escape_to_transfer", reason: "regla de transferencia humana (prioridad sobre el LLM)" });
    }
    transitions.push({ from: "HUMAN_TRANSFER", to: "COMPLETED", kind: "terminal", reason: "fin tras transferencia" });
  }
  return transitions;
}

function transferBinding(action: string): FlowActionType | null {
  return action === "TRANSFER_HUMAN" ? "transferir_soporte" : null;
}

function construirIR(spec: BusinessAgentSpec, context: CompilerContext): CompiledBusinessAgentIR {
  const caps = spec.capabilities;

  const capabilities: CapabilityBinding[] = CAPABILITY_KEYS.filter((k) => caps[k]).map((k) => ({
    capability: k,
    actions: CAPABILITY_BACKING[k].actions.slice(),
    conversationalOnly: Boolean(CAPABILITY_BACKING[k].conversationalOnly),
  }));

  const estados = activarEstados(spec);
  const transitions = construirTransiciones(estados);

  // Guardrails deterministas desde prohibiciones (orden estable: prioridad desc, id asc).
  const guardrails: CompiledGuardrailIR[] = [...spec.policies.prohibitions]
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .map((p) => ({
      id: p.id,
      source: { kind: "prohibition", prohibitionId: p.id },
      execution: "PRE_LLM",
      scope: p.scope,
      condition: p.condition,
      action: p.action,
      response: p.response,
      priority: p.priority,
      runtimeBinding: transferBinding(p.action),
    }));

  const rules: CompiledRuleIR[] = [...spec.policies.rules]
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, kind: r.kind, description: r.description, response: r.response, priority: r.priority }));

  const catalogBindings: CatalogBinding[] = [];
  if (caps.catalog) {
    // Servicios: siempre, salvo que el negocio haya elegido SOLO productos (un Spec previo sin useServices ni
    // useProducts sigue siendo "servicios": compatibilidad hacia atrás).
    if (spec.catalog.useServices || !spec.catalog.useProducts) {
      catalogBindings.push({ source: "dulabs_servicios", access: "internal-action-executor", actions: CAPABILITY_BACKING.catalog.actions.slice(), quoteBeforeQualification: spec.catalog.quoteBeforeQualification });
    }
    if (spec.catalog.useProducts) {
      // R6: los productos SÍ se consultan (listar_catalogo_servicios con incluirProductos) y se cotizan.
      catalogBindings.push({ source: "dulabs_inventario_productos", access: "internal-action-executor", actions: ["listar_catalogo_servicios", ...(caps.sales ? (["calcular_cotizacion"] as const) : [])], quoteBeforeQualification: spec.catalog.quoteBeforeQualification });
    }
  }

  const handoff: HandoffBindingIR[] = [...spec.handoff.rules]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((h) => ({ id: h.id, trigger: h.trigger, action: h.action, response: h.response, pauseHours: h.pauseHours ?? spec.handoff.defaultPauseHours, runtimeBinding: "transferir_soporte" }));

  const scheduling: SchedulingCapabilityIR = {
    requested: caps.scheduling,
    provider: spec.scheduling.provider,
    available: caps.scheduling && PROVIDERS_CON_RUNTIME.has(spec.scheduling.provider),
    actions: caps.scheduling ? CAPABILITY_BACKING.scheduling.actions.slice() : [],
    resources: spec.scheduling.resources.map((r) => ({ kind: r.kind, label: r.label, required: r.required })),
    businessHours: spec.scheduling.businessHours ?? null,
    ...(caps.scheduling
      ? {
          minNoticeMinutes: spec.scheduling.minNoticeMinutes,
          cancellation: { allowed: spec.scheduling.cancellation.allowed, minNoticeHours: spec.scheduling.cancellation.minNoticeHours },
        }
      : {}),
  };

  // Datos del cliente (R3): solo campos activos; ausente si no hay (IR y checksum
  // idénticos a los previos a R3 para todo Spec que no los configura).
  const camposCompilados = toCompiledFields(spec.customerData?.fields);

  // Procedencia (auditoría): cada elemento generado con su origen.
  const provenance: ProvenanceEntry[] = [];
  for (const f of camposCompilados) provenance.push({ element: `customer-field:${f.key}`, producedBy: "customer-data-binding", fromConfig: `customerData.fields[${f.key}]` });
  for (const cap of capabilities) provenance.push({ element: `capability:${cap.capability}`, producedBy: "capability-binding", fromConfig: `capabilities.${cap.capability}`, capability: cap.capability });
  for (const s of estados) provenance.push({ element: `state:${s.id}`, producedBy: "state-activation", fromConfig: s.enabledBy === "always" ? "always" : `capabilities.${s.enabledBy.join("+")}` });
  for (const g of guardrails) provenance.push({ element: `guardrail:${g.id}`, producedBy: "prohibition-compilation", fromConfig: `policies.prohibitions[${g.id}]`, policyId: g.id, runtimeTool: g.runtimeBinding ?? undefined });
  for (const c of catalogBindings) provenance.push({ element: `catalog:${c.source}`, producedBy: "catalog-binding", fromConfig: "catalog", capability: "catalog" });
  for (const h of handoff) provenance.push({ element: `handoff:${h.id}`, producedBy: "handoff-binding", fromConfig: `handoff.rules[${h.id}]`, capability: "humanHandoff", runtimeTool: "transferir_soporte" });

  const contenido: Omit<CompiledBusinessAgentIR, "checksum"> = {
    irVersion: CURRENT_IR_VERSION,
    tenantId: context.tenantId,
    specVersion: spec.metadata.specVersion,
    identity: { ...spec.identity },
    personality: personalityToBehavior(spec),
    capabilities,
    states: estados,
    transitions,
    guardrails,
    rules,
    catalogBindings,
    handoff,
    ...(caps.humanHandoff ? { handoffDefaults: { pauseHours: Math.max(1, spec.handoff.defaultPauseHours) } } : {}),
    scheduling,
    ...(camposCompilados.length > 0 ? { customerData: { fields: camposCompilados } } : {}),
    knowledge: {
      authority: "secondary",
      documentIds: spec.knowledge.documents.map((d) => d.id),
      ...(caps.faq
        ? {
            retrieval: {
              sources: [...KNOWLEDGE_SOURCES],
              onNoAnswer: spec.knowledge.onNoAnswer ?? "message",
              noAnswerMessage: spec.knowledge.noAnswerMessage?.trim() || DEFAULT_NO_ANSWER_MESSAGE,
            },
          }
        : {}),
    },
    provenance,
  };
  // Checksum determinista sobre el contenido lógico (sin el propio checksum).
  const checksum = checksumOf(contenido);
  return { ...contenido, checksum };
}

/**
 * Compila un BusinessAgentSpec a su IR. No publica ni genera FlowDefinition.
 * @param context.tenantId proviene del servidor autenticado (nunca del Spec).
 */
export function compileBusinessAgent(spec: unknown, context: CompilerContext): CompilationResult {
  const diagnostics: CompilerDiagnostic[] = [];

  // Fase 1 — validación estructural (Zod + tenant guard + refinements).
  const val = validateBusinessAgentSpec(spec);
  for (const iss of val.issues) {
    diagnostics.push({ code: iss.code, severity: iss.severity === "block" ? "error" : "warning", phase: "validation", message: iss.message, path: iss.evidence, source: iss.subject });
  }
  if (!val.valid) return { success: false, diagnostics };

  const specTipado = spec as BusinessAgentSpec;

  // Fase 2 — análisis semántico (factibilidad contra el Runtime real).
  const analysis = analyzeBusinessAgentSpec(specTipado, context);
  diagnostics.push(...analysis);
  if (hasErrors(analysis)) return { success: false, diagnostics };

  // Fase 3 — generación de IR determinista.
  const ir = construirIR(specTipado, context);
  return { success: true, ir, diagnostics };
}
