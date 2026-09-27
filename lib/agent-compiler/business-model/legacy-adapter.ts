// DuLabs Business — Business Agent 2.0, FASE 5 — adaptador legacy: BusinessAgentSpec → Universal Business Model.
//
//   Spec legacy → (este adaptador) → UBM → validador → MISMO compilador → artefacto → runtime
//
// No hay dos sistemas: el Spec deja de llegar al runtime conversacional; solo entra por aquí y sale como un modelo más.
// Lo que el Spec tiene y el UBM v1 no representa se registra como nota estructurada (no se pierde en silencio):
// ver LEGACY_NOTE_CODES. El adaptador es puro y determinista.

import type { BusinessAgentSpec, BusinessHours } from "@/lib/agent-compiler/spec/types";
import { BUSINESS_TYPE_OTRO } from "@/lib/agent-compiler/spec/types";
import { KNOWLEDGE_SOURCES } from "@/lib/business-agent-knowledge/limits";
import { DURACION_MIN_DEFAULT } from "@/lib/agent-compiler/calendar/nylas-availability";
import { BUSINESS_MODEL_SCHEMA_VERSION, WEEKDAYS, type BusinessHoursModel, type BusinessModel, type CapabilityEntry, type CustomerFieldModel } from "@/lib/agent-compiler/business-model/schema";

/** El Spec legacy no tiene moneda: todos los negocios actuales operan en Colombia. */
export const LEGACY_DEFAULT_CURRENCY = "COP";

export const LEGACY_NOTE_CODES = [
  "CURRENCY_DEFAULTED",
  "LEAD_CAPTURE_FLOW_ONLY",
  "RESOURCES_NOT_MAPPED",
  "GATE_POLICIES_STAY_IN_GATE",
  "PERSONALITY_NOT_USED_BY_RENDERER",
  "CONFIRMATION_REMINDERS_NOT_MAPPED",
  "CANCELLATION_REQUIRES_CALENDAR",
] as const;
export type LegacyNoteCode = (typeof LEGACY_NOTE_CODES)[number];

export interface LegacyAdapterResult {
  model: BusinessModel;
  notes: Array<{ code: LegacyNoteCode; path: string }>;
}

function hoursToModel(h: BusinessHours | undefined): BusinessHoursModel | null {
  if (!h) return null;
  const week = Object.fromEntries(
    WEEKDAYS.map((d, i) => {
      const day = h.week?.[i];
      return [d, { open: Boolean(day && !day.closed), intervals: (day?.intervals ?? []).map((iv) => ({ start: iv.open, end: iv.close })) }];
    }),
  ) as BusinessHoursModel["week"];
  return { week, exceptions: (h.exceptions ?? []).map((e) => ({ date: e.date, open: !e.closed, intervals: (e.intervals ?? []).map((iv) => ({ start: iv.open, end: iv.close })) })) };
}

/** Horario del UBM → forma que leen los handlers de agenda existentes (week[0 = domingo], {open, close}). */
export function hoursToHandlerFormat(h: BusinessHoursModel): BusinessHours {
  return {
    week: WEEKDAYS.map((d) => ({ closed: !h.week[d].open, intervals: h.week[d].intervals.map((iv) => ({ open: iv.start, close: iv.end })) })),
    exceptions: h.exceptions.map((e) => ({ date: e.date, closed: !e.open, intervals: e.intervals.map((iv) => ({ open: iv.start, close: iv.end })) })),
  };
}

function field(f: NonNullable<BusinessAgentSpec["customerData"]>["fields"][number]): CustomerFieldModel {
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    enabled: f.enabled,
    scope: f.scope,
    ...(f.question !== undefined ? { question: f.question } : {}),
    ...(f.description !== undefined ? { description: f.description } : {}),
    ...(f.options !== undefined ? { options: [...f.options] } : {}),
  };
}

export function legacyModelFromSpec(spec: BusinessAgentSpec): LegacyAdapterResult {
  const caps = spec.capabilities;
  const notes: LegacyAdapterResult["notes"] = [{ code: "CURRENCY_DEFAULTED", path: "identity.currency" }];
  const sched = spec.scheduling;
  const provider = sched?.provider;
  const calendar = provider === "nylas";

  const capabilities: CapabilityEntry[] = [
    {
      id: "knowledge",
      version: "1.0.0",
      enabled: Boolean(caps.faq),
      config: { sources: [...KNOWLEDGE_SOURCES], onNoAnswer: spec.knowledge?.onNoAnswer ?? "message", ...(spec.knowledge?.noAnswerMessage?.trim() ? { noAnswerMessage: spec.knowledge.noAnswerMessage.trim() } : {}) },
    },
    {
      id: "catalog",
      version: "1.0.0",
      enabled: Boolean(caps.catalog),
      // Mismo criterio que compile.ts: sin useServices ni useProducts sigue siendo "servicios".
      config: { includeServices: Boolean(spec.catalog?.useServices || !spec.catalog?.useProducts), includeProducts: Boolean(spec.catalog?.useProducts) },
    },
    { id: "quotes", version: "1.0.0", enabled: Boolean(caps.sales), config: {} },
    {
      id: "booking",
      version: "1.0.0",
      enabled: Boolean(caps.scheduling && sched?.enabled),
      config: {
        // Un provider sin runtime ("none", "google_calendar") queda tal cual: el validador lo rechaza (igual que el Spec).
        provider,
        requiresService: spec.catalog?.useServices !== false,
        slotDurationMinutes: DURACION_MIN_DEFAULT,
        bufferMinutes: 0,
        minimumNoticeMinutes: sched?.minNoticeMinutes ?? 0,
        maximumAdvanceDays: null,
        resourceSelection: "none",
        // En el runtime legacy, cancelar/reprogramar solo se cablean con calendario (Nylas); con agenda interna no.
        cancellation: { allowed: Boolean(sched?.cancellation?.allowed && calendar), minimumNoticeHours: sched?.cancellation?.minNoticeHours ?? 0 },
        rescheduling: { allowed: Boolean(sched?.cancellation?.allowed && calendar) },
      },
    },
    { id: "handoff", version: "1.0.0", enabled: Boolean(caps.humanHandoff), config: { pauseHours: Math.max(1, spec.handoff?.defaultPauseHours ?? 24) } },
    { id: "orders", version: "1.0.0", enabled: Boolean(caps.orders), config: {} },
    { id: "payments", version: "1.0.0", enabled: Boolean(caps.payments), config: {} },
  ];

  if (caps.leadCapture) notes.push({ code: "LEAD_CAPTURE_FLOW_ONLY", path: "capabilities.leadCapture" });
  if ((sched?.resources ?? []).length > 0) notes.push({ code: "RESOURCES_NOT_MAPPED", path: "scheduling.resources" });
  if ((spec.policies?.prohibitions ?? []).length > 0 || (spec.policies?.rules ?? []).length > 0 || (spec.handoff?.rules ?? []).length > 0) {
    notes.push({ code: "GATE_POLICIES_STAY_IN_GATE", path: "policies" });
  }
  notes.push({ code: "PERSONALITY_NOT_USED_BY_RENDERER", path: "personality" });
  if (sched?.confirmation?.required) notes.push({ code: "CONFIRMATION_REMINDERS_NOT_MAPPED", path: "scheduling.confirmation" });
  if (sched?.cancellation?.allowed && !calendar) notes.push({ code: "CANCELLATION_REQUIRES_CALENDAR", path: "scheduling.cancellation" });

  const category = spec.identity.businessType === BUSINESS_TYPE_OTRO ? spec.identity.businessTypeCustom : spec.identity.businessType;
  const model: BusinessModel = {
    schemaVersion: BUSINESS_MODEL_SCHEMA_VERSION,
    identity: {
      name: spec.identity.businessName,
      ...(spec.identity.description?.trim() ? { description: spec.identity.description.trim() } : {}),
      ...(category?.trim() ? { category: category.trim().slice(0, 80) } : {}),
      language: spec.identity.language,
      currency: LEGACY_DEFAULT_CURRENCY,
      timezone: spec.identity.timezone,
    },
    capabilities,
    catalogAuthority: "business_tables",
    services: [],
    products: [],
    resources: [],
    customerFields: (spec.customerData?.fields ?? []).map(field),
    businessHours: hoursToModel(sched?.businessHours),
    policies: { unsupportedRequest: caps.humanHandoff ? "offer_handoff" : "inform_only" },
  };
  return { model, notes };
}
