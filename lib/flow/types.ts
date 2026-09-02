/**
 * DuLabs Flow Builder — contrato de tipos (Fase 0).
 *
 * JSON-serializable. Pensado para persistirse como `definition_json` en
 * versiones publicadas y para ser consumido por flow-engine / flow-runtime /
 * flow-store en fases posteriores.
 *
 * Campos `id` y `tenantId` en FlowDefinition son de dominio tenant; la
 * autorización se implementará en capas superiores (API / store).
 */

// ---------------------------------------------------------------------------
// Primitivos compartidos
// ---------------------------------------------------------------------------

export type FlowNodeType =
  | "start"
  | "message"
  | "question"
  | "buttons"
  | "condition"
  | "ai"
  | "save_data"
  | "action"
  | "human"
  | "end";

export type FlowStatus = "draft" | "published" | "archived";

export interface NodePosition {
  x: number;
  y: number;
}

/** Metadatos editoriales; no afectan ejecución. */
export interface FlowMetadata {
  createdAt?: string;
  updatedAt?: string;
  authorId?: string;
  /** Notas internas del builder. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Mensaje — alineado con enviarWhatsApp / enviarWhatsAppPartes / plantillas
// ---------------------------------------------------------------------------

/** Referencia a plantilla Meta (runtime resuelve templateId o nombre). */
export interface FlowTemplateRef {
  templateId?: string;
  templateName?: string;
  /** Variables {{1}}, {{2}}, etc. */
  variables?: Record<string, string>;
}

export type FlowMediaType = "image" | "video" | "document" | "audio";

export interface FlowMediaRef {
  type: FlowMediaType;
  /** URL accesible en runtime o media id de Meta. */
  url?: string;
  mediaId?: string;
  caption?: string;
}

/**
 * Contenido de un nodo message.
 * - `text`: mensaje único.
 * - `parts`: múltiples burbujas (mismo patrón que enviarWhatsAppPartes).
 * Al menos uno de text/parts/template debe estar presente (validado en Zod).
 */
/** Capabilities que solo una acción verificada puede afirmar en runtime. */
export type AssertionCapability =
  | "appointment.reserved"
  | "appointment.available"
  | "payment.completed"
  | "lead.created"
  | "support.transferred";

/** Rol semántico del mensaje (Builder UX; no inferido del texto). */
export type MessageRole = "informational" | "intent_offer" | "external_assertion";

export interface FlowMessageContent {
  text?: string;
  parts?: string[];
  template?: FlowTemplateRef;
  media?: FlowMediaRef;
  /** Rol del mensaje para validación de publicación. Default: informational. */
  messageRole?: MessageRole;
  /** Obligatorio cuando messageRole === external_assertion. */
  asserts?: AssertionCapability[];
}

// ---------------------------------------------------------------------------
// Botones — ids únicos; runtime mapeará label → titulo (≤20 chars Meta)
// ---------------------------------------------------------------------------

export interface FlowButton {
  id: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Pregunta
// ---------------------------------------------------------------------------

export type QuestionValidationKind = "text" | "number" | "email" | "phone" | "regex" | "hora_colombia";

export type QuestionValidation =
  | { kind: "text" }
  | { kind: "number" }
  | { kind: "email" }
  | { kind: "phone" }
  | { kind: "regex"; pattern: string; flags?: string }
  | { kind: "hora_colombia" };

// ---------------------------------------------------------------------------
// Condición
// ---------------------------------------------------------------------------

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "greater_or_equal"
  | "less_than"
  | "less_or_equal"
  | "exists"
  | "not_exists";

export type ConditionMatchMode = "all" | "any";

export interface ConditionRule {
  /** Clave de variable del flow o path reservado del runtime. */
  field: string;
  operator: ConditionOperator;
  value?: string | number | boolean;
}

// ---------------------------------------------------------------------------
// IA — el engine decide transiciones; el nodo no salta arbitrariamente
// ---------------------------------------------------------------------------

export type AiNodeMode = "classify" | "extract" | "respond" | "hybrid" | "propose_action";

export interface AiNodeConfig {
  /** Referencia opcional a dulabs_agentes.id (perfil prompt existente). */
  agentId?: string;
  instruction: string;
  mode: AiNodeMode;
  /** Variables que la IA puede poblar (extract/hybrid). */
  outputVariables?: string[];
  /** Registry de tools permitidos en runtime (fase posterior). */
  allowedTools?: string[];
  /**
   * Valores esperados en modo classify; cada uno debe tener edge
   * sourceHandle `class:{value}` o un edge `default`.
   */
  classifications?: string[];
}

// ---------------------------------------------------------------------------
// Guardar dato
// ---------------------------------------------------------------------------

export type SaveDataTarget = "lead" | "custom_field" | "webhook_body";

export interface SaveDataMapping {
  variable: string;
  target: SaveDataTarget;
  /** Obligatorio cuando target === custom_field. */
  targetKey?: string;
}

// ---------------------------------------------------------------------------
// Acción — configuración extensible; ejecución en flow-runtime
// ---------------------------------------------------------------------------

export type FlowActionType =
  | "crear_lead_enterprise"
  | "crear_lead_campana"
  | "transferir_soporte"
  | "etiquetar_conversacion"
  | "asignar_miembro"
  | "agendar_cita_marketplace"
  // Fase 0 (migración Daniela → Flow): adaptador sobre el sistema REAL de
  // especialistas (dulabs_especialistas / dulabs_citas_especialista) — NO
  // sobre dulabs_marketplace_citas. Ver lib/especialistas-flow-adaptador.ts.
  | "consultar_disponibilidad_especialista"
  | "validar_servicio_especialista"
  | "agendar_cita_especialista"
  | "cancelar_cita_especialista"
  // Fase 1 (Blocker #4): lista TODAS las citas activas de la clienta, no
  // solo la más próxima -- necesaria para desambiguar cuál cancelar cuando
  // tiene varias. Solo lectura, misma tabla.
  | "consultar_citas_activas_especialista"
  // Fase 1 (Blocker #5): reagenda (mueve) una cita existente a una nueva
  // fecha/hora -- UPDATE atómico sobre la misma fila, nunca crea una nueva.
  | "mover_cita_especialista"
  | "webhook_http"
  | "enviar_plantilla";

/** Params genéricos mapeados desde variables en runtime. */
export type ActionParams = Record<string, string>;

/** Tag semántico opcional para identificar el contrato de una acción (webhooks). */
export interface ActionSemanticTag {
  semanticTag?: string;
}

export interface WebhookHttpActionConfig extends ActionSemanticTag {
  actionType: "webhook_http";
  /** URL destino; futura allowlist por tenant. */
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  /** Claves de variables del flow a incluir en el cuerpo. */
  bodyVariableKeys?: string[];
}

export interface EnviarPlantillaActionConfig extends ActionSemanticTag {
  actionType: "enviar_plantilla";
  templateName: string;
  variables?: Record<string, string>;
}

export interface EtiquetarConversacionActionConfig extends ActionSemanticTag {
  actionType: "etiquetar_conversacion";
  tagId: string;
}

export interface AsignarMiembroActionConfig extends ActionSemanticTag {
  actionType: "asignar_miembro";
  memberId: string;
}

export interface TransferirSoporteActionConfig extends ActionSemanticTag {
  actionType: "transferir_soporte";
  pauseDurationHours?: number;
}

export interface SimpleActionConfig extends ActionSemanticTag {
  actionType:
    | "crear_lead_enterprise"
    | "crear_lead_campana"
    | "agendar_cita_marketplace"
    | "consultar_disponibilidad_especialista"
    | "validar_servicio_especialista"
    | "agendar_cita_especialista"
    | "cancelar_cita_especialista"
    | "consultar_citas_activas_especialista"
    | "mover_cita_especialista";
  params?: ActionParams;
}

export type ActionNodeConfig =
  | SimpleActionConfig
  | TransferirSoporteActionConfig
  | EtiquetarConversacionActionConfig
  | AsignarMiembroActionConfig
  | WebhookHttpActionConfig
  | EnviarPlantillaActionConfig;

// ---------------------------------------------------------------------------
// Nodos — discriminated union por `type`
// ---------------------------------------------------------------------------

interface FlowNodeBase {
  id: string;
  position?: NodePosition;
  /** Etiqueta visual en el canvas; no usada en runtime. */
  label?: string;
}

export type StartTriggerType = "first_message" | "keyword" | "campaign_reply" | "manual";

export interface StartNodeConfig {
  triggerType: StartTriggerType;
  keywords?: string[];
}

export interface StartNode extends FlowNodeBase {
  type: "start";
  config: StartNodeConfig;
}

export interface MessageNode extends FlowNodeBase {
  type: "message";
  config: FlowMessageContent;
}

export interface QuestionNode extends FlowNodeBase {
  type: "question";
  config: {
    text: string;
    variableKey: string;
    required: boolean;
    validation: QuestionValidation;
  };
}

export interface ButtonsNode extends FlowNodeBase {
  type: "buttons";
  config: {
    text: string;
    buttons: FlowButton[];
    variableKey?: string;
  };
}

export interface ConditionNode extends FlowNodeBase {
  type: "condition";
  config: {
    rules: ConditionRule[];
    match: ConditionMatchMode;
  };
}

export interface AiNode extends FlowNodeBase {
  type: "ai";
  config: AiNodeConfig;
}

export interface SaveDataNode extends FlowNodeBase {
  type: "save_data";
  config: {
    mappings: SaveDataMapping[];
  };
}

export interface ActionNode extends FlowNodeBase {
  type: "action";
  config: ActionNodeConfig;
}

export interface HumanNode extends FlowNodeBase {
  type: "human";
  config: {
    message?: string;
    pauseDurationHours: number;
    assignTo?: string;
  };
}

export interface EndNode extends FlowNodeBase {
  type: "end";
  config: {
    message?: string;
    tags?: string[];
  };
}

export type FlowNode =
  | StartNode
  | MessageNode
  | QuestionNode
  | ButtonsNode
  | ConditionNode
  | AiNode
  | SaveDataNode
  | ActionNode
  | HumanNode
  | EndNode;

// ---------------------------------------------------------------------------
// Edges — sourceHandle codifica ramas (botones, condición, IA)
// ---------------------------------------------------------------------------

/**
 * Convenciones de sourceHandle (validadas en validate-graph):
 * - buttons: `button:{buttonId}`
 * - condition: `true` | `false`
 * - ai classify: `class:{classification}` | `default`
 * - ai extract/respond/hybrid: `success` | `failure` (opcional)
 * - start / message / etc.: omitido o `default`
 */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Variables del flow
// ---------------------------------------------------------------------------

export type FlowVariableType = "string" | "number" | "boolean" | "date" | "email" | "phone";

export interface VariableDefinition {
  key: string;
  label: string;
  type: FlowVariableType;
  required?: boolean;
  defaultValue?: string | number | boolean;
  /** Capability crítica asociada (validación de condiciones). */
  linkedCapability?: AssertionCapability;
}

// ---------------------------------------------------------------------------
// Definición completa
// ---------------------------------------------------------------------------

export interface FlowDefinition {
  /** UUID del flow; asignado al persistir. */
  id?: string;
  /** Aislamiento tenant — obligatorio en store/API futuros. */
  tenantId?: string;
  name: string;
  description?: string;
  /** Versión lógica; versionado inmutable en fases posteriores. */
  version?: number;
  status?: FlowStatus;
  nodes: FlowNode[];
  edges: FlowEdge[];
  variables: VariableDefinition[];
  metadata?: FlowMetadata;
}
