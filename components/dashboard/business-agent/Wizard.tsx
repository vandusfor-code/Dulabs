"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  BUSINESS_TYPE_OPTIONS,
  blankHandoffRule,
  blankProhibition,
  blankRule,
  blankSpecForm,
  localFormIssues,
  toggleCapability,
  type EditableBusinessAgentSpecForm,
} from "@/lib/business-agent-form";
import { BUSINESS_TYPE_OTRO } from "@/lib/agent-compiler/spec/types";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/lib/agent-compiler/spec/capabilities";
import { ServicesModule } from "@/components/dashboard/business-agent/ServicesModule";
import type { HandoffTriggerKind, ProhibitionAction, RuleKind } from "@/lib/agent-compiler/spec/types";
import { actionBtn, Field, inputCls, IssuesList, primaryBtn, SectionCard, ToggleRow } from "@/components/dashboard/business-agent/ui";
import type { CompilerDiagnostic } from "@/lib/agent-compiler/diagnostics";

const CAPABILITY_LABELS: Record<CapabilityKey, { es: string; en: string; hintEs: string; hintEn: string }> = {
  faq: { es: "Responder preguntas frecuentes", en: "Answer FAQs", hintEs: "Usa la base de conocimiento como apoyo (nunca como autoridad de precios).", hintEn: "Uses the knowledge base as support (never as pricing authority)." },
  sales: { es: "Cotizar / vender", en: "Quote / sell", hintEs: "Requiere Catálogo activo.", hintEn: "Requires Catalog enabled." },
  catalog: { es: "Mostrar catálogo", en: "Show catalog", hintEs: "Servicios/productos reales, nunca inventados por el modelo.", hintEn: "Real services/products, never invented by the model." },
  leadCapture: { es: "Captar datos del cliente", en: "Capture customer data", hintEs: "Nombre, teléfono, necesidad.", hintEn: "Name, phone, need." },
  scheduling: { es: "Agendar citas", en: "Book appointments", hintEs: "Contra el calendario real, con confirmación crítica.", hintEn: "Against the real calendar, with critical confirmation." },
  orders: { es: "Tomar pedidos", en: "Take orders", hintEs: "Todavía no disponible en el Runtime.", hintEn: "Not available in the Runtime yet." },
  payments: { es: "Cobrar", en: "Charge payments", hintEs: "Todavía no disponible en el Runtime.", hintEn: "Not available in the Runtime yet." },
  humanHandoff: { es: "Transferir a un humano", en: "Transfer to a human", hintEs: "Handoff determinista, nunca lo decide el modelo solo.", hintEn: "Deterministic handoff, never decided by the model alone." },
};

const PROHIBITION_ACTIONS: { value: ProhibitionAction; es: string; en: string }[] = [
  { value: "BLOCK", es: "Bloquear (sin respuesta)", en: "Block (no reply)" },
  { value: "FIXED_RESPONSE", es: "Responder con texto fijo", en: "Reply with fixed text" },
  { value: "TRANSFER_HUMAN", es: "Transferir a humano", en: "Transfer to human" },
];

const RULE_KINDS: { value: RuleKind; es: string; en: string }[] = [
  { value: "informative", es: "Informativa", en: "Informative" },
  { value: "reminder", es: "Recordatorio", en: "Reminder" },
  { value: "requirement", es: "Requisito", en: "Requirement" },
  { value: "validation", es: "Validación", en: "Validation" },
  { value: "precondition", es: "Precondición", en: "Precondition" },
];

const HANDOFF_TRIGGERS: { value: HandoffTriggerKind; es: string; en: string }[] = [
  { value: "agent_request", es: "El cliente lo pide", en: "Customer asks for it" },
  { value: "complaint", es: "Queja", en: "Complaint" },
  { value: "discount_request", es: "Pide descuento", en: "Asks for a discount" },
  { value: "keyword", es: "Palabra clave", en: "Keyword" },
  { value: "intent", es: "Intención detectada", en: "Detected intent" },
];

export type WizardStep = "tipo" | "personalidad" | "capacidades" | "agendamiento" | "servicios" | "reglas" | "handoff" | "revisar";

export interface WizardProps {
  form: EditableBusinessAgentSpecForm;
  onChange: (form: EditableBusinessAgentSpecForm) => void;
  diagnostics: CompilerDiagnostic[];
  saving: boolean;
  onSaveDraft: () => void;
  saveError: string | null;
}

function diagnosticText(d: CompilerDiagnostic): string {
  const prefix = d.severity === "error" ? "✕" : d.severity === "warning" ? "⚠" : "ℹ";
  return `${prefix} ${d.message}${d.path ? ` (${d.path})` : ""}`;
}

export function BusinessAgentWizard({ form, onChange, diagnostics, saving, onSaveDraft, saveError }: WizardProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<WizardStep>("tipo");
  // Orden de pasos DINÁMICO: los módulos aparecen según las capacidades. Primer
  // paso hacia el configurador dinámico -- "servicios" solo se pide si el agente
  // usa catálogo o agendamiento (precio/duración estructurados).
  const stepOrder = useMemo<WizardStep[]>(() => {
    const steps: WizardStep[] = ["tipo", "personalidad", "capacidades", "agendamiento"];
    if (form.capabilities.catalog || form.capabilities.scheduling) steps.push("servicios");
    steps.push("reglas", "handoff", "revisar");
    return steps;
  }, [form.capabilities.catalog, form.capabilities.scheduling]);
  const stepIndex = Math.max(0, stepOrder.indexOf(step));
  useEffect(() => {
    // Si el paso actual dejó de existir (se desactivó su capacidad), vuelve a uno válido.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!stepOrder.includes(step)) setStep(stepOrder[0]!);
  }, [stepOrder, step]);

  const localIssues = useMemo(() => localFormIssues(form, t), [form, t]);
  // El paso 1 (tipo de negocio) exige un tipo; con "Otro", además el texto libre.
  const step1Invalid =
    !form.identity.businessType?.trim() ||
    (form.identity.businessType === BUSINESS_TYPE_OTRO && !form.identity.businessTypeCustom?.trim());
  const errorDiagnostics = diagnostics.filter((d) => d.severity === "error");
  const warningDiagnostics = diagnostics.filter((d) => d.severity === "warning");

  function update<K extends keyof EditableBusinessAgentSpecForm>(key: K, value: EditableBusinessAgentSpecForm[K]) {
    onChange({ ...form, [key]: value });
  }

  function goto(next: WizardStep) {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-52 lg:flex-col lg:overflow-visible">
        {stepOrder.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => goto(s)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
              s === step ? "bg-lime/12 text-lime-text" : "text-mist hover:bg-card hover:text-fg"
            }`}
          >
            <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${s === step ? "bg-lime text-lime-fg" : "bg-ink text-mist"}`}>
              {i + 1}
            </span>
            {STEP_LABEL(s, t)}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        {step === "tipo" && <StepTipoIdentidad form={form} onChange={onChange} />}
        {step === "personalidad" && <StepPersonalidad form={form} update={update} />}
        {step === "capacidades" && <StepCapacidades form={form} update={update} onChange={onChange} />}
        {step === "agendamiento" && <StepAgendamiento form={form} update={update} />}
        {step === "servicios" && <ServicesModule />}
        {step === "reglas" && <StepReglas form={form} update={update} />}
        {step === "handoff" && <StepHandoff form={form} update={update} />}
        {step === "revisar" && (
          <StepRevisar
            form={form}
            localIssues={localIssues}
            errorDiagnostics={errorDiagnostics}
            warningDiagnostics={warningDiagnostics}
            saveError={saveError}
          />
        )}

        <div className="flex items-center justify-between border-t border-edge pt-4">
          <button type="button" onClick={() => goto(stepOrder[Math.max(0, stepIndex - 1)]!)} disabled={stepIndex === 0} className={actionBtn}>
            <ChevronLeft className="size-4" /> {t("Anterior", "Back")}
          </button>
          {step !== "revisar" ? (
            <button
              type="button"
              onClick={() => goto(stepOrder[Math.min(stepOrder.length - 1, stepIndex + 1)]!)}
              disabled={step === "tipo" && step1Invalid}
              className={primaryBtn}
            >
              {t("Siguiente", "Next")} <ChevronRight className="size-4" />
            </button>
          ) : (
            <button type="button" onClick={onSaveDraft} disabled={saving || localIssues.length > 0} className={primaryBtn}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {t("Guardar borrador", "Save draft")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function STEP_LABEL(s: WizardStep, t: (es: string, en: string) => string): string {
  return {
    tipo: t("Tipo de negocio", "Business type"),
    personalidad: t("Personalidad", "Personality"),
    capacidades: t("Capacidades", "Capabilities"),
    agendamiento: t("Agendamiento", "Scheduling"),
    servicios: t("Servicios", "Services"),
    reglas: t("Reglas", "Rules"),
    handoff: t("Transferencia", "Handoff"),
    revisar: t("Revisar y guardar", "Review & save"),
  }[s];
}

// ---------------------------------------------------------------------------
// Paso 1 — Tipo de negocio + identidad
// ---------------------------------------------------------------------------
function StepTipoIdentidad({ form, onChange }: { form: EditableBusinessAgentSpecForm; onChange: (f: EditableBusinessAgentSpecForm) => void }) {
  const { t, lang } = useI18n();
  const businessType = form.identity.businessType ?? "";
  const esOtro = businessType === BUSINESS_TYPE_OTRO;

  function setBusinessType(value: string) {
    // Al cambiar de "Otro" a otra opción se limpia el texto libre para no dejar
    // una validación colgada (requisito 5).
    onChange({
      ...form,
      identity: {
        ...form.identity,
        businessType: value,
        businessTypeCustom: value === BUSINESS_TYPE_OTRO ? (form.identity.businessTypeCustom ?? "") : "",
      },
    });
  }

  return (
    <SectionCard title={t("¿Qué tipo de negocio tienes?", "What type of business do you have?")} description={t("Nos ayuda a configurar el agente. Si no está en la lista, elige 'Otro'.", "Helps us configure the agent. If it's not listed, choose 'Other'.")}>
      <Field label={t("Tipo de negocio", "Business type")} required>
        <select className={inputCls} value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
          <option value="" disabled>
            {t("Selecciona el tipo de negocio", "Select the business type")}
          </option>
          {BUSINESS_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {lang === "en" ? o.labelEn : o.value}
            </option>
          ))}
        </select>
      </Field>
      {esOtro && (
        <Field label={t("¿Qué tipo de negocio es?", "What type of business is it?")} required>
          <input
            className={inputCls}
            value={form.identity.businessTypeCustom ?? ""}
            onChange={(e) => onChange({ ...form, identity: { ...form.identity, businessTypeCustom: e.target.value } })}
            placeholder={t("Escribe el tipo de negocio…", "Type the business type…")}
          />
        </Field>
      )}

      <div className="grid gap-4 border-t border-edge pt-4 sm:grid-cols-2">
        <Field label={t("Nombre del negocio", "Business name")} required>
          <input className={inputCls} value={form.identity.businessName} onChange={(e) => onChange({ ...form, identity: { ...form.identity, businessName: e.target.value } })} placeholder={t("Barbería Duvan", "Duvan's Barbershop")} />
        </Field>
        <Field label={t("Nombre del agente", "Agent name")} required hint={t("Cómo se presenta el bot.", "How the bot introduces itself.")}>
          <input className={inputCls} value={form.identity.agentName} onChange={(e) => onChange({ ...form, identity: { ...form.identity, agentName: e.target.value } })} placeholder={t("Ava", "Ava")} />
        </Field>
      </div>
      <Field label={t("Descripción (opcional)", "Description (optional)")}>
        <textarea className={inputCls} rows={2} value={form.identity.description ?? ""} onChange={(e) => onChange({ ...form, identity: { ...form.identity, description: e.target.value } })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Idioma (BCP-47)", "Language (BCP-47)")}>
          <input className={inputCls} value={form.identity.language} onChange={(e) => onChange({ ...form, identity: { ...form.identity, language: e.target.value } })} />
        </Field>
        <Field label={t("Zona horaria", "Timezone")}>
          <input className={inputCls} value={form.identity.timezone} onChange={(e) => onChange({ ...form, identity: { ...form.identity, timezone: e.target.value } })} />
        </Field>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Paso 2 — Personalidad
// ---------------------------------------------------------------------------
function StepPersonalidad({ form, update }: { form: EditableBusinessAgentSpecForm; update: <K extends keyof EditableBusinessAgentSpecForm>(k: K, v: EditableBusinessAgentSpecForm[K]) => void }) {
  const { t } = useI18n();
  const p = form.personality;
  return (
    <SectionCard title={t("Personalidad del agente", "Agent personality")} description={t("Define cómo suena, no qué puede hacer.", "Defines how it sounds, not what it can do.")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Tono principal", "Primary tone")}>
          <select className={inputCls} value={p.primary} onChange={(e) => update("personality", { ...p, primary: e.target.value as typeof p.primary })}>
            <option value="professional">{t("Profesional", "Professional")}</option>
            <option value="friendly">{t("Cercano", "Friendly")}</option>
            <option value="direct">{t("Directo", "Direct")}</option>
            <option value="consultative">{t("Consultivo", "Consultative")}</option>
          </select>
        </Field>
        <Field label={t("Extensión de respuestas", "Response length")}>
          <select className={inputCls} value={p.verbosity} onChange={(e) => update("personality", { ...p, verbosity: e.target.value as typeof p.verbosity })}>
            <option value="concise">{t("Cortas", "Concise")}</option>
            <option value="balanced">{t("Equilibradas", "Balanced")}</option>
            <option value="detailed">{t("Detalladas", "Detailed")}</option>
          </select>
        </Field>
        <Field label={t("Emojis", "Emojis")}>
          <select className={inputCls} value={p.emojiPolicy} onChange={(e) => update("personality", { ...p, emojiPolicy: e.target.value as typeof p.emojiPolicy })}>
            <option value="none">{t("Nunca", "Never")}</option>
            <option value="limited">{t("Con moderación", "Sparingly")}</option>
          </select>
        </Field>
        <Field label={t("Formalidad", "Formality")}>
          <select className={inputCls} value={p.formality} onChange={(e) => update("personality", { ...p, formality: e.target.value as typeof p.formality })}>
            <option value="formal">{t("De usted", "Formal")}</option>
            <option value="neutral">{t("Neutral", "Neutral")}</option>
            <option value="casual">{t("Informal", "Casual")}</option>
          </select>
        </Field>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Paso 3 — Capacidades + catálogo
// ---------------------------------------------------------------------------
function StepCapacidades({
  form,
  update,
  onChange,
}: {
  form: EditableBusinessAgentSpecForm;
  update: <K extends keyof EditableBusinessAgentSpecForm>(k: K, v: EditableBusinessAgentSpecForm[K]) => void;
  onChange: (f: EditableBusinessAgentSpecForm) => void;
}) {
  const { t } = useI18n();
  const caps = form.capabilities;
  function setCap(key: CapabilityKey, value: boolean) {
    // Transición atómica y pura (ver toggleCapability): actualiza capabilities y,
    // para "scheduling", también scheduling.enabled/provider en UNA sola llamada.
    // Antes se hacían dos update() encadenados sobre el mismo `form` y el segundo
    // pisaba al primero -> el checkbox "Agendar citas" no cambiaba (bug real).
    onChange(toggleCapability(form, key, value));
  }
  return (
    <>
      <SectionCard title={t("¿Qué puede hacer el agente?", "What can the agent do?")} description={t("Cada capacidad está anclada a una herramienta real del Runtime -- nunca se inventa una acción.", "Every capability is anchored to a real Runtime tool -- no invented actions.")}>
        <div className="grid gap-2 sm:grid-cols-2">
          {CAPABILITY_KEYS.map((key) => (
            <ToggleRow
              key={key}
              label={t(CAPABILITY_LABELS[key].es, CAPABILITY_LABELS[key].en)}
              hint={t(CAPABILITY_LABELS[key].hintEs, CAPABILITY_LABELS[key].hintEn)}
              checked={caps[key]}
              disabled={key === "orders" || key === "payments"}
              onChange={(v) => setCap(key, v)}
            />
          ))}
        </div>
      </SectionCard>

      {caps.catalog && (
        <SectionCard title={t("Catálogo", "Catalog")} description={t("La fuente de verdad siempre son tus servicios/productos guardados -- nunca el prompt.", "The source of truth is always your saved services/products -- never the prompt.")}>
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow label={t("Usar servicios", "Use services")} checked={form.catalog.useServices} onChange={(v) => update("catalog", { ...form.catalog, useServices: v })} />
            <ToggleRow label={t("Usar productos", "Use products")} checked={form.catalog.useProducts} onChange={(v) => update("catalog", { ...form.catalog, useProducts: v })} />
          </div>
          <ToggleRow
            label={t("Cotizar antes de calificar al cliente", "Quote before qualifying the customer")}
            hint={t("Si está apagado, primero identifica la necesidad y luego cotiza.", "If off, it identifies the need first, then quotes.")}
            checked={form.catalog.quoteBeforeQualification}
            onChange={(v) => update("catalog", { ...form.catalog, quoteBeforeQualification: v })}
          />
        </SectionCard>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Paso 4 — Agendamiento
// ---------------------------------------------------------------------------
function StepAgendamiento({ form, update }: { form: EditableBusinessAgentSpecForm; update: <K extends keyof EditableBusinessAgentSpecForm>(k: K, v: EditableBusinessAgentSpecForm[K]) => void }) {
  const { t } = useI18n();
  const s = form.scheduling;
  if (!form.capabilities.scheduling) {
    return (
      <SectionCard title={t("Agendamiento", "Scheduling")}>
        <p className="text-sm text-mist">{t("Activa la capacidad 'Agendar citas' en el paso anterior para configurar esto.", "Enable the 'Book appointments' capability in the previous step to configure this.")}</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard title={t("Agendamiento", "Scheduling")} description={t("Contra tu calendario real -- el agente nunca inventa disponibilidad.", "Against your real calendar -- the agent never invents availability.")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("Proveedor de calendario", "Calendar provider")}
          hint={t(
            "Nylas/Google Calendar: la conexión ya funciona (pestaña Calendario), pero el agendamiento automático contra ese calendario todavía está en desarrollo -- usa 'Interno' para agendar citas reales hoy.",
            "Nylas/Google Calendar: the connection already works (Calendar tab), but automatic booking against that calendar is still in development -- use 'Internal' to book real appointments today.",
          )}
        >
          <select className={inputCls} value={s.provider} onChange={(e) => update("scheduling", { ...s, provider: e.target.value as typeof s.provider })}>
            <option value="internal">{t("Interno (DuLabs) -- recomendado", "Internal (DuLabs) -- recommended")}</option>
            <option value="nylas">Nylas {t("(agendamiento en desarrollo)", "(booking in development)")}</option>
            <option value="google_calendar">Google Calendar {t("(próximamente)", "(coming soon)")}</option>
          </select>
        </Field>
        <Field label={t("Aviso mínimo (minutos)", "Minimum notice (minutes)")}>
          <input type="number" min={0} className={inputCls} value={s.minNoticeMinutes} onChange={(e) => update("scheduling", { ...s, minNoticeMinutes: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label={t("Permitir cancelar", "Allow cancellation")} checked={s.cancellation.allowed} onChange={(v) => update("scheduling", { ...s, cancellation: { ...s.cancellation, allowed: v } })} />
        <ToggleRow label={t("Requiere confirmación", "Requires confirmation")} checked={s.confirmation.required} onChange={(v) => update("scheduling", { ...s, confirmation: { ...s.confirmation, required: v } })} />
      </div>
      <Field label={t("Recursos requeridos (ej. especialista, mesa, sala)", "Required resources (e.g. specialist, table, room)")}>
        <div className="space-y-2">
          {s.resources.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={inputCls} placeholder={t("Etiqueta (ej. Barbero)", "Label (e.g. Specialist)")} value={r.label} onChange={(e) => {
                const next = [...s.resources];
                next[i] = { ...next[i]!, label: e.target.value, kind: next[i]!.kind || "specialist" };
                update("scheduling", { ...s, resources: next });
              }} />
              <button type="button" className={actionBtn} onClick={() => update("scheduling", { ...s, resources: s.resources.filter((_, j) => j !== i) })}>
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <button type="button" className={actionBtn} onClick={() => update("scheduling", { ...s, resources: [...s.resources, { kind: "specialist", label: "", required: true }] })}>
            <Plus className="size-3.5" /> {t("Agregar recurso", "Add resource")}
          </button>
        </div>
      </Field>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Paso 5 — Reglas y prohibiciones
// ---------------------------------------------------------------------------
function StepReglas({ form, update }: { form: EditableBusinessAgentSpecForm; update: <K extends keyof EditableBusinessAgentSpecForm>(k: K, v: EditableBusinessAgentSpecForm[K]) => void }) {
  const { t } = useI18n();
  const pol = form.policies;
  return (
    <>
      <SectionCard title={t("Cosas que el agente NUNCA debe hacer", "Things the agent must NEVER do")} description={t("Se evalúan ANTES del modelo -- si aplican, el modelo ni siquiera corre.", "Evaluated BEFORE the model -- if they apply, the model doesn't even run.")}>
        <div className="space-y-3">
          {pol.prohibitions.map((p, i) => (
            <div key={p.id} className="space-y-2 rounded-lg border border-edge bg-ink p-3">
              <input className={inputCls} placeholder={t("Descripción (ej. No aceptamos efectivo)", "Description (e.g. We don't accept cash)")} value={p.description} onChange={(e) => {
                const next = [...pol.prohibitions];
                next[i] = { ...next[i]!, description: e.target.value };
                update("policies", { ...pol, prohibitions: next });
              }} />
              <div className="grid gap-2 sm:grid-cols-2">
                <select className={inputCls} value={p.action} onChange={(e) => {
                  const next = [...pol.prohibitions];
                  next[i] = { ...next[i]!, action: e.target.value as ProhibitionAction };
                  update("policies", { ...pol, prohibitions: next });
                }}>
                  {PROHIBITION_ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>{t(a.es, a.en)}</option>
                  ))}
                </select>
                <input type="number" min={0} className={inputCls} placeholder={t("Prioridad", "Priority")} value={p.priority} onChange={(e) => {
                  const next = [...pol.prohibitions];
                  next[i] = { ...next[i]!, priority: Number(e.target.value) };
                  update("policies", { ...pol, prohibitions: next });
                }} />
              </div>
              {p.action !== "BLOCK" && (
                <input className={inputCls} placeholder={t("Texto de respuesta fija", "Fixed response text")} value={p.response ?? ""} onChange={(e) => {
                  const next = [...pol.prohibitions];
                  next[i] = { ...next[i]!, response: e.target.value };
                  update("policies", { ...pol, prohibitions: next });
                }} />
              )}
              <button type="button" className={actionBtn} onClick={() => update("policies", { ...pol, prohibitions: pol.prohibitions.filter((_, j) => j !== i) })}>
                <Trash2 className="size-3.5" /> {t("Quitar", "Remove")}
              </button>
            </div>
          ))}
          <button type="button" className={actionBtn} onClick={() => update("policies", { ...pol, prohibitions: [...pol.prohibitions, blankProhibition()] })}>
            <Plus className="size-3.5" /> {t("Agregar prohibición", "Add prohibition")}
          </button>
        </div>
      </SectionCard>

      <SectionCard title={t("Reglas informativas", "Informative rules")} description={t("Recordatorios/requisitos que el agente debe tener en cuenta.", "Reminders/requirements the agent should keep in mind.")}>
        <div className="space-y-3">
          {pol.rules.map((r, i) => (
            <div key={r.id} className="flex items-center gap-2">
              <input className={inputCls} placeholder={t("Descripción", "Description")} value={r.description} onChange={(e) => {
                const next = [...pol.rules];
                next[i] = { ...next[i]!, description: e.target.value };
                update("policies", { ...pol, rules: next });
              }} />
              <select className={`${inputCls} max-w-[140px]`} value={r.kind} onChange={(e) => {
                const next = [...pol.rules];
                next[i] = { ...next[i]!, kind: e.target.value as RuleKind };
                update("policies", { ...pol, rules: next });
              }}>
                {RULE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{t(k.es, k.en)}</option>
                ))}
              </select>
              <button type="button" className={actionBtn} onClick={() => update("policies", { ...pol, rules: pol.rules.filter((_, j) => j !== i) })}>
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <button type="button" className={actionBtn} onClick={() => update("policies", { ...pol, rules: [...pol.rules, blankRule()] })}>
            <Plus className="size-3.5" /> {t("Agregar regla", "Add rule")}
          </button>
        </div>
      </SectionCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Paso 6 — Handoff
// ---------------------------------------------------------------------------
function StepHandoff({ form, update }: { form: EditableBusinessAgentSpecForm; update: <K extends keyof EditableBusinessAgentSpecForm>(k: K, v: EditableBusinessAgentSpecForm[K]) => void }) {
  const { t } = useI18n();
  const h = form.handoff;
  if (!form.capabilities.humanHandoff) {
    return (
      <SectionCard title={t("Transferencia a humano", "Human handoff")}>
        <p className="text-sm text-mist">{t("Activa 'Transferir a un humano' en Capacidades para configurar esto.", "Enable 'Transfer to a human' in Capabilities to configure this.")}</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard title={t("¿Cuándo debe transferir a un humano?", "When should it hand off to a human?")} description={t("La decisión SIEMPRE es de DuLabs (determinista), nunca del modelo.", "The decision is ALWAYS DuLabs' (deterministic), never the model's.")}>
      <Field label={t("Horas de pausa por defecto tras transferir", "Default pause hours after handoff")}>
        <input type="number" min={0} className={`${inputCls} max-w-[140px]`} value={h.defaultPauseHours} onChange={(e) => update("handoff", { ...h, defaultPauseHours: Number(e.target.value) })} />
      </Field>
      <div className="space-y-3">
        {h.rules.map((r, i) => (
          <div key={r.id} className="space-y-2 rounded-lg border border-edge bg-ink p-3">
            <input className={inputCls} placeholder={t("Descripción (ej. Cliente pide hablar con alguien)", "Description (e.g. Customer asks for a person)")} value={r.description} onChange={(e) => {
              const next = [...h.rules];
              next[i] = { ...next[i]!, description: e.target.value };
              update("handoff", { ...h, rules: next });
            }} />
            <select className={inputCls} value={r.trigger.kind} onChange={(e) => {
              const next = [...h.rules];
              next[i] = { ...next[i]!, trigger: { kind: e.target.value as HandoffTriggerKind } };
              update("handoff", { ...h, rules: next });
            }}>
              {HANDOFF_TRIGGERS.map((tr) => (
                <option key={tr.value} value={tr.value}>{t(tr.es, tr.en)}</option>
              ))}
            </select>
            {r.trigger.kind === "keyword" && (
              <input className={inputCls} placeholder={t("Palabras clave separadas por coma", "Comma-separated keywords")} value={r.trigger.keywords?.join(", ") ?? ""} onChange={(e) => {
                const next = [...h.rules];
                next[i] = { ...next[i]!, trigger: { ...next[i]!.trigger, keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) } };
                update("handoff", { ...h, rules: next });
              }} />
            )}
            <button type="button" className={actionBtn} onClick={() => update("handoff", { ...h, rules: h.rules.filter((_, j) => j !== i) })}>
              <Trash2 className="size-3.5" /> {t("Quitar", "Remove")}
            </button>
          </div>
        ))}
        <button type="button" className={actionBtn} onClick={() => update("handoff", { ...h, rules: [...h.rules, blankHandoffRule()] })}>
          <Plus className="size-3.5" /> {t("Agregar regla de transferencia", "Add handoff rule")}
        </button>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Paso 7 — Revisar
// ---------------------------------------------------------------------------
function StepRevisar({
  form,
  localIssues,
  errorDiagnostics,
  warningDiagnostics,
  saveError,
}: {
  form: EditableBusinessAgentSpecForm;
  localIssues: string[];
  errorDiagnostics: CompilerDiagnostic[];
  warningDiagnostics: CompilerDiagnostic[];
  saveError: string | null;
}) {
  const { t } = useI18n();
  const activeCaps = CAPABILITY_KEYS.filter((k) => form.capabilities[k]);
  return (
    <SectionCard title={t("Revisa tu configuración", "Review your configuration")}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-mist">{t("Negocio", "Business")}</dt>
          <dd className="text-fg">{form.identity.businessName || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-mist">{t("Agente", "Agent")}</dt>
          <dd className="text-fg">{form.identity.agentName || "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-mist">{t("Capacidades activas", "Active capabilities")}</dt>
          <dd className="text-fg">{activeCaps.length > 0 ? activeCaps.join(", ") : t("Ninguna", "None")}</dd>
        </div>
      </dl>

      {localIssues.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-mist">{t("Antes de guardar", "Before saving")}</p>
          <IssuesList issues={localIssues} tone="danger" />
        </div>
      )}
      {errorDiagnostics.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-mist">{t("Errores del último guardado", "Errors from the last save")}</p>
          <IssuesList issues={errorDiagnostics.map((d) => diagnosticText(d))} tone="danger" />
        </div>
      )}
      {warningDiagnostics.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-mist">{t("Advertencias", "Warnings")}</p>
          <IssuesList issues={warningDiagnostics.map((d) => diagnosticText(d))} tone="warning" />
        </div>
      )}
      {saveError && <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{saveError}</p>}
      <p className="mt-4 text-xs text-mist">
        {t(
          "Guardar borrador NO publica tu agente -- primero puedes probarlo en Vista previa.",
          "Saving a draft does NOT publish your agent -- you can try it in Preview first.",
        )}
      </p>
    </SectionCard>
  );
}

export { blankSpecForm };
