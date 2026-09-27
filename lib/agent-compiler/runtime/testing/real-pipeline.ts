// Business Agent 2.0, FASE 7 — arnés del pipeline REAL de un turno, sin red.
//
// Piezas reales (las mismas que producción):
//   GeminiExecutor (prompt confiable/no confiable, responseSchema, parse, campos prohibidos) → Understanding Engine
//   (contexto, validación, normalización, reintentos, circuito) → entidades del negocio (catálogo y horario) → state
//   machine (reducer, requisitos, siguiente paso) → Action Engine (autorización, confirmación, idempotencia, candados,
//   simulación) → renderer.
// Sustituido: SOLO el transporte HTTP del modelo (`fakeGemini`: responde por mensaje lo que diría el modelo, o falla
// como fallaría la API: timeout, 429, 500, salida no-JSON) y el handler de acciones (formas reales de los handlers).

import { compileLegacySpec } from "@/lib/agent-compiler/business-model/compile";
import { artifactRequirements, businessContextFromArtifact, type CompiledAgentArtifact } from "@/lib/agent-compiler/business-model/artifact";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import type { GeminiGenerateContentClient, GeminiGenerateContentParams, GeminiGenerateContentResult } from "@/lib/flow/gemini/gemini-types";
import { createExecutorUnderstandingProvider, geminiUnderstandingDispatch, type UnderstandingProvider } from "@/lib/agent-compiler/understanding/provider";
import { createCircuitBreaker, withCircuitBreaker, type CircuitBreaker, type UnderstandingRetryPolicy } from "@/lib/agent-compiler/understanding/resilience";
import { understandMessage, type UnderstandingEvent } from "@/lib/agent-compiler/understanding/engine";
import { createInMemoryConversationStore, type InMemoryConversationStore } from "@/lib/agent-compiler/conversation/testing/in-memory-conversation-store";
import { createFakeHandler, createInMemoryActionStore, createTestEngine, type FakeHandler } from "@/lib/agent-compiler/actions/testing/harness";
import type { InMemoryActionStore } from "@/lib/agent-compiler/actions/testing/in-memory-action-store";
import { createConversationRuntime, type ConversationRuntimeOutcome } from "@/lib/agent-compiler/runtime/production/conversation-runtime";
import type { BusinessAgentTurnTrace } from "@/lib/agent-compiler/runtime/production/turn-trace";
import type { ConversationStateKey } from "@/lib/agent-compiler/conversation/store";
import { loadTurnView } from "@/lib/agent-compiler/conversation/service";
import type { CatalogPort } from "@/lib/agent-compiler/conversation/entities";
import { compileBusinessAgent } from "@/lib/agent-compiler/compile";
import { buildGateRules, type GateRule } from "@/lib/agent-compiler/runtime/guardrail-gate";
import { runAgentTurn, type AgentTurnResult } from "@/lib/agent-compiler/runtime/agent-runtime";

export const START = Date.parse("2026-09-26T15:00:00Z"); // sábado 26-09-2026, 10:00 en Bogotá

export type ModelReply = Record<string, unknown>;
/** Lo que "responde la API" para un mensaje: la salida del modelo, o una falla de transporte. */
export type ModelBehavior = ModelReply | { fail: "timeout" | "429" | "500" | "network" | "auth" } | { raw: string };

export const out = (intent: string, slots: Array<{ name: string; raw: string; value?: string; correction?: boolean }> = [], confidence = 0.92, extra: Record<string, unknown> = {}): ModelReply => ({
  primaryIntent: { intent, confidence },
  secondaryIntents: [],
  slots,
  ambiguities: [],
  language: "es",
  ...extra,
});

/** Mensaje actual tal como viaja en el contenido NO confiable (JSON). */
export function currentMessageOf(params: GeminiGenerateContentParams): string | null {
  const text = params.contents.map((c) => c.text).join("\n");
  const m = /CURRENT_MESSAGE:\n("(?:[^"\\]|\\.)*")/.exec(text);
  return m ? (JSON.parse(m[1]!) as string) : null;
}

/** Tokens aproximados (≈4 caracteres por token) para el análisis de costo; la API real reporta los suyos. */
export const approxTokens = (s: string) => Math.ceil(s.length / 4);

export interface FakeGemini {
  client: GeminiGenerateContentClient;
  /** Todas las llamadas (parámetros completos: instrucción, contenido, esquema, temperatura). */
  calls: GeminiGenerateContentParams[];
  script(text: string, ...behaviors: ModelBehavior[]): void;
}

/** Transporte Gemini simulado: por mensaje, una secuencia de comportamientos (el último se repite). */
export function fakeGemini(): FakeGemini {
  const calls: GeminiGenerateContentParams[] = [];
  const scripts = new Map<string, ModelBehavior[]>();
  return {
    calls,
    script(text, ...behaviors) {
      scripts.set(text, behaviors);
    },
    client: {
      async generateContent(params, signal): Promise<GeminiGenerateContentResult> {
        calls.push(params);
        const msg = currentMessageOf(params);
        const queue = msg !== null ? scripts.get(msg) : undefined;
        if (!queue || queue.length === 0) throw Object.assign(new Error(`gemini_http_400: sin guion para ${JSON.stringify(msg)}`), { status: 400 });
        const b = queue.length > 1 ? queue.shift()! : queue[0]!;
        if ("fail" in b) {
          if (b.fail === "timeout") {
            await new Promise<void>((_, reject) => signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
          }
          const status = b.fail === "429" ? 429 : b.fail === "500" ? 503 : b.fail === "auth" ? 401 : null;
          if (status) throw Object.assign(new Error(`gemini_http_${status}`), { status });
          throw new Error("fetch failed");
        }
        const text = "raw" in b && typeof b.raw === "string" ? b.raw : JSON.stringify({ mode: "extract", extracted: b });
        const prompt = params.systemInstruction.length + params.contents.reduce((n, c) => n + c.text.length, 0);
        return { text, usage: { promptTokenCount: Math.ceil(prompt / 4), candidatesTokenCount: approxTokens(text) }, model: "gemini-test" };
      },
    },
  };
}

export interface PipelineOptions {
  tenantId: string;
  agentId?: string;
  phoneNumberId?: string;
  services?: readonly string[];
  simulation?: boolean;
  circuit?: CircuitBreaker;
  retry?: UnderstandingRetryPolicy;
  conversationStore?: InMemoryConversationStore;
  actionStore?: InMemoryActionStore;
  handler?: FakeHandler;
  gemini?: FakeGemini;
  /** Proveedor real (test en vivo con GEMINI_KEY). Sin él, el transporte del modelo es `fakeGemini`. */
  provider?: UnderstandingProvider;
}

export function artifactOf(spec: BusinessAgentSpec, tenantId: string, agentId = "flow-1", versionRef = "v1"): CompiledAgentArtifact {
  const r = compileLegacySpec(spec, { tenantId, agentId, versionRef, publishedVersion: null });
  if (!r.ok) throw new Error(`fixture no publicable: ${JSON.stringify(r.errors)}`);
  return r.artifact;
}

/** Un negocio con su runtime completo. Cada `say` es un mensaje de WhatsApp del mismo cliente. */
export function createPipeline(spec: BusinessAgentSpec, opts: PipelineOptions) {
  const agentId = opts.agentId ?? "flow-1";
  const artifact = artifactOf(spec, opts.tenantId, agentId);
  const key: ConversationStateKey = { tenantId: opts.tenantId, phoneNumberId: opts.phoneNumberId ?? "pn-a", telefonoCliente: "573001112233", agentId };
  let now = START;
  const clock = () => new Date(now);
  const gemini = opts.gemini ?? fakeGemini();
  const conversationStore = opts.conversationStore ?? createInMemoryConversationStore();
  const handler = opts.handler ?? createFakeHandler();
  const e = createTestEngine({ handler, store: opts.actionStore ?? createInMemoryActionStore() });
  const understandingEvents: UnderstandingEvent[] = [];
  const traces: BusinessAgentTurnTrace[] = [];
  const sent: string[] = [];
  const catalogLoads: string[] = [];
  const catalog: CatalogPort | undefined = opts.services
    ? { load: async () => (catalogLoads.push(opts.tenantId), { source: "business_tables" as const, services: opts.services!.map((name) => ({ name, durationMinutes: 30 })) }) }
    : undefined;
  const circuit = opts.circuit ?? createCircuitBreaker();
  const provider = opts.provider ?? withCircuitBreaker(createExecutorUnderstandingProvider({ dispatch: geminiUnderstandingDispatch(gemini.client, async () => "test-key") }), circuit, () => now);
  const requirements = opts.simulation ? { ...artifactRequirements(artifact), simulation: true } : artifactRequirements(artifact);
  const runtime = createConversationRuntime({
    service: {
      store: conversationStore,
      requirements,
      business: businessContextFromArtifact(artifact),
      understand: (input) =>
        understandMessage({ provider, clock, log: (ev) => understandingEvents.push(ev), sleep: async () => {}, ...(opts.retry ? { retry: opts.retry } : {}) }, input),
      catalog,
      businessHours: artifact.booking?.businessHours ?? null,
      clock,
      log: () => {},
    },
    engine: e.engine,
    artifact,
    simulation: opts.simulation === true,
    trace: (t) => traces.push(t),
    send: async (text) => void sent.push(text),
  });
  let seq = 0;

  // Camino del webhook: claim por wamid (como registrarMensaje) → Gate PRE-LLM → runtime conversacional.
  const compiled = compileBusinessAgent(spec, { tenantId: opts.tenantId });
  const gateRules: GateRule[] = compiled.success ? buildGateRules(compiled.ir) : [];
  const gate = { messages: [] as string[], transfers: [] as Array<{ text?: string; pauseHours: number }> };
  const claimed = new Set<string>();
  const webhook = async (text: string, behavior?: ModelBehavior | ModelBehavior[], wamid?: string): Promise<AgentTurnResult> => {
    if (behavior) gemini.script(text, ...(Array.isArray(behavior) ? behavior : [behavior]));
    now += 60_000;
    const sentAt = new Date(now).toISOString();
    return runAgentTurn(
      {
        tenantId: opts.tenantId,
        gateRules,
        flowId: agentId,
        orchestrator: { process: async () => Promise.reject(new Error("el grafo no debe usarse con el runtime conversacional")) },
        store: { getActiveExecution: async () => null },
        gateSink: {
          sendMessage: async (i) => void gate.messages.push(i.text),
          transferHuman: async (i) => void gate.transfers.push({ text: i.text, pauseHours: i.pauseHours }),
        },
        idempotency: { claim: async (t, w) => (claimed.has(`${t}:${w}`) ? false : (claimed.add(`${t}:${w}`), true)) },
        conversation: { handle: (i) => runtime.handle({ ...i, agentVersion: artifact.version.ref, sentAt }) },
        agentVersion: artifact.version.ref,
      },
      { tenantId: opts.tenantId, conversation: { phoneNumberId: key.phoneNumberId, telefonoCliente: key.telefonoCliente }, wamid: wamid ?? `wamid.${++seq}`, text },
    );
  };

  return {
    artifact,
    gateRules,
    gate,
    webhook,
    key,
    gemini,
    handler,
    engine: e,
    sent,
    traces,
    understandingEvents,
    catalogLoads,
    conversationStore,
    circuit,
    advance(minutes: number) {
      now += minutes * 60_000;
    },
    /** Envía un mensaje con su guion del modelo. `wamid` fijo = reenvío del mismo evento de WhatsApp. */
    async say(text: string, behavior?: ModelBehavior | ModelBehavior[], wamid?: string): Promise<ConversationRuntimeOutcome & { reply: string | undefined }> {
      if (behavior) gemini.script(text, ...(Array.isArray(behavior) ? behavior : [behavior]));
      now += 60_000;
      const before = sent.length;
      const r = await runtime.handle({ key, agentVersion: artifact.version.ref, wamid: wamid ?? `wamid.${++seq}`, text, sentAt: new Date(now).toISOString() });
      return { ...r, reply: sent.length > before ? sent.at(-1) : undefined };
    },
    state: async () => (await loadTurnView({ store: conversationStore, requirements }, key))?.state ?? null,
    calls: (action: string) => handler.calls.filter((c) => (c.action as { actionType: string }).actionType === action),
  };
}
