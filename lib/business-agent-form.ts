/**
 * Bloque B (Authoring UI, autorizado) — estado de formulario del wizard +
 * presets de negocio. Los presets son DATA pura (valores iniciales para
 * prellenar el formulario): el compiler (lib/agent-compiler/*) nunca sabe
 * qué preset se usó -- solo ve un BusinessAgentSpec estructurado igual sin
 * importar la industria. Ningún `if (tipo === "barberia")` en lógica de
 * negocio real: los presets son un mapa de VALORES, no de comportamiento.
 */
import type {
  AgentCapabilities,
  AgentPersonality,
  BusinessRule,
  CatalogConfig,
  HandoffConfig,
  HandoffRule,
  KnowledgeConfig,
  PoliciesConfig,
  Prohibition,
  SchedulingConfig,
} from "@/lib/agent-compiler/spec/types";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";

/** Las 8 secciones editables -- exactamente lo que el cliente puede enviar (ver business-agent-api.ts::EDITABLE_SPEC_KEYS). */
export interface EditableBusinessAgentSpecForm {
  identity: { businessName: string; agentName: string; description?: string; language: string; timezone: string };
  personality: AgentPersonality;
  capabilities: AgentCapabilities;
  catalog: CatalogConfig;
  policies: PoliciesConfig;
  handoff: HandoffConfig;
  scheduling: SchedulingConfig;
  knowledge: KnowledgeConfig;
}

export function emptyCapabilities(on: CapabilityKey[] = []): AgentCapabilities {
  const base = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, false])) as AgentCapabilities;
  for (const k of on) base[k] = true;
  return base;
}

export function blankSpecForm(): EditableBusinessAgentSpecForm {
  return {
    identity: { businessName: "", agentName: "", description: "", language: "es-CO", timezone: "America/Bogota" },
    personality: { primary: "friendly", verbosity: "balanced", emojiPolicy: "limited", formality: "neutral" },
    capabilities: emptyCapabilities(["faq"]),
    catalog: { source: "structured", useServices: false, useProducts: false, quoteBeforeQualification: false },
    policies: { prohibitions: [], rules: [] },
    handoff: { rules: [], defaultPauseHours: 24 },
    scheduling: {
      enabled: false,
      provider: "none",
      timezone: "America/Bogota",
      minNoticeMinutes: 60,
      cancellation: { allowed: true, minNoticeHours: 4 },
      confirmation: { required: false, hoursBefore: 2 },
      resources: [],
    },
    knowledge: { authority: "secondary", documents: [] },
  };
}

export interface BusinessTypePreset {
  id: string;
  label: string;
  labelEn: string;
  apply: (base: EditableBusinessAgentSpecForm) => EditableBusinessAgentSpecForm;
}

/**
 * Presets: SOLO rellenan valores por defecto razonables (capabilities,
 * catalog, scheduling, un recurso típico) -- el usuario puede cambiar
 * cualquier campo después. No existe ninguna rama de compilación distinta
 * por preset: todos producen un BusinessAgentSpec con la MISMA forma.
 */
export const BUSINESS_TYPE_PRESETS: BusinessTypePreset[] = [
  {
    id: "barberia",
    label: "Barbería / Peluquería",
    labelEn: "Barbershop / Salon",
    apply: (base) => ({
      ...base,
      capabilities: emptyCapabilities(["faq", "catalog", "scheduling", "leadCapture", "humanHandoff"]),
      catalog: { ...base.catalog, useServices: true },
      scheduling: { ...base.scheduling, enabled: true, provider: "internal", resources: [{ kind: "specialist", label: "Barbero", required: true }] },
    }),
  },
  {
    id: "fotografia",
    label: "Fotografía / Estudio",
    labelEn: "Photography / Studio",
    apply: (base) => ({
      ...base,
      capabilities: emptyCapabilities(["faq", "catalog", "sales", "leadCapture", "humanHandoff"]),
      catalog: { ...base.catalog, useServices: true },
    }),
  },
  {
    id: "retail",
    label: "Retail / Tienda",
    labelEn: "Retail / Store",
    apply: (base) => ({
      ...base,
      capabilities: emptyCapabilities(["faq", "catalog", "leadCapture", "humanHandoff"]),
      catalog: { ...base.catalog, useServices: false, useProducts: true },
    }),
  },
  {
    id: "consultorio",
    label: "Consultorio / Clínica",
    labelEn: "Clinic / Practice",
    apply: (base) => ({
      ...base,
      capabilities: emptyCapabilities(["faq", "catalog", "scheduling", "leadCapture", "humanHandoff"]),
      catalog: { ...base.catalog, useServices: true },
      scheduling: {
        ...base.scheduling,
        enabled: true,
        provider: "internal",
        confirmation: { required: true, hoursBefore: 24 },
        resources: [{ kind: "specialist", label: "Profesional", required: true }],
      },
    }),
  },
  {
    id: "restaurante",
    label: "Restaurante",
    labelEn: "Restaurant",
    apply: (base) => ({
      ...base,
      capabilities: emptyCapabilities(["faq", "catalog", "leadCapture", "humanHandoff"]),
      catalog: { ...base.catalog, useProducts: true },
    }),
  },
  {
    id: "otro",
    label: "Otro tipo de negocio",
    labelEn: "Other business type",
    apply: (base) => base,
  },
];

export function newRuleId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function blankProhibition(): Prohibition {
  return { id: newRuleId("prohibicion"), description: "", scope: "business", action: "FIXED_RESPONSE", response: "", priority: 50 };
}

export function blankRule(): BusinessRule {
  return { id: newRuleId("regla"), description: "", kind: "informative", priority: 50 };
}

export function blankHandoffRule(): HandoffRule {
  return { id: newRuleId("handoff"), description: "", trigger: { kind: "agent_request" }, action: "TRANSFER_HUMAN" };
}

/** Validaciones de UX rápidas (no reemplazan al servidor, que es la autoridad real). */
export function localFormIssues(form: EditableBusinessAgentSpecForm, t: (es: string, en: string) => string): string[] {
  const issues: string[] = [];
  if (!form.identity.businessName.trim()) issues.push(t("Falta el nombre del negocio.", "Missing business name."));
  if (!form.identity.agentName.trim()) issues.push(t("Falta el nombre del agente.", "Missing agent name."));
  if (form.capabilities.sales && !form.capabilities.catalog) issues.push(t("'Cotizar' requiere activar 'Catálogo'.", "'Quote' requires 'Catalog' enabled."));
  if (form.scheduling.enabled !== form.capabilities.scheduling) {
    issues.push(t("El agendamiento y la capacidad 'Agendar citas' deben coincidir.", "Scheduling and the 'Book appointments' capability must match."));
  }
  if ((form.catalog.useServices || form.catalog.useProducts) && !form.capabilities.catalog) {
    issues.push(t("El catálogo está configurado pero la capacidad 'Catálogo' está apagada.", "Catalog is configured but the 'Catalog' capability is off."));
  }
  const usaTransferencia = form.handoff.rules.length > 0 || form.policies.prohibitions.some((p) => p.action === "TRANSFER_HUMAN");
  if (usaTransferencia && !form.capabilities.humanHandoff) {
    issues.push(t("Hay reglas de transferencia a humano pero 'Transferir a humano' está apagada.", "There are human-transfer rules but 'Human handoff' is off."));
  }
  return issues;
}
