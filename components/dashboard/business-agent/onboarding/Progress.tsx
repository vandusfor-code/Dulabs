"use client";

// Business Agent 2.0, FASE 6 — progreso de la configuración guiada y estado de guardado.

import { Check, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { ONBOARDING_STEPS, type OnboardingIssue, type OnboardingStep } from "@/lib/agent-compiler/onboarding/issues";
import type { SaveState } from "@/components/dashboard/business-agent/onboarding/useOnboarding";
import { focusRing } from "@/components/dashboard/business-agent/onboarding/controls";
import { motion as styles } from "@/components/dashboard/business-agent/onboarding/motion";

export const STEP_LABELS: Record<OnboardingStep, string> = {
  negocio: "Tu negocio",
  oferta: "Lo que ofreces",
  citas: "Citas",
  horario: "Horario",
  atencion: "Atención",
  reglas: "Reglas",
  prueba: "Prueba",
  activar: "Publicar y activar",
};

export type StepVisualState = "done" | "current" | "pending" | "error";

export function stepState(step: OnboardingStep, current: OnboardingStep, visited: ReadonlySet<OnboardingStep>, issues: readonly OnboardingIssue[]): StepVisualState {
  if (step === current) return "current";
  const errors = issues.some((i) => i.step === step && i.severity === "error");
  if (visited.has(step) && errors) return "error";
  if (visited.has(step)) return "done";
  return "pending";
}

export function StepProgress(props: { current: OnboardingStep; visited: ReadonlySet<OnboardingStep>; issues: readonly OnboardingIssue[]; onSelect: (s: OnboardingStep) => void }) {
  const index = ONBOARDING_STEPS.indexOf(props.current);
  return (
    <nav aria-label="Pasos de la configuración" className="lg:sticky lg:top-6">
      {/* Móvil: barra compacta */}
      <div className="lg:hidden">
        <p className="text-xs text-mist">
          Paso {index + 1} de {ONBOARDING_STEPS.length} · <span className="font-medium text-fg">{STEP_LABELS[props.current]}</span>
        </p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-edge" role="progressbar" aria-valuemin={1} aria-valuemax={ONBOARDING_STEPS.length} aria-valuenow={index + 1} aria-label="Avance">
          <div className="h-full rounded-full bg-lime transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${((index + 1) / ONBOARDING_STEPS.length) * 100}%` }} />
        </div>
      </div>
      <ol className="mt-3 flex gap-1.5 overflow-x-auto pb-1 lg:mt-0 lg:flex-col lg:gap-1 lg:overflow-visible">
        {ONBOARDING_STEPS.map((s, i) => {
          const st = stepState(s, props.current, props.visited, props.issues);
          const errors = props.issues.filter((x) => x.step === s && x.severity === "error").length;
          return (
            <li key={s} className="shrink-0">
              <button
                type="button"
                onClick={() => props.onSelect(s)}
                aria-current={st === "current" ? "step" : undefined}
                aria-label={`${STEP_LABELS[s]}${st === "done" ? ", completado" : st === "error" ? `, ${errors} por revisar` : st === "pending" ? ", pendiente" : ", paso actual"}`}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors ${focusRing} ${st === "current" ? "bg-lime/12 font-semibold text-fg" : "text-mist hover:bg-edge/40 hover:text-fg"}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                    st === "done" ? "border-lime bg-lime text-lime-fg" : st === "current" ? "border-lime text-fg" : st === "error" ? "border-red-500/70 text-red-400" : "border-edge text-mist"
                  }`}
                >
                  {st === "done" ? <Check className={`size-3.5 ${styles.checkPop}`} strokeWidth={3} /> : st === "error" ? "!" : st === "current" ? <span className="size-2 rounded-full bg-lime" /> : i + 1}
                </span>
                <span className="whitespace-nowrap">{STEP_LABELS[s]}</span>
                {st === "error" && <span className="ml-auto rounded-full bg-red-500/15 px-1.5 text-[11px] text-red-400">{errors}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const SAVE_TEXT: Record<SaveState, string> = {
  idle: "Sin cambios",
  saving: "Guardando…",
  saved: "Guardado",
  offline: "Sin conexión · reintentando",
  conflict: "Cambió en otra sesión",
  error: "No se pudo guardar",
};

export function SaveIndicator({ state }: { state: SaveState }) {
  const tone = state === "saved" ? "text-lime-text" : state === "saving" || state === "idle" ? "text-mist" : state === "offline" ? "text-amber-400" : "text-red-400";
  return (
    <p role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone}`}>
      {state === "saving" && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {state === "saved" && <Check className={`size-3.5 ${styles.checkPop}`} aria-hidden="true" />}
      {state === "offline" && <CloudOff className="size-3.5" aria-hidden="true" />}
      {(state === "conflict" || state === "error") && <TriangleAlert className="size-3.5" aria-hidden="true" />}
      {SAVE_TEXT[state]}
    </p>
  );
}
