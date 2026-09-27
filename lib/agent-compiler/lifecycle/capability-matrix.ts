// DuLabs Business — Business Agent 2.0, FASE 8 — matriz de capacidades y readiness del motor (puro).
//
// Para cada capacidad, CINCO hechos distintos que nunca se confunden:
//
//   enabled            el negocio la encendió en su configuración (borrador / Spec)
//   configured         su configuración es válida y publicable (validador del modelo, fail-closed)
//   published          está encendida en la versión PUBLICADA (artefacto compilado)
//   runtimeSupported   el MOTOR que atenderá esa versión la ejecuta (grafo vs motor conversacional)
//   integration        lo externo que necesita existe: calendario conectado, inventario, conocimiento, despacho…
//                      "available" | "missing" | "not_needed" | "not_verified" (no se puede verificar desde aquí)
//
// "Activa" = publicada + soportada por el motor + integración disponible + agente atendiendo un número. Cada columna es
// un hecho verificable; la pantalla solo lo muestra. Credenciales: solo PRESENCIA (nunca valores).

import type { AgentEngineId, BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import type { EngineSelection } from "@/lib/agent-compiler/runtime/production/engine-selection";

export const MATRIX_CAPABILITIES = [
  "knowledge",
  "catalog",
  "products",
  "quotes",
  "booking",
  "appointment_changes",
  "resources",
  "handoff",
  "lead_capture",
  "reminders",
  "orders",
  "payments",
] as const;
export type MatrixCapability = (typeof MATRIX_CAPABILITIES)[number];

export type IntegrationStatus = "available" | "missing" | "not_needed" | "not_verified";
export type RuntimeSupport = "full" | "partial" | "none";

export const CAPABILITY_LABELS: Readonly<Record<MatrixCapability, string>> = {
  knowledge: "Responder preguntas frecuentes",
  catalog: "Mostrar servicios",
  products: "Consultar productos (existencia, precio y stock)",
  quotes: "Dar precios y cotizar",
  booking: "Agendar citas",
  appointment_changes: "Cancelar o cambiar citas",
  resources: "Elegir con quién se atiende",
  handoff: "Pasar a una persona",
  lead_capture: "Guardar interesados",
  reminders: "Recordatorios de cita",
  orders: "Tomar pedidos",
  payments: "Cobrar",
};

/**
 * Qué ejecuta cada motor. El grafo (graph_v1) es el camino de siempre: sus capacidades son las de FASE 1. Lo nuevo de
 * FASE 8 (recursos, recordatorios, consulta de producto por inventario, captura de interesados con guardado explícito)
 * solo lo ejecuta el motor conversacional. Pedidos y pagos no tienen runtime en ninguno (no se simulan).
 */
export const ENGINE_SUPPORT: Readonly<Record<AgentEngineId, Readonly<Record<MatrixCapability, RuntimeSupport>>>> = {
  graph_v1: {
    knowledge: "full",
    catalog: "full",
    // El grafo lista productos en el catálogo, pero no resuelve UN producto contra el inventario (existencia/stock).
    products: "partial",
    quotes: "full",
    booking: "full",
    appointment_changes: "full",
    resources: "none",
    // El grafo pregunta los datos y los guarda en el contacto (save_data), sin objetivo explícito de "interesado".
    lead_capture: "partial",
    reminders: "none",
    handoff: "full",
    orders: "none",
    payments: "none",
  },
  state_machine_v1: {
    knowledge: "full",
    catalog: "full",
    products: "full",
    quotes: "full",
    booking: "full",
    appointment_changes: "full",
    // La elección viaja con la reserva; la disponibilidad es la del calendario completo (no por recurso).
    resources: "partial",
    lead_capture: "full",
    reminders: "full",
    handoff: "full",
    orders: "none",
    payments: "none",
  },
};

export interface IntegrationFacts {
  calendarConnected: boolean;
  activeServices: number;
  activeProducts: number;
  hasKnowledge: boolean;
  whatsappConnected: boolean;
  /** Tabla dulabs_ba_reminders disponible (migración 20261127000000 aplicada). */
  remindersStore: boolean;
  /** Despacho programado y verificado (cron). No se puede comprobar desde la app: false = "not_verified". */
  remindersDispatchVerified: boolean;
}

export interface CredentialFacts {
  /** Solo presencia. */
  geminiKey: boolean;
  nylasApiKey: boolean;
  whatsappToken: boolean;
}

export interface CapabilityRow {
  id: MatrixCapability;
  label: string;
  enabled: boolean;
  configured: boolean;
  published: boolean;
  runtimeSupported: RuntimeSupport;
  integration: IntegrationStatus;
  active: boolean;
  detail?: string;
}

export interface MatrixInput {
  /** Spec de la configuración vigente (borrador proyectado o última versión guardada). */
  spec: BusinessAgentSpec;
  /** Errores de configuración por capacidad (del validador); vacío = todo publicable. */
  configErrors?: ReadonlySet<MatrixCapability>;
  /** Artefacto de la versión PUBLICADA (null = no hay versión publicada o no compila). */
  published: CompiledAgentArtifact | null;
  engine: AgentEngineId;
  facts: IntegrationFacts;
  /** El agente atiende al menos un número. */
  agentActive: boolean;
}

function enabledInSpec(spec: BusinessAgentSpec, id: MatrixCapability): boolean {
  const c = spec.capabilities;
  const rt = spec.runtime;
  switch (id) {
    case "knowledge":
      return c.faq;
    case "catalog":
      return c.catalog && (spec.catalog.useServices || !spec.catalog.useProducts);
    case "products":
      return c.catalog && spec.catalog.useProducts;
    case "quotes":
      return c.sales;
    case "booking":
      return c.scheduling && spec.scheduling.enabled;
    case "appointment_changes":
      return c.scheduling && Boolean(spec.scheduling.cancellation?.allowed);
    case "resources":
      return (rt?.resources?.length ?? 0) > 0;
    case "handoff":
      return c.humanHandoff;
    case "lead_capture":
      return c.leadCapture;
    case "reminders":
      return Boolean(rt?.reminders?.enabled);
    case "orders":
      return c.orders;
    case "payments":
      return c.payments;
  }
}

function publishedIn(a: CompiledAgentArtifact | null, id: MatrixCapability): boolean {
  if (!a) return false;
  const on = (cap: string) => a.capabilities.some((c) => c.id === cap && c.enabled);
  switch (id) {
    case "catalog":
      return on("catalog") && Boolean(a.actions.listar_catalogo_servicios);
    case "products":
      return Boolean(a.actions.ba_consultar_producto);
    case "appointment_changes":
      return Boolean(a.actions.cancelar_cita_cliente || a.actions.reprogramar_cita_cliente);
    case "resources":
      return a.resources.length > 0;
    default:
      return on(id);
  }
}

function integrationOf(input: MatrixInput, id: MatrixCapability): { status: IntegrationStatus; detail?: string } {
  const f = input.facts;
  const provider = input.spec.scheduling.provider;
  switch (id) {
    case "knowledge":
      return f.hasKnowledge ? { status: "available" } : { status: "missing", detail: "Agrega al menos una pregunta frecuente o documento." };
    case "catalog":
      return f.activeServices > 0 ? { status: "available" } : { status: "missing", detail: "No tienes servicios activos." };
    case "products":
      return f.activeProducts > 0 ? { status: "available" } : { status: "missing", detail: "No tienes productos activos en el inventario." };
    case "quotes":
      return f.activeServices + f.activeProducts > 0 ? { status: "available" } : { status: "missing", detail: "No hay nada con precio para cotizar." };
    case "booking":
    case "appointment_changes":
    case "resources":
      if (provider === "nylas") return f.calendarConnected ? { status: "available" } : { status: "missing", detail: "Conecta tu calendario." };
      return { status: provider === "internal" ? "available" : "missing" };
    case "handoff":
    case "lead_capture":
      return f.whatsappConnected ? { status: "available" } : { status: "missing", detail: "Conecta tu número de WhatsApp." };
    case "reminders":
      if (!f.remindersStore) return { status: "missing", detail: "Falta aplicar la migración de recordatorios." };
      return f.remindersDispatchVerified ? { status: "available" } : { status: "not_verified", detail: "El envío programado de recordatorios no está verificado." };
    case "orders":
    case "payments":
      return { status: "missing", detail: "No disponible todavía." };
  }
}

export function buildCapabilityMatrix(input: MatrixInput): CapabilityRow[] {
  const support = ENGINE_SUPPORT[input.engine];
  return MATRIX_CAPABILITIES.map((id) => {
    const enabled = enabledInSpec(input.spec, id);
    const configured = enabled && !input.configErrors?.has(id) && id !== "orders" && id !== "payments";
    const published = publishedIn(input.published, id);
    const integration = enabled || published ? integrationOf(input, id) : { status: "not_needed" as const };
    const runtimeSupported = support[id];
    const active = published && runtimeSupported !== "none" && integration.status === "available" && input.agentActive;
    const detail =
      enabled && runtimeSupported === "none"
        ? input.engine === "graph_v1" && ENGINE_SUPPORT.state_machine_v1[id] !== "none"
          ? "Solo funciona con el motor conversacional."
          : "No disponible todavía."
        : "detail" in integration
          ? integration.detail
          : undefined;
    return { id, label: CAPABILITY_LABELS[id], enabled, configured, published, runtimeSupported, integration: integration.status, active, ...(detail ? { detail } : {}) };
  });
}

// ---------------------------------------------------------------------------
// Readiness del motor (parte del activation gate)
// ---------------------------------------------------------------------------

export type EngineBlockerCode = "ENGINE_CAPABILITY_UNSUPPORTED" | "AI_CREDENTIAL_MISSING" | "ARTIFACT_INVALID" | "KILL_SWITCH_ON";

export interface EngineReadiness {
  blockers: Array<{ code: EngineBlockerCode; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  credentials: Array<{ id: "gemini_key" | "nylas_api_key" | "whatsapp_token"; label: string; present: boolean; required: boolean }>;
}

/**
 * ¿La versión publicada puede atenderse con el motor elegido? Bloquea: capacidad encendida que ese motor no ejecuta,
 * motor conversacional sin credencial de IA, artefacto que no compila. Avisa (sin bloquear): kill switch activo,
 * integraciones "no verificadas" (p. ej. el despacho de recordatorios).
 */
export function evaluateEngineReadiness(input: {
  spec: BusinessAgentSpec;
  engine: AgentEngineId;
  artifactOk: boolean;
  credentials: CredentialFacts;
  killSwitchOn: boolean;
  matrix: readonly CapabilityRow[];
}): EngineReadiness {
  const blockers: EngineReadiness["blockers"] = [];
  const warnings: EngineReadiness["warnings"] = [];
  const sm = input.engine === "state_machine_v1";
  for (const row of input.matrix) {
    if (row.enabled && row.runtimeSupported === "none" && row.id !== "orders" && row.id !== "payments") {
      blockers.push({ code: "ENGINE_CAPABILITY_UNSUPPORTED", message: `${row.label}: solo funciona con el motor conversacional. Actívalo o apaga esta opción.` });
    }
    if (row.enabled && row.integration === "not_verified") warnings.push({ code: "INTEGRATION_NOT_VERIFIED", message: `${row.label}: ${row.detail ?? "integración no verificada"}.` });
  }
  if (sm && !input.credentials.geminiKey) blockers.push({ code: "AI_CREDENTIAL_MISSING", message: "El motor conversacional necesita la IA configurada en el servidor." });
  if (sm && !input.artifactOk) blockers.push({ code: "ARTIFACT_INVALID", message: "La versión publicada no se pudo preparar para el motor conversacional. Vuelve a publicar." });
  if (input.killSwitchOn && sm) warnings.push({ code: "KILL_SWITCH_ON", message: "El motor conversacional está apagado por emergencia: atiende el motor clásico." });
  const needsCalendar = input.spec.capabilities.scheduling && input.spec.scheduling.provider === "nylas";
  return {
    blockers,
    warnings,
    credentials: [
      { id: "gemini_key", label: "IA (Gemini)", present: input.credentials.geminiKey, required: sm },
      { id: "nylas_api_key", label: "Calendario (Nylas)", present: input.credentials.nylasApiKey, required: needsCalendar },
      { id: "whatsapp_token", label: "WhatsApp (Meta)", present: input.credentials.whatsappToken, required: true },
    ],
  };
}

/** Motor que atiende + matriz + readiness (lo que muestra la pantalla y exige el gate de activación). */
export interface EngineReport {
  engine: EngineSelection;
  matrix: CapabilityRow[];
  readiness: EngineReadiness;
}
