// DuLabs Business — Agent Compiler, Step 8 — puertos de PRODUCCIÓN.
//
// Adaptadores finos sobre abstracciones REALES existentes (no se duplica
// ninguna): envío de WhatsApp, pausa/handoff, claim atómico de idempotencia y
// clasificador semántico Claude. Todos inyectables para test.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";
import { enviarWhatsApp } from "@/lib/whatsapp-outbound";
import { activarPausaChat } from "@/lib/pausas-chat";
import { ClaudeExecutor } from "@/lib/flow/executors/claude-executor";
import { resolveAnthropicApiKeyFromEnv } from "@/lib/flow/claude/anthropic-client";
import type { EffectDispatchRequest, EffectDispatchResult } from "@/lib/flow/executor-types";
import type { GateActionSink, GateIdempotencyStore } from "@/lib/agent-compiler/runtime/agent-runtime";
import { GATE_CONTINUE_LABEL, type SemanticClassifier } from "@/lib/agent-compiler/runtime/guardrail-gate";

// ---------------------------------------------------------------------------
// GateActionSink real — reutiliza enviarWhatsApp + activarPausaChat.
// ---------------------------------------------------------------------------

/**
 * Sink de acciones del Gate sobre las funciones REALES existentes. `cliente`
 * porta el token/número (el sink nunca lo expone). La transferencia = enviar
 * el mensaje configurado (si hay) + activar la pausa humana por chat.
 */
export function createWhatsAppGateSink(
  supabase: SupabaseClient,
  cliente: ClienteConfig,
): GateActionSink {
  return {
    async sendMessage({ conversation, text }) {
      await enviarWhatsApp(supabase, cliente, conversation.telefonoCliente, text);
    },
    async transferHuman({ conversation, text, pauseHours }) {
      if (text) await enviarWhatsApp(supabase, cliente, conversation.telefonoCliente, text);
      await activarPausaChat(supabase, cliente.phone_number_id, conversation.telefonoCliente, Math.max(1, pauseHours) * 60 * 60 * 1000);
    },
  };
}

// ---------------------------------------------------------------------------
// GateIdempotencyStore real — claim atómico sobre dulabs_mensajes_log.
// ---------------------------------------------------------------------------

/**
 * Claim atómico de idempotencia por wamid, con el MISMO mecanismo que el
 * webhook real (UPDATE ... WHERE procesado_at IS NULL RETURNING id — atómico a
 * nivel de fila en Postgres). Devuelve true SOLO al ganador; los demás (mismo
 * wamid, aún concurrentes) obtienen false. Precondición: la fila entrante ya
 * fue registrada (el webhook lo hace de forma síncrona antes de responder 200).
 *
 * NOTA de integración: cuando el boundary corre DENTRO del webhook, el webhook
 * YA ejecutó este claim en atenderMensaje; en ese caso NO se pasa este store al
 * runtime (la deduplicación por ejecución del orquestador — dulabs_flow_events,
 * event_id=wamid — es la segunda barrera). Este adapter se usa para el camino
 * standalone y para probar la atomicidad.
 */
export function createMensajesLogIdempotency(supabase: SupabaseClient): GateIdempotencyStore {
  return {
    async claim(_tenantId, wamid) {
      const { data, error } = await supabase
        .from("dulabs_mensajes_log")
        .update({ procesado_at: new Date().toISOString() })
        .eq("wamid", wamid)
        .is("procesado_at", null)
        .select("id")
        .maybeSingle();
      if (error) {
        // Fail-closed: ante un error del claim, NO procesar (evita doble efecto).
        return false;
      }
      return Boolean(data);
    },
  };
}

// ---------------------------------------------------------------------------
// SemanticClassifier real — Claude en modo classify (SOLO clasifica).
// ---------------------------------------------------------------------------

/** Dispatch de IA inyectable (para test). En prod = ClaudeExecutor real. */
export type ClassifierDispatch = (req: EffectDispatchRequest) => Promise<EffectDispatchResult>;

function claudeDispatch(req: EffectDispatchRequest): Promise<EffectDispatchResult> {
  const executor = new ClaudeExecutor({ resolveApiKey: async () => resolveAnthropicApiKeyFromEnv() });
  return executor.dispatch(req, { tenantId: req.tenantId, internal: true });
}

/**
 * Clasificador semántico del Gate respaldado por Claude en modo classify. SOLO
 * interpreta lenguaje → devuelve una etiqueta de la lista dada. NUNCA decide la
 * acción (la política es de DuLabs, en la regla del Gate). Fail-safe: cualquier
 * error/ausencia => null (sin bloquear; las críticas son deterministas).
 */
export function createClaudeSemanticClassifier(deps: { tenantId: string; dispatch?: ClassifierDispatch }): SemanticClassifier {
  const dispatch = deps.dispatch ?? claudeDispatch;
  return async ({ message, labels }) => {
    const req: EffectDispatchRequest = {
      effectId: randomUUID(),
      executionRowId: `gate-classifier:${randomUUID()}`,
      tenantId: deps.tenantId,
      nodeId: "gate-policy-classifier",
      attempt: 1,
      kind: "ai",
      payload: { __userMessage: message },
      ai: {
        mode: "classify",
        instruction:
          "Clasifica la intención del mensaje del cliente en UNA de las etiquetas de política dadas. " +
          `Si ninguna aplica claramente, responde "${GATE_CONTINUE_LABEL}". No respondas al cliente ni ejecutes nada: solo clasifica.`,
        classifications: labels,
      },
    };

    let result: EffectDispatchResult;
    try {
      result = await dispatch(req);
    } catch {
      return null;
    }
    if (!result.success) return null;
    const data = (result.appliedResult ?? result.data ?? {}) as Record<string, unknown>;
    const label = typeof data.classification === "string" ? data.classification : null;
    if (!label || !labels.includes(label)) return null;
    return { label };
  };
}
