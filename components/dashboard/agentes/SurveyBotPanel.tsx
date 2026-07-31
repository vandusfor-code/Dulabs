"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, RotateCcw, Sparkles, ChevronDown, Check, Users, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SurveyQuestion } from "@/lib/survey-builder";
import { buildSurveyAgentSystemPrompt, type SurveyBotConfig } from "@/lib/survey-engine";
import { SurveySimulator } from "@/components/dashboard/surveys/SurveySimulator";

// Forma remota (snake_case, tal cual la API/DB) — evita duplicar el mapeo en
// cada campo del formulario; solo se convierte a SurveyBotConfig (camelCase)
// justo antes de llamar al motor. Compartida con el Builder de
// /dashboard/surveys/new, que edita la misma configuración.
export interface RemoteBotConfig {
  phone_number_id: string;
  brand_name: string;
  agent_name: string;
  intro_template: string;
  closing_template: string;
  decline_template: string;
  schedule_confirm_template: string;
  milestone_half: string;
  milestone_two_left: string;
  milestone_last: string;
  reminder_delay_hours: number;
  reminder_max: number;
  reminder_template: string;
  allow_change_answers: boolean;
  questions: SurveyQuestion[];
  close_date: string | null;
  invite_template_name: string;
  reminder_template_name: string;
  active: boolean;
  existe?: boolean;
}

export function toEngineConfig(r: RemoteBotConfig): SurveyBotConfig {
  return {
    brandName: r.brand_name,
    agentName: r.agent_name,
    introTemplate: r.intro_template,
    closingTemplate: r.closing_template,
    declineTemplate: r.decline_template,
    scheduleConfirmTemplate: r.schedule_confirm_template,
    milestones: { half: r.milestone_half, twoLeft: r.milestone_two_left, last: r.milestone_last },
    reminder: { delayHours: r.reminder_delay_hours, maxReminders: r.reminder_max, template: r.reminder_template },
    allowChangeAnswers: r.allow_change_answers,
  };
}

export function SurveyBotPanel({
  phoneNumberId,
  accessToken,
}: {
  phoneNumberId: string;
  accessToken: string;
}) {
  const { t } = useI18n();
  // remote === null representa "cargando" (mismo patrón que el resto del
  // dashboard, ej. CampanasPage/AnalyticsPage: sin bandera de loading aparte).
  const [remote, setRemote] = useState<RemoteBotConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/dashboard/survey-bot-config?phone_number_id=${encodeURIComponent(phoneNumberId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("Error cargando la configuración", "Error loading configuration"));
        setRemote(data as RemoteBotConfig);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [phoneNumberId, accessToken, t]);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof RemoteBotConfig>(key: K, value: RemoteBotConfig[K]) =>
    setRemote((c) => (c ? { ...c, [key]: value } : c));

  const save = useCallback(async () => {
    if (!remote) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/dashboard/survey-bot-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(remote),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error guardando", "Error saving"));
      setSaveMsg(t("Guardado. El bot ya usa esta configuración en producción.", "Saved. The bot now uses this configuration in production."));
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 5000);
    }
  }, [remote, accessToken, t]);

  if (loadError) {
    return (
      <div className="rounded-xl border border-edge bg-card p-5">
        <p className="text-sm text-red-400">{loadError}</p>
      </div>
    );
  }
  if (!remote) {
    return (
      <div className="rounded-xl border border-edge bg-card p-5">
        <p className="text-sm text-mist">{t("Cargando bot de encuestas…", "Loading survey bot…")}</p>
      </div>
    );
  }

  const config = toEngineConfig(remote);

  return (
    <div className="rounded-xl border border-edge bg-card p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <ClipboardList className="size-4 text-lime-text" />
        <h3 className="text-sm font-semibold text-fg">{t("Bot de encuestas", "Survey bot")}</h3>
        <span className="rounded-full bg-lime/12 px-2 py-0.5 text-[10.5px] font-semibold text-lime-text">Beta</span>
        {!remote.existe && (
          <span className="rounded-full bg-ink px-2 py-0.5 text-[10.5px] text-mist">
            {t("Sin configurar todavía (mostrando valores por defecto)", "Not configured yet (showing defaults)")}
          </span>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-mist">
          <input type="checkbox" checked={remote.active} onChange={(e) => set("active", e.target.checked)} className="size-3.5 accent-lime" />
          {t("Activo", "Active")}
        </label>
      </div>
      <p className="text-xs leading-relaxed text-mist">
        {t(
          "Un entrevistador digital que acompaña al participante a completar la encuesta por WhatsApp: una pregunta a la vez, guarda el progreso, motiva en los momentos justos y respeta a quien no desea continuar.",
          "A digital interviewer that guides participants to complete the WhatsApp survey: one question at a time, saves progress, motivates at the right moments, and respects anyone who declines."
        )}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* --- Configuración --- */}
        <div className="space-y-4">
          <Field label={t("Nombre de la empresa o servicio", "Company or service name")} hint={t("Aparece en los mensajes del bot (reemplaza a Cofrem/People).", "Shown in the bot's messages (replaces Cofrem/People).")}>
            <input
              value={remote.brand_name}
              maxLength={60}
              onChange={(e) => set("brand_name", e.target.value)}
              className={inputCls}
              placeholder={t("Ej. Crédito Social Cofrem", "e.g. Crédito Social Cofrem")}
            />
          </Field>

          <Field label={t("Nombre del agente", "Agent name")}>
            <input value={remote.agent_name} maxLength={40} onChange={(e) => set("agent_name", e.target.value)} className={inputCls} />
          </Field>

          <Field label={t("Mensaje de bienvenida", "Welcome message")} hint={t("Usa {brand} y {count}.", "Use {brand} and {count}.")}>
            <textarea rows={3} value={remote.intro_template} onChange={(e) => set("intro_template", e.target.value)} className={`${inputCls} resize-none`} />
          </Field>

          <div className="grid grid-cols-1 gap-3">
            <Field label={t("Motivación al 50%", "Halfway nudge")}>
              <input value={remote.milestone_half} onChange={(e) => set("milestone_half", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("Motivación al faltar 2", "Two-left nudge")}>
              <input value={remote.milestone_two_left} onChange={(e) => set("milestone_two_left", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("Última pregunta", "Last question")}>
              <input value={remote.milestone_last} onChange={(e) => set("milestone_last", e.target.value)} className={inputCls} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Recordatorio tras (horas)", "Reminder after (hours)")}>
              <input
                type="number"
                min={1}
                max={72}
                value={remote.reminder_delay_hours}
                onChange={(e) => set("reminder_delay_hours", Math.max(1, Number(e.target.value) || 1))}
                className={inputCls}
              />
            </Field>
            <Field label={t("Máx. recordatorios", "Max reminders")}>
              <input
                type="number"
                min={0}
                max={5}
                value={remote.reminder_max}
                onChange={(e) => set("reminder_max", Math.max(0, Number(e.target.value) || 0))}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label={t("Mensaje de recuperación", "Recovery message")} hint={t("Se envía para retomar una encuesta abandonada. Usa {brand}.", "Sent to resume an abandoned survey. Use {brand}.")}>
            <textarea rows={2} value={remote.reminder_template} onChange={(e) => set("reminder_template", e.target.value)} className={`${inputCls} resize-none`} />
          </Field>

          <Field label={t("Mensaje de cierre", "Closing message")} hint="{brand}">
            <textarea rows={2} value={remote.closing_template} onChange={(e) => set("closing_template", e.target.value)} className={`${inputCls} resize-none`} />
          </Field>

          <Field label={t("Mensaje al no querer continuar", "Decline message")} hint="{closeDate}">
            <textarea rows={2} value={remote.decline_template} onChange={(e) => set("decline_template", e.target.value)} className={`${inputCls} resize-none`} />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("Fecha de cierre de la encuesta", "Survey close date")}>
              <input
                type="date"
                value={remote.close_date ?? ""}
                onChange={(e) => set("close_date", e.target.value || null)}
                className={inputCls}
              />
            </Field>
            <div />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("Plantilla Meta — invitación", "Meta template — invite")} hint={t("Debe existir APROBADA en /dashboard/plantillas.", "Must exist APPROVED in /dashboard/plantillas.")}>
              <input value={remote.invite_template_name} onChange={(e) => set("invite_template_name", e.target.value)} className={inputCls} />
            </Field>
            <Field label={t("Plantilla Meta — recordatorio", "Meta template — reminder")}>
              <input value={remote.reminder_template_name} onChange={(e) => set("reminder_template_name", e.target.value)} className={inputCls} />
            </Field>
          </div>

          <label className="flex items-center gap-2.5 text-sm text-fg">
            <input type="checkbox" checked={remote.allow_change_answers} onChange={(e) => set("allow_change_answers", e.target.checked)} className="size-4 accent-lime" />
            {t("Permitir cambiar respuestas anteriores", "Allow changing previous answers")}
          </label>

          <p className="text-[11px] leading-relaxed text-mist">
            {t(`Encuesta activa: ${remote.questions.length} preguntas.`, `Active survey: ${remote.questions.length} questions.`)}{" "}
            <Link href={`/dashboard/surveys/new?phone_number_id=${phoneNumberId}`} className="font-medium text-lime-text hover:text-fg">
              {t("Editar preguntas en Encuestas →", "Edit questions in Surveys →")}
            </Link>
          </p>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? t("Guardando…", "Saving…") : t("Guardar configuración", "Save configuration")}
            </button>
            <button
              onClick={load}
              className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm font-medium text-mist transition-colors hover:text-fg"
            >
              <RotateCcw className="size-3.5" /> {t("Descartar cambios", "Discard changes")}
            </button>
            {saveMsg && <Check className="size-4 text-lime-text" />}
          </div>
          {saveMsg && <p className="text-xs leading-relaxed text-mist">{saveMsg}</p>}

          {/* Instrucción base del agente (personalizada) */}
          <div className="rounded-lg border border-edge bg-ink">
            <button
              onClick={() => setShowPrompt((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-fg"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-lime-text" /> {t("Instrucción base del agente (IA)", "Agent base instruction (AI)")}
              </span>
              <ChevronDown className={`size-4 text-mist transition-transform ${showPrompt ? "rotate-180" : ""}`} />
            </button>
            {showPrompt && (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-edge px-3 py-3 text-[11px] leading-relaxed text-mist">
                {buildSurveyAgentSystemPrompt(config)}
              </pre>
            )}
          </div>

          <InvitarPanel phoneNumberId={phoneNumberId} accessToken={accessToken} />
        </div>

        {/* --- Simulador --- */}
        <SurveySimulator config={config} questions={remote.questions} />
      </div>
    </div>
  );
}

export function InvitarPanel({
  phoneNumberId,
  accessToken,
  prefill,
}: {
  phoneNumberId: string;
  accessToken: string;
  /**
   * Contenido inicial del textarea (ej. contactos importados de un Excel).
   * Para forzar que se recargue con un valor nuevo, monta este componente
   * con una `key` distinta (ej. `key={prefill}`) — es lo que hace el Builder.
   */
  prefill?: string;
}) {
  const { t } = useI18n();
  const [destinatarios, setDestinatarios] = useState(prefill ?? "");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ enviados: number; fallidos: { destinatario: string; error: string }[] } | string | null>(null);

  // Una línea por destinatario ("teléfono" o "teléfono, Nombre") — la coma
  // dentro de una línea separa teléfono/nombre, no dos destinatarios.
  const conteo = destinatarios.split("\n").map((d) => d.trim()).filter(Boolean).length;

  const enviar = useCallback(async () => {
    const lista = destinatarios.split("\n").map((d) => d.trim()).filter(Boolean);
    if (lista.length === 0) return;
    setEnviando(true);
    setResultado(null);
    try {
      const res = await fetch("/api/dashboard/surveys/invitar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ phone_number_id: phoneNumberId, destinatarios: lista }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("Error enviando invitaciones", "Error sending invitations"));
      setResultado(data);
      if (data.enviados > 0) setDestinatarios("");
    } catch (err) {
      setResultado(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }, [destinatarios, phoneNumberId, accessToken, t]);

  return (
    <div className="rounded-lg border border-edge bg-ink p-3">
      <div className="flex items-center gap-2">
        <Users className="size-3.5 text-lime-text" />
        <p className="text-sm font-medium text-fg">{t("Enviar invitaciones", "Send invitations")}</p>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-mist">
        {t(
          "Uno por línea: teléfono con indicativo de país, opcionalmente seguido de \", Nombre\" (para personalizar {{nombre_cliente}} en la plantilla). Si el contacto escribió en las últimas 24h se le envía el saludo directo; si no, se usa la plantilla de invitación aprobada.",
          "One per line: phone with country code, optionally followed by \", Name\" (to fill {{nombre_cliente}} in the template). If the contact wrote in the last 24h they get the direct greeting; otherwise the approved invite template is used."
        )}
      </p>
      <textarea
        rows={3}
        value={destinatarios}
        onChange={(e) => setDestinatarios(e.target.value)}
        placeholder={"573001234567, Juan Pérez\n573007654321"}
        className={`${inputCls} mt-2 resize-none bg-card`}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-mist">{conteo} {conteo === 1 ? t("destinatario", "recipient") : t("destinatarios", "recipients")}</span>
        <button
          onClick={enviar}
          disabled={enviando || conteo === 0}
          className="flex items-center gap-2 rounded-lg bg-lime px-3.5 py-1.5 text-xs font-semibold text-lime-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="size-3.5" /> {enviando ? t("Enviando…", "Sending…") : t("Enviar", "Send")}
        </button>
      </div>
      {resultado && (
        <p className="mt-2 rounded-lg bg-card p-2.5 text-xs leading-relaxed text-mist">
          {typeof resultado === "string"
            ? resultado
            : t(
                `Enviados: ${resultado.enviados}${resultado.fallidos.length ? ` · Fallidos: ${resultado.fallidos.length} (${resultado.fallidos[0].error})` : ""}`,
                `Sent: ${resultado.enviados}${resultado.fallidos.length ? ` · Failed: ${resultado.fallidos.length} (${resultado.fallidos[0].error})` : ""}`
              )}
        </p>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-mist focus:border-lime/50";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-mist">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10.5px] text-mist/70">{hint}</p>}
    </div>
  );
}
