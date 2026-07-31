"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SurveyQuestion } from "@/lib/survey-builder";
import {
  createSession,
  handleMessage,
  inviteSurvey,
  startSurvey,
  type EngineResult,
  type SurveyBotConfig,
  type SurveySession,
} from "@/lib/survey-engine";

// Simulador en vivo del motor real (lib/survey-engine.ts), cero red — prueba
// de verdad las preguntas/config actuales, incluso antes de guardarlas.
// Compartido entre el panel de Agentes de IA y el Builder de /dashboard/surveys.

type ChatMsg = { role: "bot" | "user"; text: string };

interface SimState {
  messages: ChatMsg[];
  session: SurveySession;
  quick: string[];
  closed: boolean;
}

function initSim(config: SurveyBotConfig, questions: SurveyQuestion[]): SimState {
  const closeDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const res = inviteSurvey(config, questions, createSession(closeDate));
  return {
    messages: res.messages.map((text): ChatMsg => ({ role: "bot", text })),
    session: res.session,
    quick: res.quickReplies ?? [],
    closed: false,
  };
}

export function SurveySimulator({ config, questions }: { config: SurveyBotConfig; questions: SurveyQuestion[] }) {
  const { t } = useI18n();
  const [sim, setSim] = useState<SimState>(() => initSim(config, questions));
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [sim.messages]);

  const reset = useCallback(() => {
    setSim(initSim(config, questions));
    setInput("");
  }, [config, questions]);

  const send = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value || sim.closed) return;
      setInput("");
      const res: EngineResult =
        sim.session.status === "invited" && /^(comenzar|s[ií]|ok|dale|listo|vamos|empezar)$/i.test(value)
          ? startSurvey(config, questions, sim.session)
          : handleMessage(config, questions, sim.session, value);
      setSim((prev) => ({
        messages: [...prev.messages, { role: "user", text: value }, ...res.messages.map((tx): ChatMsg => ({ role: "bot", text: tx }))],
        session: res.session,
        quick: res.quickReplies ?? [],
        closed: res.action === "completed" || res.action === "closed",
      }));
    },
    [sim.session, sim.closed, config, questions]
  );

  const answered = Object.keys(sim.session.answers).length;
  const total = questions.filter((q) => q.type !== "message").length;

  return (
    <div className="flex flex-col rounded-xl border border-edge bg-ink">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-fg">{t("Simulador en vivo", "Live simulator")}</p>
          <p className="mt-0.5 text-[11px] text-mist">
            {t("Estado", "Status")}: <span className="text-fg">{sim.session.status}</span> · {answered}/{total}
          </p>
        </div>
        <button
          onClick={reset}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-mist transition-colors hover:text-fg"
        >
          <RotateCcw className="size-3.5" /> {t("Reiniciar", "Restart")}
        </button>
      </div>

      <div ref={scrollRef} className="h-80 space-y-2 overflow-y-auto p-3">
        {sim.messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <p
              className={`max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-lime/15 text-fg" : "bg-card text-fg"
              }`}
            >
              {m.text}
            </p>
          </div>
        ))}
      </div>

      {sim.quick.length > 0 && !sim.closed && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {sim.quick.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="rounded-full border border-edge bg-card px-2.5 py-1 text-xs text-fg transition-colors hover:border-lime/40"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-edge p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          disabled={sim.closed}
          placeholder={sim.closed ? t("Encuesta finalizada — reinicia para probar de nuevo", "Survey ended — restart to try again") : t("Responde como lo haría un participante…", "Reply as a participant would…")}
          className="w-full rounded-lg border border-edge bg-card px-3 py-2 text-sm text-fg outline-none focus:border-lime/50 disabled:opacity-50"
        />
        <button
          onClick={() => send(input)}
          disabled={sim.closed || !input.trim()}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-lime text-lime-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          aria-label={t("Enviar", "Send")}
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}
