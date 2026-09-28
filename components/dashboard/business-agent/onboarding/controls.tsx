"use client";

// Business Agent 2.0, FASE 6 — controles accesibles de la configuración guiada: preguntas humanas (Sí/No, tarjetas,
// chips) en lugar de formularios administrativos. Etiquetas asociadas, grupos de opción con teclado (flechas),
// errores vinculados al campo (aria-describedby / aria-invalid) y foco visible.

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { OnboardingIssue } from "@/lib/agent-compiler/onboarding/issues";
import { motion as styles } from "@/components/dashboard/business-agent/onboarding/motion";

export const inputCls =
  "w-full rounded-xl border border-edge bg-ink px-3.5 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-mist/60 focus-visible:border-lime/60 focus-visible:ring-2 focus-visible:ring-lime/30 aria-[invalid=true]:border-red-500/60";
export const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-lime/50 focus-visible:ring-offset-2 focus-visible:ring-offset-ink";
export const primaryBtn = `inline-flex items-center justify-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-lime-fg transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
export const secondaryBtn = `inline-flex items-center justify-center gap-2 rounded-xl border border-edge px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:border-lime/40 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

/** Problemas de un campo del borrador (el servidor y el navegador usan las mismas rutas). */
export function issuesFor(issues: readonly OnboardingIssue[], field: string): OnboardingIssue[] {
  return issues.filter((i) => i.field === field || (i.field?.startsWith(`${field}.`) ?? false));
}

export function FieldError({ id, issues }: { id: string; issues: OnboardingIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div id={id} className={`mt-1.5 space-y-0.5 ${styles.fadeIn}`}>
      {issues.map((i, n) => (
        <p key={n} className={`text-xs ${i.severity === "error" ? "text-red-400" : "text-amber-400"}`}>
          {i.message}
        </p>
      ))}
    </div>
  );
}

export function Question({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-fg">{title}</h3>
        {hint && <p className="mt-0.5 text-sm text-mist">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
  issues?: OnboardingIssue[];
  multiline?: boolean;
  maxLength?: number;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const bad = (props.issues ?? []).some((i) => i.severity === "error");
  const describedBy = [props.hint ? hintId : null, (props.issues ?? []).length ? errId : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    value: props.value,
    onChange: (e: { target: { value: string } }) => props.onChange(e.target.value),
    placeholder: props.placeholder,
    maxLength: props.maxLength,
    "aria-invalid": bad || undefined,
    "aria-describedby": describedBy,
    "aria-required": props.required || undefined,
    className: inputCls,
    autoFocus: props.autoFocus,
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">
        {props.label}
        {props.required && <span className="ml-0.5 text-red-400" aria-hidden="true">*</span>}
      </label>
      {props.multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />}
      {props.hint && (
        <p id={hintId} className="mt-1 text-xs text-mist">
          {props.hint}
        </p>
      )}
      <FieldError id={errId} issues={props.issues ?? []} />
    </div>
  );
}

export interface Choice<T extends string> {
  value: T;
  title: string;
  description?: string;
  disabled?: boolean;
}

/** Grupo de opciones (radio) con teclado: flechas para moverse, Espacio/Enter para elegir. */
export function ChoiceGroup<T extends string>(props: {
  label: string;
  value: T | undefined;
  options: Choice<T>[];
  onChange: (v: T) => void;
  variant?: "cards" | "chips";
  issues?: OnboardingIssue[];
  hideLabel?: boolean;
}) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = props.options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const selectedIndex = props.options.findIndex((o) => o.value === props.value);
  const tabIndexFor = (i: number) => (selectedIndex >= 0 ? (i === selectedIndex ? 0 : -1) : i === enabled[0] ? 0 : -1);
  const move = (from: number, delta: number) => {
    const pos = enabled.indexOf(from);
    const next = enabled[(pos + delta + enabled.length) % enabled.length];
    if (next === undefined) return;
    refs.current[next]?.focus();
    props.onChange(props.options[next]!.value);
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(i, 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(i, -1);
    }
  };
  const chips = props.variant === "chips";
  const errId = `${id}-err`;
  return (
    <div>
      <p id={`${id}-label`} className={props.hideLabel ? "sr-only" : "mb-2 text-sm font-medium text-fg"}>
        {props.label}
      </p>
      <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={(props.issues ?? []).length ? errId : undefined} className={chips ? "flex flex-wrap gap-2" : "grid gap-2.5 sm:grid-cols-2"}>
        {props.options.map((o, i) => {
          const selected = o.value === props.value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={o.disabled}
              tabIndex={tabIndexFor(i)}
              onKeyDown={(e) => onKey(e, i)}
              onClick={() => props.onChange(o.value)}
              className={
                chips
                  ? `rounded-full border px-3.5 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${focusRing} ${selected ? "border-lime bg-lime/15 text-fg" : "border-edge text-mist hover:border-lime/40 hover:text-fg"}`
                  : `relative flex min-h-[64px] items-start gap-3 rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 ${focusRing} ${selected ? "border-lime bg-lime/10" : "border-edge bg-ink hover:border-lime/40"}`
              }
            >
              {!chips && (
                <span aria-hidden="true" className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-lime bg-lime text-lime-fg" : "border-edge"}`}>
                  {selected && <Check className={`size-3 ${styles.checkPop}`} strokeWidth={3} />}
                </span>
              )}
              <span className="min-w-0">
                <span className={`block ${chips ? "" : "text-sm font-semibold text-fg"}`}>{o.title}</span>
                {!chips && o.description && <span className="mt-0.5 block text-xs text-mist">{o.description}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <FieldError id={errId} issues={props.issues ?? []} />
    </div>
  );
}

/** Pregunta de Sí / No. */
export function YesNo(props: { label: string; value: boolean; onChange: (v: boolean) => void; yes?: string; no?: string; yesHint?: string; noHint?: string; issues?: OnboardingIssue[]; disabledYes?: boolean }) {
  return (
    <ChoiceGroup
      label={props.label}
      hideLabel
      value={props.value ? "si" : "no"}
      onChange={(v) => props.onChange(v === "si")}
      issues={props.issues}
      options={[
        { value: "si", title: props.yes ?? "Sí", description: props.yesHint, disabled: props.disabledYes },
        { value: "no", title: props.no ?? "No", description: props.noHint },
      ]}
    />
  );
}

export function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-edge bg-ink px-4 py-3 transition-colors hover:border-lime/30 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
      <input id={id} type="checkbox" className={`mt-0.5 size-4 accent-lime ${focusRing}`} checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{props.label}</span>
        {props.hint && <span className="mt-0.5 block text-xs text-mist">{props.hint}</span>}
      </span>
    </label>
  );
}

/** Mensaje de error humano + código de soporte opcional. */
export function ErrorBanner({ message, code, children }: { message: string; code?: string; children?: ReactNode }) {
  return (
    <div role="alert" className={`rounded-2xl border border-red-500/40 bg-red-500/10 p-4 ${styles.fadeIn}`}>
      <p className="text-sm font-medium text-red-400">{message}</p>
      {children}
      {code && <p className="mt-1.5 font-mono text-[11px] text-mist">Código: {code}</p>}
    </div>
  );
}
