// DuLabs Business — Business Agent 2.0, FASE 6 — borrador de la configuración guiada.
//
// Es lo ÚNICO que la persona edita. Está escrito en términos de su negocio ("¿tus clientes reservan citas?"), no del
// sistema: no hay capabilities, ni tenant, ni agente, ni checksum, ni versión de compilador. Puede estar INCOMPLETO
// (autosave), pero siempre acotado y estricto: una clave desconocida (p. ej. tenantId, capabilities) es rechazo.
//
//   borrador → (assemble.ts) → Universal Business Model + Spec del runtime → validación → publicación
//
// El backend es quien deriva todo lo técnico. Un Spec previo (editor avanzado) puede sembrar el borrador para que un
// negocio existente no empiece de cero (draftFromSpec).

import { z } from "zod";
import { AGENT_ENGINES, CUSTOMER_FIELD_TYPES, type AgentTone, type BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { businessHoursSchema, WEEKDAYS, type BusinessHoursModel } from "@/lib/agent-compiler/business-model/schema";
import { DEFAULT_TIMEZONE } from "@/lib/agent-compiler/onboarding/timezones";

export const ONBOARDING_DRAFT_VERSION = "business-agent.onboarding-draft/1" as const;

const text = (max: number) => z.string().max(max);

export const extraFieldSchema = z
  .object({
    /** Lo genera el backend desde la etiqueta; solo se conserva el de un campo que ya existía (continuidad de datos). */
    key: z.string().max(40).optional(),
    label: text(80),
    type: z.enum(CUSTOMER_FIELD_TYPES),
    required: z.boolean(),
    options: z.array(text(60)).max(25).optional(),
  })
  .strict();

export const restrictedTopicSchema = z
  .object({
    /** Palabras o frases (una por entrada). Se comparan con el mensaje del cliente de forma determinista. */
    words: z.array(text(60)).min(1).max(10),
    reply: text(300).optional(),
  })
  .strict();

export const onboardingDraftSchema = z
  .object({
    version: z.literal(ONBOARDING_DRAFT_VERSION),
    business: z
      .object({
        name: text(120).optional(),
        description: text(1000).optional(),
        /** Ayuda inicial / metadato. "Otro" es válido: no cambia lo que el agente hace. */
        category: text(80).optional(),
        assistantName: text(60).optional(),
        timezone: text(64),
      })
      .strict(),
    offer: z
      .object({
        services: z.boolean(),
        products: z.boolean(),
        /** El agente muestra lo que ofreces. */
        showCatalog: z.boolean(),
        /** El agente da precios y cotiza (los calcula el sistema). */
        quotes: z.boolean(),
      })
      .strict(),
    booking: z
      .object({
        enabled: z.boolean(),
        /** calendar = Google Calendar conectado; team = agenda de especialistas en DuLabs. */
        agenda: z.enum(["calendar", "team"]).optional(),
        minimumNoticeMinutes: z.number().int().min(0).max(10_080),
        allowChanges: z.boolean(),
        changesNoticeHours: z.number().int().min(0).max(720),
        /** FASE 8 — personas/sillas/salas entre las que el cliente elige (solo con Google Calendar). Vacío = no se pregunta. */
        resources: z.array(z.object({ name: text(80) }).strict()).max(20).optional(),
        /** FASE 8 — el cliente puede pedir que le recuerden su cita ("recuérdame mañana"). */
        reminders: z.object({ enabled: z.boolean(), offsetMinutes: z.number().int().min(15).max(2880) }).strict().optional(),
      })
      .strict(),
    hours: businessHoursSchema,
    support: z
      .object({
        handoff: z.boolean(),
        pauseHours: z.number().int().min(1).max(720),
        answerQuestions: z.boolean(),
        whenUnknown: z.enum(["say_so", "handoff"]),
        unknownMessage: text(300).optional(),
        whenCannotHelp: z.enum(["offer_person", "inform"]),
      })
      .strict(),
    customerData: z
      .object({
        askName: z.boolean(),
        askEmail: z.boolean(),
        askNotes: z.boolean(),
        extra: z.array(extraFieldSchema).max(10),
        /** FASE 8 — guardar a quien pide que lo contacten (nombre/correo en tus contactos). */
        leadCapture: z.object({ enabled: z.boolean(), captureInterest: z.boolean() }).strict().optional(),
      })
      .strict(),
    /** FASE 8: cuatro tonos (Cercano, Profesional, Casual, Formal). "direct" se conserva para borradores previos. */
    tone: z.enum(["friendly", "professional", "direct", "casual", "formal"]),
    /**
     * FASE 8 — motor que atenderá la versión publicada. Ausente = el de la versión anterior (o el grafo). Solo la
     * persona lo cambia (opt-in explícito); ningún agente cambia de motor solo.
     */
    engine: z.enum(AGENT_ENGINES).optional(),
    restrictedTopics: z.array(restrictedTopicSchema).max(10),
  })
  .strict();

export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;

/** Tono del borrador → tono del motor conversacional (solo estilo). */
export const DRAFT_TONE_TO_AGENT_TONE: Readonly<Record<OnboardingDraft["tone"], AgentTone>> = {
  friendly: "cercano",
  professional: "profesional",
  direct: "profesional",
  casual: "casual",
  formal: "formal",
};

export const DEFAULT_REMINDER_OFFSET_MINUTES = 120;
export type ExtraField = z.infer<typeof extraFieldSchema>;

/** Lunes a viernes 09:00–18:00; sábado y domingo cerrados (se ajusta en el editor). */
export function defaultHours(): BusinessHoursModel {
  const open = () => ({ open: true, intervals: [{ start: "09:00", end: "18:00" }] });
  const closed = () => ({ open: false, intervals: [] as Array<{ start: string; end: string }> });
  return { week: { sunday: closed(), monday: open(), tuesday: open(), wednesday: open(), thursday: open(), friday: open(), saturday: closed() }, exceptions: [] };
}

export function emptyDraft(): OnboardingDraft {
  return {
    version: ONBOARDING_DRAFT_VERSION,
    business: { timezone: DEFAULT_TIMEZONE },
    offer: { services: true, products: false, showCatalog: true, quotes: false },
    booking: { enabled: false, minimumNoticeMinutes: 60, allowChanges: false, changesNoticeHours: 4 },
    hours: defaultHours(),
    support: { handoff: true, pauseHours: 24, answerQuestions: true, whenUnknown: "say_so", whenCannotHelp: "offer_person" },
    customerData: { askName: true, askEmail: false, askNotes: false, extra: [] },
    tone: "friendly",
    restrictedTopics: [],
  };
}

export type DraftParse = { ok: true; draft: OnboardingDraft } | { ok: false; issues: Array<{ path: string; message: string }> };

/** Parse estricto del borrador que manda el navegador (o que se leyó de la base). */
export function parseDraft(raw: unknown): DraftParse {
  const r = onboardingDraftSchema.safeParse(raw);
  if (r.success) return { ok: true, draft: r.data };
  return { ok: false, issues: r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })) };
}

/** Prefijo de las reglas que genera la configuración guiada (las demás son del editor avanzado y se conservan). */
export const ONBOARDING_RULE_PREFIX = "onb-";

/** Siembra el borrador desde el Spec de un agente existente (editor avanzado): nadie empieza de cero. */
export function draftFromSpec(spec: BusinessAgentSpec): OnboardingDraft {
  const d = emptyDraft();
  const caps = spec.capabilities;
  const sched = spec.scheduling;
  const category = spec.identity.businessType === "Otro" ? spec.identity.businessTypeCustom : spec.identity.businessType;
  d.business = {
    name: spec.identity.businessName || undefined,
    ...(spec.identity.description ? { description: spec.identity.description.slice(0, 1000) } : {}),
    ...(category ? { category: category.slice(0, 80) } : {}),
    ...(spec.identity.agentName ? { assistantName: spec.identity.agentName.slice(0, 60) } : {}),
    timezone: spec.identity.timezone || DEFAULT_TIMEZONE,
  };
  d.offer = { services: Boolean(spec.catalog.useServices), products: Boolean(spec.catalog.useProducts), showCatalog: Boolean(caps.catalog), quotes: Boolean(caps.sales) };
  const agenda = sched.provider === "nylas" ? "calendar" : sched.provider === "internal" ? "team" : undefined;
  d.booking = {
    enabled: Boolean(caps.scheduling && sched.enabled),
    ...(agenda ? { agenda } : {}),
    minimumNoticeMinutes: Math.min(10_080, Math.max(0, sched.minNoticeMinutes ?? 60)),
    allowChanges: Boolean(sched.cancellation?.allowed),
    changesNoticeHours: Math.min(720, Math.max(0, sched.cancellation?.minNoticeHours ?? 4)),
  };
  if (sched.businessHours) {
    d.hours = {
      week: Object.fromEntries(WEEKDAYS.map((w, i) => {
        const day = sched.businessHours!.week[i];
        return [w, { open: Boolean(day && !day.closed), intervals: (day?.intervals ?? []).map((iv) => ({ start: iv.open, end: iv.close })) }];
      })) as BusinessHoursModel["week"],
      exceptions: (sched.businessHours.exceptions ?? []).map((e) => ({ date: e.date, open: !e.closed, intervals: e.intervals.map((iv) => ({ start: iv.open, end: iv.close })) })),
    };
  }
  d.support = {
    handoff: Boolean(caps.humanHandoff),
    pauseHours: Math.min(720, Math.max(1, spec.handoff.defaultPauseHours || 24)),
    answerQuestions: Boolean(caps.faq),
    whenUnknown: spec.knowledge.onNoAnswer === "handoff" ? "handoff" : "say_so",
    ...(spec.knowledge.noAnswerMessage?.trim() ? { unknownMessage: spec.knowledge.noAnswerMessage.trim().slice(0, 300) } : {}),
    whenCannotHelp: caps.humanHandoff ? "offer_person" : "inform",
  };
  const fields = spec.customerData?.fields ?? [];
  const on = (k: string) => fields.some((f) => f.key === k && f.enabled);
  d.customerData = {
    askName: on("nombreCliente"),
    askEmail: on("correoCliente"),
    askNotes: on("notas"),
    extra: fields
      .filter((f) => f.enabled && !["nombreCliente", "correoCliente", "notas", "telefonoCliente"].includes(f.key))
      .slice(0, 10)
      .map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, ...(f.options ? { options: f.options } : {}) })),
  };
  d.tone = spec.personality.primary === "professional" || spec.personality.primary === "consultative" ? "professional" : spec.personality.primary === "direct" ? "direct" : "friendly";
  // FASE 8 — configuración del motor conversacional (si la versión la tenía).
  const rt = spec.runtime;
  if (rt?.tone) d.tone = (Object.entries(DRAFT_TONE_TO_AGENT_TONE).find(([k, v]) => v === rt.tone && k !== "direct")?.[0] ?? d.tone) as OnboardingDraft["tone"];
  if (rt?.resources?.length) d.booking.resources = rt.resources.map((r) => ({ name: r.name.slice(0, 80) }));
  if (rt?.reminders) d.booking.reminders = { enabled: rt.reminders.enabled, offsetMinutes: rt.reminders.offsetMinutes };
  if (rt?.leadCapture && caps.leadCapture) d.customerData.leadCapture = { enabled: true, captureInterest: rt.leadCapture.captureInterest };
  if (rt?.engine) d.engine = rt.engine;
  d.restrictedTopics = spec.policies.prohibitions
    .filter((p) => p.id.startsWith(ONBOARDING_RULE_PREFIX) && p.condition)
    .slice(0, 10)
    .map((p) => ({ words: p.condition!.rules.map((r) => String(r.value ?? "")).filter(Boolean).slice(0, 10), ...(p.response ? { reply: p.response } : {}) }))
    .filter((t) => t.words.length > 0);
  return d;
}
