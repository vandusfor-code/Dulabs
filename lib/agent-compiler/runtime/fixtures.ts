// DuLabs Business — Agent Compiler, Step 7 — fixtures industry-agnostic
// (Photography / Salon / Retail). BusinessAgentSpec REALES y consistentes para
// probar la cadena completa: Spec -> IR -> FlowDefinition -> Runtime.

import { CAPABILITY_KEYS, type CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";
import type {
  AgentCapabilities,
  BusinessAgentSpec,
  HandoffRule,
  Prohibition,
} from "@/lib/agent-compiler/spec/types";

function caps(on: Partial<Record<CapabilityKey, boolean>>): AgentCapabilities {
  const base = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, false])) as AgentCapabilities;
  return { ...base, ...on };
}

function baseSpec(over: {
  businessName: string;
  agentName: string;
  capabilities: AgentCapabilities;
  prohibitions?: Prohibition[];
  handoff?: HandoffRule[];
  scheduling?: BusinessAgentSpec["scheduling"];
  useProducts?: boolean;
  quoteBeforeQualification?: boolean;
}): BusinessAgentSpec {
  return {
    schemaVersion: "1.0.0",
    identity: {
      businessName: over.businessName,
      agentName: over.agentName,
      language: "es-CO",
      timezone: "America/Bogota",
    },
    personality: { primary: "friendly", verbosity: "balanced", emojiPolicy: "limited", formality: "neutral" },
    capabilities: over.capabilities,
    catalog: {
      source: "structured",
      useServices: true,
      useProducts: over.useProducts ?? false,
      quoteBeforeQualification: over.quoteBeforeQualification ?? false,
    },
    policies: { prohibitions: over.prohibitions ?? [], rules: [] },
    handoff: { rules: over.handoff ?? [], defaultPauseHours: 24 },
    scheduling:
      over.scheduling ??
      {
        enabled: false,
        provider: "none",
        timezone: "America/Bogota",
        minNoticeMinutes: 60,
        cancellation: { allowed: true, minNoticeHours: 4 },
        confirmation: { required: false, hoursBefore: 2 },
        resources: [],
      },
    knowledge: { authority: "secondary", documents: [] },
    metadata: { specVersion: 1, status: "draft", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
  };
}

/** Prohibición contextual crítica: mascotas prohibidas en estudio (estado QUOTING). */
export const PROHIBICION_MASCOTA_ESTUDIO: Prohibition = {
  id: "mascota_estudio",
  description: "Mascotas permitidas únicamente en exteriores; prohibidas en estudio.",
  scope: "contextual",
  condition: {
    rules: [
      { field: "message", operator: "contains", value: "perro" },
      { field: "state", operator: "equals", value: "QUOTING" },
    ],
    match: "all",
  },
  action: "FIXED_RESPONSE",
  response: "En el estudio no se permiten mascotas; solo pueden acompañarte en las sesiones en exteriores.",
  priority: 100,
};

/** Prohibición de negocio (siempre): no se acepta efectivo. */
export const PROHIBICION_NO_EFECTIVO: Prohibition = {
  id: "no_efectivo",
  description: "No se acepta efectivo.",
  scope: "business",
  condition: { rules: [{ field: "message", operator: "contains", value: "efectivo" }], match: "any" },
  action: "FIXED_RESPONSE",
  response: "Por ahora no recibimos pagos en efectivo.",
  priority: 60,
};

/** Handoff determinista por keyword. */
export const HANDOFF_HABLAR_HUMANO: HandoffRule = {
  id: "hablar_humano",
  description: "El cliente pide hablar con una persona.",
  trigger: { kind: "keyword", keywords: ["hablar con una persona", "quiero un asesor", "hablar con alguien"] },
  action: "TRANSFER_HUMAN",
  response: "Claro, te comunico con una persona del equipo.",
  pauseHours: 12,
};

/** Handoff semántico (queja) — requiere clasificador. */
export const HANDOFF_QUEJA: HandoffRule = {
  id: "queja",
  description: "El cliente presenta una queja o reclamo.",
  trigger: { kind: "complaint" },
  action: "TRANSFER_HUMAN",
  response: "Lamento el inconveniente. Te comunico con una persona para resolverlo.",
  pauseHours: 24,
};

export function photographySpec(): BusinessAgentSpec {
  return baseSpec({
    businessName: "Estudio Lumen",
    agentName: "Lía",
    capabilities: caps({ faq: true, catalog: true, sales: true, leadCapture: true, humanHandoff: true }),
    prohibitions: [PROHIBICION_MASCOTA_ESTUDIO, PROHIBICION_NO_EFECTIVO],
    handoff: [HANDOFF_HABLAR_HUMANO, HANDOFF_QUEJA],
  });
}

export function salonSpec(): BusinessAgentSpec {
  return baseSpec({
    businessName: "Salón Aura",
    agentName: "Sara",
    capabilities: caps({ faq: true, catalog: true, scheduling: true, humanHandoff: true }),
    handoff: [HANDOFF_HABLAR_HUMANO],
    scheduling: {
      enabled: true,
      provider: "internal",
      timezone: "America/Bogota",
      minNoticeMinutes: 60,
      cancellation: { allowed: true, minNoticeHours: 4 },
      confirmation: { required: true, hoursBefore: 2 },
      resources: [{ kind: "specialist", label: "Especialista", required: true }],
    },
  });
}

export function retailSpec(): BusinessAgentSpec {
  return baseSpec({
    businessName: "Tienda Norte",
    agentName: "Tomás",
    capabilities: caps({ faq: true, catalog: true, sales: true, leadCapture: true, humanHandoff: true }),
    prohibitions: [PROHIBICION_NO_EFECTIVO],
    handoff: [HANDOFF_HABLAR_HUMANO],
    useProducts: true,
  });
}
