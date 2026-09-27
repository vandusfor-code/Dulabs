"use client";

// Business Agent 2.0, FASE 6 — "Publicar y activar". Cada elemento refleja un estado REAL del servidor:
//   - checklist calculado en el servidor (configuración, datos reales, publicación, plan, WhatsApp);
//   - publicación con las etapas reales transmitidas mientras ocurren (nada se marca antes de que pase);
//   - "Publicado" solo con la respuesta de la transacción; "Activo" solo tras activar el número en el servidor.

import { useState } from "react";
import { Check, Circle, Loader2, PartyPopper, Rocket, X } from "lucide-react";
import type { OnboardingIssue, OnboardingStep } from "@/lib/agent-compiler/onboarding/issues";
import type { OnboardingOverview, PublishStageEvent, PublishStageId } from "@/lib/agent-compiler/onboarding/service";
import type { OnboardingStatus, WhatsAppNumberInfo } from "@/lib/agent-compiler/onboarding/status";
import { activateOnboarding, publishOnboarding, type OnboardingAuth } from "@/lib/business-agent-onboarding-client";
import { ErrorBanner, primaryBtn, secondaryBtn } from "@/components/dashboard/business-agent/onboarding/controls";
import { STEP_LABELS } from "@/components/dashboard/business-agent/onboarding/Progress";
import { motion as styles } from "@/components/dashboard/business-agent/onboarding/motion";

export const STATUS_LABEL: Record<OnboardingStatus, string> = {
  NOT_STARTED: "Sin empezar",
  DRAFT: "Borrador",
  INCOMPLETE: "Faltan datos",
  READY: "Listo para publicar",
  PUBLISHING: "Publicando…",
  PUBLISHED: "Publicado",
  ACTIVE: "Activo",
  PAUSED: "En pausa",
  ERROR: "Requiere atención",
};

/** Etapas en el orden en que el servidor las ejecuta (las etiquetas llegan del servidor en cada evento). */
export const STAGE_ORDER: Array<{ id: PublishStageId; label: string }> = [
  { id: "review", label: "Revisando la información de tu negocio" },
  { id: "validate", label: "Validando servicios, horarios y reglas" },
  { id: "compile", label: "Preparando lo que tu agente puede hacer" },
  { id: "verify", label: "Verificando tus datos reales y la seguridad" },
  { id: "save", label: "Guardando la nueva versión" },
  { id: "publish", label: "Publicando" },
];

const NUMBER_STATUS: Record<WhatsAppNumberInfo["status"], string> = {
  active: "Activo con este agente",
  paused: "En pausa",
  other_engine: "Lo atiende otro asistente",
  other_agent: "Lo atiende otro flujo",
  available: "Disponible",
  disconnected: "Pendiente de conexión",
};

type StageStatus = PublishStageEvent["status"] | "pending";

export function PublishProgress({ stages }: { stages: Partial<Record<PublishStageId, StageStatus>> }) {
  return (
    <ol className="space-y-2" aria-label="Progreso de la publicación">
      {STAGE_ORDER.map((s) => {
        const st = stages[s.id] ?? "pending";
        return (
          <li key={s.id} className="flex items-center gap-2.5 text-sm" aria-label={`${s.label}: ${st === "done" ? "listo" : st === "running" ? "en curso" : st === "failed" ? "falló" : "pendiente"}`}>
            <span aria-hidden="true" className="flex size-5 items-center justify-center">
              {st === "done" && <Check className={`size-4 text-lime-text ${styles.checkPop}`} strokeWidth={3} />}
              {st === "running" && <span className={`size-2.5 rounded-full bg-lime ${styles.working}`} />}
              {st === "failed" && <X className="size-4 text-red-400" />}
              {st === "pending" && <Circle className="size-3.5 text-edge" />}
            </span>
            <span className={st === "pending" ? "text-mist" : st === "failed" ? "text-red-400" : "text-fg"}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ActivateStep(props: {
  auth: OnboardingAuth;
  overview: OnboardingOverview;
  revision: number;
  hasLocalErrors: boolean;
  ensureSaved: () => Promise<boolean>;
  onChanged: () => Promise<void>;
  onConflict: () => void;
  goTo: (s: OnboardingStep) => void;
}) {
  const [publishing, setPublishing] = useState(false);
  const [stages, setStages] = useState<Partial<Record<PublishStageId, StageStatus>>>({});
  const [published, setPublished] = useState<number | null>(null);
  const [error, setError] = useState<{ message: string; code: string; issues: OnboardingIssue[]; conflict?: boolean } | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [activated, setActivated] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<{ message: string; code: string; reasons: string[] } | null>(null);
  const o = props.overview;
  const status: OnboardingStatus = publishing ? "PUBLISHING" : o.status;

  const publish = async () => {
    setError(null);
    setPublished(null);
    setStages({});
    setPublishing(true);
    if (!(await props.ensureSaved())) {
      setPublishing(false);
      setError({ message: "No pudimos guardar tus últimos cambios antes de publicar. Revisa tu conexión.", code: "BA-DRF-003", issues: [] });
      return;
    }
    const r = await publishOnboarding(props.auth, { expectedRevision: props.revision }, (e) => setStages((s) => ({ ...s, [e.stage]: e.status })));
    setPublishing(false);
    if (!r.ok) {
      setError({ message: r.error.message, code: r.error.code, issues: [], conflict: r.error.status === 409 });
      await props.onChanged();
      return;
    }
    if (!r.data.ok) {
      setError({ message: r.data.message, code: r.data.code, issues: r.data.issues, conflict: r.data.conflict });
      await props.onChanged();
      return;
    }
    setPublished(r.data.publishedVersion);
    await props.onChanged();
  };

  const activate = async (phoneNumberId: string) => {
    setActivationError(null);
    setActivating(phoneNumberId);
    const r = await activateOnboarding(props.auth, { phoneNumberId });
    setActivating(null);
    if (!r.ok) {
      const d = r.error.details as { reasons?: string[] } | undefined;
      setActivationError({ message: r.error.message, code: r.error.code, reasons: d?.reasons ?? [] });
      return;
    }
    setActivated(phoneNumberId);
    await props.onChanged();
  };

  const ready = o.checklist.readyToActivate;
  const canPublish = !publishing && !props.hasLocalErrors && (o.pendingChanges || !o.publication);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-mist">Estado de tu agente:</span>
        <span role="status" className={`rounded-full px-3 py-1 text-sm font-semibold ${status === "ACTIVE" ? "bg-lime/20 text-lime-text" : status === "ERROR" ? "bg-red-500/15 text-red-400" : "bg-edge/60 text-fg"}`}>
          {STATUS_LABEL[status]}
        </span>
        {o.publication && (
          <span className="text-xs text-mist">
            Versión publicada {o.publication.publishedVersion}
            {o.pendingChanges ? " · tienes cambios sin publicar" : ""}
          </span>
        )}
      </div>

      <section aria-labelledby="checklist-title" className="rounded-2xl border border-edge bg-card p-5">
        <h3 id="checklist-title" className="text-sm font-semibold text-fg">
          {ready ? "Todo listo para activar" : "Antes de activar"}
        </h3>
        <ul className="mt-3 space-y-2.5">
          {o.checklist.items.map((it) => (
            <li key={it.id} className="flex items-start gap-2.5 text-sm">
              {it.ok ? <Check className={`mt-0.5 size-4 shrink-0 text-lime-text ${styles.checkPop}`} aria-label="Listo" /> : <Circle className="mt-0.5 size-4 shrink-0 text-mist" aria-label="Pendiente" />}
              <span className="min-w-0">
                <span className={it.ok ? "text-fg" : "text-mist"}>{it.label}</span>
                {it.detail && <span className="block text-xs text-mist">{it.detail}</span>}
              </span>
              {!it.ok && it.step !== "activar" && (
                <button type="button" className="ml-auto shrink-0 text-xs font-medium text-lime-text underline-offset-2 hover:underline" onClick={() => props.goTo(it.step)}>
                  Ir a {STEP_LABELS[it.step]}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="publish-title" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="publish-title" className="text-sm font-semibold text-fg">
              Publicar
            </h3>
            <p className="text-xs text-mist">Publicar prepara tu agente con tu configuración. Todavía no responde en WhatsApp hasta que lo actives.</p>
          </div>
          <button type="button" className={primaryBtn} onClick={publish} disabled={!canPublish}>
            {publishing ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Rocket className="size-4" />}
            {publishing ? "Publicando…" : o.publication ? "Publicar cambios" : "Publicar mi agente"}
          </button>
        </div>
        {(publishing || Object.keys(stages).length > 0) && (
          <div className="rounded-2xl border border-edge bg-card p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-mist">Configurando tu agente</p>
            <PublishProgress stages={stages} />
          </div>
        )}
        {published !== null && !error && (
          <div role="status" className={`flex items-center gap-3 rounded-2xl border border-lime/40 bg-lime/10 p-4 ${styles.celebrate}`}>
            <PartyPopper className="size-5 text-lime-text" aria-hidden="true" />
            <p className="text-sm text-fg">
              <strong>Tu agente quedó publicado</strong> (versión {published}).{" "}
              {o.checklist.readyToActivate ? "Ya puedes activarlo en tu WhatsApp." : "Revisa la lista de arriba para poder activarlo."}
            </p>
          </div>
        )}
        {error && (
          <ErrorBanner message={error.message} code={error.code}>
            {error.issues.length > 0 && (
              <ul className="mt-2 space-y-1">
                {error.issues
                  .filter((i) => i.severity === "error")
                  .slice(0, 6)
                  .map((i, n) => (
                    <li key={n} className="text-xs text-red-300">
                      • {i.message}{" "}
                      <button type="button" className="underline" onClick={() => props.goTo(i.step)}>
                        Ir a {STEP_LABELS[i.step]}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            {error.conflict && (
              <button type="button" className={`${secondaryBtn} mt-3`} onClick={props.onConflict}>
                Actualizar
              </button>
            )}
          </ErrorBanner>
        )}
      </section>

      <section aria-labelledby="numbers-title" className="space-y-3">
        <h3 id="numbers-title" className="text-sm font-semibold text-fg">
          Tu WhatsApp
        </h3>
        {o.numbers.length === 0 ? (
          <p className="rounded-2xl border border-edge bg-ink p-4 text-sm text-mist">
            Todavía no tienes un número conectado.{" "}
            <a href="/dashboard/conexion" className="font-medium text-lime-text underline-offset-2 hover:underline">
              Conectar WhatsApp
            </a>
          </p>
        ) : (
          <ul className="space-y-2">
            {o.numbers.map((n) => {
              const isActive = n.status === "active" || activated === n.phoneNumberId;
              const canActivate = ready && !isActive && (n.status === "available" || n.status === "other_agent" || n.status === "paused");
              return (
                <li key={n.phoneNumberId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-edge bg-ink p-4">
                  <div>
                    <p className="text-sm font-medium text-fg">{n.label}</p>
                    <p className={`text-xs ${isActive ? "text-lime-text" : "text-mist"}`}>{isActive ? "Activo con este agente" : NUMBER_STATUS[n.status]}</p>
                    {n.status === "other_agent" && canActivate && <p className="text-xs text-amber-400">Al activar, este agente reemplaza al que atiende hoy este número.</p>}
                  </div>
                  {isActive ? (
                    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold text-lime-text ${styles.checkPop}`}>
                      <Check className="size-4" /> Activo
                    </span>
                  ) : (
                    <button type="button" className={primaryBtn} disabled={!canActivate || activating !== null} onClick={() => activate(n.phoneNumberId)}>
                      {activating === n.phoneNumberId ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                      Activar aquí
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!ready && o.numbers.length > 0 && <p className="text-xs text-mist">Podrás activar cuando todo lo de la lista esté listo.</p>}
        {activationError && (
          <ErrorBanner message={activationError.message} code={activationError.code}>
            {activationError.reasons.length > 0 && (
              <ul className="mt-2 space-y-1">
                {activationError.reasons.map((r, i) => (
                  <li key={i} className="text-xs text-red-300">
                    • {r}
                  </li>
                ))}
              </ul>
            )}
          </ErrorBanner>
        )}
      </section>
    </div>
  );
}
