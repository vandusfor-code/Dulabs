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
import { BUSINESS_TYPE_OTRO, type BusinessHours } from "@/lib/agent-compiler/spec/types";
import { tieneAlgunHorarioAbierto } from "@/lib/business-hours";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";

/** Las 8 secciones editables -- exactamente lo que el cliente puede enviar (ver business-agent-api.ts::EDITABLE_SPEC_KEYS). */
export interface EditableBusinessAgentSpecForm {
  identity: { businessName: string; agentName: string; description?: string; businessType?: string; businessTypeCustom?: string; language: string; timezone: string };
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
    identity: { businessName: "", agentName: "", description: "", businessType: "", businessTypeCustom: "", language: "es-CO", timezone: "America/Bogota" },
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

/**
 * Opción del desplegable "Tipo de negocio". `value` es el string canónico que
 * se persiste en identity.businessType (= etiqueta en español); `labelEn` es
 * solo la traducción para mostrar. BUSINESS_TYPE_OTRO ("Otro") habilita el
 * campo libre `businessTypeCustom`.
 *
 * ARQUITECTURA: el tipo de negocio es SOLO contexto para el compiler, nunca una
 * lista rígida en lógica. Ampliar la oferta = agregar una línea aquí; jamás
 * implica tocar el compiler, el runtime ni la base de datos. "Otro" ya cubre
 * cualquier negocio no contemplado sin cambiar código.
 */
export interface BusinessTypeOption {
  value: string;
  labelEn: string;
}

export const BUSINESS_TYPE_OPTIONS: BusinessTypeOption[] = [
  { value: "Barbería / Peluquería", labelEn: "Barbershop / Salon" },
  { value: "Salón de belleza / Uñas", labelEn: "Beauty salon / Nails" },
  { value: "Spa / Estética", labelEn: "Spa / Aesthetics" },
  { value: "Consultorio / Clínica", labelEn: "Clinic / Practice" },
  { value: "Fotografía / Estudio", labelEn: "Photography / Studio" },
  { value: "Restaurante", labelEn: "Restaurant" },
  { value: "Tienda / Retail", labelEn: "Store / Retail" },
  { value: "Gimnasio / Fitness", labelEn: "Gym / Fitness" },
  { value: "Servicios profesionales", labelEn: "Professional services" },
  { value: "Educación / Cursos", labelEn: "Education / Courses" },
  { value: BUSINESS_TYPE_OTRO, labelEn: "Other" },
];

/** Horario por defecto: L-V 09:00-18:00 abierto, sábado y domingo cerrados. Índice 0 = domingo. */
export function blankBusinessHours(): BusinessHours {
  const abierto = () => ({ closed: false, intervals: [{ open: "09:00", close: "18:00" }] });
  const cerrado = () => ({ closed: true, intervals: [] as { open: string; close: string }[] });
  return { week: [cerrado(), abierto(), abierto(), abierto(), abierto(), abierto(), cerrado()], exceptions: [] };
}

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

/**
 * Alterna una capacidad y devuelve el form COMPLETO ya actualizado (transición
 * PURA, testeable). "scheduling" es especial: capabilities.scheduling y
 * scheduling.enabled deben coincidir (lo exige el servidor), así que se cambian
 * JUNTOS en una sola actualización. Hacerlo en dos update() encadenados sobre el
 * mismo `form` perdía el primer cambio y el checkbox "Agendar citas" nunca se
 * marcaba (bug real). Al activar scheduling sin proveedor aún, se usa "internal"
 * (proveedor listo por defecto; el usuario puede cambiarlo a Nylas después).
 */
export function toggleCapability(
  form: EditableBusinessAgentSpecForm,
  key: CapabilityKey,
  value: boolean,
): EditableBusinessAgentSpecForm {
  const capabilities = { ...form.capabilities, [key]: value };
  if (key !== "scheduling") return { ...form, capabilities };
  const provider = value && form.scheduling.provider === "none" ? "internal" : form.scheduling.provider;
  return { ...form, capabilities, scheduling: { ...form.scheduling, enabled: value, provider } };
}

/** Validaciones de UX rápidas (no reemplazan al servidor, que es la autoridad real). */
export function localFormIssues(form: EditableBusinessAgentSpecForm, t: (es: string, en: string) => string): string[] {
  const issues: string[] = [];
  if (!form.identity.businessName.trim()) issues.push(t("Falta el nombre del negocio.", "Missing business name."));
  if (!form.identity.agentName.trim()) issues.push(t("Falta el nombre del agente.", "Missing agent name."));
  if (!form.identity.businessType?.trim()) {
    issues.push(t("Falta el tipo de negocio.", "Missing business type."));
  } else if (form.identity.businessType === BUSINESS_TYPE_OTRO && !form.identity.businessTypeCustom?.trim()) {
    issues.push(t("Especifica el tipo de negocio para 'Otro'.", "Specify the business type for 'Other'."));
  }
  if (form.capabilities.sales && !form.capabilities.catalog) issues.push(t("'Cotizar' requiere activar 'Catálogo'.", "'Quote' requires 'Catalog' enabled."));
  if (form.scheduling.enabled !== form.capabilities.scheduling) {
    issues.push(t("El agendamiento y la capacidad 'Agendar citas' deben coincidir.", "Scheduling and the 'Book appointments' capability must match."));
  }
  if (form.scheduling.enabled && form.scheduling.provider === "nylas" && !tieneAlgunHorarioAbierto(form.scheduling.businessHours)) {
    issues.push(t("Configura el horario de atención (al menos un día abierto).", "Set the business hours (at least one open day)."));
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
