import Anthropic from "@anthropic-ai/sdk";
import type { SurveyQuestion } from "@/lib/survey-builder";
import { scaleRange } from "@/lib/survey-builder";

// Capa de IA que envuelve al motor determinístico (lib/survey-engine.ts) sin
// tocarlo — la máquina de estados sigue siendo la única fuente de verdad de
// qué pregunta toca y si una respuesta es válida (sección 17 del spec: "la
// IA interpreta y redacta; el backend decide"). Esta capa solo hace dos
// cosas, cada una con su propio candado de seguridad:
//
// 1. interpretarRespuestaEncuesta: cuando el texto libre del participante no
//    calzó con la validación literal del motor (ej. "me fue mal" contra una
//    pregunta de calificación 1-10), propone un valor normalizado. NUNCA
//    persiste nada — el texto propuesto se vuelve a pasar por
//    validateAnswer() dentro de handleMessage(), así que un valor mal
//    propuesto simplemente vuelve a fallar la validación real.
// 2. redactarPreguntaCalida: reescribe SOLO el enunciado de la pregunta para
//    que suene conversacional. Las instrucciones obligatorias (rango,
//    opciones) las sigue agregando questionPrompt() por su cuenta, nunca la
//    IA — así una reescritura nunca puede omitir o inventar una opción.
//
// Si la IA no está disponible o falla, ambas funciones devuelven null y el
// llamador (app/webhook-dulabs/route.ts) cae de vuelta al comportamiento
// determinístico de siempre — nunca bloquea el envío del mensaje.

const MODELO = "claude-opus-4-8";

export type Sentimiento = "positivo" | "negativo" | null;

export interface InterpretacionRespuesta {
  /** Texto normalizado para reintentar con el motor (ej. "3"), o null si la
   * IA no propone ningún valor (el llamador debe quedarse con la aclaración
   * determinística original). */
  textoNormalizado: string | null;
  sentimiento: Sentimiento;
}

function contextoPregunta(pregunta: SurveyQuestion): string {
  const rango = scaleRange(pregunta.type);
  const lineas = [
    `Pregunta actual: "${pregunta.text}"`,
    `Tipo: ${pregunta.type}`,
    rango ? `Formato de respuesta válido: un número entero del ${rango[0]} al ${rango[1]}.` : "",
    pregunta.type === "yes_no" ? "Formato de respuesta válido: Sí o No." : "",
    pregunta.options?.length ? `Opciones válidas (deben coincidir con una de estas EXACTAMENTE): ${pregunta.options.join(" | ")}` : "",
  ];
  return lineas.filter(Boolean).join("\n");
}

/**
 * Interpreta un mensaje libre del participante que NO validó literalmente
 * contra la pregunta actual, buscando qué quiso responder. Conservador a
 * propósito: es preferible devolver null (y dejar que el motor pida
 * aclaración) a inventar un valor que el participante no dijo.
 */
export async function interpretarRespuestaEncuesta(params: {
  apiKey: string;
  pregunta: SurveyQuestion;
  textoUsuario: string;
}): Promise<InterpretacionRespuesta> {
  const { apiKey, pregunta, textoUsuario } = params;
  const anthropic = new Anthropic({ apiKey });

  const tool: Anthropic.Tool = {
    name: "interpretar",
    description: "Registra qué entendiste del mensaje del participante para la pregunta actual de la encuesta.",
    input_schema: {
      type: "object",
      properties: {
        valor: {
          type: "string",
          description:
            "Lo que el participante quiso responder, en el formato EXACTO que exige el tipo de pregunta (un número dentro del rango, 'Sí'/'No', o el texto EXACTO de una opción válida de la lista). " +
            "Para preguntas de calificación (rating/NPS) o Sí/No, SÍ puedes inferir el valor a partir de una emoción claramente expresada (ej. 'me fue muy mal' -> un número bajo del rango; 'todo excelente' -> un número alto). " +
            "Para preguntas de opción múltiple, NUNCA inventes cuál opción eligió si no la nombró o describió con claridad -- omite este campo en ese caso. " +
            "Si el mensaje no responde la pregunta en absoluto (habla de otra cosa, hace una pregunta), omite este campo.",
        },
        sentimiento: {
          type: "string",
          enum: ["positivo", "negativo", "neutral"],
          description: "Tono emocional del mensaje, solo si es claro. 'neutral' si no hay ninguno perceptible.",
        },
      },
      required: ["sentimiento"],
    },
  };

  try {
    const response = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 300,
      system:
        "Interpretas UN mensaje de un participante de encuesta por WhatsApp para identificar qué quiso responder a la pregunta actual. " +
        "No inventes datos que el participante no dio a entender. Sé conservador: ante la duda, no propongas ningún valor.\n\n" +
        contextoPregunta(pregunta),
      tools: [tool],
      tool_choice: { type: "tool", name: "interpretar" },
      messages: [{ role: "user", content: textoUsuario }],
    });

    const bloque = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!bloque) return { textoNormalizado: null, sentimiento: null };
    const input = bloque.input as { valor?: string; sentimiento?: "positivo" | "negativo" | "neutral" };
    return {
      textoNormalizado: input.valor?.trim() || null,
      sentimiento: input.sentimiento === "neutral" ? null : (input.sentimiento ?? null),
    };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error("[survey-agent-ia] IA rate-limited (interpretar)");
    } else if (err instanceof Anthropic.APIError) {
      console.error(`[survey-agent-ia] error de IA ${err.status} (interpretar):`, err.message);
    } else {
      console.error("[survey-agent-ia] error de IA (interpretar):", err instanceof Error ? err.message : err);
    }
    return { textoNormalizado: null, sentimiento: null };
  }
}

/**
 * Reescribe el enunciado de una pregunta para que suene cercano y
 * conversacional, preservando su significado exacto. Las instrucciones de
 * cómo responder (rango, opciones) NO se generan aquí — questionPrompt() las
 * sigue agregando aparte, sin cambios.
 */
export async function redactarPreguntaCalida(params: {
  apiKey: string;
  pregunta: SurveyQuestion;
  brandName: string;
}): Promise<string | null> {
  const { apiKey, pregunta, brandName } = params;
  const anthropic = new Anthropic({ apiKey });
  try {
    const response = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 200,
      system:
        `Reescribes UNA pregunta de encuesta de "${brandName}" para que suene cercana y conversacional en un mensaje de WhatsApp, como la haría una persona real, no un formulario. ` +
        "Reglas: conserva EXACTAMENTE lo que se está midiendo, no cambies el tema ni agregues datos u opciones que no estén en el original. " +
        "No agregues instrucciones de cómo responder (eso se agrega aparte). Máximo 2 frases cortas. " +
        "Responde SOLO con la pregunta reescrita, sin comillas ni explicación.",
      messages: [{ role: "user", content: pregunta.text }],
    });
    const texto = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return texto || null;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error("[survey-agent-ia] IA rate-limited (redactar)");
    } else if (err instanceof Anthropic.APIError) {
      console.error(`[survey-agent-ia] error de IA ${err.status} (redactar):`, err.message);
    } else {
      console.error("[survey-agent-ia] error de IA (redactar):", err instanceof Error ? err.message : err);
    }
    return null;
  }
}

// Frases de empatía FIJAS (no generadas por IA): así queda garantizado un
// tono correcto siempre, sin riesgo de que el modelo diga algo fuera de
// lugar, y sin una llamada extra a la IA solo para una línea. Varias
// variantes por polaridad para que no se sienta repetido en encuestas
// largas con varias respuestas negativas/positivas.
const EMPATIA_NEGATIVA = [
  "Lamento mucho escuchar eso 💛 Justo por comentarios como el tuyo hacemos esta encuesta, para poder mejorar.",
  "De verdad lamento esa experiencia 💛 Tu respuesta nos ayuda a identificar qué corregir.",
  "Gracias por ser sincero, aunque no haya sido una buena experiencia 💛 Es justo lo que necesitamos saber para mejorar.",
];
const EMPATIA_POSITIVA = [
  "¡Qué bueno leer eso! 😊 Gracias por contarlo.",
  "¡Nos alegra mucho saberlo! 😊",
  "¡Excelente! Gracias por compartirlo 😊",
];

export function fraseEmpatica(sentimiento: Sentimiento): string | null {
  if (sentimiento === "negativo") return EMPATIA_NEGATIVA[Math.floor(Math.random() * EMPATIA_NEGATIVA.length)];
  if (sentimiento === "positivo") return EMPATIA_POSITIVA[Math.floor(Math.random() * EMPATIA_POSITIVA.length)];
  return null;
}
