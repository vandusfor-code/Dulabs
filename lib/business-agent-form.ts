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
  CustomerDataConfig,
  CustomerField,
  HandoffConfig,
  HandoffRule,
  KnowledgeConfig,
  PoliciesConfig,
  Prohibition,
  SchedulingConfig,
} from "@/lib/agent-compiler/spec/types";
import { BUSINESS_TYPE_OTRO, type BusinessHours } from "@/lib/agent-compiler/spec/types";
import { tieneAlgunHorarioAbierto } from "@/lib/business-hours";
import { WELL_KNOWN_FIELDS, activeFields, isChannelSourced, validateCustomerFieldsConfig } from "@/lib/customer-data";
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
  /** Datos que el agente captura del cliente (R3). Ausente en borradores previos = sin datos configurados. */
  customerData?: CustomerDataConfig;
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
    customerData: { fields: [] },
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

/** Campo con significado fijo en el sistema (nombre/teléfono/correo/notas), listo para agregar al wizard. */
export function wellKnownCustomerField(key: keyof typeof WELL_KNOWN_FIELDS & string): CustomerField {
  const known = WELL_KNOWN_FIELDS[key]!;
  return {
    key,
    label: known.label,
    type: known.type,
    required: key === "nombreCliente" || key === "telefonoCliente",
    enabled: true,
    scope: key === "notas" ? "booking" : "customer",
  };
}

/** Campo personalizado en blanco (la clave la deriva la UI de la etiqueta). */
export function blankCustomerField(existingKeys: readonly string[]): CustomerField {
  let n = existingKeys.length + 1;
  while (existingKeys.includes(`campo_${n}`)) n += 1;
  return { key: `campo_${n}`, label: "", type: "text", required: false, enabled: true, scope: "customer" };
}

/** Conjunto recomendado para agendar: nombre (obligatorio) + teléfono tomado del canal. */
export function recommendedBookingFields(): CustomerField[] {
  return [wellKnownCustomerField("nombreCliente"), wellKnownCustomerField("telefonoCliente")];
}

/** Clave técnica a partir de una etiqueta ("Edad del paciente" -> "edad_del_paciente"). */
export function slugifyFieldKey(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40);
  return base;
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
  // response por defecto: el cliente SIEMPRE debe recibir un mensaje al
  // transferir (sin él la transferencia pausa la IA en silencio). El usuario
  // puede editarlo en el Wizard.
  return {
    id: newRuleId("handoff"),
    description: "",
    trigger: { kind: "agent_request" },
    action: "TRANSFER_HUMAN",
    response: "Con gusto te comunico con una persona del equipo. En un momento te responden. 🙌",
  };
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
  if (key === "catalog") {
    if (!value) {
      // Sin catálogo no hay qué cotizar (sales requiere catalog) y las banderas del catálogo no pueden quedar activas.
      return { ...form, capabilities: { ...capabilities, sales: false }, catalog: { ...form.catalog, useServices: false, useProducts: false } };
    }
    // Al activarlo, si no eligió qué catálogo usar, el predeterminado es SERVICIOS (mismo comportamiento de siempre).
    const sinElegir = !form.catalog.useServices && !form.catalog.useProducts;
    return { ...form, capabilities, catalog: sinElegir ? { ...form.catalog, useServices: true } : form.catalog };
  }
  if (key !== "scheduling") return { ...form, capabilities };
  const provider = value && form.scheduling.provider === "none" ? "internal" : form.scheduling.provider;
  return { ...form, capabilities, scheduling: { ...form.scheduling, enabled: value, provider } };
}

// ---------------------------------------------------------------------------
// Wizard dinámico: qué módulos aparecen según las capacidades elegidas (PURO, testeable).
// ---------------------------------------------------------------------------

export type WizardStepId =
  | "tipo" | "personalidad" | "capacidades" | "servicios" | "agendamiento" | "horarios" | "datos" | "conocimiento" | "reglas" | "handoff" | "revisar";

/** Servicios en el catálogo: explícito, o el predeterminado de Specs previos (ni servicios ni productos elegidos). */
export function catalogUsesServices(c: EditableBusinessAgentSpecForm["catalog"]): boolean {
  return c.useServices || !c.useProducts;
}

/** El paso Servicios se pide si el agente agenda (duración/precio) o muestra servicios en el catálogo. */
export function needsServicesModule(form: EditableBusinessAgentSpecForm): boolean {
  return form.capabilities.scheduling || (form.capabilities.catalog && catalogUsesServices(form.catalog));
}

export function needsProductsModule(form: EditableBusinessAgentSpecForm): boolean {
  return form.capabilities.catalog && form.catalog.useProducts;
}

/**
 * Orden de pasos del Wizard: cada módulo aparece SOLO si su capacidad está seleccionada (sin pasos de relleno).
 * Identidad, capacidades, reglas y revisión son siempre parte del flujo.
 */
export function wizardStepOrder(form: EditableBusinessAgentSpecForm): WizardStepId[] {
  const c = form.capabilities;
  const steps: WizardStepId[] = ["tipo", "personalidad", "capacidades"];
  if (needsServicesModule(form) || needsProductsModule(form)) steps.push("servicios");
  if (c.scheduling) steps.push("agendamiento", "horarios");
  if (c.leadCapture || c.scheduling) steps.push("datos");
  if (c.faq) steps.push("conocimiento");
  steps.push("reglas");
  if (c.humanHandoff) steps.push("handoff");
  steps.push("revisar");
  return steps;
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
  if (form.capabilities.catalog && !form.catalog.useServices && !form.catalog.useProducts) {
    issues.push(t("Elige qué muestra el catálogo: servicios y/o productos.", "Choose what the catalog shows: services and/or products."));
  }
  if ((form.catalog.useServices || form.catalog.useProducts) && !form.capabilities.catalog) {
    issues.push(t("El catálogo está configurado pero la capacidad 'Catálogo' está apagada.", "Catalog is configured but the 'Catalog' capability is off."));
  }
  const usaTransferencia = form.handoff.rules.length > 0 || form.policies.prohibitions.some((p) => p.action === "TRANSFER_HUMAN");
  if (usaTransferencia && !form.capabilities.humanHandoff) {
    issues.push(t("Hay reglas de transferencia a humano pero 'Transferir a humano' está apagada.", "There are human-transfer rules but 'Human handoff' is off."));
  }
  issues.push(...customerDataIssues(form, t));
  if (form.knowledge.onNoAnswer === "handoff" && !form.capabilities.humanHandoff) {
    issues.push(t("'Transferir cuando no hay información' requiere 'Transferir a un humano'.", "'Transfer when there is no information' requires 'Human handoff'."));
  }
  return issues;
}

/**
 * Validaciones de UX de los datos del cliente (espejo de spec/validate.ts, que es
 * la autoridad real). Devuelve mensajes para mostrar en el módulo y en Revisar.
 */
export function customerDataIssues(form: EditableBusinessAgentSpecForm, t: (es: string, en: string) => string): string[] {
  const campos = form.customerData?.fields ?? [];
  if (campos.length === 0) return [];
  const issues: string[] = validateCustomerFieldsConfig(campos).map((i) => i.message);
  const activos = activeFields(campos);
  if (activos.length === 0) return issues;
  if (!form.capabilities.leadCapture && !form.capabilities.scheduling) {
    issues.push(t("Los datos del cliente requieren 'Captar datos del cliente' o 'Agendar citas'.", "Customer data requires 'Capture customer data' or 'Book appointments'."));
  }
  if (activos.some((f) => f.scope === "booking") && !form.capabilities.scheduling) {
    issues.push(t("Los datos de la reserva requieren 'Agendar citas'.", "Booking data requires 'Book appointments'."));
  }
  if (form.capabilities.scheduling && !activos.some((f) => f.key === "nombreCliente" && f.required)) {
    issues.push(t("Con agendamiento, el Nombre debe estar entre los datos y ser obligatorio.", "With scheduling, the Name must be included and required."));
  }
  return issues;
}

/** Campos que el agente PREGUNTARÁ (activos y no tomados del canal), en orden. */
export function fieldsAgentWillAsk(form: EditableBusinessAgentSpecForm): CustomerField[] {
  return activeFields(form.customerData?.fields).filter((f) => !isChannelSourced(f.key));
}

/**
 * Limpia el form justo antes de enviarlo al servidor: los editores dejan estados
 * intermedios (opciones vacías, textos en blanco) que el schema estricto rechazaría.
 * Función PURA -- no muta el form original.
 */
export function normalizeFormForSave(input: EditableBusinessAgentSpecForm): EditableBusinessAgentSpecForm {
  // R4: un mensaje "sin información" vacío o con espacios se limpia (vacío = el mensaje estándar del sistema).
  let form = input;
  const bruto = input.knowledge.noAnswerMessage;
  if (bruto !== undefined && bruto !== bruto.trim()) {
    const { noAnswerMessage: _omit, ...resto } = input.knowledge;
    void _omit;
    form = { ...input, knowledge: bruto.trim() ? { ...resto, noAnswerMessage: bruto.trim() } : resto };
  } else if (bruto === "") {
    const { noAnswerMessage: _omit, ...resto } = input.knowledge;
    void _omit;
    form = { ...input, knowledge: resto };
  }
  // R6: un catálogo activo sin fuente elegida (Specs previos) significa SERVICIOS: se hace explícito (misma semántica).
  if (form.capabilities.catalog && !form.catalog.useServices && !form.catalog.useProducts) {
    form = { ...form, catalog: { ...form.catalog, useServices: true } };
  }
  const campos = form.customerData?.fields;
  if (!campos) return form;
  const limpios: CustomerField[] = campos.map((f) => {
    const { question, description, options, ...resto } = f;
    return {
      ...resto,
      key: f.key.trim(),
      label: f.label.trim(),
      ...(question?.trim() ? { question: question.trim() } : {}),
      ...(description?.trim() ? { description: description.trim() } : {}),
      ...(f.type === "select" ? { options: (options ?? []).map((o) => o.trim()).filter(Boolean) } : {}),
    };
  });
  return { ...form, customerData: { fields: limpios } };
}
