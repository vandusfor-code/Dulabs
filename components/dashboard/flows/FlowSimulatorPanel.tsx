"use client";

/**
 * Fase 1 (Flow Simulator, autorizado) — panel de simulación conversacional
 * dentro del Builder (spec §9-§24). Habla EXCLUSIVAMENTE con
 * `POST /api/flows/[id]/simulate` (vía lib/flow-builder/simulate-flow-client.ts)
 * -- nunca ejecuta lógica de flow por su cuenta, nunca llama a WhatsApp/IA
 * reales. Todo lo que se ve acá (transiciones, condiciones evaluadas,
 * variables, efectos simulados) es exactamente lo que devolvió el backend
 * (lib/flow/simulate-flow.ts), que a su vez corrió el MISMO motor puro que
 * producción.
 */

import { useMemo, useState } from "react";
import { Bot, CheckCircle2, MapPin, RotateCcw, Send, TriangleAlert, User, X } from "lucide-react";
import { simulateFlowTurn } from "@/lib/flow-builder/simulate-flow-client";
import type {
  ConditionEvaluationTrace,
  SimulatedEffectLogEntry,
  SimulationInputEvent,
  SimulationTransition,
  SimulationTurnResult,
} from "@/lib/flow/simulate-flow";
import type { FlowEngineState, FlowEngineStatus } from "@/lib/flow/engine-types";
import type { FlowButton, VariableDefinition } from "@/lib/flow/types";
import type { FlowValidationResult } from "@/lib/flow/errors";

interface ChatBubble {
  id: string;
  role: "bot" | "user" | "system";
  text: string;
  buttons?: FlowButton[];
  tone?: "error" | "info";
  nodeId?: string;
  timestamp: string;
}

const STATUS_LABEL: Record<FlowEngineStatus | "idle", string> = {
  idle: "Sin iniciar",
  running: "Ejecutando",
  waiting_input: "Esperando respuesta",
  waiting_effect: "Esperando efecto",
  completed: "Finalizado",
  failed: "Error",
  transferred: "Transferido a asesor",
};

const STATUS_TONE: Record<FlowEngineStatus | "idle", string> = {
  idle: "text-mist",
  running: "text-lime-text",
  waiting_input: "text-amber-400",
  waiting_effect: "text-amber-400",
  completed: "text-lime-text",
  failed: "text-red-400",
  transferred: "text-blue-300",
};

function uid(): string {
  return Math.random().toString(36).slice(2);
}

function nowIso(): string {
  return new Date().toISOString();
}

function messageText(content: { text?: string; parts?: string[]; media?: { caption?: string } }): string {
  if (content.text) return content.text;
  if (content.parts?.length) return content.parts.join("\n\n");
  if (content.media?.caption) return content.media.caption;
  return "(mensaje sin texto)";
}

function coerceInitialValue(def: VariableDefinition, raw: string): unknown {
  if (raw === "") return undefined;
  if (def.type === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (def.type === "boolean") return raw === "true";
  return raw;
}

function transitionLabel(t: SimulationTransition, nodeLabel: (id: string) => string): string {
  const from = t.fromNodeId ? nodeLabel(t.fromNodeId) : "(inicio)";
  const to = nodeLabel(t.toNodeId);
  const reasonLabel: Record<SimulationTransition["reason"], string> = {
    start: "inicio",
    auto: "automático",
    condition_true: "condición → TRUE",
    condition_false: "condición → FALSE",
    button: "clic de botón",
    text: "texto libre",
    effect_success: "efecto exitoso",
    effect_failure: "efecto falló",
    ai_classification: "clasificación IA",
  };
  const suffix = t.ambiguous ? " (camino intermedio no determinado)" : "";
  return `${from} → ${to} (${reasonLabel[t.reason]})${suffix}`;
}

export interface FlowSimulatorPanelProps {
  open: boolean;
  onClose: () => void;
  flowId: string;
  accessToken: string;
  /** Variables declaradas del flow -- fuente de los campos del formulario "Variables de prueba" (spec §13). */
  flowVariables: VariableDefinition[];
  nodeLabel: (nodeId: string) => string;
  /** Centra el nodo en el canvas (reutiliza FlowCanvasHandle.centerOnNode ya existente). */
  onCenterNode: (nodeId: string) => void;
  /** El Builder usa esto para resaltar el nodo activo en FlowCanvas (spec §11). */
  onActiveNodeChange: (nodeId: string | null) => void;
}

export function FlowSimulatorPanel({
  open,
  onClose,
  flowId,
  accessToken,
  flowVariables,
  nodeLabel,
  onCenterNode,
  onActiveNodeChange,
}: FlowSimulatorPanelProps) {
  const [phase, setPhase] = useState<"setup" | "running">("setup");
  const [testVarInputs, setTestVarInputs] = useState<Record<string, string>>({});
  const [extraVars, setExtraVars] = useState<{ key: string; value: string }[]>([]);

  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [engineState, setEngineState] = useState<FlowEngineState | null>(null);
  const [status, setStatus] = useState<FlowEngineStatus | "idle">("idle");
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [currentButtons, setCurrentButtons] = useState<FlowButton[] | undefined>(undefined);
  const [expectedInput, setExpectedInput] = useState<"text" | "button" | undefined>(undefined);
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  const [transitions, setTransitions] = useState<SimulationTransition[]>([]);
  const [conditionEvaluations, setConditionEvaluations] = useState<ConditionEvaluationTrace[]>([]);
  const [effectsLog, setEffectsLog] = useState<SimulatedEffectLogEntry[]>([]);

  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [blockedValidation, setBlockedValidation] = useState<FlowValidationResult | null>(null);
  const [showErrorsDetail, setShowErrorsDetail] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"variables" | "history" | "effects">("variables");

  const lastTransition = transitions.length > 0 ? transitions[transitions.length - 1]! : null;

  const initialVariablesMerged = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const def of flowVariables) {
      const raw = testVarInputs[def.key];
      if (raw !== undefined) {
        const value = coerceInitialValue(def, raw);
        if (value !== undefined) out[def.key] = value;
      }
    }
    for (const extra of extraVars) {
      if (extra.key.trim()) out[extra.key.trim()] = extra.value;
    }
    return out;
  }, [flowVariables, testVarInputs, extraVars]);

  function resetSimulationState() {
    setBubbles([]);
    setEngineState(null);
    setStatus("idle");
    setCurrentNodeId(null);
    setCurrentButtons(undefined);
    setExpectedInput(undefined);
    setVariables({});
    setTransitions([]);
    setConditionEvaluations([]);
    setEffectsLog([]);
    setApiError(null);
    setBlockedValidation(null);
    onActiveNodeChange(null);
  }

  function applyTurn(turn: SimulationTurnResult) {
    setEngineState(turn.engineState);
    setStatus(turn.status);
    setCurrentNodeId(turn.currentNodeId);
    setCurrentButtons(turn.currentButtons);
    setExpectedInput(turn.expectedInput);
    setVariables(turn.variables);
    setTransitions((prev) => [...prev, ...turn.transitions]);
    setConditionEvaluations((prev) => [...prev, ...turn.conditionEvaluations]);
    setEffectsLog((prev) => [...prev, ...turn.effectsLog]);
    onActiveNodeChange(turn.currentNodeId);

    const next: ChatBubble[] = [];
    for (const m of turn.messages) {
      next.push({ id: uid(), role: "bot", text: messageText(m.content), buttons: m.buttons, timestamp: nowIso() });
    }
    if (turn.humanHandoff) {
      next.push({ id: uid(), role: "system", tone: "info", text: "Esta conversación sería transferida a un asesor.", timestamp: nowIso() });
    }
    if (turn.completed) {
      next.push({ id: uid(), role: "system", tone: "info", text: "✓ Flow finalizado", timestamp: nowIso() });
    }
    if (turn.error) {
      next.push({
        id: uid(),
        role: "system",
        tone: "error",
        nodeId: turn.error.nodeId ?? undefined,
        text: `❌ No se pudo continuar — Nodo: ${turn.error.nodeId ?? "desconocido"} — Problema: ${turn.error.message}`,
        timestamp: nowIso(),
      });
    }
    setBubbles((prev) => [...prev, ...next]);
  }

  async function sendTurn(event: SimulationInputEvent, opts?: { fresh?: boolean }) {
    setLoading(true);
    setApiError(null);
    const result = await simulateFlowTurn({
      flowId,
      event,
      engineState: opts?.fresh ? null : engineState,
      accessToken,
      initialVariables: opts?.fresh ? initialVariablesMerged : undefined,
    });
    setLoading(false);
    if (!result.ok) {
      if (result.error.kind === "invalid_flow" && result.error.validation) {
        setBlockedValidation(result.error.validation);
      } else {
        setApiError(result.error.message);
      }
      return;
    }
    setBlockedValidation(null);
    applyTurn(result.turn);
  }

  function handleStart() {
    resetSimulationState();
    setPhase("running");
    void sendTurn({ type: "start" }, { fresh: true });
  }

  function handleReset() {
    resetSimulationState();
    setPhase("setup");
  }

  function handleSendText() {
    const text = inputText.trim();
    if (!text || loading) return;
    setBubbles((prev) => [...prev, { id: uid(), role: "user", text, timestamp: nowIso() }]);
    setInputText("");
    void sendTurn({ type: "text", text });
  }

  function handleClickButton(button: FlowButton) {
    if (loading) return;
    setBubbles((prev) => [...prev, { id: uid(), role: "user", text: button.label, timestamp: nowIso() }]);
    void sendTurn({ type: "button", id: button.id });
  }

  if (!open) return null;

  const canType = phase === "running" && status === "waiting_input" && expectedInput === "text" && !currentButtons?.length;
  const isTerminal = status === "completed" || status === "failed" || status === "transferred";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50" role="dialog" aria-modal="true">
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-edge bg-card shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-edge px-5 py-3">
          <h2 className="flex-1 text-sm font-semibold text-fg">▶ Probar Flow</h2>
          <button
            type="button"
            onClick={handleReset}
            disabled={phase === "setup"}
            title="Reiniciar simulación"
            className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-mist transition-colors hover:border-lime/40 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="size-3.5" /> Reiniciar
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Volver al Builder"
            className="rounded-lg p-1.5 text-mist transition-colors hover:bg-ink hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>

        {blockedValidation && (
          <div className="shrink-0 border-b border-edge bg-red-500/10 px-5 py-3 text-xs text-danger-text">
            <p className="font-semibold">Este flow tiene errores que deben corregirse antes de simular.</p>
            <button type="button" onClick={() => setShowErrorsDetail((v) => !v)} className="mt-1 underline underline-offset-2">
              {showErrorsDetail ? "Ocultar errores" : "[Ver errores]"}
            </button>
            {showErrorsDetail && (
              <ul className="mt-2 space-y-1">
                {blockedValidation.errors.map((e, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span>{e.message}</span>
                    {e.nodeId && (
                      <button
                        type="button"
                        onClick={() => onCenterNode(e.nodeId!)}
                        className="shrink-0 underline underline-offset-2 hover:text-red-300"
                      >
                        [Ir al nodo]
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {apiError && (
          <div className="shrink-0 border-b border-edge bg-red-500/10 px-5 py-2 text-xs text-danger-text">{apiError}</div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* Chat */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {phase === "setup" && (
                <div className="mx-auto max-w-sm rounded-xl border border-edge bg-ink/40 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-mist">Variables de prueba (opcional)</p>
                  {flowVariables.length === 0 && <p className="mb-2 text-xs text-mist">Este flow no declara variables.</p>}
                  <div className="space-y-2">
                    {flowVariables.map((def) => (
                      <label key={def.key} className="block text-xs text-mist">
                        {def.label} <span className="text-[10px] text-mist/60">({def.key})</span>
                        <input
                          type={def.type === "number" ? "number" : "text"}
                          value={testVarInputs[def.key] ?? (def.defaultValue !== undefined ? String(def.defaultValue) : "")}
                          onChange={(e) => setTestVarInputs((prev) => ({ ...prev, [def.key]: e.target.value }))}
                          className="mt-1 w-full rounded-md border border-edge bg-card px-2 py-1 text-xs text-fg"
                        />
                      </label>
                    ))}
                  </div>
                  {extraVars.map((extra, i) => (
                    <div key={i} className="mt-2 flex gap-1.5">
                      <input
                        placeholder="clave"
                        value={extra.key}
                        onChange={(e) =>
                          setExtraVars((prev) => prev.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)))
                        }
                        className="w-1/2 rounded-md border border-edge bg-card px-2 py-1 text-xs text-fg"
                      />
                      <input
                        placeholder="valor"
                        value={extra.value}
                        onChange={(e) =>
                          setExtraVars((prev) => prev.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))
                        }
                        className="w-1/2 rounded-md border border-edge bg-card px-2 py-1 text-xs text-fg"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setExtraVars((prev) => [...prev, { key: "", value: "" }])}
                    className="mt-2 text-xs text-mist underline underline-offset-2 hover:text-fg"
                  >
                    + agregar variable
                  </button>
                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={loading}
                    className="btn-shine mt-4 w-full rounded-lg bg-lime px-3.5 py-2 text-xs font-semibold text-lime-fg transition-colors hover:bg-lime-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? "Iniciando…" : "▶ Iniciar simulación"}
                  </button>
                </div>
              )}

              {bubbles.map((b) => (
                <div key={b.id} className={`flex ${b.role === "user" ? "justify-end" : "justify-start"}`}>
                  {b.role === "system" ? (
                    <div
                      className={`mx-auto max-w-[85%] rounded-lg px-3 py-2 text-center text-xs ${
                        b.tone === "error" ? "bg-red-500/10 text-danger-text" : "bg-ink/60 text-mist"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{b.text}</p>
                      {b.nodeId && (
                        <button
                          type="button"
                          onClick={() => onCenterNode(b.nodeId!)}
                          className="mt-1 inline-flex items-center gap-1 underline underline-offset-2 hover:text-fg"
                        >
                          <MapPin className="size-3" /> [Ir al nodo]
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className={`flex max-w-[80%] items-end gap-2 ${b.role === "user" ? "flex-row-reverse" : ""}`}>
                      <div
                        className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                          b.role === "user" ? "bg-lime/20 text-lime-text" : "bg-ink text-mist"
                        }`}
                      >
                        {b.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                      </div>
                      <div>
                        <div
                          className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                            b.role === "user" ? "rounded-br-sm bg-lime text-lime-fg" : "rounded-bl-sm bg-ink text-fg"
                          }`}
                        >
                          {b.text}
                        </div>
                        {b.buttons && b.buttons.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {b.buttons.map((btn) => (
                              <button
                                key={btn.id}
                                type="button"
                                onClick={() => handleClickButton(btn)}
                                disabled={loading || currentButtons === undefined}
                                className="rounded-full border border-lime/40 px-3 py-1 text-xs font-medium text-lime-text transition-colors hover:bg-lime/10 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {loading && phase === "running" && <p className="text-center text-xs text-mist">Simulando…</p>}

              {isTerminal && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex items-center gap-1.5 rounded-full border border-edge px-3.5 py-1.5 text-xs font-medium text-mist hover:border-lime/40 hover:text-fg"
                  >
                    <RotateCcw className="size-3.5" /> Reiniciar simulación
                  </button>
                </div>
              )}
            </div>

            {phase === "running" && !isTerminal && (
              <div className="shrink-0 border-t border-edge p-3">
                {currentButtons && currentButtons.length > 0 ? (
                  <p className="text-center text-xs text-mist">Elige una opción arriba para continuar…</p>
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSendText();
                      }}
                      disabled={!canType && expectedInput !== "text"}
                      placeholder={canType ? "Escribe tu respuesta…" : "Esperando…"}
                      className="flex-1 rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-fg placeholder:text-mist/50"
                    />
                    <button
                      type="button"
                      onClick={handleSendText}
                      disabled={loading || !inputText.trim()}
                      className="flex items-center gap-1.5 rounded-lg bg-lime px-3.5 py-2 text-xs font-semibold text-lime-fg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Inspector */}
          <div className="flex w-72 shrink-0 flex-col border-l border-edge bg-ink/30">
            <div className="shrink-0 border-b border-edge px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-mist">Estado</p>
              <p className={`mt-1 text-sm font-medium ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</p>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-mist">Nodo actual</p>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-fg">
                {currentNodeId ? nodeLabel(currentNodeId) : "—"}
                {currentNodeId && (
                  <button type="button" onClick={() => onCenterNode(currentNodeId)} title="Ir al nodo en el canvas">
                    <MapPin className="size-3.5 text-mist hover:text-fg" />
                  </button>
                )}
              </p>
              {lastTransition && (
                <>
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-mist">Última transición</p>
                  <p className="mt-1 text-xs text-mist">{transitionLabel(lastTransition, nodeLabel)}</p>
                </>
              )}
            </div>

            <div className="flex shrink-0 border-b border-edge text-[11px] font-medium">
              {(["variables", "history", "effects"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setInspectorTab(tab)}
                  className={`flex-1 px-2 py-2 uppercase tracking-wide ${
                    inspectorTab === tab ? "border-b-2 border-lime text-fg" : "text-mist hover:text-fg"
                  }`}
                >
                  {tab === "variables" ? "Variables" : tab === "history" ? "Recorrido" : "Efectos"}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {inspectorTab === "variables" && (
                <div className="space-y-1.5">
                  {Object.keys(variables).length === 0 && <p className="text-xs text-mist">Sin variables todavía.</p>}
                  {Object.entries(variables).map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-2 text-xs">
                      <span className="font-mono text-mist">{key}</span>
                      <span className="truncate text-right text-fg">{value === undefined || value === "" ? "—" : String(value)}</span>
                    </div>
                  ))}
                  {conditionEvaluations.length > 0 && (
                    <div className="mt-3 border-t border-edge pt-2">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mist">Condiciones evaluadas</p>
                      {conditionEvaluations.map((c, i) => (
                        <p key={i} className="text-xs text-mist">
                          {nodeLabel(c.nodeId)}:{" "}
                          <span className={c.result === true ? "text-lime-text" : c.result === false ? "text-red-400" : "text-mist"}>
                            {c.result === "unknown" ? "no determinado" : c.result ? "TRUE" : "FALSE"}
                          </span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {inspectorTab === "history" && (
                <div className="space-y-2">
                  {transitions.length === 0 && <p className="text-xs text-mist">Sin recorrido todavía.</p>}
                  {transitions.map((t, i) => (
                    <div key={i} className="text-xs">
                      <p className="text-fg">{transitionLabel(t, nodeLabel)}</p>
                      <p className="text-[10px] text-mist">{new Date(t.timestamp).toLocaleTimeString()}</p>
                    </div>
                  ))}
                </div>
              )}

              {inspectorTab === "effects" && (
                <div className="space-y-2">
                  {effectsLog.length === 0 && <p className="text-xs text-mist">Sin efectos simulados todavía.</p>}
                  {effectsLog.map((e, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs">
                      {e.success ? (
                        <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-lime-text" />
                      ) : (
                        <TriangleAlert className="mt-0.5 size-3 shrink-0 text-red-400" />
                      )}
                      <span className="text-mist">{e.summary}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
