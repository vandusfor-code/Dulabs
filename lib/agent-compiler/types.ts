// DuLabs Business — Agent Compiler (Fase 1).
//
// Contratos de dominio del Compiler: capa NUEVA y aditiva que convierte
// prompt + PDF + config de UI en un FlowDefinition estructurado, reutilizando
// el Flow Engine existente (lib/flow/*) como Runtime autoritativo. NO define un
// segundo runtime, ni un segundo motor de tools/estados/precios/guardrails.
//
// Filosofía: el LLM interpreta intención; DuLabs mantiene la autoridad sobre
// precios (tablas estructuradas + internal actions), estados (grafo del flow),
// permisos (capabilities) y políticas (guardrails deterministas). Todo dato
// comercial extraído lleva `sourceEvidence` para trazabilidad/auditoría.

import type { ConditionMatchMode, ConditionRule, FlowDefinition } from "@/lib/flow/types";

// ---------------------------------------------------------------------------
// Diagnósticos del Compiler (observabilidad + publication gate)
// ---------------------------------------------------------------------------

/** `block` impide publicar; `warn`/`info` no bloquean. */
export type IssueSeverity = "block" | "warn" | "info";

/** Códigos estables de diagnóstico (para UI, auditoría y tests). */
export type CompilerIssueCode =
  // Catálogo
  | "AMBIGUOUS_CATALOG_ITEM"
  | "CATALOG_ITEM_MISSING_PRICE"
  | "CATALOG_INVALID_CURRENCY"
  | "CATALOG_DUPLICATE_ITEM"
  | "CATALOG_EMPTY"
  // Guardrails
  | "GUARDRAIL_INVALID"
  | "GUARDRAIL_NO_ACTION"
  // Flow / grafo
  | "FLOW_STRUCTURAL_INVALID"
  | "FLOW_ORPHAN_NODE"
  | "FLOW_UNREACHABLE_STATE"
  | "FLOW_INVALID_TRANSITION"
  | "TOOL_NOT_FOUND"
  | "TOOL_FORBIDDEN_USED"
  // Simulación
  | "SIMULATION_CRITICAL_FAILED"
  | "SIMULATION_TRANSFER_EXPECTED_MISSING"
  // Genéricos
  | "COMPILER_INPUT_INVALID";

export interface CompilerIssue {
  code: CompilerIssueCode;
  severity: IssueSeverity;
  message: string;
  /** Fragmento original que originó el diagnóstico (trazabilidad). */
  evidence?: string;
}

// ---------------------------------------------------------------------------
// Entrada del Compiler (UNTRUSTED — prompt/PDF del usuario)
// ---------------------------------------------------------------------------

/**
 * El `tenantId` NUNCA proviene de aquí: se toma del contexto autenticado del
 * servidor (ver Pilar 6). Este contrato es solo el contenido que el usuario
 * escribió/subió, tratado como DATOS, nunca como instrucciones privilegiadas.
 */
export interface CompilerInput {
  /** Prompt/playbook escrito por el usuario. */
  prompt: string;
  /** Texto ya extraído del PDF (pdf-parse corre antes, en subida). Opcional. */
  knowledge?: string;
  /** Config de UI (nombre del agente, etc.). Sin datos autoritativos. */
  config?: {
    agentName?: string;
    /** Dominio del catálogo por defecto cuando el texto no lo desambigua. */
    defaultCatalogType?: CatalogItemType;
  };
}

// ---------------------------------------------------------------------------
// Pilar 1 — Catálogo estructurado
// ---------------------------------------------------------------------------

export type CatalogItemType = "service" | "product";

/**
 * Ítem de catálogo extraído del texto, ANTES de persistir. `priceCop` es entero
 * (COP, sin decimales) para calzar con dulabs_servicios.precio /
 * dulabs_inventario_productos. `sourceEvidence` es obligatorio: ningún dato
 * comercial sin trazabilidad.
 */
export interface ExtractedCatalogItem {
  name: string;
  type: CatalogItemType;
  category?: string;
  /** Entero COP. Ausente si el texto no da un precio inequívoco. */
  priceCop?: number;
  /** Moneda detectada; "COP" por defecto. Otra moneda => issue. */
  currency: string;
  /** Servicios: duración; dulabs_servicios.duracion_min es NOT NULL > 0. */
  durationMin?: number;
  /** Productos: stock si el texto lo indica. */
  stock?: number;
  description?: string;
  /** Cadena original de la que salió el dato (ej. "Paquete 1 Estudio = $350.000"). */
  sourceEvidence: string;
  /** 0..1 — qué tan inequívoca fue la extracción. */
  confidence: number;
}

export interface CatalogExtractionResult {
  items: ExtractedCatalogItem[];
  /** AMBIGUOUS_CATALOG_ITEM, duplicados, moneda inválida, precio ausente. */
  issues: CompilerIssue[];
}

// ---------------------------------------------------------------------------
// Pilar 2 — Guardrails (políticas / exclusiones duras)
// ---------------------------------------------------------------------------

/** Acciones que puede producir una política; espejo del contrato del Runtime. */
export type GuardrailAction = "BLOCK" | "RESPOND" | "TRANSFER_HUMAN" | "CHANGE_STATE" | "END_FLOW";

export type GuardrailSeverity = "critical" | "high" | "medium";

/**
 * Política compilada. La condición se expresa con el MISMO contrato que el
 * Runtime ya entiende (ConditionRule[] + match), para poder materializarse como
 * un `condition` node evaluado ANTES del nodo IA. No es una infraestructura
 * paralela de guardrails.
 */
export interface CompiledGuardrail {
  id: string;
  description: string;
  when: { rules: ConditionRule[]; match: ConditionMatchMode };
  action: GuardrailAction;
  /** Texto fijo de respuesta cuando action === RESPOND/BLOCK. */
  response?: string;
  sourceEvidence: string;
  severity: GuardrailSeverity;
}

export interface GuardrailCompilationResult {
  guardrails: CompiledGuardrail[];
  issues: CompilerIssue[];
}

// ---------------------------------------------------------------------------
// Pilar 3 — Escenarios de simulación
// ---------------------------------------------------------------------------

export interface SimulationScenario {
  id: string;
  description: string;
  input: string;
  expected: {
    state?: string;
    guardrailTriggered?: string;
    toolCallsAllowed?: string[];
    toolCallsForbidden?: string[];
    action?: string;
    shouldTransferHuman?: boolean;
    /** Si true, un FAIL de este escenario bloquea la publicación. */
    shouldBlockPublication?: boolean;
  };
  severity: GuardrailSeverity;
}

export interface ScenarioResult {
  scenarioId: string;
  passed: boolean;
  severity: GuardrailSeverity;
  detail: string;
}

export interface SimulationReport {
  results: ScenarioResult[];
  /** true si algún escenario CRITICAL falló. */
  criticalFailure: boolean;
}

// ---------------------------------------------------------------------------
// Resultado completo de compilación
// ---------------------------------------------------------------------------

export interface CompilationResult {
  catalog: CatalogExtractionResult;
  guardrails: GuardrailCompilationResult;
  /** FlowDefinition generado (draft). */
  flow: FlowDefinition;
  scenarios: SimulationScenario[];
  simulation?: SimulationReport;
  /** Gate de publicación: false si hay cualquier issue `block` o fallo crítico. */
  publicationAllowed: boolean;
  /** Todos los diagnósticos agregados (catálogo + guardrails + flow + simulación). */
  issues: CompilerIssue[];
}
