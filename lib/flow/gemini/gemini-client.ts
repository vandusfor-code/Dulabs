/**
 * Boundary aislado Gemini — API key solo aquí (FASE B, autorizado). Mismo
 * patrón que lib/flow/claude/anthropic-client.ts: la clave nunca se loguea,
 * nunca viaja en la URL (siempre header `x-goog-api-key`), y solo se lee de
 * `GEMINI_KEY` (misma variable ya validada en la prueba aislada de FASE B).
 */
import type { GeminiGenerateContentClient, GeminiGenerateContentResult } from "@/lib/flow/gemini/gemini-types";

// Confirmado en vivo durante la prueba aislada de FASE B: gemini-2.0-flash
// quedó deprecado y la propia API recomienda gemini-3.6-flash como reemplazo.
const DEFAULT_MODEL = "gemini-3.6-flash";

export function createGeminiGenerateContentClient(apiKey: string): GeminiGenerateContentClient {
  return {
    async generateContent(params, signal) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: params.systemInstruction }] },
            contents: params.contents.map((c) => ({ role: c.role, parts: [{ text: c.text }] })),
            generationConfig: {
              temperature: params.temperature ?? 0.7,
              maxOutputTokens: params.maxOutputTokens,
              responseMimeType: "application/json",
              responseSchema: params.responseSchema,
            },
          }),
          signal,
        },
      );

      if (!res.ok) {
        const detalle = await res.text().catch(() => "");
        const err = new Error(`gemini_http_${res.status}: ${detalle.slice(0, 300)}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        modelVersion?: string;
      };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? null;
      return {
        text,
        usage: {
          promptTokenCount: data.usageMetadata?.promptTokenCount,
          candidatesTokenCount: data.usageMetadata?.candidatesTokenCount,
        },
        model: data.modelVersion,
      } satisfies GeminiGenerateContentResult;
    },
  };
}

export function resolveGeminiApiKeyFromEnv(): string | null {
  return process.env.GEMINI_KEY ?? null;
}

export { DEFAULT_MODEL as GEMINI_DEFAULT_MODEL };
