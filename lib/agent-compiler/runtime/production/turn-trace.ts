// DuLabs Business — Business Agent 2.0, FASE 7 — traza reconstruible de UN turno conversacional.
//
// Una línea estructurada por mensaje (`[business-agent.turn]`) con la que se reconstruye qué pasó, sin secretos ni
// valores del cliente:
//   message_id · tenant · agente · versión publicada (y huella del artefacto) · simulación
//   entendimiento (intent, banda, ESTADO de cada dato, resolución de entidades, proveedor, modelo, intentos, tokens)
//   estado antes / después (estado, objetivo, estado de cada dato, acción pendiente)
//   solicitudes y resultados de acciones (acción, propósito, ref de la solicitud, estado, código, motivo, simulada)
//   respuesta (intención del plan, enviada, largo y hash del texto: se correlaciona con el log de WhatsApp sin copiarlo)
//   latencias por etapa (entendimiento, estado, acciones, respuesta, total)
// El texto del cliente, los valores de los datos y la respuesta NO se copian aquí.

import { createHash } from "node:crypto";
import type { StateSnapshot, TurnUnderstanding } from "@/lib/agent-compiler/conversation/service";
import type { ActionResult } from "@/lib/agent-compiler/actions/result";

export interface TurnActionTrace {
  action: string;
  purpose: string;
  /** Ref corta de la solicitud (hash de su id idempotente). */
  requestRef: string;
  status: ActionResult["status"];
  errorCode: string | null;
  reason: string | null;
  simulated: boolean;
  replayed: boolean;
  durationMs: number;
  /** FASE 8 — error BA-* (clase + motivo) si la acción no tuvo éxito. */
  baError?: string;
}

export interface TurnUnderstandingTrace {
  ok: boolean;
  intent?: string;
  band?: string;
  secondary?: string[];
  /** Estado de cada dato entendido (resolved / ambiguous / invalid…), nunca su valor. */
  slots?: Record<string, string>;
  entities?: Record<string, string>;
  ambiguities?: string[];
  handoff?: string | null;
  provider?: string;
  model?: string;
  attempts?: number;
  inputTokens?: number;
  outputTokens?: number;
  offeringsInContext?: number;
  errorCategory?: string;
  errorCode?: string;
}

export interface BusinessAgentTurnTrace {
  event: "business_agent.turn";
  messageId: string;
  tenantId: string;
  agentId: string;
  publishedVersion: string;
  artifactFingerprint: string;
  simulation: boolean;
  outcome: string;
  understanding: TurnUnderstandingTrace | null;
  stateBefore: StateSnapshot | null;
  stateAfter: StateSnapshot | null;
  actions: TurnActionTrace[];
  response: { planIntent: string | null; sent: boolean; chars: number; textHash: string | null };
  latencyMs: { understanding: number; state: number; actions: number; response: number; total: number };
  errorCode?: string;
  /** FASE 8 — errores BA-* del turno (entendimiento + acciones), para agrupar por clase en observabilidad. */
  baErrors?: string[];
  /** FASE 9 — correlación del mensaje (hash de tenant + wamid) y referencia de soporte que ve el cliente en un error. */
  correlationId?: string;
  supportRef?: string;
  at: string;
}

export function shortHash(value: string, length = 12): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function understandingTrace(u: TurnUnderstanding | undefined): TurnUnderstandingTrace | null {
  if (!u) return null;
  if (!u.ok) return { ok: false, errorCategory: u.category, errorCode: u.code };
  const x = u.understanding;
  const p = x.provenance;
  return {
    ok: true,
    intent: x.intent.primary.intent,
    band: x.intent.primary.band,
    secondary: x.intent.secondary.map((s) => s.intent),
    slots: Object.fromEntries(Object.entries(x.slots).map(([k, v]) => [k, v.normalizedBy ? `${v.status}:${v.normalizedBy}` : v.status])),
    ...(u.entities && Object.keys(u.entities).length
      ? { entities: Object.fromEntries(Object.entries(u.entities).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "object" ? `${v.slot}#${v.index}` : String(v)])) }
      : {}),
    ambiguities: x.ambiguities.map((a) => (a.slot ? `${a.kind}:${a.slot}` : a.kind)),
    handoff: x.signals.handoff.requested ? x.signals.handoff.source : null,
    provider: p.provider,
    ...(p.model ? { model: p.model } : {}),
    ...(p.attempts ? { attempts: p.attempts } : {}),
    ...(p.usage?.inputTokens !== undefined ? { inputTokens: p.usage.inputTokens } : {}),
    ...(p.usage?.outputTokens !== undefined ? { outputTokens: p.usage.outputTokens } : {}),
    offeringsInContext: u.offeringsInContext,
  };
}

export function defaultTurnTraceSink(trace: BusinessAgentTurnTrace): void {
  console.info("[business-agent.turn]", JSON.stringify(trace));
}
