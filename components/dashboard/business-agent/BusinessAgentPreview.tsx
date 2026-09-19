"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Send, ShieldAlert, UserRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDashboard } from "@/lib/dashboard-session";
import { previewBusinessAgent, type PreviewResponse } from "@/lib/business-agent-client";

/**
 * Bloque 12G -- chat de prueba REAL contra el Business Agent compilado
 * (Gate PRE-LLM + Flow Engine vía simulador, ver lib/agent-compiler/api/preview.ts).
 * Mismo patrón visual que SurveySimulator.tsx, pero cada turno es una
 * llamada de red a POST /api/business-agent/preview (el motor real corre en
 * el servidor, nunca en el navegador) -- nunca toca WhatsApp/Claude/DB reales.
 */

type ChatMsg = { role: "bot" | "user" | "system"; text: string };

export function BusinessAgentPreview({ flowVersionId }: { flowVersionId: string }) {
  const { t } = useI18n();
  const { session } = useDashboard();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [engineState, setEngineState] = useState<unknown>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const reset = useCallback(() => {
    setMessages([]);
    setEngineState(null);
    setClosed(false);
    setError(null);
    setInput("");
  }, []);

  const applyResult = useCallback((result: PreviewResponse) => {
    const nuevos: ChatMsg[] = [];
    if (result.gate.decision !== "pass") {
      if (result.gate.response) nuevos.push({ role: "bot", text: result.gate.response });
      nuevos.push({
        role: "system",
        text:
          result.gate.decision === "block"
            ? t("Guardrail: mensaje bloqueado (sin respuesta).", "Guardrail: message blocked (no reply).")
            : result.gate.decision === "transfer_human"
              ? t("Guardrail: transferido a un humano.", "Guardrail: transferred to a human.")
              : t("Guardrail: respuesta fija.", "Guardrail: fixed response."),
      });
      setClosed(result.gate.decision === "transfer_human");
    } else if (result.turn) {
      for (const m of result.turn.messages) nuevos.push({ role: "bot", text: m.content.text ?? m.content.parts?.join("\n") ?? "" });
      if (result.turn.humanHandoff) {
        nuevos.push({ role: "system", text: t("Transferido a un humano -- la automatización se pausa.", "Transferred to a human -- automation pauses.") });
        setClosed(true);
      }
      if (result.turn.completed) {
        nuevos.push({ role: "system", text: t("Conversación finalizada.", "Conversation completed.") });
        setClosed(true);
      }
      if (result.turn.error) {
        nuevos.push({ role: "system", text: t("Error del motor: ", "Engine error: ") + result.turn.error.message });
      }
      setEngineState(result.turn.engineState);
    }
    setMessages((prev) => [...prev, ...nuevos]);
  }, [t]);

  const send = useCallback(
    async (event: { type: "start" } | { type: "text"; text: string }) => {
      if (!session || loading || closed) return;
      setLoading(true);
      setError(null);
      if (event.type === "text") setMessages((prev) => [...prev, { role: "user", text: event.text }]);
      const result = await previewBusinessAgent({
        accessToken: session.access_token,
        flowVersionId,
        engineState,
        event,
      });
      setLoading(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      applyResult(result.data);
    },
    [session, loading, closed, engineState, flowVersionId, applyResult],
  );

  useEffect(() => {
    // Arranca el preview al montar/cambiar de versión -- intencional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (messages.length === 0) void send({ type: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowVersionId]);

  const submit = () => {
    const value = input.trim();
    if (!value) return;
    setInput("");
    void send({ type: "text", text: value });
  };

  return (
    <div className="flex flex-col rounded-xl border border-edge bg-ink">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-fg">{t("Vista previa conversacional", "Conversation preview")}</p>
          <p className="mt-0.5 text-[11px] text-mist">{t("100% simulado -- no envía WhatsApp real ni ejecuta acciones de negocio.", "100% simulated -- no real WhatsApp sent, no business actions executed.")}</p>
        </div>
        <button onClick={reset} className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-mist transition-colors hover:text-fg">
          <RotateCcw className="size-3.5" /> {t("Reiniciar", "Restart")}
        </button>
      </div>

      <div ref={scrollRef} className="h-96 space-y-2 overflow-y-auto p-3">
        {messages.map((m, i) =>
          m.role === "system" ? (
            <div key={i} className="flex items-center justify-center gap-1.5 py-1 text-center text-[11px] text-mist">
              <ShieldAlert className="size-3" /> {m.text}
            </div>
          ) : (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-lime/15 text-fg" : "bg-card text-fg"}`}>{m.text}</p>
            </div>
          ),
        )}
        {loading && (
          <div className="flex items-center gap-1.5 text-xs text-mist">
            <Loader2 className="size-3.5 animate-spin" /> {t("Pensando…", "Thinking…")}
          </div>
        )}
      </div>

      {error && <p className="mx-3 mb-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-2 border-t border-edge p-3">
        <UserRound className="size-4 shrink-0 text-mist" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          disabled={closed || loading}
          placeholder={closed ? t("Conversación finalizada -- reinicia para probar de nuevo", "Conversation ended -- restart to try again") : t("Escribe como lo haría un cliente…", "Type as a customer would…")}
          className="w-full rounded-lg border border-edge bg-card px-3 py-2 text-sm text-fg outline-none focus:border-lime/50 disabled:opacity-50"
        />
        <button
          onClick={submit}
          disabled={closed || loading || !input.trim()}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-lime text-lime-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          aria-label={t("Enviar", "Send")}
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}
