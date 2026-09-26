// DuLabs Business — Business Agent 2.0, FASE 1 — contratos de acción.
//
// Cada acción que un Business Agent puede ejecutar tiene un contrato explícito. Principio:
//   LLM = interpreta (propone SOLO los campos de `llmArguments`)
//   backend = decide (tenant, conversación, ids, horario, precios: `runtimeInjected` / `businessConfiguredParams`)
//   domain = valida (el handler de lib/flow/executors/internal-action-executor.ts)
//   action engine = ejecuta · database = persiste · integration = comunica
//
// `llmArguments` es una ALLOWLIST: cualquier otra clave que proponga la IA se descarta antes de llegar a las
// variables de la ejecución (lib/agent-compiler/contracts/argument-policy.ts). Los identificadores internos
// (tenant, número, ejecución, efecto) nunca son argumentos: los inyecta el runtime desde el contexto autenticado.
//
// Estos contratos describen el comportamiento REAL de los handlers existentes (verificado leyendo qué
// `params.*` consume cada uno); no inventan acciones nuevas. El timeout efectivo hoy es el global del
// framework de executors (executor-framework.ts, 30 s): `timeoutMs` declara el presupuesto de cada acción y
// su aplicación por acción queda para la FASE 4 (Action Engine).

import { z } from "zod";
import type { FlowActionType } from "@/lib/flow/types";
import type { BusinessAgentErrorCategory } from "@/lib/agent-compiler/contracts/errors";

/** Datos que el runtime inyecta desde el contexto autenticado/de la conversación. Nunca vienen de la IA. */
export type RuntimeInjectedField =
  | "tenantId"
  | "conversation.phoneNumberId"
  | "conversation.telefonoCliente"
  | "executionRowId"
  | "effectId"
  | "now";

export type ActionSideEffect = "none" | "read_internal" | "read_external" | "write_external" | "pause_conversation";

export type IdempotencyStrategy =
  /** Solo lectura: repetirla no cambia nada. */
  | "not_required"
  /** Clave (tenant, ejecución, efecto) + huella de la solicitud: un replay devuelve el mismo resultado. */
  | "effect_scoped_key"
  /** El estado final es el mismo aunque se repita (p. ej. activar una pausa). */
  | "idempotent_by_state"
  /** No hay garantía propia: depende del dedupe por wamid del webhook y de dulabs_flow_events. Gap para FASE 4. */
  | "upstream_dedupe_only";

export interface BusinessAgentActionContract {
  action: FlowActionType;
  /** SemVer del contrato (no del handler). Cambia cuando cambia lo que la IA puede proponer o lo que se produce. */
  version: string;
  description: string;
  /** ALLOWLIST de lo que la IA puede proponer. Objeto Zod: cada campo con tipo y límite de tamaño. */
  llmArguments: z.ZodObject<z.ZodRawShape>;
  runtimeInjected: readonly RuntimeInjectedField[];
  /** Parámetros que el compilador embebe en el nodo (config del negocio). Ganan siempre sobre la IA (mergeParams). */
  businessConfiguredParams: readonly string[];
  /** Variables capturadas o derivadas que la acción lee de la ejecución (no de la IA). */
  reads: readonly string[];
  /** Variables que la acción produce (RUNTIME-DERIVED): la IA nunca puede escribirlas. */
  outputs: readonly string[];
  /** Solo el InternalActionExecutor con context.internal (nunca una llamada externa ni la IA directamente). */
  permission: "runtime_internal";
  tenantScope: "runtime_context";
  sideEffects: ActionSideEffect;
  idempotency: IdempotencyStrategy;
  timeoutMs: number;
  /** Códigos de error que la acción puede devolver -> categoría del contrato de errores. */
  errors: Readonly<Record<string, BusinessAgentErrorCategory>>;
}

const texto = (max: number) => z.string().trim().min(1).max(max);
const SIN_ARGUMENTOS = z.object({});

/** Límite del framework de executors (executor-framework.ts DEFAULT_TIMEOUT_MS). Ningún contrato puede superarlo. */
export const EXECUTOR_FRAMEWORK_TIMEOUT_MS = 30_000;

const ERRORES_AGENDA = {
  datos_incompletos: "USER_ERROR",
  datos_invalidos: "USER_ERROR",
  fecha_invalida: "USER_ERROR",
  hora_invalida: "USER_ERROR",
  fecha_pasada: "BUSINESS_RULE_ERROR",
  muy_pronto: "BUSINESS_RULE_ERROR",
  fuera_de_horario: "BUSINESS_RULE_ERROR",
  ocupado: "BUSINESS_RULE_ERROR",
  calendario_no_conectado: "EXTERNAL_SERVICE_ERROR",
  proveedor_no_disponible: "EXTERNAL_SERVICE_ERROR",
  error_tecnico: "EXTERNAL_SERVICE_ERROR",
  en_progreso: "EXTERNAL_SERVICE_ERROR",
  conflicto_reintento: "INTERNAL_ERROR",
  configuracion_invalida: "INTERNAL_ERROR",
} as const satisfies Record<string, BusinessAgentErrorCategory>;

const CONTRATOS: readonly BusinessAgentActionContract[] = [
  {
    action: "buscar_conocimiento",
    version: "1.0.0",
    description: "Recupera fragmentos de FAQ/documentos del tenant relevantes para la pregunta del cliente.",
    llmArguments: SIN_ARGUMENTOS,
    runtimeInjected: ["tenantId"],
    businessConfiguredParams: ["fuentes"],
    reads: ["user_request", "__firstMessageText"],
    outputs: ["conocimientoEncontrado", "conocimientoTexto", "respuestaExacta", "respuestaDirecta", "cantidadConocimiento", "consultaVacia"],
    permission: "runtime_internal",
    tenantScope: "runtime_context",
    sideEffects: "read_internal",
    idempotency: "not_required",
    timeoutMs: 10_000,
    errors: {},
  },
  {
    action: "listar_catalogo_servicios",
    version: "1.0.0",
    description: "Lista servicios y/o productos activos del tenant con sus precios reales.",
    llmArguments: SIN_ARGUMENTOS,
    runtimeInjected: ["tenantId"],
    businessConfiguredParams: ["incluirServicios", "incluirProductos"],
    reads: [],
    outputs: ["catalogoTexto", "catalogoDisponible", "cantidadCatalogo"],
    permission: "runtime_internal",
    tenantScope: "runtime_context",
    sideEffects: "read_internal",
    idempotency: "not_required",
    timeoutMs: 10_000,
    errors: {},
  },
  {
    action: "calcular_cotizacion",
    version: "1.0.0",
    description: "Calcula una cotización resolviendo los ítems contra el catálogo real (precio y stock de la DB).",
    llmArguments: z.object({ items: texto(1_000) }),
    runtimeInjected: ["tenantId"],
    businessConfiguredParams: ["incluirServicios", "incluirProductos"],
    reads: [],
    outputs: [
      "cotizacionTexto",
      "cotizacionLineas",
      "cotizacionTotal",
      "cotizacionTotalTexto",
      "cotizacionCompleta",
      "cotizacionHayStockInsuficiente",
      "cantidadLineasCotizacion",
    ],
    permission: "runtime_internal",
    tenantScope: "runtime_context",
    sideEffects: "read_internal",
    idempotency: "not_required",
    timeoutMs: 10_000,
    errors: {},
  },
  {
    action: "buscar_disponibilidad_nylas_generico",
    version: "1.0.0",
    description: "Consulta horarios libres reales del calendario conectado (solo lectura).",
    llmArguments: z.object({ fecha: texto(40).optional(), servicio: texto(120).optional() }),
    runtimeInjected: ["tenantId", "now"],
    businessConfiguredParams: ["businessHoursJson", "minNoticeMinutes", "modoReprogramar"],
    reads: ["appointment_request", "cita_pick", "citasCliente"],
    outputs: ["horariosDisponibles", "disponibilidadTexto", "hayCupos", "fecha", "duracionMin"],
    permission: "runtime_internal",
    tenantScope: "runtime_context",
    sideEffects: "read_external",
    idempotency: "not_required",
    timeoutMs: 15_000,
    errors: ERRORES_AGENDA,
  },
  {
    action: "crear_cita_nylas_generico",
    version: "1.0.0",
    description: "Crea la cita en el calendario conectado revalidando horario, disponibilidad y datos del cliente.",
    // `nombreCliente` es un dato del cliente (USER-CONTROLLED): la IA solo puede aportarlo cuando el agente NO lo
    // captura con una pregunta (agentes sin datos configurados). Si hay pregunta de captura, queda protegido.
    llmArguments: z.object({
      servicio: texto(120).optional(),
      fecha: texto(40).optional(),
      hora: texto(20).optional(),
      notas: texto(500).optional(),
      nombreCliente: texto(120).optional(),
    }),
    runtimeInjected: ["tenantId", "conversation.telefonoCliente", "executionRowId", "effectId", "now"],
    businessConfiguredParams: ["businessHoursJson", "minNoticeMinutes", "customerFieldsJson"],
    reads: ["appointment_request", "appointment_pick", "horariosDisponibles", "nombreCliente", "duracionMin"],
    outputs: ["citaId", "status", "inicio", "fin", "reservaTexto", "servicioNombre", "ocupado", "faltantes", "detalle"],
    permission: "runtime_internal",
    tenantScope: "runtime_context",
    sideEffects: "write_external",
    idempotency: "effect_scoped_key",
    timeoutMs: 20_000,
    errors: ERRORES_AGENDA,
  },
  {
    action: "agendar_cita_especialista",
    version: "1.0.0",
    description: "Agenda con los especialistas configurados en DuLabs (proveedor 'internal').",
    // `confirmado`, `duracionMin`, `phoneNumberId` y `telefonoCliente` NO son de la IA: el teléfono y el número salen
    // de la conversación. `nombreCliente` solo si el agente no lo captura con una pregunta (entonces queda protegido).
    llmArguments: z.object({ servicio: texto(120).optional(), fecha: texto(40).optional(), hora: texto(20).optional(), nombreCliente: texto(120).optional() }),
    runtimeInjected: ["tenantId", "conversation.phoneNumberId", "conversation.telefonoCliente"],
    businessConfiguredParams: [],
    reads: ["nombreCliente"],
    outputs: ["citaId", "status", "especialista", "inicio", "fin", "ocupado", "horariosTomados", "detalle"],
    permission: "runtime_internal",
    tenantScope: "runtime_context",
    sideEffects: "write_external",
    idempotency: "upstream_dedupe_only",
    timeoutMs: 20_000,
    errors: { ...ERRORES_AGENDA, missing_appointment_params: "USER_ERROR" },
  },
  {
    action: "listar_citas_cliente",
    version: "1.0.0",
    description: "Lista las citas futuras del propio cliente (identidad = teléfono de la conversación).",
    llmArguments: SIN_ARGUMENTOS,
    runtimeInjected: ["tenantId", "conversation.telefonoCliente", "now"],
    businessConfiguredParams: ["cancelAllowed", "cancelMinNoticeHours"],
    reads: [],
    outputs: ["citasCliente", "citasTexto"],
    permission: "runtime_internal",
    tenantScope: "runtime_context",
    sideEffects: "read_external",
    idempotency: "not_required",
    timeoutMs: 15_000,
    errors: { sin_citas: "BUSINESS_RULE_ERROR", ...ERRORES_AGENDA },
  },
  {
    action: "cancelar_cita_cliente",
    version: "1.0.0",
    description: "Cancela una cita del propio cliente elegida de la lista que mostró el sistema.",
    llmArguments: SIN_ARGUMENTOS,
    runtimeInjected: ["tenantId", "conversation.telefonoCliente", "now"],
    businessConfiguredParams: ["cancelAllowed", "cancelMinNoticeHours"],
    reads: ["cita_pick", "citasCliente"],
    outputs: ["cancelada", "yaCancelada", "citaCanceladaTexto"],
    permission: "runtime_internal",
    tenantScope: "runtime_context",
    sideEffects: "write_external",
    idempotency: "idempotent_by_state",
    timeoutMs: 20_000,
    errors: { seleccion_invalida: "USER_ERROR", cita_no_encontrada: "BUSINESS_RULE_ERROR", muy_cerca: "BUSINESS_RULE_ERROR", no_permitido: "BUSINESS_RULE_ERROR", ...ERRORES_AGENDA },
  },
  {
    action: "reprogramar_cita_cliente",
    version: "1.0.0",
    description: "Mueve una cita del propio cliente a un horario que el sistema ofreció.",
    llmArguments: SIN_ARGUMENTOS,
    runtimeInjected: ["tenantId", "conversation.telefonoCliente", "effectId", "now"],
    businessConfiguredParams: ["businessHoursJson", "minNoticeMinutes", "cancelAllowed", "cancelMinNoticeHours"],
    reads: ["cita_pick", "citasCliente", "appointment_request", "appointment_pick", "horariosDisponibles"],
    outputs: ["movida", "citaMovidaTexto", "inicio", "fin"],
    permission: "runtime_internal",
    tenantScope: "runtime_context",
    sideEffects: "write_external",
    idempotency: "effect_scoped_key",
    timeoutMs: 20_000,
    errors: { seleccion_invalida: "USER_ERROR", mismo_horario: "BUSINESS_RULE_ERROR", ...ERRORES_AGENDA },
  },
  {
    action: "transferir_soporte",
    version: "1.0.0",
    description: "Pausa la IA en esta conversación para que atienda una persona del equipo.",
    llmArguments: SIN_ARGUMENTOS,
    runtimeInjected: ["tenantId", "conversation.phoneNumberId", "conversation.telefonoCliente"],
    businessConfiguredParams: ["pauseDurationHours"],
    reads: [],
    outputs: ["transferred", "pausadoHasta", "pauseDurationHours"],
    permission: "runtime_internal",
    tenantScope: "runtime_context",
    sideEffects: "pause_conversation",
    idempotency: "idempotent_by_state",
    timeoutMs: 10_000,
    errors: { pause_activation_failed: "EXTERNAL_SERVICE_ERROR", conversation_required: "VALIDATION_ERROR" },
  },
];

const POR_ACCION: ReadonlyMap<string, BusinessAgentActionContract> = new Map(CONTRATOS.map((c) => [c.action, c]));

export const BUSINESS_AGENT_ACTION_CONTRACTS: readonly BusinessAgentActionContract[] = CONTRATOS;

export function getActionContract(action: string): BusinessAgentActionContract | undefined {
  return POR_ACCION.get(action);
}

/** Nombres de los campos que la IA puede proponer para `action` (vacío si no hay contrato o no acepta argumentos). */
export function llmArgumentKeys(contract: BusinessAgentActionContract): string[] {
  return Object.keys(contract.llmArguments.shape);
}
