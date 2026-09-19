// DuLabs Business — Agent Compiler (Fase 1), Step 5.
//
// CompiledBusinessAgentIR: representación intermedia del Compiler. NO es un
// alias de FlowDefinition — representa DECISIONES de compilación con
// procedencia (qué las produjo, de qué config, qué capability las habilitó, qué
// policy las originó, qué tool de Runtime usarán). Industry-agnostic. La
// conversión IR -> FlowDefinition es un Step posterior; aquí solo se produce y
// valida la IR + el análisis semántico.

import type { FlowActionType } from "@/lib/flow/types";
import type { KnowledgeSource } from "@/lib/business-agent-knowledge/limits";
import type { CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";
import type {
  AgentIdentity,
  BusinessHours,
  CustomerField,
  HandoffAction,
  HandoffTrigger,
  KnowledgeNoAnswerPolicy,
  PolicyCondition,
  ProhibitionAction,
  ProhibitionScope,
  RuleKind,
  SchedulingProvider,
} from "@/lib/agent-compiler/spec/types";

export type IrVersion = "1.0.0";
export const CURRENT_IR_VERSION: IrVersion = "1.0.0";

/** Estados comerciales GENÉRICOS (primitivas universales; sin industria). */
export type CommercialState =
  | "WELCOME"
  | "IDENTIFICATION"
  | "QUALIFICATION"
  | "INFORMATION"
  | "CATALOG"
  | "QUOTING"
  | "BOOKING"
  | "CONFIRMATION"
  | "HUMAN_TRANSFER"
  | "COMPLETED";

export interface CompiledState {
  id: CommercialState;
  /** "always" o las capabilities que activaron este estado. */
  enabledBy: "always" | CapabilityKey[];
  /** Acciones de Runtime disponibles en este estado (tool bindings). */
  toolBindings: FlowActionType[];
  description: string;
}

export type TransitionKind = "sequential" | "escape_to_transfer" | "terminal";

export interface CompiledTransition {
  from: CommercialState;
  to: CommercialState;
  kind: TransitionKind;
  reason: string;
}

/** Capability habilitada + sus acciones reales de Runtime. */
export interface CapabilityBinding {
  capability: CapabilityKey;
  actions: FlowActionType[];
  conversationalOnly: boolean;
}

/** Prohibición compilada como guardrail determinista (PRE_LLM). */
export interface CompiledGuardrailIR {
  id: string;
  source: { kind: "prohibition"; prohibitionId: string };
  /** Los guardrails críticos se evalúan ANTES del LLM. */
  execution: "PRE_LLM";
  scope: ProhibitionScope;
  /** Contexto preservado (ej. MASCOTA + ESTUDIO) — nunca reducido a keyword global. */
  condition?: PolicyCondition;
  action: ProhibitionAction;
  response?: string;
  priority: number;
  /** Acción de Runtime si la política transfiere (ej. transferir_soporte). */
  runtimeBinding: FlowActionType | null;
}

/** Regla de negocio compilada (informativa/recordatorio/requisito/validación/precondición). */
export interface CompiledRuleIR {
  id: string;
  kind: RuleKind;
  description: string;
  response?: string;
  priority: number;
}

/** Binding del catálogo: referencia a datos estructurados, nunca al prompt. */
export interface CatalogBinding {
  source: "dulabs_servicios" | "dulabs_inventario_productos";
  access: "internal-action-executor";
  actions: FlowActionType[];
  quoteBeforeQualification: boolean;
}

export interface HandoffBindingIR {
  id: string;
  trigger: HandoffTrigger;
  action: HandoffAction;
  response?: string;
  pauseHours: number;
  runtimeBinding: FlowActionType; // transferir_soporte
}

export interface SchedulingCapabilityIR {
  requested: boolean;
  provider: SchedulingProvider;
  /** true solo si existe soporte real de Runtime para ese provider. */
  available: boolean;
  actions: FlowActionType[];
  resources: { kind: string; label: string; required: boolean }[];
  /** Horario de atención estructurado (regla de disponibilidad); compile lo puebla siempre. */
  businessHours?: BusinessHours | null;
}

/**
 * Datos del cliente compilados (R3): solo campos ACTIVOS, en forma compacta
 * (sin notas internas). El flow compiler genera de aquí los nodos de captura y
 * embebe la misma definición en la acción de reserva (validación de backend).
 */
export interface CustomerDataIR {
  fields: CustomerField[];
}

/** Fuentes de conocimiento: SIEMPRE secundarias, nunca autoridad. */
export interface KnowledgeBindingIR {
  authority: "secondary";
  documentIds: string[];
  /**
   * R4 -- recuperación real de conocimiento (solo con la capability faq). El flow
   * compiler la traduce a: buscar_conocimiento -> [hay resultados] respuesta de
   * la IA con SOLO esos fragmentos | [no hay] mensaje fijo o transferencia.
   */
  retrieval?: {
    sources: KnowledgeSource[];
    onNoAnswer: KnowledgeNoAnswerPolicy;
    noAnswerMessage: string;
  };
}

/** Personalidad como parámetros de comportamiento (no un prompt gigante). */
export interface PersonalityBehaviorIR {
  primary: string;
  verbosity: string;
  emojiPolicy: string;
  formality: string;
  /** Hints mínimos para el LLM; nunca sustituyen una regla de negocio. */
  styleHints: string[];
}

/** Traza de auditoría: cada elemento generado y su origen. */
export interface ProvenanceEntry {
  element: string;
  producedBy: string;
  fromConfig: string;
  capability?: CapabilityKey;
  policyId?: string;
  runtimeTool?: FlowActionType;
}

export interface CompiledBusinessAgentIR {
  irVersion: IrVersion;
  /** Tenant propietario (SIEMPRE del contexto autenticado del servidor). */
  tenantId: string;
  /** Hash determinista del contenido lógico (idempotencia). */
  checksum: string;
  /** Versión del Spec de origen (auditoría de linaje). */
  specVersion: number;
  identity: AgentIdentity;
  personality: PersonalityBehaviorIR;
  capabilities: CapabilityBinding[];
  states: CompiledState[];
  transitions: CompiledTransition[];
  guardrails: CompiledGuardrailIR[];
  rules: CompiledRuleIR[];
  catalogBindings: CatalogBinding[];
  handoff: HandoffBindingIR[];
  scheduling: SchedulingCapabilityIR;
  /** Ausente cuando el Spec no configura datos del cliente (IR idéntica a la previa a R3). */
  customerData?: CustomerDataIR;
  knowledge: KnowledgeBindingIR;
  provenance: ProvenanceEntry[];
}
