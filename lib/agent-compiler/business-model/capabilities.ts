// DuLabs Business — Business Agent 2.0, FASE 5 — catálogo de capacidades del Universal Business Model.
//
// Fuente única (en código) de qué capacidades existen, qué versiones se soportan, cómo se configuran, de qué dependen y
// qué acciones REALES del runtime (Action Registry de FASE 4) pueden habilitar. El modelo solo elige {id, version,
// enabled, config}; nunca declara acciones ni permisos.
//
// Una capacidad sin acción de runtime (pedidos, pagos) existe en el catálogo para poder decir "no disponible" con un
// error estructurado, pero NO se puede activar: no se simula.

import { z } from "zod";
import { KNOWLEDGE_SOURCES } from "@/lib/business-agent-knowledge/limits";
import type { CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";

export const UBM_CAPABILITY_IDS = ["knowledge", "catalog", "quotes", "booking", "handoff", "lead_capture", "reminders", "orders", "payments"] as const;
export type UbmCapabilityId = (typeof UBM_CAPABILITY_IDS)[number];

export const knowledgeConfigSchema = z
  .object({
    /** Fuentes de la búsqueda de conocimiento existente (FAQ estructurada / documentos indexados). Sin RAG nuevo. */
    sources: z.array(z.enum(KNOWLEDGE_SOURCES)).min(1).max(KNOWLEDGE_SOURCES.length),
    onNoAnswer: z.enum(["message", "handoff"]),
    noAnswerMessage: z.string().trim().max(300).optional(),
  })
  .strict();

export const catalogConfigSchema = z.object({ includeServices: z.boolean(), includeProducts: z.boolean() }).strict();

export const quotesConfigSchema = z.object({}).strict();

export const bookingConfigSchema = z
  .object({
    /** Proveedores con runtime real: calendario Nylas o agenda interna (especialistas). */
    provider: z.enum(["nylas", "internal"]),
    /** Una reserva exige elegir servicio (false = p. ej. reserva de mesa sin servicio). */
    requiresService: z.boolean(),
    /** Duración de una reserva cuando no hay servicio que la defina. */
    slotDurationMinutes: z.number().int().min(5).max(480),
    /** Margen entre reservas. Los handlers de agenda existentes no lo aplican: solo se acepta 0 (validador). */
    bufferMinutes: z.number().int().min(0).max(240),
    minimumNoticeMinutes: z.number().int().min(0).max(10_080),
    /** Máxima anticipación (días); null = sin límite. La aplica el Action Engine antes de tocar la agenda. */
    maximumAdvanceDays: z.number().int().min(1).max(365).nullable(),
    /**
     * "customer_choice" (FASE 8): el cliente elige entre los recursos activos del modelo (persona, silla, sala…). La
     * elección viaja con la reserva; la disponibilidad sigue siendo la del calendario del negocio (conservadora).
     */
    resourceSelection: z.enum(["none", "customer_choice"]),
    cancellation: z.object({ allowed: z.boolean(), minimumNoticeHours: z.number().int().min(0).max(720) }).strict(),
    rescheduling: z.object({ allowed: z.boolean() }).strict(),
  })
  .strict();

export const handoffConfigSchema = z
  .object({
    /** Horas que el bot queda en pausa tras transferir (pausa humana existente). */
    pauseHours: z.number().int().min(1).max(720),
    /** Mensaje al transferir. Vacío = el estándar. */
    message: z.string().trim().max(300).optional(),
  })
  .strict();

/**
 * FASE 8 — captura de interesados: qué datos del CONTACTO pide el agente (claves de customerFields con scope
 * "customer") y si guarda también el interés (lo que preguntó). Se guardan en el contacto del negocio (custom_fields).
 */
export const leadCaptureConfigSchema = z
  .object({
    fieldKeys: z.array(z.string().trim().min(1).max(64)).min(1).max(10),
    captureInterest: z.boolean(),
  })
  .strict();

/** FASE 8 — recordatorios que pide el cliente. `offsetMinutes`: cuánto antes de su cita, si no dice la hora. */
export const remindersConfigSchema = z.object({ offsetMinutes: z.number().int().min(15).max(2880) }).strict();

const emptyConfigSchema = z.object({}).strict();

export type KnowledgeCapabilityConfig = z.infer<typeof knowledgeConfigSchema>;
export type CatalogCapabilityConfig = z.infer<typeof catalogConfigSchema>;
export type BookingCapabilityConfig = z.infer<typeof bookingConfigSchema>;
export type HandoffCapabilityConfig = z.infer<typeof handoffConfigSchema>;
export type LeadCaptureCapabilityConfig = z.infer<typeof leadCaptureConfigSchema>;
export type RemindersCapabilityConfig = z.infer<typeof remindersConfigSchema>;

export interface CapabilityDefinition {
  id: UbmCapabilityId;
  versions: readonly string[];
  configSchema: z.ZodType;
  /** Dependencias fijas (grafo). */
  dependsOn: readonly UbmCapabilityId[];
  /** Dependencias que aparecen según la configuración (p. ej. conocimiento → handoff si onNoAnswer = handoff). */
  conditionalDependsOn: readonly UbmCapabilityId[];
  /** false = no existe acción de runtime que la respalde: no se puede activar. */
  executable: boolean;
  /** Acciones del Action Registry que puede habilitar (cuáles exactamente lo decide el compilador con la config). */
  actions: readonly string[];
  /** Capacidad equivalente del Spec legacy (solo para el adaptador). Ausente = solo existe en el motor conversacional. */
  legacyKey?: CapabilityKey;
}

export const CAPABILITY_CATALOG: Readonly<Record<UbmCapabilityId, CapabilityDefinition>> = {
  knowledge: { id: "knowledge", versions: ["1.0.0"], configSchema: knowledgeConfigSchema, dependsOn: [], conditionalDependsOn: ["handoff"], executable: true, actions: ["buscar_conocimiento"], legacyKey: "faq" },
  catalog: { id: "catalog", versions: ["1.0.0"], configSchema: catalogConfigSchema, dependsOn: [], conditionalDependsOn: [], executable: true, actions: ["listar_catalogo_servicios", "ba_consultar_producto"], legacyKey: "catalog" },
  quotes: { id: "quotes", versions: ["1.0.0"], configSchema: quotesConfigSchema, dependsOn: ["catalog"], conditionalDependsOn: [], executable: true, actions: ["calcular_cotizacion"], legacyKey: "sales" },
  booking: {
    id: "booking",
    versions: ["1.0.0"],
    configSchema: bookingConfigSchema,
    dependsOn: [],
    conditionalDependsOn: [],
    executable: true,
    actions: ["buscar_disponibilidad_nylas_generico", "crear_cita_nylas_generico", "agendar_cita_especialista", "cancelar_cita_cliente", "reprogramar_cita_cliente"],
    legacyKey: "scheduling",
  },
  handoff: { id: "handoff", versions: ["1.0.0"], configSchema: handoffConfigSchema, dependsOn: [], conditionalDependsOn: [], executable: true, actions: ["transferir_soporte"], legacyKey: "humanHandoff" },
  lead_capture: { id: "lead_capture", versions: ["1.0.0"], configSchema: leadCaptureConfigSchema, dependsOn: [], conditionalDependsOn: [], executable: true, actions: ["ba_guardar_lead"], legacyKey: "leadCapture" },
  // Un recordatorio es de UNA cita que el agente agendó: sin agenda no hay a qué anclarlo.
  reminders: { id: "reminders", versions: ["1.0.0"], configSchema: remindersConfigSchema, dependsOn: ["booking"], conditionalDependsOn: [], executable: true, actions: ["ba_programar_recordatorio"] },
  orders: { id: "orders", versions: ["1.0.0"], configSchema: emptyConfigSchema, dependsOn: ["catalog"], conditionalDependsOn: [], executable: false, actions: [], legacyKey: "orders" },
  payments: { id: "payments", versions: ["1.0.0"], configSchema: emptyConfigSchema, dependsOn: ["orders"], conditionalDependsOn: [], executable: false, actions: [], legacyKey: "payments" },
};

export function isUbmCapabilityId(id: string): id is UbmCapabilityId {
  return (UBM_CAPABILITY_IDS as readonly string[]).includes(id);
}

/** Dependencias efectivas de una capacidad con su configuración. */
export function dependenciesOf(id: UbmCapabilityId, config: unknown): UbmCapabilityId[] {
  const def = CAPABILITY_CATALOG[id];
  const out = [...def.dependsOn];
  if (id === "knowledge" && (config as KnowledgeCapabilityConfig | undefined)?.onNoAnswer === "handoff") out.push("handoff");
  return out;
}

/** Orden topológico del grafo completo (fijas + condicionales). Lanza si hubiera un ciclo (lo cubre un test). */
export function capabilityTopologicalOrder(): UbmCapabilityId[] {
  const order: UbmCapabilityId[] = [];
  const state = new Map<UbmCapabilityId, "visiting" | "done">();
  const visit = (id: UbmCapabilityId) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new Error(`capability_dependency_cycle:${id}`);
    state.set(id, "visiting");
    for (const d of [...CAPABILITY_CATALOG[id].dependsOn, ...CAPABILITY_CATALOG[id].conditionalDependsOn]) visit(d);
    state.set(id, "done");
    order.push(id);
  };
  for (const id of UBM_CAPABILITY_IDS) visit(id);
  return order;
}
