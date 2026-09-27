"use client";

// Business Agent 2.0, FASE 6 — "Prueba": vista previa con el borrador (SIMULACIÓN real del servidor: nada se reserva,
// transfiere ni envía) y "Prueba tu agente" (conversaciones de ejemplo con verificaciones).

import { useState, type FormEvent } from "react";
import { Check, FlaskConical, Loader2, RotateCcw, Send, X } from "lucide-react";
import type { ScenarioResult } from "@/lib/agent-compiler/onboarding/scenarios";
import { previewOnboarding, testOnboardingAgent, type OnboardingAuth } from "@/lib/business-agent-onboarding-client";
import { ErrorBanner, inputCls, primaryBtn, secondaryBtn } from "@/components/dashboard/business-agent/onboarding/controls";
import { motion as styles } from "@/components/dashboard/business-agent/onboarding/motion";

interface Msg {
  from: "cliente" | "agente";
  text: string;
}

export function TestStep({ auth, ensureSaved, blocked }: { auth: OnboardingAuth; ensureSaved: () => Promise<boolean>; blocked: boolean }) {
  return (
    <div className="space-y-8">
      <p className="flex items-start gap-2 rounded-2xl border border-lime/30 bg-lime/10 p-4 text-sm text-fg">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-lime-text" aria-hidden="true" />
        <span>
          <strong>Modo prueba.</strong> Todo lo que pase aquí es una simulación con tu configuración actual: no se crean citas, no se envían mensajes y
          nadie recibe nada.
        </span>
      </p>
      {blocked ? (
        <ErrorBanner message="Completa los datos marcados en los pasos anteriores para poder probar tu agente." code="BA-SIM-001" />
      ) : (
        <>
          <PreviewChat auth={auth} ensureSaved={ensureSaved} />
          <AgentTests auth={auth} ensureSaved={ensureSaved} />
        </>
      )}
    </div>
  );
}

export function PreviewChat({ auth, ensureSaved }: { auth: OnboardingAuth; ensureSaved: () => Promise<boolean> }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [state, setState] = useState<unknown>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    if (!(await ensureSaved())) {
      setBusy(false);
      setError({ message: "No pudimos guardar tus últimos cambios. Revisa tu conexión e intenta de nuevo.", code: "BA-DRF-003" });
      return;
    }
    setMessages((m) => [...m, { from: "cliente", text: t }]);
    setText("");
    const r = await previewOnboarding(auth, { text: t, state });
    setBusy(false);
    if (!r.ok) {
      if (r.error.code === "BA-SIM-003") setState(null);
      setError({ message: r.error.message, code: r.error.code });
      return;
    }
    setState(r.data.state);
    setMessages((m) => [...m, ...r.data.replies.map((x) => ({ from: "agente" as const, text: x }))]);
  };

  return (
    <section aria-labelledby="preview-title" className="rounded-2xl border border-edge bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <div>
          <h3 id="preview-title" className="text-sm font-semibold text-fg">
            Habla con tu agente
          </h3>
          <p className="text-xs text-mist">Escribe como lo haría un cliente.</p>
        </div>
        <button
          type="button"
          className={`${secondaryBtn} py-1.5 text-xs`}
          onClick={() => {
            setMessages([]);
            setState(null);
            setError(null);
          }}
        >
          <RotateCcw className="size-3.5" /> Reiniciar
        </button>
      </header>
      <div role="log" aria-live="polite" aria-label="Conversación de prueba" className="max-h-96 min-h-48 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && <p className="text-sm text-mist">Prueba con «Hola» o «Quiero una cita mañana en la tarde».</p>}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.from === "cliente" ? "justify-end" : "justify-start"} ${styles.fadeIn}`}>
            <p className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm ${m.from === "cliente" ? "rounded-br-md bg-lime text-lime-fg" : "rounded-bl-md border border-edge bg-ink text-fg"}`}>
              <span className="sr-only">{m.from === "cliente" ? "Tú: " : "Agente: "}</span>
              {m.text}
            </p>
          </div>
        ))}
        {busy && (
          <p className={`text-xs text-mist ${styles.working}`} aria-label="El agente está respondiendo">
            Tu agente está escribiendo…
          </p>
        )}
      </div>
      {error && (
        <div className="px-4 pb-3">
          <ErrorBanner message={error.message} code={error.code} />
        </div>
      )}
      <form onSubmit={send} className="flex gap-2 border-t border-edge p-3">
        <label htmlFor="preview-input" className="sr-only">
          Mensaje de prueba
        </label>
        <input id="preview-input" className={inputCls} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Escribe un mensaje…" autoComplete="off" />
        <button type="submit" className={primaryBtn} disabled={busy || !text.trim()} aria-label="Enviar mensaje de prueba">
          {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Send className="size-4" />}
        </button>
      </form>
    </section>
  );
}

export function AgentTests({ auth, ensureSaved }: { auth: OnboardingAuth; ensureSaved: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ScenarioResult[] | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    if (!(await ensureSaved())) {
      setBusy(false);
      setError({ message: "No pudimos guardar tus últimos cambios. Revisa tu conexión e intenta de nuevo.", code: "BA-DRF-003" });
      return;
    }
    const r = await testOnboardingAgent(auth);
    setBusy(false);
    if (!r.ok) return setError({ message: r.error.message, code: r.error.code });
    setResults(r.data.scenarios);
  };
  return (
    <section aria-labelledby="tests-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="tests-title" className="text-sm font-semibold text-fg">
            Prueba tu agente
          </h3>
          <p className="text-xs text-mist">Corremos conversaciones de ejemplo con tu configuración y te mostramos qué hizo tu agente.</p>
        </div>
        <button type="button" className={primaryBtn} onClick={run} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <FlaskConical className="size-4" />}
          {busy ? "Probando…" : results ? "Probar de nuevo" : "Probar mi agente"}
        </button>
      </div>
      {error && <ErrorBanner message={error.message} code={error.code} />}
      {results && (
        <ul className="space-y-3" aria-live="polite">
          {results.map((s, i) => (
            <li key={s.id} className={`rounded-2xl border border-edge bg-card p-4 ${styles.stepIn}`} style={{ animationDelay: `${i * 70}ms` }}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-fg">{s.title}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.passed ? "bg-lime/15 text-lime-text" : "bg-red-500/15 text-red-400"}`}>{s.passed ? "Bien" : "Revisar"}</span>
              </div>
              <ul className="mt-2 space-y-1">
                {s.checks.map((c, k) => (
                  <li key={k} className="flex items-start gap-2 text-sm">
                    {c.ok ? <Check className={`mt-0.5 size-4 shrink-0 text-lime-text ${styles.checkPop}`} aria-label="Correcto" /> : <X className="mt-0.5 size-4 shrink-0 text-red-400" aria-label="Por revisar" />}
                    <span className={c.ok ? "text-fg" : "text-red-400"}>
                      {c.label}
                      {c.detail && <span className="block text-xs text-mist">{c.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-mist hover:text-fg">Ver la conversación</summary>
                <ol className="mt-2 space-y-1.5">
                  {s.transcript.map((t, k) => (
                    <li key={k} className="text-xs">
                      <span className="font-semibold text-fg">{t.from === "cliente" ? "Cliente" : "Tu agente"}: </span>
                      <span className="text-mist">{t.text}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-mist">
        Estas pruebas leen cada mensaje de ejemplo de forma fija para darte un resultado estable. Cómo entiende mensajes escritos a tu manera lo ves en
        «Habla con tu agente».
      </p>
    </section>
  );
}
