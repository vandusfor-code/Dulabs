"use client";

// Business Agent 2.0, FASE 6 — configuración guiada: "enséñale a DuLabs cómo funciona tu negocio".
//
// La persona responde preguntas; el servidor guarda (autosave), valida, compila, publica y activa. Nada técnico en
// pantalla. Cada estado visible viene del servidor (guardado, problemas con datos reales, publicación, activación).

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, RefreshCw, Settings2 } from "lucide-react";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/agent-compiler/onboarding/issues";
import type { OnboardingDraft } from "@/lib/agent-compiler/onboarding/draft";
import type { OnboardingAuth } from "@/lib/business-agent-onboarding-client";
import { useOnboarding, type UseOnboardingOptions } from "@/components/dashboard/business-agent/onboarding/useOnboarding";
import { SaveIndicator, STEP_LABELS, StepProgress } from "@/components/dashboard/business-agent/onboarding/Progress";
import { BookingStep, BusinessStep, HoursStep, OfferStep, RulesStep, SupportStep } from "@/components/dashboard/business-agent/onboarding/Steps";
import { TestStep } from "@/components/dashboard/business-agent/onboarding/TestStep";
import { ActivateStep, STATUS_LABEL } from "@/components/dashboard/business-agent/onboarding/ActivateStep";
import { ErrorBanner, focusRing, primaryBtn, secondaryBtn } from "@/components/dashboard/business-agent/onboarding/controls";
import { motion as styles, MotionStyles } from "@/components/dashboard/business-agent/onboarding/motion";

const STEP_INTRO: Record<OnboardingStep, string> = {
  negocio: "Cuéntanos lo básico de tu negocio.",
  oferta: "Lo que tus clientes pueden pedirle a tu agente.",
  citas: "Si tu agente agenda, y cómo.",
  horario: "¿Cuándo atiendes a tus clientes?",
  atencion: "Cómo atiende tu agente y cuándo pasa a tu equipo.",
  reglas: "Límites que tu agente siempre respeta.",
  prueba: "Conversa con tu agente antes de publicarlo.",
  activar: "Publica tu agente y actívalo en tu WhatsApp.",
};

export interface OnboardingSlots {
  services?: ReactNode;
  products?: ReactNode;
  calendar?: ReactNode;
  /** Recibe el borrador y devuelve el módulo de conocimiento (preguntas frecuentes y documentos). */
  knowledge?: (draft: OnboardingDraft, setDraft: (u: (d: OnboardingDraft) => OnboardingDraft) => void) => ReactNode;
}

function readStepFromUrl(): OnboardingStep {
  if (typeof window === "undefined") return "negocio";
  const v = new URLSearchParams(window.location.search).get("paso");
  return (ONBOARDING_STEPS as readonly string[]).includes(v ?? "") ? (v as OnboardingStep) : "negocio";
}

export function OnboardingFlow({ auth, slots = {}, options, advancedHref = "/dashboard/business-agent" }: { auth: OnboardingAuth | null; slots?: OnboardingSlots; options?: UseOnboardingOptions; advancedHref?: string }) {
  const ob = useOnboarding(auth, options);
  const [step, setStep] = useState<OnboardingStep>(readStepFromUrl);
  const [visited, setVisited] = useState<Set<OnboardingStep>>(() => new Set([readStepFromUrl()]));

  const goTo = useCallback((s: OnboardingStep) => {
    setStep(s);
    setVisited((v) => new Set(v).add(s));
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("paso", s);
      window.history.replaceState(null, "", url.toString());
      document.getElementById("onboarding-step-title")?.focus();
    }
  }, []);

  // Al cargar un borrador existente, los pasos anteriores ya fueron recorridos (se marcan para mostrar su estado real).
  useEffect(() => {
    if (!ob.overview?.savedAt) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza con datos del servidor una vez cargados
    setVisited((v) => new Set([...v, ...ONBOARDING_STEPS.slice(0, ONBOARDING_STEPS.indexOf("reglas") + 1)]));
  }, [ob.overview?.savedAt]);

  const setDraft = ob.setDraft as (u: (d: OnboardingDraft) => OnboardingDraft) => void;
  const hasErrors = ob.issues.some((i) => i.severity === "error" && !i.code.startsWith("BA-RDY"));
  const index = ONBOARDING_STEPS.indexOf(step);
  const header = useMemo(
    () => (
      <div className="flex flex-col gap-4 border-b border-edge px-4 py-6 md:flex-row md:items-end md:justify-between md:px-8">
        <MotionStyles />
        <div className="min-w-0">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-mist">Business Agent</p>
          <h1 className="text-2xl font-semibold tracking-tight text-fg md:text-[28px]">Configura tu agente</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-mist">Responde unas preguntas sobre tu negocio. Nosotros nos encargamos del resto.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {ob.overview && <span className="rounded-full bg-edge/60 px-3 py-1 text-xs font-semibold text-fg">{STATUS_LABEL[ob.overview.status]}</span>}
          <SaveIndicator state={ob.saveState} />
          <a href={advancedHref} className={`-my-3 inline-flex min-h-11 items-center gap-1.5 py-3 text-xs text-mist hover:text-fg ${focusRing}`}>
            <Settings2 className="size-3.5" aria-hidden="true" /> Editor avanzado
          </a>
        </div>
      </div>
    ),
    [ob.overview, ob.saveState, advancedHref],
  );

  if (!auth || ob.loading) {
    return (
      <div className="pb-12">
        {header}
        <div className="px-4 pt-8 md:px-8" aria-busy="true">
          <div className={`h-40 max-w-3xl rounded-2xl bg-edge/40 ${styles.working}`} />
          <p className="sr-only">Cargando tu configuración…</p>
        </div>
      </div>
    );
  }
  if (ob.loadError || !ob.draft || !ob.overview) {
    return (
      <div className="pb-12">
        {header}
        <div className="max-w-3xl px-4 pt-8 md:px-8">
          <ErrorBanner message={ob.loadError?.message ?? "No pudimos cargar tu configuración."} code={ob.loadError?.code}>
            <button type="button" className={`${secondaryBtn} mt-3`} onClick={() => void ob.reload()}>
              <RefreshCw className="size-4" /> Intentar de nuevo
            </button>
          </ErrorBanner>
        </div>
      </div>
    );
  }

  const draft = ob.draft;
  const stepProps = { draft, setDraft, issues: ob.issues };

  return (
    <div className="pb-16">
      {header}
      <div className="px-4 pt-6 md:px-8">
        {ob.recovery && (
          <div role="alert" className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 ${styles.fadeIn}`}>
            <p className="text-sm text-fg">Tienes cambios sin guardar de tu última visita.</p>
            <div className="flex gap-2">
              <button type="button" className={primaryBtn} onClick={ob.applyRecovery}>
                Recuperarlos
              </button>
              <button type="button" className={secondaryBtn} onClick={ob.discardRecovery}>
                Descartar
              </button>
            </div>
          </div>
        )}
        {ob.saveState === "conflict" && (
          <div className="mb-5">
            <ErrorBanner message="Esta configuración cambió en otra sesión. Actualiza antes de continuar." code={ob.saveError?.code}>
              <p className="mt-1 text-xs text-mist">Al actualizar verás la versión más reciente; los cambios de esta pestaña que no se guardaron se descartan.</p>
              <button type="button" className={`${secondaryBtn} mt-3`} onClick={() => void ob.reload()}>
                <RefreshCw className="size-4" /> Actualizar
              </button>
            </ErrorBanner>
          </div>
        )}
        {ob.saveState === "error" && ob.saveError && (
          <div className="mb-5">
            <ErrorBanner message={ob.saveError.message} code={ob.saveError.code} />
          </div>
        )}
        {ob.overview.recovered && (
          <p className="mb-5 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-fg">Recuperamos tu configuración desde tu agente actual. Revísala y guarda.</p>
        )}

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="lg:w-60 lg:shrink-0">
            <StepProgress current={step} visited={visited} issues={ob.issues} onSelect={goTo} />
          </aside>
          <main className="min-w-0 max-w-3xl flex-1">
            <div key={step} className={styles.stepIn}>
              <h2 id="onboarding-step-title" tabIndex={-1} className="text-xl font-semibold tracking-tight text-fg outline-none">
                {STEP_LABELS[step]}
              </h2>
              <p className="mb-6 mt-1 text-sm text-mist">{STEP_INTRO[step]}</p>
              {step === "negocio" && <BusinessStep {...stepProps} />}
              {step === "oferta" && <OfferStep {...stepProps} servicesSlot={slots.services} productsSlot={slots.products} />}
              {step === "citas" && <BookingStep {...stepProps} calendarSlot={slots.calendar} />}
              {step === "horario" && <HoursStep {...stepProps} />}
              {step === "atencion" && <SupportStep {...stepProps} knowledgeSlot={slots.knowledge?.(draft, setDraft)} />}
              {step === "reglas" && <RulesStep {...stepProps} />}
              {step === "prueba" && <TestStep auth={auth} ensureSaved={ob.flush} blocked={hasErrors} />}
              {step === "activar" && (
                <ActivateStep auth={auth} requestedEngine={draft.engine} onEngineChange={(e) => setDraft((d) => ({ ...d, engine: e }))} overview={ob.overview} revision={ob.revision} hasLocalErrors={hasErrors} ensureSaved={ob.flush} onChanged={ob.refreshOverview} onConflict={() => void ob.reload()} goTo={goTo} />
              )}
            </div>
            <div className="mt-10 flex items-center justify-between gap-3 border-t border-edge pt-5">
              <button type="button" className={secondaryBtn} onClick={() => goTo(ONBOARDING_STEPS[index - 1]!)} disabled={index === 0}>
                <ArrowLeft className="size-4" /> Atrás
              </button>
              {index < ONBOARDING_STEPS.length - 1 && (
                <button type="button" className={primaryBtn} onClick={() => goTo(ONBOARDING_STEPS[index + 1]!)}>
                  Continuar <ArrowRight className="size-4" />
                </button>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
