/**
 * GeminiProvider — adaptador del contrato neutral a la API REST de Gemini
 * (generateContent v1beta) con FUNCTION CALLING real.
 *
 * Contrato verificado contra los tipos oficiales de @google/genai (2.24.0):
 *   - tools[].functionDeclarations[] { name, description, parametersJsonSchema }
 *   - toolConfig.functionCallingConfig { mode: VALIDATED | NONE, allowedFunctionNames }
 *     (VALIDATED = el modelo responde texto O llama herramientas, SOLO de la lista)
 *   - partes con functionCall { id?, name, args } y thoughtSignature (opaca)
 *   - la respuesta a una herramienta viaja como parte functionResponse { id?, name, response }
 *   - generationConfig.thinkingConfig.thinkingLevel: MINIMAL | LOW | MEDIUM | HIGH
 *   - finishReason, promptFeedback.blockReason, usageMetadata
 *
 * Reglas:
 *   - El turno del modelo se devuelve TAL CUAL en el siguiente paso (partes
 *     originales, con sus firmas de pensamiento): Gemini 3 lo exige para
 *     continuar un razonamiento con herramientas.
 *   - La API key viaja solo en el header x-goog-api-key; nunca en la URL, en
 *     un error ni en un registro.
 *   - Aislado a propósito de lib/flow/gemini/gemini-client.ts (lo usan AMORE y
 *     el Flow Engine): cambiar este archivo no cambia su comportamiento.
 *   - Sin dependencias nuevas: fetch nativo, como el resto del repo.
 */
import { z } from "zod";
import {
  AIProviderError,
  type AIFinishReason,
  type AIGenerateRequest,
  type AIGenerateResult,
  type AIProvider,
  type AIToolCall,
  type AITurn,
} from "@/lib/ia-proveedores/contrato";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
/** Prefijo de ids asignados localmente cuando Gemini no envía uno (no se reenvían a la API). */
const LOCAL_ID_PREFIX = "gemini-local-";

export interface GeminiProviderOptions {
  apiKey: string;
  /** Solo pruebas / E2E local. En producción siempre la URL oficial. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

// --- Respuesta (se valida la forma; lo desconocido se ignora) ---------------

const partSchema = z
  .object({
    text: z.string().optional(),
    thought: z.boolean().optional(),
    thoughtSignature: z.string().optional(),
    functionCall: z
      .object({ id: z.string().optional(), name: z.string().min(1), args: z.record(z.string(), z.unknown()).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const responseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z.object({ role: z.string().optional(), parts: z.array(partSchema).optional() }).passthrough().optional(),
            finishReason: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    promptFeedback: z.object({ blockReason: z.string().optional() }).passthrough().optional(),
    usageMetadata: z
      .object({
        promptTokenCount: z.number().optional(),
        candidatesTokenCount: z.number().optional(),
        thoughtsTokenCount: z.number().optional(),
        cachedContentTokenCount: z.number().optional(),
      })
      .passthrough()
      .optional(),
    modelVersion: z.string().optional(),
  })
  .passthrough();

type GeminiPart = z.infer<typeof partSchema>;

const SAFETY_FINISH = new Set(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "RECITATION", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "IMAGE_RECITATION"]);
const INVALID_OUTPUT_FINISH = new Set(["MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL", "TOO_MANY_TOOL_CALLS"]);

function finishOf(raw: string | undefined, toolCalls: AIToolCall[]): AIFinishReason {
  if (raw && SAFETY_FINISH.has(raw)) return "safety";
  if (raw && INVALID_OUTPUT_FINISH.has(raw)) return "invalid_output";
  if (raw === "MAX_TOKENS") return "max_tokens";
  if (toolCalls.length > 0) return "tool_calls";
  if (raw === "STOP" || raw === undefined) return "stop";
  return "other";
}

const THINKING: Record<NonNullable<AIGenerateRequest["thinking"]>, string> = { minimal: "MINIMAL", low: "LOW", medium: "MEDIUM", high: "HIGH" };

/** JSON Schema de zod -> parametersJsonSchema (sin la meta-clave $schema). */
function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "$schema"));
}

function turnToContent(turn: AITurn): Record<string, unknown> {
  if (turn.role === "user") return { role: "user", parts: [{ text: turn.text }] };
  if (turn.role === "tool") {
    return {
      role: "user",
      parts: turn.results.map((r) => ({
        functionResponse: { ...(r.callId.startsWith(LOCAL_ID_PREFIX) ? {} : { id: r.callId }), name: r.name, response: r.output },
      })),
    };
  }
  // Turno del modelo: si es de Gemini, las partes ORIGINALES (con thoughtSignature); si no, se reconstruye.
  if (turn.continuation?.provider === "gemini" && Array.isArray(turn.continuation.data)) {
    return { role: "model", parts: turn.continuation.data };
  }
  return {
    role: "model",
    parts: [
      ...(turn.text ? [{ text: turn.text }] : []),
      ...turn.toolCalls.map((c) => ({ functionCall: { ...(c.id.startsWith(LOCAL_ID_PREFIX) ? {} : { id: c.id }), name: c.name, args: c.args } })),
    ],
  };
}

/** Cuerpo exacto de generateContent (exportado para las pruebas de contrato). */
export function buildGeminiRequestBody(req: AIGenerateRequest): Record<string, unknown> {
  const names = req.tools.map((t) => t.name);
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.turns.map(turnToContent),
    ...(req.tools.length > 0
      ? {
          tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: cleanSchema(t.parameters) })) }],
          toolConfig: { functionCallingConfig: req.toolMode === "none" ? { mode: "NONE" } : { mode: "VALIDATED", allowedFunctionNames: names } },
        }
      : {}),
    generationConfig: {
      maxOutputTokens: req.maxOutputTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.thinking ? { thinkingConfig: { thinkingLevel: THINKING[req.thinking] } } : {}),
    },
  };
}

/** Interpreta la respuesta HTTP 200 de Gemini (exportado para las pruebas de contrato). */
export function parseGeminiResponse(raw: unknown, requestedModel: string, latencyMs: number): AIGenerateResult {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new AIProviderError("invalid_response", "gemini");
  const data = parsed.data;
  const candidate = data.candidates?.[0];
  if (!candidate) {
    if (data.promptFeedback?.blockReason) throw new AIProviderError("safety_blocked", "gemini", { providerCode: data.promptFeedback.blockReason });
    throw new AIProviderError("invalid_response", "gemini");
  }
  const parts: GeminiPart[] = candidate.content?.parts ?? [];
  const toolCalls: AIToolCall[] = [];
  parts.forEach((p, i) => {
    if (p.functionCall) toolCalls.push({ id: p.functionCall.id ?? `${LOCAL_ID_PREFIX}${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} });
  });
  // Las partes de pensamiento nunca son respuesta al cliente.
  const text = parts
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  const usage = data.usageMetadata;
  return {
    provider: "gemini",
    model: data.modelVersion ?? requestedModel,
    text: text.length > 0 ? text : null,
    toolCalls,
    finish: finishOf(candidate.finishReason, toolCalls),
    usage: {
      inputTokens: usage?.promptTokenCount ?? null,
      outputTokens: usage?.candidatesTokenCount ?? null,
      thinkingTokens: usage?.thoughtsTokenCount ?? null,
      cachedTokens: usage?.cachedContentTokenCount ?? null,
    },
    continuation: parts.length > 0 ? { provider: "gemini", data: parts } : null,
    latencyMs,
  };
}

/** Error HTTP -> error normalizado. Solo el estado y el código corto de Google; nunca el mensaje (puede repetir contenido). */
export function geminiHttpError(status: number, body: unknown): AIProviderError {
  const code = (body as { error?: { status?: unknown } } | null)?.error?.status;
  const providerCode = typeof code === "string" && /^[A-Z_]{2,40}$/.test(code) ? code : undefined;
  const detail = { httpStatus: status, providerCode };
  if (status === 401 || status === 403) return new AIProviderError("auth", "gemini", detail);
  if (status === 429) return new AIProviderError("rate_limit", "gemini", detail);
  if (status === 408 || status === 504) return new AIProviderError("timeout", "gemini", detail);
  if (status >= 500) return new AIProviderError("server", "gemini", detail);
  if (status >= 400) return new AIProviderError("invalid_request", "gemini", detail);
  return new AIProviderError("unknown", "gemini", detail);
}

export function createGeminiProvider(options: GeminiProviderOptions): AIProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  if (!options.apiKey) throw new AIProviderError("config", "gemini");

  return {
    id: "gemini",
    async generate(req, signal) {
      if (!/^[a-z0-9][a-z0-9.-]{1,60}$/.test(req.model)) throw new AIProviderError("config", "gemini");
      // Temporizador propio (no AbortSignal.timeout, que no mantiene vivo el
      // proceso) y liberado al terminar, cubre la petición y la lectura del cuerpo.
      const timeoutCtl = new AbortController();
      const timeout = timeoutCtl.signal;
      const timer = setTimeout(() => timeoutCtl.abort(), req.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const started = Date.now();
      try {
        let res: Response;
        try {
          res = await doFetch(`${baseUrl}/models/${req.model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": options.apiKey },
            body: JSON.stringify(buildGeminiRequestBody(req)),
            signal: combined,
          });
        } catch (err) {
          if (timeout.aborted || signal?.aborted) throw new AIProviderError("timeout", "gemini");
          void err;
          throw new AIProviderError("network", "gemini");
        }
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          if (timeout.aborted || signal?.aborted) throw new AIProviderError("timeout", "gemini");
          if (res.ok) throw new AIProviderError("invalid_response", "gemini", { httpStatus: res.status });
        }
        if (!res.ok) throw geminiHttpError(res.status, body);
        return parseGeminiResponse(body, req.model, Date.now() - started);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
