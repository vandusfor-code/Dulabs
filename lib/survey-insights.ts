import Anthropic from "@anthropic-ai/sdk";
import { descifrarSecreto } from "@/lib/crypto";
import type { AIInsights } from "@/lib/surveys";

const MODELO = "claude-opus-4-8";
// Con menos respuestas, un análisis de "sentimiento general" no dice nada
// útil — se prefiere no llamar a la IA y mostrar un estado honesto de "aún
// no hay suficientes datos" en vez de forzar un número sin sentido.
const MIN_RESPUESTAS = 3;

// Clasifica el sentimiento y extrae temas recurrentes de las respuestas de
// texto libre reales de un tenant, vía un tool-use forzado (la respuesta es
// JSON válido garantizado por el schema, no texto a parsear a mano).
export async function analizarRespuestasTexto(
  respuestas: string[],
  apiKeyCifrada: string | null
): Promise<AIInsights | null> {
  if (respuestas.length < MIN_RESPUESTAS) return null;
  const apiKey = apiKeyCifrada ? descifrarSecreto(apiKeyCifrada) : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const anthropic = new Anthropic({ apiKey });
  const muestra = respuestas.slice(0, 200);

  try {
    const response = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 1024,
      tools: [
        {
          name: "clasificar_respuestas",
          description:
            "Clasifica el sentimiento de cada respuesta de texto libre de una encuesta y extrae los temas más recurrentes.",
          input_schema: {
            type: "object",
            properties: {
              positivas: { type: "integer", description: "Cantidad de respuestas con sentimiento positivo" },
              neutrales: { type: "integer", description: "Cantidad de respuestas con sentimiento neutral" },
              negativas: { type: "integer", description: "Cantidad de respuestas con sentimiento negativo" },
              temas: {
                type: "array",
                maxItems: 5,
                items: {
                  type: "object",
                  properties: {
                    tema: { type: "string" },
                    menciones: { type: "integer" },
                  },
                  required: ["tema", "menciones"],
                },
              },
            },
            required: ["positivas", "neutrales", "negativas", "temas"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "clasificar_respuestas" },
      messages: [
        {
          role: "user",
          content: `Estas son ${muestra.length} respuestas de texto libre de encuestas de satisfacción. Clasifica cada una como positiva, neutral o negativa, y extrae hasta 5 temas recurrentes con cuántas respuestas los mencionan:\n\n${muestra
            .map((r, i) => `${i + 1}. ${r}`)
            .join("\n")}`,
        },
      ],
    });

    const bloque = response.content.find((b) => b.type === "tool_use");
    if (!bloque || bloque.type !== "tool_use") return null;
    const datos = bloque.input as {
      positivas: number;
      neutrales: number;
      negativas: number;
      temas: { tema: string; menciones: number }[];
    };

    const totalSentimiento = Math.max(1, datos.positivas + datos.neutrales + datos.negativas);
    const pctSentimiento = (n: number) => Math.round((n / totalSentimiento) * 100);
    const totalMenciones = Math.max(1, datos.temas.reduce((a, t) => a + t.menciones, 0));

    return {
      completedResponses: respuestas.length,
      sentiment: {
        positive: { percentage: pctSentimiento(datos.positivas), count: datos.positivas },
        neutral: { percentage: pctSentimiento(datos.neutrales), count: datos.neutrales },
        negative: { percentage: pctSentimiento(datos.negativas), count: datos.negativas },
      },
      topics: datos.temas
        .slice(0, 5)
        .map((t) => ({ label: t.tema, percentage: Math.round((t.menciones / totalMenciones) * 100) })),
    };
  } catch (err) {
    console.error("[survey-insights] error analizando respuestas:", err instanceof Error ? err.message : err);
    return null;
  }
}
