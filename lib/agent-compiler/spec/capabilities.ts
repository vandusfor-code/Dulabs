// DuLabs Business — Agent Compiler (Fase 1), Step 4.
//
// Anclaje de CAPABILITIES a herramientas REALES del Runtime existente. Una
// capability activa DEBE corresponder a acciones/tools que el Flow Engine ya
// puede ejecutar (FlowActionType de lib/flow/types). Si una capability no tiene
// backing real (available:false), habilitarla es inválido — nunca se habilita
// algo solo porque el LLM recibió una instrucción textual.

import type { FlowActionType } from "@/lib/flow/types";

export const CAPABILITY_KEYS = [
  "faq",
  "sales",
  "catalog",
  "leadCapture",
  "scheduling",
  "orders",
  "payments",
  "humanHandoff",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export interface CapabilityBacking {
  /** false = no existe todavía una herramienta de Runtime que la respalde. */
  available: boolean;
  /** Acciones internas del Flow Engine que materializan esta capability. */
  actions: readonly FlowActionType[];
  /** Capabilities que ésta requiere para tener sentido. */
  requires?: readonly CapabilityKey[];
  /** Solo conversacional (nodo AI), sin acción de tool dedicada. */
  conversationalOnly?: boolean;
}

/**
 * Mapa capability -> respaldo real. Las acciones referencian FlowActionType
 * EXISTENTES (ver lib/flow/types.ts). `orders`/`payments` = available:false
 * porque hoy NO existe una acción de Runtime para tomar pedidos o cobrar.
 */
export const CAPABILITY_BACKING: Record<CapabilityKey, CapabilityBacking> = {
  faq: { available: true, actions: [], conversationalOnly: true },
  sales: { available: true, actions: [], conversationalOnly: true, requires: ["catalog"] },
  catalog: {
    available: true,
    actions: ["listar_catalogo_servicios", "resolver_servicio_catalogo", "consultar_disponibilidad_catalogo", "listar_profesionales_servicio"],
  },
  leadCapture: { available: true, actions: ["crear_lead_enterprise", "crear_lead_campana", "get_contact"] },
  scheduling: {
    available: true,
    actions: [
      "consultar_disponibilidad_especialista",
      "listar_horarios_disponibles_especialista",
      "resolver_seleccion_horario",
      "agendar_cita_especialista",
      "cancelar_cita_especialista",
      "mover_cita_especialista",
      "buscar_disponibilidad_nylas",
      "crear_cita_nylas",
    ],
  },
  orders: { available: false, actions: [], requires: ["catalog"] },
  payments: { available: false, actions: [] },
  humanHandoff: { available: true, actions: ["transferir_soporte"] },
};

/** Acciones de Runtime habilitadas por el conjunto de capabilities activas. */
export function allowedActionsForCapabilities(capabilities: Record<CapabilityKey, boolean>): FlowActionType[] {
  const set = new Set<FlowActionType>();
  for (const key of CAPABILITY_KEYS) {
    if (capabilities[key]) for (const a of CAPABILITY_BACKING[key].actions) set.add(a);
  }
  return [...set];
}
