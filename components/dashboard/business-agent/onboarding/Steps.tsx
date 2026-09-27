"use client";

// Business Agent 2.0, FASE 6 — pasos de configuración: preguntas sobre el NEGOCIO, nunca sobre el sistema. Ningún
// identificador interno llega a la pantalla. Los módulos que editan datos que ya viven en tablas (servicios,
// productos, calendario, preguntas frecuentes) se reutilizan tal cual (entran como `slots`), sin duplicarlos.

import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  OnboardingDraft,
  ExtraField,
} from "@/lib/agent-compiler/onboarding/draft";
import type { OnboardingIssue } from "@/lib/agent-compiler/onboarding/issues";
import { TIMEZONE_OPTIONS } from "@/lib/agent-compiler/onboarding/timezones";
import { BUSINESS_TYPE_OPTIONS } from "@/lib/business-agent-form";
import { BUSINESS_TYPE_OTRO } from "@/lib/agent-compiler/spec/types";
import {
  ChoiceGroup,
  FieldError,
  Question,
  TextField,
  Toggle,
  YesNo,
  inputCls,
  issuesFor,
  secondaryBtn,
} from "@/components/dashboard/business-agent/onboarding/controls";
import { HoursEditor } from "@/components/dashboard/business-agent/onboarding/HoursEditor";

export interface StepProps {
  draft: OnboardingDraft;
  setDraft: (u: (d: OnboardingDraft) => OnboardingDraft) => void;
  issues: readonly OnboardingIssue[];
}

const I = (issues: readonly OnboardingIssue[], field: string) =>
  issuesFor(issues, field);

// ---------------------------------------------------------------------------
// 1. Tu negocio
// ---------------------------------------------------------------------------

export function BusinessStep({ draft, setDraft, issues }: StepProps) {
  const b = draft.business;
  const set = (patch: Partial<OnboardingDraft["business"]>) =>
    setDraft((d) => ({ ...d, business: { ...d.business, ...patch } }));
  const known = BUSINESS_TYPE_OPTIONS.filter(
    (o) => o.value !== BUSINESS_TYPE_OTRO,
  ).map((o) => o.value);
  const isOther =
    b.category !== undefined &&
    b.category !== "" &&
    !known.includes(b.category);
  const tzInList = TIMEZONE_OPTIONS.some((t) => t.iana === b.timezone);
  return (
    <div className="space-y-7">
      <TextField
        label="¿Cómo se llama tu negocio?"
        required
        value={b.name ?? ""}
        onChange={(v) => set({ name: v })}
        maxLength={120}
        placeholder="Ej.: Barbería Norte"
        issues={I(issues, "business.name")}
      />
      <TextField
        label="¿A qué se dedica tu negocio?"
        multiline
        value={b.description ?? ""}
        onChange={(v) => set({ description: v })}
        maxLength={1000}
        hint="Opcional. Una o dos frases; tu agente la usa para presentarse. Las reglas y lo que puede hacer se configuran en los siguientes pasos."
        issues={I(issues, "business.description")}
      />
      <div className="space-y-2">
        <ChoiceGroup
          label="¿Qué tipo de negocio es? (opcional, es solo una referencia)"
          variant="chips"
          value={isOther ? BUSINESS_TYPE_OTRO : b.category}
          onChange={(v) => set({ category: v === BUSINESS_TYPE_OTRO ? "" : v })}
          options={BUSINESS_TYPE_OPTIONS.map((o) => ({
            value: o.value,
            title: o.value,
          }))}
        />
        {(isOther || b.category === "") && (
          <TextField
            label="Cuéntanos en pocas palabras"
            value={b.category ?? ""}
            onChange={(v) => set({ category: v })}
            maxLength={80}
            placeholder="Ej.: Taller de bicicletas"
          />
        )}
      </div>
      <TextField
        label="¿Cómo quieres que se llame tu asistente?"
        value={b.assistantName ?? ""}
        onChange={(v) => set({ assistantName: v })}
        maxLength={60}
        hint={`Opcional. Si lo dejas vacío: "Asistente de ${b.name?.trim() || "tu negocio"}".`}
      />
      <div>
        <label
          htmlFor="onb-tz"
          className="mb-1.5 block text-sm font-medium text-fg"
        >
          ¿Dónde está tu negocio?
        </label>
        <select
          id="onb-tz"
          className={inputCls}
          value={b.timezone}
          onChange={(e) => set({ timezone: e.target.value })}
          aria-describedby="onb-tz-hint"
        >
          {!tzInList && <option value={b.timezone}>{b.timezone}</option>}
          {TIMEZONE_OPTIONS.map((t) => (
            <option key={t.iana} value={t.iana}>
              {t.label}
            </option>
          ))}
        </select>
        <p id="onb-tz-hint" className="mt-1 text-xs text-mist">
          Tu agente usa la hora de esta ciudad para fechas y horarios.
        </p>
        <FieldError id="onb-tz-err" issues={I(issues, "business.timezone")} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Lo que ofreces
// ---------------------------------------------------------------------------

export function OfferStep({
  draft,
  setDraft,
  issues,
  servicesSlot,
  productsSlot,
}: StepProps & { servicesSlot?: ReactNode; productsSlot?: ReactNode }) {
  const o = draft.offer;
  const set = (patch: Partial<OnboardingDraft["offer"]>) =>
    setDraft((d) => ({ ...d, offer: { ...d.offer, ...patch } }));
  const kind =
    o.services && o.products
      ? "both"
      : o.products
        ? "products"
        : o.services
          ? "services"
          : undefined;
  return (
    <div className="space-y-7">
      <Question title="¿Qué ofreces a tus clientes?">
        <ChoiceGroup
          label="¿Qué ofreces a tus clientes?"
          hideLabel
          value={kind}
          onChange={(v) =>
            set({ services: v !== "products", products: v !== "services" })
          }
          issues={I(issues, "offer.services")}
          options={[
            {
              value: "services",
              title: "Servicios",
              description: "Cortes, consultas, clases, sesiones…",
            },
            {
              value: "products",
              title: "Productos",
              description: "Cosas que vendes.",
            },
            {
              value: "both",
              title: "Ambos",
              description: "Servicios y productos.",
            },
          ]}
        />
      </Question>
      <Question
        title="¿Tu agente puede mostrarle a tus clientes lo que ofreces?"
        hint="Muestra solo lo que tienes registrado, con tus precios reales."
      >
        <YesNo
          label="Mostrar lo que ofreces"
          value={o.showCatalog}
          onChange={(v) =>
            set({ showCatalog: v, quotes: v ? o.quotes : false })
          }
        />
      </Question>
      <Question
        title="¿Puede dar precios y cotizar?"
        hint="El sistema calcula el total con tus precios; tu agente no cobra ni toma pedidos."
      >
        <YesNo
          label="Dar precios y cotizar"
          value={o.quotes}
          onChange={(v) => set({ quotes: v })}
          disabledYes={!o.showCatalog}
          yesHint={
            o.showCatalog ? undefined : "Primero activa mostrar lo que ofreces."
          }
          issues={I(issues, "offer.quotes")}
        />
      </Question>
      {o.services && servicesSlot && (
        <Question
          title="Tus servicios"
          hint="Se guardan al instante y son los mismos que usa todo tu dashboard."
        >
          {servicesSlot}
        </Question>
      )}
      {o.products && productsSlot && (
        <Question
          title="Tus productos"
          hint="Se guardan al instante y son los mismos que usa todo tu dashboard."
        >
          {productsSlot}
        </Question>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Citas
// ---------------------------------------------------------------------------

const NOTICE = [
  { value: "0", title: "Sin mínimo" },
  { value: "30", title: "30 minutos" },
  { value: "60", title: "1 hora" },
  { value: "120", title: "2 horas" },
  { value: "1440", title: "1 día" },
];
const CHANGE_NOTICE = [
  { value: "0", title: "Hasta la hora de la cita" },
  { value: "2", title: "2 horas antes" },
  { value: "4", title: "4 horas antes" },
  { value: "24", title: "1 día antes" },
];

export function BookingStep({
  draft,
  setDraft,
  issues,
  calendarSlot,
}: StepProps & { calendarSlot?: ReactNode }) {
  const b = draft.booking;
  const set = (patch: Partial<OnboardingDraft["booking"]>) =>
    setDraft((d) => ({ ...d, booking: { ...d.booking, ...patch } }));
  const withCurrent = (opts: typeof NOTICE, v: number, suffix: string) =>
    opts.some((o) => o.value === String(v))
      ? opts
      : [...opts, { value: String(v), title: `${v} ${suffix}` }];
  return (
    <div className="space-y-7">
      <Question title="¿Tus clientes pueden reservar citas por WhatsApp?">
        <YesNo
          label="Reservar citas"
          value={b.enabled}
          onChange={(v) => set({ enabled: v })}
          yesHint="Tu agente agenda con tu disponibilidad real."
          noHint="Tu agente no ofrecerá citas."
          issues={I(issues, "booking.enabled")}
        />
      </Question>
      {b.enabled && (
        <>
          <Question title="¿Dónde llevas tu agenda?">
            <ChoiceGroup
              label="¿Dónde llevas tu agenda?"
              hideLabel
              value={b.agenda}
              onChange={(v) =>
                set({
                  agenda: v,
                  allowChanges: v === "calendar" ? b.allowChanges : false,
                })
              }
              issues={I(issues, "booking.agenda")}
              options={[
                {
                  value: "calendar",
                  title: "Google Calendar",
                  description: "Revisa tu calendario y crea el evento.",
                },
                {
                  value: "team",
                  title: "Agenda de mi equipo en DuLabs",
                  description: "Con los horarios de tu equipo en DuLabs.",
                },
              ]}
            />
            {b.agenda === "calendar" && calendarSlot}
          </Question>
          <Question title="¿Con cuánta anticipación mínima se puede reservar?">
            <ChoiceGroup
              label="Anticipación mínima"
              hideLabel
              variant="chips"
              value={String(b.minimumNoticeMinutes)}
              onChange={(v) => set({ minimumNoticeMinutes: Number(v) })}
              options={withCurrent(NOTICE, b.minimumNoticeMinutes, "min")}
            />
          </Question>
          {b.agenda === "calendar" && (
            <Question title="¿Pueden cancelar o cambiar su cita por WhatsApp?">
              <YesNo
                label="Cancelar o cambiar citas"
                value={b.allowChanges}
                onChange={(v) => set({ allowChanges: v })}
                issues={I(issues, "booking.allowChanges")}
              />
              {b.allowChanges && (
                <ChoiceGroup
                  label="¿Hasta cuándo?"
                  variant="chips"
                  value={String(b.changesNoticeHours)}
                  onChange={(v) => set({ changesNoticeHours: Number(v) })}
                  options={withCurrent(
                    CHANGE_NOTICE,
                    b.changesNoticeHours,
                    "horas antes",
                  )}
                />
              )}
            </Question>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Horario
// ---------------------------------------------------------------------------

export function HoursStep({ draft, setDraft, issues }: StepProps) {
  const needed = draft.booking.enabled && draft.booking.agenda === "calendar";
  return (
    <div className="space-y-4">
      <p className="rounded-2xl border border-edge bg-ink-2 p-4 text-sm text-mist">
        {needed
          ? "Tu agente solo ofrece y reserva citas dentro de este horario."
          : "Solo se usa para reservar citas con tu calendario. Puedes dejarlo listo para cuando lo actives."}
      </p>
      <FieldError
        id="hours-general"
        issues={issues.filter((i) => i.field === "hours")}
      />
      <HoursEditor
        hours={draft.hours}
        onChange={(h) => setDraft((d) => ({ ...d, hours: h }))}
        issues={issues}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Atención
// ---------------------------------------------------------------------------

const FIELD_TYPES: Array<{ value: ExtraField["type"]; label: string }> = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Fecha" },
  { value: "time", label: "Hora" },
  { value: "select", label: "Lista de opciones" },
  { value: "boolean", label: "Sí / No" },
  { value: "email", label: "Correo" },
  { value: "phone", label: "Teléfono" },
];

export function SupportStep({
  draft,
  setDraft,
  issues,
  knowledgeSlot,
}: StepProps & { knowledgeSlot?: ReactNode }) {
  const s = draft.support;
  const set = (patch: Partial<OnboardingDraft["support"]>) =>
    setDraft((d) => ({ ...d, support: { ...d.support, ...patch } }));
  const cd = draft.customerData;
  const setCd = (patch: Partial<OnboardingDraft["customerData"]>) =>
    setDraft((d) => ({ ...d, customerData: { ...d.customerData, ...patch } }));
  const setExtra = (i: number, patch: Partial<ExtraField>) =>
    setCd({
      extra: cd.extra.map((e, k) => (k === i ? { ...e, ...patch } : e)),
    });
  return (
    <div className="space-y-8">
      <Question
        title="¿Alguien de tu equipo puede atender cuando el cliente lo pida?"
        hint="El agente pasa la conversación y se pausa en ese chat."
      >
        <YesNo
          label="Pasar a una persona"
          value={s.handoff}
          onChange={(v) =>
            set({
              handoff: v,
              whenCannotHelp: v ? s.whenCannotHelp : "inform",
              whenUnknown: v ? s.whenUnknown : "say_so",
            })
          }
        />
        {s.handoff && (
          <ChoiceGroup
            label="¿Cuánto tiempo se pausa tu agente en esa conversación?"
            variant="chips"
            value={String(s.pauseHours)}
            onChange={(v) => set({ pauseHours: Number(v) })}
            options={[1, 4, 12, 24, 48]
              .concat(
                [1, 4, 12, 24, 48].includes(s.pauseHours) ? [] : [s.pauseHours],
              )
              .map((h) => ({
                value: String(h),
                title: h === 1 ? "1 hora" : `${h} horas`,
              }))}
          />
        )}
      </Question>
      <Question title="¿Qué quieres hacer cuando el agente no pueda ayudar?">
        <ChoiceGroup
          label="Cuando no pueda ayudar"
          hideLabel
          value={s.whenCannotHelp}
          onChange={(v) => set({ whenCannotHelp: v })}
          issues={I(issues, "support.whenCannotHelp")}
          options={[
            {
              value: "offer_person",
              title: "Ofrecer hablar con una persona",
              disabled: !s.handoff,
              description: s.handoff
                ? undefined
                : "Activa primero que tu equipo pueda atender.",
            },
            { value: "inform", title: "Informar que no puede ayudar por aquí" },
          ]}
        />
      </Question>
      <Question
        title="¿Tu agente responde preguntas con la información de tu negocio?"
        hint="Usa tus preguntas frecuentes y documentos. Nunca inventa."
      >
        <YesNo
          label="Responder preguntas"
          value={s.answerQuestions}
          onChange={(v) => set({ answerQuestions: v })}
        />
        {s.answerQuestions && knowledgeSlot}
        <FieldError
          id="support-unknown-err"
          issues={I(issues, "support.whenUnknown")}
        />
      </Question>
      {!draft.booking.enabled ? (
        <Question title="¿Qué datos necesitas de tus clientes?">
          <p className="rounded-2xl border border-edge bg-ink-2 p-4 text-sm text-mist">
            Tu agente pide datos del cliente para agendar citas. Si activas las
            citas, aquí eliges cuáles.
          </p>
        </Question>
      ) : (
        <Question
          title="¿Qué datos necesitas de tus clientes?"
          hint="Tu agente los pide antes de agendar. El teléfono ya lo tiene por WhatsApp."
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <Toggle
              label="Nombre"
              checked={cd.askName}
              onChange={(v) => setCd({ askName: v })}
            />
            <Toggle
              label="Correo"
              checked={cd.askEmail}
              onChange={(v) => setCd({ askEmail: v })}
            />
            <Toggle
              label="Notas"
              hint="Opcional para el cliente."
              checked={cd.askNotes}
              onChange={(v) => setCd({ askNotes: v })}
            />
          </div>
          <ul className="space-y-3">
            {cd.extra.map((e, i) => (
              <li
                key={i}
                className="space-y-3 rounded-2xl border border-edge bg-ink p-4"
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                  <TextField
                    label="¿Qué dato?"
                    value={e.label}
                    onChange={(v) => setExtra(i, { label: v })}
                    maxLength={80}
                    placeholder="Ej.: Número de personas"
                    issues={I(issues, `customerData.extra.${i}`)}
                  />
                  <div>
                    <label
                      htmlFor={`extra-type-${i}`}
                      className="mb-1.5 block text-sm font-medium text-fg"
                    >
                      Tipo de respuesta
                    </label>
                    <select
                      id={`extra-type-${i}`}
                      className={inputCls}
                      value={e.type}
                      onChange={(ev) =>
                        setExtra(i, {
                          type: ev.target.value as ExtraField["type"],
                        })
                      }
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {e.type === "select" && (
                  <TextField
                    label="Opciones (separadas por coma)"
                    value={(e.options ?? []).join(", ")}
                    onChange={(v) =>
                      setExtra(i, {
                        options: v
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean)
                          .slice(0, 25),
                      })
                    }
                    placeholder="Ej.: S, M, L"
                  />
                )}
                <div className="flex items-center justify-between gap-3">
                  <Toggle
                    label="Obligatorio"
                    checked={e.required}
                    onChange={(v) => setExtra(i, { required: v })}
                  />
                  <button
                    type="button"
                    className={secondaryBtn}
                    onClick={() =>
                      setCd({ extra: cd.extra.filter((_, k) => k !== i) })
                    }
                    aria-label={`Quitar el dato ${e.label || i + 1}`}
                  >
                    <Trash2 className="size-4" /> Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {cd.extra.length < 10 && (
            <button
              type="button"
              className={secondaryBtn}
              onClick={() =>
                setCd({
                  extra: [
                    ...cd.extra,
                    { label: "", type: "text", required: false },
                  ],
                })
              }
            >
              <Plus className="size-4" /> Pedir otro dato
            </button>
          )}
        </Question>
      )}
      <Question title="¿Cómo quieres que hable tu agente?">
        <ChoiceGroup
          label="Tono"
          hideLabel
          value={draft.tone}
          onChange={(v) => setDraft((d) => ({ ...d, tone: v }))}
          options={[
            {
              value: "friendly",
              title: "Cercano",
              description: "Amable y conversacional.",
            },
            {
              value: "professional",
              title: "Profesional",
              description: "Formal y preciso.",
            },
            {
              value: "direct",
              title: "Directo",
              description: "Breve y al punto.",
            },
          ]}
        />
      </Question>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Reglas
// ---------------------------------------------------------------------------

export function RulesStep({ draft, setDraft, issues }: StepProps) {
  const topics = draft.restrictedTopics;
  const setTopics = (t: OnboardingDraft["restrictedTopics"]) =>
    setDraft((d) => ({ ...d, restrictedTopics: t }));
  return (
    <div className="space-y-6">
      <Question
        title="¿De qué temas tu agente nunca debe hablar?"
        hint="Si el cliente menciona alguna de estas palabras, tu agente responde tu mensaje y no sigue con el tema."
      >
        <ul className="space-y-3">
          {topics.map((t, i) => (
            <li
              key={i}
              className="space-y-3 rounded-2xl border border-edge bg-ink p-4"
            >
              <TextField
                label="Palabras o frases (separadas por coma)"
                value={t.words.join(", ")}
                onChange={(v) =>
                  setTopics(
                    topics.map((x, k) =>
                      k === i
                        ? {
                            ...x,
                            words: v
                              .split(",")
                              .map((w) => w.trimStart())
                              .slice(0, 10),
                          }
                        : x,
                    ),
                  )
                }
                placeholder="Ej.: política, religión"
                issues={I(issues, `restrictedTopics.${i}`)}
              />
              <TextField
                label="¿Qué responde tu agente?"
                value={t.reply ?? ""}
                onChange={(v) =>
                  setTopics(
                    topics.map((x, k) => (k === i ? { ...x, reply: v } : x)),
                  )
                }
                maxLength={300}
                placeholder="Prefiero no hablar de ese tema. ¿Te ayudo con algo más?"
              />
              <button
                type="button"
                className={secondaryBtn}
                onClick={() => setTopics(topics.filter((_, k) => k !== i))}
                aria-label={`Quitar el tema ${i + 1}`}
              >
                <Trash2 className="size-4" /> Quitar
              </button>
            </li>
          ))}
        </ul>
        {topics.length < 10 && (
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => setTopics([...topics, { words: [""] }])}
          >
            <Plus className="size-4" /> Agregar tema
          </button>
        )}
        {topics.length === 0 && (
          <p className="text-sm text-mist">
            No tienes temas restringidos. Es opcional.
          </p>
        )}
      </Question>
    </div>
  );
}
