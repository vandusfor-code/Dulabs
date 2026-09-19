"use client";

import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  blankCustomerField,
  customerDataIssues,
  fieldsAgentWillAsk,
  recommendedBookingFields,
  slugifyFieldKey,
  wellKnownCustomerField,
  type EditableBusinessAgentSpecForm,
} from "@/lib/business-agent-form";
import { CUSTOMER_FIELD_TYPES, type CustomerField, type CustomerFieldScope, type CustomerFieldType } from "@/lib/agent-compiler/spec/types";
import { WELL_KNOWN_FIELDS, buildQuestionText, isChannelSourced } from "@/lib/customer-data";
import { actionBtn, Field, inputCls, IssuesList, SectionCard, ToggleRow } from "@/components/dashboard/business-agent/ui";

const WELL_KNOWN_LABELS: Record<string, { es: string; en: string }> = {
  nombreCliente: { es: "Nombre", en: "Name" },
  telefonoCliente: { es: "Teléfono", en: "Phone" },
  correoCliente: { es: "Correo electrónico", en: "Email" },
  notas: { es: "Notas de la reserva", en: "Booking notes" },
};

const TYPE_LABELS: Record<CustomerFieldType, { es: string; en: string }> = {
  text: { es: "Texto", en: "Text" },
  phone: { es: "Teléfono", en: "Phone" },
  email: { es: "Correo", en: "Email" },
  number: { es: "Número", en: "Number" },
  date: { es: "Fecha", en: "Date" },
  time: { es: "Hora", en: "Time" },
  select: { es: "Lista de opciones", en: "Option list" },
  boolean: { es: "Sí / No", en: "Yes / No" },
};

const SCOPE_LABELS: Record<CustomerFieldScope, { es: string; en: string; hintEs: string; hintEn: string }> = {
  customer: {
    es: "Del cliente",
    en: "About the customer",
    hintEs: "Se pide una sola vez y se recuerda para próximas conversaciones.",
    hintEn: "Asked once and remembered for future conversations.",
  },
  booking: {
    es: "De esta reserva",
    en: "About this booking",
    hintEs: "Se pide en cada reserva y viaja solo con esa cita.",
    hintEn: "Asked on every booking and travels only with that appointment.",
  },
};

/**
 * Módulo "Datos del cliente" (R3). Edita form.customerData.fields -- se guarda con el
 * borrador, el compiler genera de aquí las preguntas (con validación real) y el
 * backend de reserva exige los obligatorios antes de tocar el calendario.
 */
export function CustomerDataModule({ form, onChange }: { form: EditableBusinessAgentSpecForm; onChange: (f: EditableBusinessAgentSpecForm) => void }) {
  const { t, lang } = useI18n();
  const fields = form.customerData?.fields ?? [];
  const issues = customerDataIssues(form, t);
  const willAsk = fieldsAgentWillAsk(form);
  const usedKeys = fields.map((f) => f.key);
  const missingKnown = Object.keys(WELL_KNOWN_FIELDS).filter((k) => !usedKeys.includes(k));
  const nameOf = (f: CustomerField) => WELL_KNOWN_LABELS[f.key]?.[lang === "en" ? "en" : "es"] ?? (f.label || t("(sin etiqueta)", "(no label)"));

  function setFields(next: CustomerField[]) {
    onChange({ ...form, customerData: { fields: next } });
  }
  function patch(index: number, change: Partial<CustomerField>) {
    setFields(fields.map((f, i) => (i === index ? { ...f, ...change } : f)));
  }
  function uniqueKey(base: string, exceptIndex: number): string {
    const others = fields.filter((_, i) => i !== exceptIndex).map((f) => f.key);
    let key = base;
    let n = 2;
    while (others.includes(key)) key = `${base}_${n++}`;
    return key;
  }
  function changeLabel(index: number, f: CustomerField, label: string) {
    // Un campo personalizado deriva su clave de la etiqueta mientras la clave siga siendo "automática".
    const auto = !WELL_KNOWN_FIELDS[f.key] && (f.key.startsWith("campo_") || f.key === slugifyFieldKey(f.label));
    const slug = slugifyFieldKey(label);
    patch(index, auto && slug ? { label, key: uniqueKey(slug, index) } : { label });
  }
  function changeType(index: number, f: CustomerField, type: CustomerFieldType) {
    patch(index, { type, options: type === "select" ? (f.options && f.options.length >= 2 ? f.options : ["", ""]) : undefined });
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title={t("Datos del cliente", "Customer data")}
        description={t(
          "Define qué datos pide el agente antes de reservar. El sistema los valida (la IA no decide qué es obligatorio) y no vuelve a pedir lo que ya conoce del cliente.",
          "Define which data the agent asks for before booking. The system validates it (the AI does not decide what is required) and does not ask again for what it already knows.",
        )}
      >
        {fields.length === 0 && (
          <div className="rounded-lg border border-dashed border-edge p-4 text-sm text-mist">
            <p>{t("Aún no configuraste datos. Sin esto, el agente reserva solo con lo que el cliente mencione.", "No data configured yet. Without this, the agent books with whatever the customer mentions.")}</p>
            <button type="button" className={`${actionBtn} mt-3`} onClick={() => setFields(recommendedBookingFields())}>
              <Plus className="size-3.5" /> {t("Usar datos recomendados (nombre + teléfono de WhatsApp)", "Use recommended data (name + WhatsApp phone)")}
            </button>
          </div>
        )}

        {fields.map((f, i) => {
          const canal = isChannelSourced(f.key);
          const conocido = Boolean(WELL_KNOWN_FIELDS[f.key]);
          return (
            <div key={i} className="space-y-3 rounded-lg border border-edge bg-ink p-3.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-fg">
                  {nameOf(f)} <span className="ml-1 font-mono text-[10.5px] text-mist/70">{f.key}</span>
                </p>
                <button type="button" className={actionBtn} onClick={() => setFields(fields.filter((_, j) => j !== i))} aria-label={t("Quitar campo", "Remove field")}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t("Etiqueta", "Label")} required>
                  <input className={inputCls} value={f.label} onChange={(e) => changeLabel(i, f, e.target.value)} placeholder={t("Ej. Edad", "e.g. Age")} />
                </Field>
                <Field label={t("Tipo de dato", "Data type")} hint={conocido ? t("Fijo para este campo del sistema.", "Fixed for this system field.") : undefined}>
                  <select className={inputCls} value={f.type} disabled={conocido} onChange={(e) => changeType(i, f, e.target.value as CustomerFieldType)}>
                    {CUSTOMER_FIELD_TYPES.map((tp) => (
                      <option key={tp} value={tp}>
                        {t(TYPE_LABELS[tp].es, TYPE_LABELS[tp].en)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("Pertenece a", "Belongs to")} hint={t(SCOPE_LABELS[f.scope].hintEs, SCOPE_LABELS[f.scope].hintEn)}>
                  <select className={inputCls} value={f.scope} disabled={canal} onChange={(e) => patch(i, { scope: e.target.value as CustomerFieldScope })}>
                    {(Object.keys(SCOPE_LABELS) as CustomerFieldScope[]).map((sc) => (
                      <option key={sc} value={sc}>
                        {t(SCOPE_LABELS[sc].es, SCOPE_LABELS[sc].en)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {!conocido && (
                <Field label={t("Clave técnica", "Technical key")} hint={t("Minúsculas, números y guion bajo. Identifica el dato en el flujo y en el contacto.", "Lowercase, numbers and underscore. Identifies the data in the flow and the contact.")}>
                  <input className={`${inputCls} font-mono`} value={f.key} onChange={(e) => patch(i, { key: e.target.value.trim() })} />
                </Field>
              )}

              {f.type === "select" && (
                <Field label={t("Opciones (una por línea)", "Options (one per line)")} required>
                  <textarea className={`${inputCls} min-h-24`} value={(f.options ?? []).join("\n")} onChange={(e) => patch(i, { options: e.target.value.split("\n") })} />
                </Field>
              )}

              {canal ? (
                <p className="rounded-md bg-lime/10 px-3 py-2 text-xs text-lime-text">
                  {t("Se toma automáticamente del número de WhatsApp del cliente -- el agente nunca se lo pregunta.", "Taken automatically from the customer's WhatsApp number -- the agent never asks for it.")}
                </p>
              ) : (
                <Field label={t("Pregunta al cliente", "Question to the customer")} hint={t("Opcional. Si la dejas vacía se usa una pregunta estándar.", "Optional. If left empty a standard question is used.")}>
                  <input className={inputCls} value={f.question ?? ""} onChange={(e) => patch(i, { question: e.target.value })} placeholder={buildQuestionText({ ...f, question: undefined })} />
                </Field>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <ToggleRow
                  label={t("Obligatorio", "Required")}
                  hint={f.required ? t("Sin este dato el sistema no reserva.", "Without this data the system will not book.") : t("Se ofrece con botones Sí/No para que el cliente pueda omitirlo.", "Offered with Yes/No buttons so the customer can skip it.")}
                  checked={f.required}
                  onChange={(v) => patch(i, { required: v })}
                />
                <ToggleRow label={t("Activo", "Active")} hint={t("Apagado = no se pregunta ni se exige.", "Off = not asked nor required.")} checked={f.enabled} onChange={(v) => patch(i, { enabled: v })} />
              </div>

              <Field label={t("Nota interna (opcional)", "Internal note (optional)")}>
                <input className={inputCls} value={f.description ?? ""} onChange={(e) => patch(i, { description: e.target.value })} />
              </Field>
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2">
          {missingKnown.map((k) => (
            <button key={k} type="button" className={actionBtn} onClick={() => setFields([...fields, wellKnownCustomerField(k)])}>
              <Plus className="size-3.5" /> {t(WELL_KNOWN_LABELS[k]!.es, WELL_KNOWN_LABELS[k]!.en)}
            </button>
          ))}
          <button type="button" className={actionBtn} onClick={() => setFields([...fields, blankCustomerField(usedKeys)])}>
            <Plus className="size-3.5" /> {t("Campo personalizado", "Custom field")}
          </button>
        </div>

        <IssuesList issues={issues} tone="danger" />
      </SectionCard>

      <SectionCard title={t("Lo que recopilará el agente", "What the agent will collect")}>
        {fields.filter((f) => f.enabled).length === 0 ? (
          <p className="text-sm text-mist">{t("Nada configurado.", "Nothing configured.")}</p>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {fields
              .filter((f) => f.enabled)
              .map((f) => (
                <li key={f.key} className="flex flex-wrap items-baseline gap-x-2 text-fg">
                  <span className="font-medium">{nameOf(f)}</span>
                  <span className="text-xs text-mist">
                    {isChannelSourced(f.key)
                      ? t("automático desde WhatsApp", "automatic from WhatsApp")
                      : `${f.required ? t("obligatorio", "required") : t("opcional", "optional")} · ${t(TYPE_LABELS[f.type].es, TYPE_LABELS[f.type].en)} · ${t(SCOPE_LABELS[f.scope].es, SCOPE_LABELS[f.scope].en).toLowerCase()}`}
                  </span>
                </li>
              ))}
          </ol>
        )}
        {willAsk.length > 0 && (
          <p className="text-xs text-mist">
            {t(
              "Si el cliente ya dio un dato del cliente en una conversación anterior, el agente no lo vuelve a pedir.",
              "If the customer already provided a customer data point in a previous conversation, the agent does not ask again.",
            )}
          </p>
        )}
      </SectionCard>
    </div>
  );
}
