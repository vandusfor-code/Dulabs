/**
 * Registry de capabilities y criticidad de acciones (Fase 2.7).
 * Futuro: tenant allowlist en Supabase sustituirá WEBHOOK_SEMANTIC_ALLOWLIST estático.
 */

import type { ActionNodeConfig, AssertionCapability, FlowActionType } from "@/lib/flow/types";

export type ActionCriticality = "critical" | "elevated" | "standard";

export interface ActionCapabilitySpec {
  actionType: FlowActionType;
  /** Para webhook_http u overrides semánticos. */
  semanticTag?: string;
  criticality: ActionCriticality;
  verifiesOnSuccess?: AssertionCapability[];
  outputVariables?: string[];
  requiresFailureBranch?: boolean;
}

/** Tags de webhook permitidos en publicación (mock estático; reemplazar por tenant registry). */
export const WEBHOOK_SEMANTIC_ALLOWLIST = new Set<string>([
  "consultar_disponibilidad",
  "reservar_cita",
  "consultar_pago",
  "notificar_externo",
]);

/** Specs por actionType (sin semanticTag). */
const BY_ACTION_TYPE: Partial<Record<FlowActionType, ActionCapabilitySpec>> = {
  agendar_cita_marketplace: {
    actionType: "agendar_cita_marketplace",
    criticality: "critical",
    verifiesOnSuccess: ["appointment.reserved"],
    outputVariables: ["reservationId"],
    requiresFailureBranch: true,
  },
  enviar_plantilla: {
    actionType: "enviar_plantilla",
    criticality: "critical",
    requiresFailureBranch: true,
  },
  crear_lead_enterprise: {
    actionType: "crear_lead_enterprise",
    criticality: "elevated",
    verifiesOnSuccess: ["lead.created"],
    outputVariables: ["leadId"],
  },
  crear_lead_campana: {
    actionType: "crear_lead_campana",
    criticality: "elevated",
    verifiesOnSuccess: ["lead.created"],
    outputVariables: ["leadId"],
  },
  transferir_soporte: {
    actionType: "transferir_soporte",
    criticality: "elevated",
    verifiesOnSuccess: ["support.transferred"],
  },
  etiquetar_conversacion: {
    actionType: "etiquetar_conversacion",
    criticality: "standard",
  },
  asignar_miembro: {
    actionType: "asignar_miembro",
    criticality: "standard",
  },
};

/** Specs por semanticTag de webhook (prioridad sobre actionType genérico). */
const BY_WEBHOOK_TAG: Record<string, ActionCapabilitySpec> = {
  consultar_disponibilidad: {
    actionType: "webhook_http",
    semanticTag: "consultar_disponibilidad",
    criticality: "critical",
    verifiesOnSuccess: ["appointment.available"],
    outputVariables: ["available"],
    requiresFailureBranch: true,
  },
  reservar_cita: {
    actionType: "webhook_http",
    semanticTag: "reservar_cita",
    criticality: "critical",
    verifiesOnSuccess: ["appointment.reserved"],
    outputVariables: ["reservationId"],
    requiresFailureBranch: true,
  },
  consultar_pago: {
    actionType: "webhook_http",
    semanticTag: "consultar_pago",
    criticality: "critical",
    verifiesOnSuccess: ["payment.completed"],
    outputVariables: ["paymentStatus"],
    requiresFailureBranch: true,
  },
};

export function resolveActionCapabilitySpec(config: ActionNodeConfig): ActionCapabilitySpec {
  const tag = "semanticTag" in config ? config.semanticTag : undefined;

  if (config.actionType === "webhook_http") {
    if (tag && BY_WEBHOOK_TAG[tag]) return BY_WEBHOOK_TAG[tag]!;
    return {
      actionType: "webhook_http",
      semanticTag: tag,
      criticality: "critical",
      requiresFailureBranch: true,
    };
  }

  const base = BY_ACTION_TYPE[config.actionType];
  if (base) return { ...base, semanticTag: tag ?? base.semanticTag };
  return {
    actionType: config.actionType,
    semanticTag: tag,
    criticality: "standard",
  };
}

export function isCriticalAction(config: ActionNodeConfig): boolean {
  return resolveActionCapabilitySpec(config).criticality === "critical";
}

/** Mapa variable → capability (registry + linkedCapability en flow). */
export function buildVariableCapabilityMap(
  outputVariableSpecs: ActionCapabilitySpec[],
  linkedFromFlow: Map<string, AssertionCapability>,
): Map<string, AssertionCapability> {
  const map = new Map(linkedFromFlow);
  for (const spec of outputVariableSpecs) {
    if (!spec.outputVariables?.length || !spec.verifiesOnSuccess?.length) continue;
    const cap = spec.verifiesOnSuccess[0]!;
    for (const key of spec.outputVariables) {
      if (!map.has(key)) map.set(key, cap);
    }
  }
  return map;
}

export function isWebhookSemanticTagAllowed(tag: string): boolean {
  return WEBHOOK_SEMANTIC_ALLOWLIST.has(tag);
}
