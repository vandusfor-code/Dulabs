/**
 * Adapta el JSON Schema genérico de buildAiOutputToolSchema (compartido con
 * Claude, lib/flow/claude/claude-output-schema.ts) al subconjunto que acepta
 * generationConfig.responseSchema de Gemini -- que NO reconoce
 * `additionalProperties` (a diferencia del input_schema de un tool de
 * Anthropic). Nunca se reescribe el schema a mano por proveedor: se deriva
 * SIEMPRE del mismo buildAiOutputToolSchema, así ambos executors quedan
 * forzados a aceptar exactamente la misma forma de salida.
 */
export function toGeminiResponseSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiResponseSchema);
  if (schema === null || typeof schema !== "object") return schema;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "additionalProperties") continue;
    out[key] = toGeminiResponseSchema(value);
  }
  return out;
}
