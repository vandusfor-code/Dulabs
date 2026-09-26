// Business Agent 2.0, FASE 2 — utilidades de test del Understanding Engine (sin red).
//
// `scriptedProvider` devuelve una salida fija "como si" la hubiera producido el modelo: los tests prueban lo que hace
// el BACKEND con esa salida (validar, normalizar, rechazar), que es la parte determinista. `executorBackedProvider`
// pasa por el GeminiExecutor REAL (prompt builder, responseSchema, parse) con un cliente Gemini simulado (sin red).

import { GeminiExecutor } from "@/lib/flow/executors/gemini-executor";
import type { GeminiGenerateContentParams, GeminiGenerateContentResult } from "@/lib/flow/gemini/gemini-types";
import type { UnderstandingEvent } from "@/lib/agent-compiler/understanding/engine";
import type { UnderstandingInput } from "@/lib/agent-compiler/understanding/context";
import {
  createExecutorUnderstandingProvider,
  type UnderstandingProvider,
  type UnderstandingProviderRequest,
  type UnderstandingProviderResult,
} from "@/lib/agent-compiler/understanding/provider";
import type { SlotDefinition } from "@/lib/agent-compiler/understanding/slots";

export const TENANT = "11111111-1111-4111-8111-111111111111";
export const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
export const CONVERSATION = "conv-pn-a:573001112233";
export const CONTACT = "573001112233";

/** Sábado 26 de septiembre de 2026, 10:00 en Bogotá (15:00 UTC). */
export const FIXED_NOW = new Date("2026-09-26T15:00:00Z");
export const fixedClock = () => FIXED_NOW;

export function scriptedProvider(output: unknown, calls: UnderstandingProviderRequest[] = []): UnderstandingProvider {
  return {
    name: "scripted",
    async understand(req): Promise<UnderstandingProviderResult> {
      calls.push(req);
      return { ok: true, output, provider: "scripted" };
    },
  };
}

/**
 * `extracted` = salida del entendimiento; si ya trae `mode`, se usa tal cual como JSON de respuesta. Un string se
 * devuelve crudo (para simular JSON truncado o inválido de la API).
 */
export function executorBackedProvider(extracted: unknown, seen: GeminiGenerateContentParams[] = []): UnderstandingProvider {
  const body = extracted && typeof extracted === "object" && "mode" in extracted ? extracted : { mode: "extract", extracted };
  const text = typeof extracted === "string" ? extracted : JSON.stringify(body);
  const executor = new GeminiExecutor({
    resolveApiKey: async () => "test-key",
    geminiClient: {
      async generateContent(params): Promise<GeminiGenerateContentResult> {
        seen.push(params);
        return { text, usage: { promptTokenCount: 10, candidatesTokenCount: 10 }, model: "gemini-test" };
      },
    },
  });
  return createExecutorUnderstandingProvider({ dispatch: (req) => executor.dispatch(req, { tenantId: req.tenantId, internal: true }) });
}

export function input(text: string, over: Partial<UnderstandingInput> & { businessSlots?: SlotDefinition[]; knownSlots?: Record<string, string>; pending?: { ref: string; summary: string }; lastQuestion?: string } = {}): UnderstandingInput {
  const { businessSlots, knownSlots, pending, lastQuestion, ...rest } = over;
  return {
    scope: { tenantId: TENANT, conversationId: CONVERSATION, contactId: CONTACT, agentId: "agent-1" },
    message: { text },
    conversation: {
      tenantId: TENANT,
      conversationId: CONVERSATION,
      contactId: CONTACT,
      knownSlots,
      pendingConfirmation: pending,
      lastAgentQuestion: lastQuestion,
    },
    business: { tenantId: TENANT, agentId: "agent-1", businessName: "Negocio de prueba", businessTimezone: "America/Bogota", businessSlots },
    ...rest,
  };
}

/** Salida del modelo con valores por defecto válidos. */
export function llm(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { primaryIntent: { intent: "UNKNOWN", confidence: 0.5 }, secondaryIntents: [], slots: [], ambiguities: [], language: "es", ...over };
}

export function intent(name: string, confidence = 0.9) {
  return { intent: name, confidence };
}

export function silentLog(events: UnderstandingEvent[] = []) {
  return (e: UnderstandingEvent) => {
    events.push(e);
  };
}
